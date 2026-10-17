import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import type { RoomState } from "../lib/types.ts";

// Exercise the actual Worker handlers and SQL using only an in-memory D1 adapter.
type FixtureEnvironment = {
  DB?: {
    prepare(sql: string): {
      bind(...args: SQLInputValue[]): {
        first(): Promise<Record<string, SQLOutputValue> | null>;
        run(): Promise<{ meta: { changes: number } }>;
      };
    };
  };
  YOUTUBE_API_KEY?: string;
};
const syntheticEnv: FixtureEnvironment = {};
const globals = globalThis as typeof globalThis & { __roomTestEnv: FixtureEnvironment };
globals.__roomTestEnv = syntheticEnv;
const moduleUrl = (source: string) =>
  "data:text/javascript," + encodeURIComponent(source);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers")
      return {
        url: moduleUrl("export const env=globalThis.__roomTestEnv;"),
        shortCircuit: true,
      };
    if (
      context.parentURL?.endsWith("/lib/server.ts") &&
      specifier === "./admin-session"
    )
      return {
        url: moduleUrl("export const hasPasswordSession=async()=>false;"),
        shortCircuit: true,
      };
    if (
      context.parentURL?.endsWith("/lib/server.ts") &&
      specifier === "./party"
    )
      return {
        url: moduleUrl(
          'export const recordPlay=async()=>{throw new Error("Unexpected playback history write");};',
        ),
        shortCircuit: true,
      };
    if (
      context.parentURL?.endsWith("/lib/server.ts") &&
      specifier === "./core-server"
    )
      return next("./core-server.ts", context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith("/lib/server.ts"))
      return {
        format: "module",
        source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), {
          mode: "transform",
        }),
        shortCircuit: true,
      };
    return next(url, context);
  },
});
const { mutate: mutateHandler, hash, publicRoom } = await import("../lib/server.ts");
hooks.deregister();
const mutate = async (...args: Parameters<typeof mutateHandler>) => {
  const result = await mutateHandler(...args);
  assert(result.room, "The tested room mutation must return the resulting room");
  return { ...result, room: result.room };
};
const seed = {
  id: "seed1234567",
  title: "Syn Cole - Feel Good | Future House | NCS - Copyright Free",
  artist: "NCS",
  image: "",
  duration: 200,
  live: false,
  embeddable: true,
};
const next = { ...seed, id: "next1234567", title: "Other Artist - Synthetic next | Future House" };
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    sqlite.exec(
      readFileSync(new URL("../drizzle/" + file, import.meta.url), "utf8"),
    );
  syntheticEnv.DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              return sqlite.prepare(sql).get(...args) ?? null;
            },
            async run() {
              return {
                meta: {
                  changes: Number(sqlite.prepare(sql).run(...args).changes),
                },
              };
            },
          };
        },
      };
    },
  };
  syntheticEnv.YOUTUBE_API_KEY = "synthetic-key";
  const request = new Request("https://site.example/api/rooms/TESTROOM", {
    headers: { authorization: "Bearer synthetic-host" },
  });
  const save = async (
    code = "TESTROOM",
    state: RoomState = { current: seed, queue: [], playing: true, position: 199 },
  ) =>
    sqlite
      .prepare(
        "INSERT INTO rooms(code,name,owner_hash,state,version,updated_at,expires_at) VALUES(?,?,?,?,1,?,?)",
      )
      .run(
        code,
        "Synthetic room",
        await hash("synthetic-host"),
        JSON.stringify(state),
        Date.now(),
        Date.now() + 60000,
      );
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (target) => {
    const url = new URL(typeof target === "string" ? target : target instanceof URL ? target.href : target.url);
    assert.equal(url.origin, "https://www.googleapis.com");
    calls++;
    if (url.pathname.endsWith("/search"))
      return Response.json({ items: [{ id: { videoId: next.id } }] });
    return Response.json({
      items: [
        {
          id: next.id,
          snippet: { title: next.title, channelTitle: next.artist },
          contentDetails: { duration: "PT3M20S" },
          status: { embeddable: true },
        },
      ],
    });
  };
  const roomRow = (code = "TESTROOM"): Parameters<typeof publicRoom>[1] => {
    const value = sqlite.prepare("SELECT * FROM rooms WHERE code=?").get(code);
    assert(value);
    const { name, owner_hash, state, version, updated_at, expires_at } = value;
    assert(typeof name === "string" && typeof owner_hash === "string" && typeof state === "string");
    assert(typeof version === "number" && typeof updated_at === "number" && typeof expires_at === "number");
    return {
      code, name, owner_hash, state, version, updated_at, expires_at,
      ...(typeof value.guild_id === "string" ? { guild_id: value.guild_id } : {}),
      ...(typeof value.is_public === "number" ? { is_public: value.is_public } : {}),
    };
  };
  return {
    sqlite,
    request,
    save,
    roomRow,
    roomState: (code = "TESTROOM") => JSON.parse(roomRow(code).state) as RoomState,
    calls: () => calls,
    close() {
      globalThis.fetch = originalFetch;
      delete syntheticEnv.DB;
      delete syntheticEnv.YOUTUBE_API_KEY;
      sqlite.close();
    },
  };
}
test("D1 own-room radio advances the queue, keeps manual priority and hides its bounded history", async () => {
  const f = fixture();
  try {
    await f.save();
    const { room } = await mutate(f.request, "TESTROOM", {
      action: "next",
      version: 1,
    });
    assert.equal(room.current?.id, next.id);
    assert.equal(room.playing, true);
    assert.equal(room.radio, true);
    assert.equal(room.version, 2);
    assert(!("radioHistory" in room));
    const saved = f.roomState();
    assert.equal(saved.radioHistory?.[0].id, seed.id);
    await f.save("MANUAL01", {
      current: seed,
      queue: [next],
      playing: true,
      position: 199,
    });
    const calls = f.calls();
    assert.equal(
      (await mutate(f.request, "MANUAL01", { action: "next", version: 1 })).room
        .current?.id,
      next.id,
    );
    assert.equal(f.calls(), calls);
    await f.save("DISCORD1");
    const offline = await publicRoom(
      f.request,
      {
        ...f.roomRow("DISCORD1"),
        updated_at: Date.now() - 20000,
      },
      false,
    );
    assert.equal(offline.playing, false);
  } finally {
    f.close();
  }
});
test("D1 own-room radio rejects guests and a result arriving after a pause", async () => {
  const f = fixture();
  try {
    await f.save();
    await assert.rejects(
      mutate(new Request(f.request.url), "TESTROOM", {
        action: "next",
        version: 1,
      }),
      (error: unknown) => error instanceof Error && "status" in error && error.status === 403,
    );
    assert.equal(f.calls(), 0);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      started = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      fetchMetadata = globalThis.fetch;
    globalThis.fetch = async (target) => {
      entered();
      await gate;
      return fetchMetadata(target);
    };
    const pending = mutate(f.request, "TESTROOM", {
      action: "next",
      version: 1,
    });
    await started;
    await mutate(f.request, "TESTROOM", { action: "pause", version: 1 });
    release();
    await assert.rejects(pending, (error: unknown) => error instanceof Error && "status" in error && error.status === 409);
    const saved = f.roomState();
    assert.equal(saved.current?.id, seed.id);
    assert.equal(saved.playing, false);
  } finally {
    f.close();
  }
});

test("D1 radio uses and persists its original choice after an automatic transition", async () => {
  const f = fixture();
  try {
    const changed = { ...seed, id: "changed0001", title: "Different Artist - Different style | Jazz", radio: true };
    await f.save("TESTROOM", { current: changed, queue: [], playing: true, position: 199, radioSeed: seed });
    const { room } = await mutate(f.request,"TESTROOM",{action:"next",version:1});
    assert.equal(room.current?.id,next.id);
    assert.equal(room.current?.radio,true);
    assert(!("radioSeed" in room));
    const saved=f.roomState();
    assert.equal(saved.radioSeed?.id,seed.id);
    assert.equal(saved.radioHistory?.[0].id,changed.id);
  } finally { f.close(); }
});
test("D1 radio refreshes old search metadata and excludes explicit non-music categories", async () => {
  const f = fixture();
  const bad = { ...next, id: "wrong000001", title: "Another Artist - A day in Paris | Future House" };
  try {
    await f.save();
    const query = 'future house audio -"Feel Good"';
    const oldVideos = [bad, next];
    for (const key of [`search:${query.toLowerCase()}`, `videos:${bad.id},${next.id}`]) {
      f.sqlite.prepare("INSERT INTO cached(key,data,expires_at) VALUES(?,?,?)")
        .run(key, JSON.stringify(oldVideos), Date.now() + 3600000);
    }
    const stages: string[] = [];
    globalThis.fetch = async (target) => {
      const url = new URL(typeof target === "string" ? target : target instanceof URL ? target.href : target.url);
      assert.equal(url.origin, "https://www.googleapis.com");
      if (url.pathname.endsWith("/search")) {
        stages.push("search");
        return Response.json({ items: oldVideos.map((video) => ({ id: { videoId: video.id } })) });
      }
      stages.push("metadata");
      return Response.json({ items: oldVideos.map((video) => ({
        id: video.id,
        snippet: { title: video.title, channelTitle: video.artist, categoryId: video.id === bad.id ? "22" : "10" },
        contentDetails: { duration: "PT3M20S" }, status: { embeddable: true },
      })) });
    };
    const { room } = await mutate(f.request, "TESTROOM", { action: "radio-prefetch", version: 1 });
    assert.deepEqual(stages, ["search", "metadata"]);
    assert.deepEqual(room.queue.map((video) => video.id), [next.id]);
    assert.equal(room.queue[0].music, true);
    assert(!JSON.stringify(room).includes("radioRelatedTo"));
    assert.equal(f.roomState().queue[0].music, true);
  } finally { f.close(); }
});
test("D1 starts the recommended video clock after its metadata lookup completes", async () => {
  const f = fixture(),
    now = Date.now;
  let time = now();
  Date.now = () => time;
  try {
    await f.save();
    const fetchMetadata = globalThis.fetch;
    globalThis.fetch = async (target) => {
      time += 2500;
      return fetchMetadata(target);
    };
    const { room } = await mutate(f.request, "TESTROOM", {
      action: "next",
      version: 1,
    });
    assert.equal(room.current?.id, next.id);
    assert.equal(room.position, 0);
  } finally {
    Date.now = now;
    f.close();
  }
});

test("D1 direct playback starts at zero after slow metadata, including replay of the same video", async () => {
  const f = fixture(),
    now = Date.now;
  let time = now();
  Date.now = () => time;
  try {
    await f.save();
    const fetchMetadata = globalThis.fetch;
    globalThis.fetch = async (target) => {
      time += 2500;
      return fetchMetadata(target);
    };
    const { room } = await mutate(f.request, "TESTROOM", {
      action: "play-video",
      videoId: next.id,
      version: 1,
    });
    assert.equal(room.current?.id, next.id);
    assert.equal(room.position, 0);
    assert.equal(room.playing, true);
    time += 5000;
    const replay = await mutate(f.request, "TESTROOM", {
      action: "play-video",
      videoId: next.id,
      version: 2,
    });
    assert.equal(replay.room.position, 0);
    assert.notEqual(replay.room.playbackKey, room.playbackKey);
  } finally {
    Date.now = now;
    f.close();
  }
});
test("D1 a slow queue addition preserves the clock of the video already playing", async () => {
  const f = fixture(),
    now = Date.now;
  let time = now();
  Date.now = () => time;
  try {
    await f.save("TESTROOM", {
      current: seed,
      queue: [],
      playing: true,
      position: 20,
    });
    const fetchMetadata = globalThis.fetch;
    globalThis.fetch = async (target) => {
      time += 2500;
      return fetchMetadata(target);
    };
    const { room } = await mutate(f.request, "TESTROOM", {
      action: "add",
      videoId: next.id,
      version: 1,
    });
    assert.equal(room.current?.id, seed.id);
    assert.equal(room.position, 22.5);
    assert.equal(room.queue[0].id, next.id);
  } finally {
    Date.now = now;
    f.close();
  }
});

test("cohost invitations are single-use, revocable and cannot grant another room", async () => {
  const f = fixture();
  try {
    await f.save();
    await f.save("OTHERROM");
    const guest = new Request(f.request.url, {
      headers: { "X-Afterparty-Visitor": crypto.randomUUID() },
    });
    await assert.rejects(
      mutate(guest, "TESTROOM", { action: "invite" }),
      (e: unknown) => e instanceof Error && "status" in e && e.status === 403,
    );
    const invitation = await mutate(f.request, "TESTROOM", {
      action: "invite",
    });
    await assert.rejects(
      mutate(guest, "OTHERROM", {
        action: "claim-host",
        token: invitation.token,
      }),
      (e: unknown) => e instanceof Error && "status" in e && e.status === 403,
    );
    const grant = await mutate(guest, "TESTROOM", {
      action: "claim-host",
      token: invitation.token,
    });
    assert(grant.token);
    await assert.rejects(
      mutate(guest, "TESTROOM", {
        action: "claim-host",
        token: invitation.token,
      }),
      (e: unknown) => e instanceof Error && "status" in e && e.status === 403,
    );
    const cohost = new Request(f.request.url, {
      headers: { authorization: "Bearer " + grant.token },
    });
    let value = f.roomRow();
    const visible = await publicRoom(cohost, value, false);
    assert.equal(visible.isHost, true);
    assert.equal(visible.isOwner, false);
    assert(!JSON.stringify(visible).includes("cohostHashes"));
    assert(!JSON.stringify(visible).includes("engineOwnerHash"));
    await mutate(cohost, "TESTROOM", {
      action: "pause",
      version: value.version,
    });
    await assert.rejects(
      mutate(cohost, "TESTROOM", { action: "transfer-invite" }),
      (e: unknown) => e instanceof Error && "status" in e && e.status === 403,
    );
    await mutate(f.request, "TESTROOM", { action: "revoke-hosts" });
    value = f.roomRow();
    await assert.rejects(
      mutate(cohost, "TESTROOM", { action: "play", version: value.version }),
      (e: unknown) => e instanceof Error && "status" in e && e.status === 403,
    );
  } finally {
    f.close();
  }
});
test("ownership transfer removes previous grants but keeps the stable Core authority private", async () => {
  const f = fixture();
  try {
    await f.save();
    const invitation = await mutate(f.request, "TESTROOM", {
      action: "transfer-invite",
    });
    const grant = await mutate(new Request(f.request.url), "TESTROOM", {
      action: "claim-host",
      token: invitation.token,
    });
    const request = new Request(f.request.url, {
      headers: { authorization: "Bearer " + grant.token },
    });
    const value = f.roomRow();
    assert.equal((await publicRoom(request, value, false)).isOwner, true);
    assert.equal((await publicRoom(f.request, value, false)).isHost, false);
    assert.equal(
      JSON.parse(value.state).engineOwnerHash,
      await hash("synthetic-host"),
    );
    await assert.rejects(
      mutate(f.request, "TESTROOM", { action: "invite" }),
      (e: unknown) => e instanceof Error && "status" in e && e.status === 403,
    );
  } finally {
    f.close();
  }
});

test('D1 persists removal of consumed undo and old radio retry state', async () => {
 const f=fixture();
 try {
  await f.save('TESTROOM',{current:seed,queue:[next],playing:false,position:20,undoQueue:[next],radioRetryAt:Date.now()+60000,cohostHashes:['synthetic-cohost']});
  await mutate(f.request,'TESTROOM',{action:'play-video',videoId:next.id,version:1});
  const saved=f.roomState();
  assert.equal(saved.undoQueue,undefined);
  assert.equal(saved.radioRetryAt,undefined);
  assert.deepEqual(saved.queue,[]);
  assert.deepEqual(saved.cohostHashes,['synthetic-cohost']);
 } finally {f.close();}
});

test("D1 current-track radio retry preserves playback and sets a future cooldown", async () => {
  const f = fixture();
  const now = Date.now;
  let time = now();
  Date.now = () => time;
  try {
    await f.save("TESTROOM", { current: seed, queue: [], playing: true, position: 20,
      playbackKey: "same-playback", startsAt: time - 1000 });
    const fetchMetadata = globalThis.fetch;
    globalThis.fetch = async target => { time += 2500; return fetchMetadata(target); };
    const { room } = await mutate(f.request, "TESTROOM", { action: "radio", enabled: true, version: 1 });
    assert.equal(room.current?.id, seed.id);
    assert.equal(room.playbackKey, "same-playback");
    assert.equal(room.playing, true);
    assert.equal(room.position, 25);
    assert.deepEqual(room.queue.map(video => video.id), [next.id]);
    assert.equal(f.roomState().radioRetryAt, time + 15000);
  } finally { Date.now = now; f.close(); }
});

test("D1 empty radio retry reports failure while retaining the current clock and cooldown", async () => {
  const f = fixture();
  const now = Date.now;
  const time = now();
  Date.now = () => time;
  try {
    await f.save("TESTROOM", { current: seed, queue: [], playing: true, position: 20, playbackKey: "same-playback" });
    globalThis.fetch = async () => Response.json({ items: [] });
    await assert.rejects(mutate(f.request, "TESTROOM", { action: "radio", enabled: true, version: 1 }),
      error => error instanceof Error && "status" in error && error.status === 422 && /Prøv radio igjen/.test(error.message));
    const saved = f.roomState();
    assert.equal(saved.current?.id, seed.id);
    assert.equal(saved.playbackKey, "same-playback");
    assert.equal(saved.position, 20);
    assert.equal(saved.playing, true);
    assert.equal(saved.radioRetryAt, time + 15000);
    assert.equal(f.roomRow().version, 2);
    globalThis.fetch = async () => { assert.fail("cooldown should suppress automatic search"); };
    await publicRoom(f.request, f.roomRow());
  } finally { Date.now = now; f.close(); }
});

test("D1 radio retry cannot override a newer radio-off command", async () => {
  const f = fixture();
  try {
    await f.save("TESTROOM", { current: seed, queue: [], playing: true, position: 20 });
    await assert.rejects(mutate(new Request(f.request.url), "TESTROOM", { action: "radio", enabled: true, version: 1 }),
      error => error instanceof Error && "status" in error && error.status === 403);
    assert.equal(f.calls(), 0);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const fetchMetadata = globalThis.fetch;
    globalThis.fetch = async target => { entered(); await gate; return fetchMetadata(target); };
    const pending = mutate(f.request, "TESTROOM", { action: "radio", enabled: true, version: 1 });
    const rejection = assert.rejects(pending, error => error instanceof Error && "status" in error && error.status === 409);
    await started;
    await mutate(f.request, "TESTROOM", { action: "radio", enabled: false, version: 1 });
    release();
    await rejection;
    assert.equal(f.roomState().radio, false);
    assert.deepEqual(f.roomState().queue, []);
    assert.equal(f.roomState().current?.id, seed.id);
  } finally { f.close(); }
});

test("D1 empty early next persists cooldown without restarting playback", async () => {
  const f = fixture();
  const now = Date.now;
  let time = now();
  Date.now = () => time;
  const info = console.info;
  const diagnostics: unknown[][] = [];
  console.info = (...args) => diagnostics.push(args);
  try {
    await f.save("TESTROOM", { current: seed, queue: [], playing: true, position: 20,
      playbackKey: "same-playback", startsAt: time - 1000 });
    globalThis.fetch = async () => { time += 2500; return Response.json({ items: [] }); };
    await assert.rejects(mutate(f.request, "TESTROOM", { action: "next", version: 1 }),
      error => error instanceof Error && "status" in error && error.status === 422);
    const saved = f.roomState();
    assert.equal(saved.radioRetryAt, time + 15000);
    assert.equal(saved.current?.id, seed.id);
    assert.equal(saved.playbackKey, "same-playback");
    assert.equal(saved.playing, true);
    assert.equal(saved.position, 25);
    assert.deepEqual(saved.queue, []);
    assert.equal(f.roomRow().version, 2);
    const lookups = diagnostics.length;
    const room = await publicRoom(f.request, f.roomRow());
    assert.equal(diagnostics.length, lookups, "polling during cooldown must not rerun recommendation, even from cache");
    assert.equal(room.position, 25);
    assert.equal(f.roomRow().version, 2);
  } finally { Date.now = now; console.info = info; f.close(); }
});

test("D1 empty early next cannot overwrite a concurrent radio-off command", async () => {
  const f = fixture();
  try {
    await f.save("TESTROOM", { current: seed, queue: [], playing: true, position: 20,
      playbackKey: "same-playback" });
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    globalThis.fetch = async () => { entered(); await gate; return Response.json({ items: [] }); };
    const pending = mutate(f.request, "TESTROOM", { action: "next", version: 1 });
    const rejection = assert.rejects(pending,
      error => error instanceof Error && "status" in error && error.status === 409);
    await started;
    await mutate(f.request, "TESTROOM", { action: "radio", enabled: false, version: 1 });
    release();
    await rejection;
    assert.equal(f.roomState().radio, false);
    assert.equal(f.roomState().radioRetryAt, undefined);
    assert.equal(f.roomState().current?.id, seed.id);
    assert.equal(f.roomState().playbackKey, "same-playback");
    assert.deepEqual(f.roomState().queue, []);
    assert.equal(f.roomRow().version, 2);
  } finally { f.close(); }
});
