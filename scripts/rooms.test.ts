import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { registerHooks } from "node:module";
import { transpileFixtureModule } from "./fixture-transpile.ts";
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
  GUTTA_CORE_PUBLIC_URL?: string;
  ADMIN_BRIDGE_KEY?: string;
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
        source: transpileFixtureModule(url),
        shortCircuit: true,
      };
    return next(url, context);
  },
});
const { mutate: mutateHandler, hash, publicRoom, search: searchHandler, body } = await import("../lib/server.ts");
hooks.deregister();
test("foreign-origin JSON is fully discarded and remains forbidden", async () => {
  const request = new Request("https://afterparty.test/api/rooms/TESTROOM", {
    method: "POST",
    headers: { Origin: "https://foreign.invalid", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "radio", enabled: false }),
  });
  await assert.rejects(() => body(request), { status: 403 });
  assert.equal(request.bodyUsed, true);
  assert.equal(request.body?.locked, false);
});

test('D1 fallback shares the future-start clock and duplicate-play behavior with Core', async () => {
  const previousNow = Date.now;
  let now = 1000000;
  Date.now = () => now;
  const f = fixture();
  try {
    await f.save('TESTROOM', { current: seed, queue: [], playing: false, position: 20, radio: false, playbackKey: 'same-track' });
    let state = (await mutate(f.request, 'TESTROOM', { action: 'play', version: 1 })).room;
    assert.equal(state.playing, true); assert.equal(state.position, 20); assert.equal(state.startsAt, now + 1500);
    const startsAt = state.startsAt;
    now += 1000;
    assert.equal((await publicRoom(f.request, f.roomRow(), false, false)).position, 20);
    state = (await mutate(f.request, 'TESTROOM', { action: 'play', version: state.version })).room;
    assert.equal(state.startsAt, startsAt); assert.equal(state.position, 20);
    now += 1000;
    assert.equal((await publicRoom(f.request, f.roomRow(), false, false)).position, 20.5);
    state = (await mutate(f.request, 'TESTROOM', { action: 'seek', position: 50, version: state.version })).room;
    assert.equal(state.playing, true); assert.equal(state.position, 50); assert.equal(state.startsAt, now);
    now += 250;
    assert.equal((await publicRoom(f.request, f.roomRow(), false, false)).position, 50.25);
    state = (await mutate(f.request, 'TESTROOM', { action: 'pause', version: state.version })).room;
    assert.equal(state.playing, false); assert.equal(state.startsAt, undefined);
    state = (await mutate(f.request, 'TESTROOM', { action: 'seek', position: 100, version: state.version })).room;
    assert.equal(state.position, 100); assert.equal(state.playing, false); assert.equal(state.playbackKey, 'same-track');
    now += 5000;
    assert.equal((await publicRoom(f.request, f.roomRow(), false, false)).position, 100);
    assert.equal(f.calls(), 0, 'clock controls do not search for music');
  } finally { f.close(); Date.now = previousNow; }
});
test("discarding an untrusted origin stops at the body limit and cancels the stream", async () => {
  let chunks = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunks++;
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const request = new Request("https://afterparty.test/api/rooms/TESTROOM", {
    method: "POST",
    headers: { Origin: "https://foreign.invalid", "Content-Type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  await assert.rejects(() => body(request, 2), { status: 403 });
  assert.equal(cancelled, true);
  assert(chunks <= 3, "A rejected stream must not be drained without a bound");
  assert.equal(request.body?.locked, false);
});
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

test("D1 starts the first room addition on the shared clock without a separate play command", async (t) => {
  let now = 1000000;
  t.mock.method(Date, "now", () => now);
  const f = fixture();
  try {
    await f.save("TESTROOM", { current: null, queue: [], position: 0, playing: false, radio: false });
    const added = (await mutate(f.request, "TESTROOM", { action: "add", version: 1, videoId: next.id })).room;
    assert.equal(added.current?.id, next.id);
    assert.equal(added.playing, true);
    assert.equal(added.startsAt, 1001500);
    now += 2000;
    assert.equal((await publicRoom(f.request, f.roomRow(), false, false)).position, 0.5);
    const paused = (await mutate(f.request, "TESTROOM", { action: "pause", version: added.version })).room;
    assert.equal(paused.playing, false);
  } finally { f.close(); }
});
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
test("Discord room presence follows its guild heartbeat independently of the saved snapshot", async (t) => {
  const f = fixture();
  let now = 1800000000000;
  t.mock.method(Date, "now", () => now);
  try {
    await f.save("D0123456", { current: seed, queue: [], playing: false, position: 25 });
    f.sqlite.prepare("UPDATE rooms SET guild_id=?,updated_at=? WHERE code='D0123456'")
      .run("111111111111111", now - 3600000);
    f.sqlite.prepare("INSERT INTO bot_state(key,state,updated_at) VALUES(?,'{}',?)")
      .run("discord:111111111111111", now);
    const initial = f.roomRow("D0123456");
    const online = await publicRoom(f.request, initial, false);
    assert.equal(online.discordOnline, true);
    assert.equal(online.syncValidForMs, 12000);
    assert.equal(online.playing, false);
    assert.equal(online.position, 25);
    assert.deepEqual(f.roomRow("D0123456"), initial, "Reading heartbeat presence does not write the room");
    now += 14999;
    assert.equal((await publicRoom(f.request, initial, false)).discordOnline, true);
    now += 1;
    const offline = await publicRoom(f.request, initial, false);
    assert.equal(offline.discordOnline, false);
    assert.equal(offline.syncValidForMs, 0);
    f.sqlite.prepare("UPDATE bot_state SET updated_at=? WHERE key=?")
      .run(now, "discord:111111111111111");
    assert.equal((await publicRoom(f.request, initial, false)).discordOnline, true);
  } finally {
    f.close();
  }
});

test("Discord heartbeat lookup preserves guild isolation and legacy room-only fallback", async (t) => {
  const f = fixture();
  let now = 1800000000000;
  t.mock.method(Date, "now", () => now);
  try {
    await f.save("DISCORD1", { current: seed, queue: [], playing: false, position: 25 });
    const saved = f.roomRow("DISCORD1");
    assert.equal((await publicRoom(f.request, saved, false)).discordOnline, true);
    now += 20000;
    assert.equal((await publicRoom(f.request, saved, false)).discordOnline, false);
    f.sqlite.prepare("INSERT INTO bot_state(key,state,updated_at) VALUES('discord','{}',?)").run(now);
    assert.equal((await publicRoom(f.request, saved, false)).discordOnline, true);
    f.sqlite.prepare("UPDATE rooms SET guild_id=? WHERE code='DISCORD1'").run("111111111111111");
    const scoped = f.roomRow("DISCORD1");
    assert.equal((await publicRoom(f.request, scoped, false)).discordOnline, false,
      "A scoped default room must not reuse the legacy unscoped heartbeat");
    f.sqlite.prepare("INSERT INTO bot_state(key,state,updated_at) VALUES(?,'{}',?)")
      .run("discord:222222222222222", now);
    assert.equal((await publicRoom(f.request, scoped, false)).discordOnline, false,
      "Another guild's fresh heartbeat cannot keep this room online");
    f.sqlite.prepare("INSERT INTO bot_state(key,state,updated_at) VALUES(?,'{}',?)")
      .run("discord:111111111111111", now - 20000);
    assert.equal((await publicRoom(f.request, { ...scoped, updated_at: now }, false)).discordOnline, false,
      "An existing expired heartbeat takes precedence over a fresh room-only snapshot");
  } finally {
    f.close();
  }
});

test("checkpointed Discord rooms use only their canonical transient clock and stop across outage and paused reconnect", async (t) => {
  const f = fixture();
  let now = 1800000000000;
  t.mock.method(Date, 'now', () => now);
  const guildId = '111111111111111', roomCode = 'D0123456';
  const concert = { ...seed, concert: true };
  try {
    await f.save(roomCode, { current: concert, queue: [], playing: true, position: 0 });
    f.sqlite.prepare('UPDATE rooms SET guild_id=?,updated_at=? WHERE code=?').run(guildId, now - 45000, roomCode);
    const snapshot = f.roomRow(roomCode);
    const heartbeat = (extra: Record<string, unknown> = {}) => f.sqlite.prepare('INSERT INTO bot_state(key,state,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at').run(
      `discord:${guildId}`, JSON.stringify({ guildId, roomCode, bridgeRevision: 10, checkpointRevision: 1, current: concert, queue: [], playing: true, position: 60, ...extra }), now,
    );
    heartbeat();
    now += 2000;
    const first = await publicRoom(f.request, snapshot, false);
    assert.equal(first.position, 62, 'the old room checkpoint does not freeze an advancing guild clock at twelve seconds');
    assert.equal(first.playing, true);
    assert.equal(first.isHost, false);
    assert.equal(first.syncValidForMs, 10000);
    heartbeat({ bridgeRevision: 11, checkpointRevision: 11, playing: false, position: 42, queue: [concert, { ...next, concert: false }] });
    const paused = await publicRoom(f.request, snapshot, false);
    assert.equal(paused.position, 42);
    assert.equal(paused.playing, false);
    assert.deepEqual(paused.queue.map(video => video.id), [concert.id], 'private music stays out of fallback concert responses');
    now += 14999;
    assert.equal((await publicRoom(f.request, snapshot, false)).discordOnline, true);
    now++;
    const offline = await publicRoom(f.request, snapshot, false);
    assert.equal(offline.discordOnline, false);
    assert.equal(offline.playing, false);
    assert.equal(offline.syncValidForMs, 0);
    heartbeat({ bridgeRevision: 12, checkpointRevision: 11, playing: false, position: 42 });
    const reconnected = await publicRoom(f.request, snapshot, false);
    assert.equal(reconnected.discordOnline, true);
    assert.equal(reconnected.playing, false, 'a read-only browser reconnect cannot resume a deliberately paused song');
    heartbeat({ guildId: '222222222222222', position: 99 });
    assert.equal((await publicRoom(f.request, snapshot, false)).position, 12, 'mismatched guild payloads cannot supply another room clock');
    assert.deepEqual(f.roomRow(roomCode), snapshot, 'repeated reads never write the durable checkpoint');
  } finally { f.close(); }
});

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
    assert.deepEqual(stages, ["search", "metadata", "search", "search"], "Both discovery pools and the video lookup reuse fresh music-category metadata");
    assert.deepEqual(room.queue.map((video) => video.id), [next.id]);
    assert.equal(room.queue[0].music, true);
    assert(!JSON.stringify(room).includes("radioRelatedTo"));
    assert.equal(f.roomState().queue[0].music, true);
  } finally { f.close(); }
});
test("D1 House radio prepares a different artist at the start of playback", async (t) => {
  const f = fixture();
  t.mock.method(Date, "now", () => 1800000000000);
  const original = { ...seed, title: "SAM WAITIN - AFTERMATH | House | NCS - Copyright Free Music", artist: "NoCopyrightSounds" };
  const fresh = { ...next, title: "Other Artist - Synthetic Next | House" };
  const queries: string[] = [];
  try {
    await f.save("TESTROOM", { current: original, queue: [], playing: true, position: 0 });
    globalThis.fetch = async target => {
      const url = new URL(typeof target === "string" ? target : target instanceof URL ? target.href : target.url);
      assert.equal(url.origin, "https://www.googleapis.com");
      if (url.pathname.endsWith("/search")) {
        const query = url.searchParams.get("q") ?? "";
        queries.push(query);
        return Response.json({ items: query.startsWith("house audio") ? [{ id: { videoId: fresh.id } }] : [] });
      }
      return Response.json({ items: [{ id: fresh.id,
        snippet: { title: fresh.title, channelTitle: fresh.artist, categoryId: "10" },
        contentDetails: { duration: "PT3M20S" }, status: { embeddable: true } }] });
    };
    const room = await publicRoom(f.request, f.roomRow());
    assert.equal(room.current?.id, original.id);
    assert.equal(room.position, 0);
    assert.equal(room.playing, true);
    assert.deepEqual(room.queue.map(song => song.id), [fresh.id]);
    assert.equal(f.roomState().radioSeed?.id, original.id);
    assert.equal(queries.length, 4);
    await publicRoom(f.request, f.roomRow());
    assert.equal(queries.length, 4, "a prepared song suppresses later refresh lookups");
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
  const startedAt = time;
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
    assert.equal(room.position, 20 + (time - startedAt) / 1000);
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

test("D1 Radio 2.0 compares discovery pools without restarting current playback", async () => {
  const f = fixture();
  const originalNow = Date.now;
  let time = originalNow();
  const startedAt = time;
  Date.now = () => time;
  try {
    const sameArtist = { ...seed, id: "same1234567", title: "Syn Cole - Another Song | Future House" };
    const differentArtist = { ...seed, id: "other123456", title: "Another Artist - New Song | Future House" };
    const videos = new Map([sameArtist, differentArtist].map(video => [video.id, video]));
    const queries: string[] = [];
    await f.save("TESTROOM", { current: seed, queue: [], radio: false, playing: true,
      position: 20, playbackKey: "unchanged-playback" });
    globalThis.fetch = async target => {
      time += 250;
      const url = new URL(typeof target === "string" ? target : target instanceof URL ? target.href : target.url);
      assert.equal(url.origin, "https://www.googleapis.com");
      if (url.pathname.endsWith("/search")) {
        const query = url.searchParams.get("q") ?? "";
        queries.push(query);
        const id = query.includes("future house") ? sameArtist.id : differentArtist.id;
        return Response.json({ items: [{ id: { videoId: id } }] });
      }
      return Response.json({ items: (url.searchParams.get("id") ?? "").split(",").flatMap(id => {
        const video = videos.get(id);
        return video ? [{ id, snippet: { title: video.title, channelTitle: video.artist, categoryId: "10" },
          contentDetails: { duration: "PT3M20S" }, status: { embeddable: true } }] : [];
      }) });
    };
    const { room } = await mutate(f.request, "TESTROOM", { action: "radio", enabled: true, version: 1 });
    assert.equal(room.queue[0]?.id, differentArtist.id, "Compare eligible pools before choosing a repeat artist");
    assert.equal(room.current?.id, seed.id);
    assert.equal(room.playbackKey, "unchanged-playback");
    assert.equal(room.position, 20 + (time - startedAt) / 1000, "Preparing radio preserves the advancing clock");
    assert.equal(f.roomState().radioSeed?.id, seed.id);
    assert.equal(f.roomState().queue[0]?.radioRelatedTo, seed.id);
    assert(!("radioRelatedTo" in room.queue[0]), "Recommendation evidence stays private");
    assert(queries.length <= 3, "Discovery has a bounded request budget");
  } finally { Date.now = originalNow; f.close(); }
});

// Real catalog names, with controlled API responses and IDs. No live provider
// or claim about audible similarity: see docs/RADIO_REAL_CATALOG.md for sources.
for (const title of ["Live Forever", "Hello"]) {
  test(`D1 real-name radio admits Oasis ${title} without restarting playback`, async () => {
    const f = fixture();
    try {
      const original = { ...seed, title: "Oasis - Supersonic (Official Audio)", artist: "Oasis", radio: false };
      const candidate = { ...next, title: `Oasis - ${title} (Official Audio)`, artist: "Oasis", music: true };
      const heard = { ...seed, id: "heard123456", title: "Adele - Hello (Official Audio)", artist: "Adele" };
      await f.save("TESTROOM", { current: original, queue: [], playing: true, position: 20,
        playbackKey: "real-name-playback", history: [heard] });
      globalThis.fetch = async target => {
        const url = new URL(typeof target === "string" ? target : target instanceof URL ? target.href : target.url);
        assert.equal(url.origin, "https://www.googleapis.com");
        if (url.pathname.endsWith("/search"))
          return Response.json({ items: [{ id: { videoId: candidate.id } }] });
        return Response.json({ items: [{ id: candidate.id,
          snippet: { title: candidate.title, channelTitle: candidate.artist, categoryId: "10" },
          contentDetails: { duration: "PT3M20S" }, status: { embeddable: true } }] });
      };
      const { room } = await mutate(f.request, "TESTROOM", { action: "radio", enabled: true, version: 1 });
      assert.equal(room.queue[0]?.id, candidate.id);
      assert.equal(room.current?.id, original.id);
      assert.equal(room.playbackKey, "real-name-playback");
      assert(room.position >= 20 && room.position < 22, "Prefetch preserves the active clock");
      assert.equal(f.roomState().radioSeed?.id, original.id);
      assert.equal(f.roomState().queue[0]?.radioRelatedTo, original.id);
      assert(!JSON.stringify(room).includes("radioRelatedTo"), "Recording proof stays private");
    } finally { f.close(); }
  });
}

test("D1 refreshes both cached search and video genres after the free-form tag correction", async () => {
  const f = fixture();
  try {
    const query = "The Weeknd Starboy";
    const old = { ...next, id: "Rif-RTvmmss", title: "The Weeknd - Starboy (Audio) ft. Daft Punk",
      artist: "The Weeknd", genres: ["punk"] };
    for (const key of [`search:v2:${query.toLowerCase()}`, `videos:v2:${old.id}`])
      f.sqlite.prepare("INSERT INTO cached(key,data,expires_at) VALUES(?,?,?)")
        .run(key, JSON.stringify([old]), Date.now() + 3600000);
    const calls: string[] = [];
    globalThis.fetch = async target => {
      const url = new URL(typeof target === "string" ? target : target instanceof URL ? target.href : target.url);
      assert.equal(url.origin, "https://www.googleapis.com");
      if (url.pathname.endsWith("/search")) {
        calls.push("search");
        return Response.json({ items: [{ id: { videoId: old.id } }] });
      }
      calls.push("videos");
      // Isolate cache invalidation from the separately tested tag parser.
      return Response.json({ items: [{ id: old.id,
        snippet: { title: old.title, channelTitle: old.artist, categoryId: "10" },
        contentDetails: { duration: "PT3M50S" }, status: { embeddable: true } }] });
    };
    const result = await searchHandler(f.request, query);
    assert.deepEqual(result.videos[0]?.genres, []);
    assert.deepEqual(calls, ["search", "videos"]);
    assert.deepEqual(JSON.parse(String(f.sqlite.prepare("SELECT data FROM cached WHERE key=?")
      .get(`videos:v2:${old.id}`)?.data))[0].genres, ["punk"], "Old cache is bypassed, not destructively migrated");
  } finally { f.close(); }
});

test("D1 compound genre labels retain specific cross-artist discovery and private proof", async () => {
  const f = fixture();
  try {
    const original = { ...seed, title: "Seed Artist - Synthetic Original", artist: "Seed Artist",
      genres: ["Drum & Bass/Jungle"], radio: false };
    const candidate = { ...next, title: "Different Artist - Synthetic Next", artist: "Different Artist" };
    await f.save("TESTROOM", { current: original, queue: [], playing: true, position: 20,
      playbackKey: "compound-genre-playback" });
    globalThis.fetch = async target => {
      const url = new URL(typeof target === "string" ? target : target instanceof URL ? target.href : target.url);
      assert.equal(url.origin, "https://www.googleapis.com");
      if (url.pathname.endsWith("/search"))
        return Response.json({ items: [{ id: { videoId: candidate.id } }] });
      return Response.json({ items: [{ id: candidate.id,
        snippet: { title: candidate.title, channelTitle: candidate.artist, categoryId: "10", tags: ["Drum & Bass/Jungle"] },
        contentDetails: { duration: "PT3M20S" }, status: { embeddable: true } }] });
    };
    const { room } = await mutate(f.request, "TESTROOM", { action: "radio", enabled: true, version: 1 });
    assert.equal(room.queue[0]?.id, candidate.id);
    assert.deepEqual(room.queue[0]?.genres, ["drum and bass"]);
    assert.equal(room.current?.id, original.id);
    assert.equal(room.playbackKey, "compound-genre-playback");
    assert(room.position >= 20 && room.position < 22);
    assert.equal(f.roomState().queue[0]?.radioRelatedTo, original.id);
    assert(!JSON.stringify(room).includes("radioRelatedTo"));
  } finally { f.close(); }
});

for (const candidateTitle of ["Oasis - Song Live Wembley", "Oasis - Song Live Glastonbury", "Oasis - Song Live BBC Radio 1", "The Beatles - Hey Jude"]) {
  test(`D1 radio excludes reviewed unsafe or repeated candidate: ${candidateTitle}`, async () => {
    const f = fixture();
    try {
      const alias = candidateTitle.startsWith("The Beatles");
      const original = { ...seed, title: alias ? "Beatles - Hey Jude" : "Oasis - Supersonic",
        artist: alias ? "Beatles" : "Oasis", genres: ["indie pop"], radio: false };
      const candidate = { ...next, title: candidateTitle, artist: alias ? "The Beatles" : "Oasis" };
      await f.save("TESTROOM", { current: original, queue: [], playing: true, position: 20,
        playbackKey: "review-playback" });
      globalThis.fetch = async target => {
        const url = new URL(typeof target === "string" ? target : target instanceof URL ? target.href : target.url);
        assert.equal(url.origin, "https://www.googleapis.com");
        if (url.pathname.endsWith("/search"))
          return Response.json({ items: [{ id: { videoId: candidate.id } }] });
        return Response.json({ items: [{ id: candidate.id,
          snippet: { title: candidate.title, channelTitle: candidate.artist, categoryId: "10", tags: ["indie pop"] },
          contentDetails: { duration: "PT3M20S" }, status: { embeddable: true } }] });
      };
      await assert.rejects(mutate(f.request, "TESTROOM", { action: "radio", enabled: true, version: 1 }),
        error => error instanceof Error && "status" in error && error.status === 422);
      const room = await publicRoom(f.request, f.roomRow());
      assert.deepEqual(room.queue, []);
      assert.equal(room.current?.id, original.id);
      assert.equal(room.playbackKey, "review-playback");
      assert(room.position >= 20 && room.position < 22);
      assert(!JSON.stringify(room).includes("radioRelatedTo"));
    } finally { f.close(); }
  });
}

test('D1 user discovery returns thirty unique results in one bounded search and metadata batch', async () => {
  const f = fixture();
  try {
    const ids = Array.from({ length: 35 }, (_, index) => `s${String(index).padStart(10, '0')}`);
    const calls: string[] = [];
    globalThis.fetch = async target => {
      const url = new URL(String(target));
      assert.equal(url.origin, 'https://www.googleapis.com');
      calls.push(url.pathname);
      if (url.pathname.endsWith('/search')) {
        assert.equal(url.searchParams.get('maxResults'), '30');
        assert.equal(url.searchParams.has('videoCategoryId'), false);
        return Response.json({ items: [ids[0], ...ids].map(videoId => ({ id: { videoId } })) });
      }
      const requested = url.searchParams.get('id')!.split(',');
      assert.deepEqual(requested, ids.slice(0, 30));
      return Response.json({ items: requested.map(id => ({ id,
        snippet: { title: 'Artist - Original', channelTitle: 'Artist', categoryId: '10' },
        contentDetails: { duration: 'PT3M' }, status: { embeddable: true },
      })) });
    };
    assert.deepEqual((await searchHandler(f.request, 'bounded discovery')).videos.map(video => video.id), ids.slice(0, 30));
    assert.equal((await searchHandler(f.request, 'bounded discovery')).videos.length, 30);
    assert.equal(calls.length, 2, 'Repeating a search reuses metadata without fetching another page');
  } finally { f.close(); }
});

test('D1 empty searches expire after one minute and errors do not become cached empties', async () => {
  const f = fixture(), now = Date.now;
  let clock = now(), calls = 0, fail = true;
  Date.now = () => clock;
  try {
    globalThis.fetch = async target => {
      assert.equal(new URL(String(target)).pathname.endsWith('/search'), true);
      calls++;
      if (fail) return new Response('', { status: 503 });
      return Response.json({ items: [] });
    };
    await assert.rejects(searchHandler(f.request, 'temporary empty'));
    fail = false;
    assert.deepEqual((await searchHandler(f.request, 'temporary empty')).videos, []);
    assert.deepEqual((await searchHandler(f.request, 'temporary empty')).videos, []);
    assert.equal(calls, 2);
    clock += 61000;
    assert.deepEqual((await searchHandler(f.request, 'temporary empty')).videos, []);
    assert.equal(calls, 3);
  } finally { Date.now = now; f.close(); }
});

test('D1 radio uses twenty music results and its own visitor allowance after user search is exhausted', async () => {
  const f = fixture();
  try {
    await f.save('TESTROOM', { current: seed, queue: [], playing: true, position: 20 });
    const provider = globalThis.fetch;
    let radioSearches = 0;
    globalThis.fetch = async target => {
      const url = new URL(String(target));
      if (url.pathname.endsWith('/search') && url.searchParams.get('q') !== 'user results') {
        radioSearches++;
        assert.equal(url.searchParams.get('maxResults'), '20');
        assert.equal(url.searchParams.get('videoCategoryId'), '10');
      }
      return provider(target);
    };
    for (let index = 0; index < 20; index++) await searchHandler(f.request, 'user results');
    await assert.rejects(searchHandler(f.request, 'user results'), error => error instanceof Error && 'status' in error && error.status === 429);
    const result = await mutate(f.request, 'TESTROOM', { action: 'radio', enabled: true, version: 1 });
    assert.equal(result.room.queue[0]?.id, next.id);
    assert(radioSearches > 0);
    const userBudget = f.sqlite.prepare("SELECT count FROM limits WHERE key LIKE 'search-visitor:%'").get();
    assert.equal(userBudget?.count, 20, 'Internal radio lookups never spend the user search allowance');
  } finally { f.close(); }
});

test('D1 retains description, tags and synthetic-media AI declarations for radio revalidation', async () => {
  const f = fixture();
  try {
    const ids = ['ai000000001', 'ai000000002', 'ai000000003'];
    globalThis.fetch = async target => {
      const url = new URL(String(target));
      if (url.pathname.endsWith('/search')) return Response.json({ items: ids.map(videoId => ({ id: { videoId } })) });
      return Response.json({ items: ids.map((id, index) => ({ id,
        snippet: { title: 'Artist - Quiet song', channelTitle: 'Artist', categoryId: '10',
          ...(index === 0 ? { description: 'Created using Suno' } : index === 1 ? { tags: ['AI generated'] } : {}) },
        contentDetails: { duration: 'PT3M' }, status: { embeddable: true, ...(index === 2 ? { containsSyntheticMedia: true } : {}) },
      })) });
    };
    const result = await searchHandler(f.request, 'negative metadata');
    assert.equal(result.videos.length, 3);
    assert(result.videos.every(video => video.aiGenerated === true));
    const state: RoomState = { current: seed, queue: result.videos.map(video => ({ ...video, radio: true })), playing: true, position: 20 };
    await f.save('TESTROOM', state);
    assert.deepEqual((await publicRoom(f.request, f.roomRow())).queue, [], 'Automatic entries are revalidated after persistence');
  } finally { f.close(); }
});

for (const example of [
  { title: 'Janji - Heroes Tonight (feat. Johnning) [NCS Release]', artist: 'Janji', first: 'Jim Yosef', firstTitle: 'Firefly', next: 'Tobu', nextTitle: 'Hope' },
  { title: 'Lost Sky - Dreams [NCS Release]', artist: 'Lost Sky', first: 'Unknown Brain', firstTitle: 'Superhero (feat. Chris Linton)', next: 'Rival x Cadmium', nextTitle: 'Seasons (feat. Harley Bird)' },
]) test(`D1 ${example.artist} station crosses artists, rejects declared AI and preserves current playback`, async () => {
  const f = fixture();
  try {
    const original = { ...seed, title: example.title, artist: 'NoCopyrightSounds', radio: false };
    const junk = { ...next, id: 'junk0000001', title: `${example.artist} - Latest Channel News`, artist: example.artist };
    const marked = { ...next, id: 'aiclip00001', title: `${example.first} - ${example.firstTitle}`, artist: example.first + ' - Topic', aiGenerated: true };
    const safe = { ...next, id: 'safeclip001', title: `${example.next} - ${example.nextTitle} [NCS Release]`, artist: 'NoCopyrightSounds' };
    const recordings = [junk, marked, safe];
    await f.save('TESTROOM', { current: original, queue: [], playing: true, position: 20, playbackKey: 'station-current' });
    let lookups = 0;
    globalThis.fetch = async target => {
      const url = new URL(String(target));
      assert.equal(url.origin, 'https://www.googleapis.com');
      if (url.pathname.endsWith('/search')) {
        lookups++;
        assert.equal(url.searchParams.get('maxResults'), '20');
        assert.equal(url.searchParams.get('videoCategoryId'), '10');
        const query = url.searchParams.get('q')!;
        const selected = query.startsWith(example.first) ? [junk, marked] : query.startsWith(example.next) ? [junk, safe] : [junk];
        return Response.json({ items: selected.map(video => ({ id: { videoId: video.id } })) });
      }
      return Response.json({ items: url.searchParams.get('id')!.split(',').map(id => {
        const video = recordings.find(item => item.id === id); assert(video);
        return { id, snippet: { title: video.title, channelTitle: video.artist, categoryId: '10' },
          contentDetails: { duration: 'PT3M20S' }, status: { embeddable: true, containsSyntheticMedia: 'aiGenerated' in video && video.aiGenerated === true } };
      }) });
    };
    const { room } = await mutate(f.request, 'TESTROOM', { action: 'radio', enabled: true, version: 1 });
    assert.equal(room.queue[0]?.id, safe.id);
    assert.equal(room.current?.id, original.id);
    assert.equal(room.playbackKey, 'station-current');
    assert(room.position >= 20 && room.position < 22);
    assert(lookups <= 5, `Station discovery must stay bounded, used ${lookups}`);
    assert.equal(f.roomState().radioSeed?.id, original.id);
    assert(!JSON.stringify(room).includes('radioRelatedTo'));
  } finally { f.close(); }
});

test('negotiated room reads require bounded authenticated Core and immediately stop on outage or configuration loss',async(t)=>{
 const f=fixture();
 const guildId='111111111111111',code='D0123456';
 const concert={...seed,concert:true};
 const checkpoint={current:concert,queue:[],playing:true,position:12,presenceCapability:'core-authority-v1'};
 try{
  await f.save(code,checkpoint);
  f.sqlite.prepare('UPDATE rooms SET guild_id=? WHERE code=?').run(guildId,code);
  f.sqlite.prepare('INSERT INTO bot_state(key,state,updated_at) VALUES(?,?,?)').run('discord:'+guildId,JSON.stringify({...checkpoint,guildId,roomCode:code,bridgeRevision:20,checkpointRevision:20,presenceCapability:'core-authority-v1'}),Date.now());
  const original=f.roomRow(code);
  syntheticEnv.GUTTA_CORE_PUBLIC_URL='https://synthetic-core.invalid';syntheticEnv.ADMIN_BRIDGE_KEY='synthetic-key';
  let mode='live';
  const calls:Array<{url:string,signal:AbortSignal|null|undefined}>=[];
  t.mock.method(globalThis,'fetch',async(url:unknown,init:RequestInit)=>{
   calls.push({url:String(url),signal:init.signal});
   assert.equal(init.headers&&new Headers(init.headers).get('Authorization'),'Bearer synthetic-key');
   assert.equal(init.redirect,'manual');
   if(mode==='outage')throw Error('Offline');
   if(mode==='timeout')return await new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(init.signal!.reason),{once:true}));
   return Response.json({state:{...checkpoint,queue:[concert,{...next,concert:false}],current:concert,position:77,ready:true,connected:true,playing:mode!=='paused',volume:100,queueRevision:'queue',buffering:false,playbackKey:'core:test',epoch:'epoch-current',sequence:5,engine:'gutta-krutt-core',serverTime:Date.now(),online:true,guildId:mode==='wrong-guild'?'222222222222222':guildId,roomCode:code}});
  });
  const live=await publicRoom(f.request,original,false);
  assert.equal(live.position,77);assert.equal(live.playing,true);assert.equal(live.discordOnline,true);
  assert.equal(live.syncSource,'live');assert.equal(live.isHost,false);assert.equal(live.queue.length,1);
  assert.equal(new URL(calls[0].url).searchParams.get('authority'),'1');
  mode='paused';assert.equal((await publicRoom(f.request,original,false)).playing,false);
  for(const failure of ['outage','wrong-guild','timeout']){
   mode=failure;
   const start=performance.now();
   const offline=await publicRoom(f.request,original,false);
   assert(performance.now()-start<2500,'Core fallback is bounded to its short presence deadline');
   assert.equal(offline.discordOnline,false);assert.equal(offline.playing,false);assert.equal(offline.position,12);assert.equal(offline.syncValidForMs,0);
  }
  delete syntheticEnv.GUTTA_CORE_PUBLIC_URL;
  const offline=await publicRoom(f.request,original,false);
  assert.equal(offline.discordOnline,false);assert.equal(offline.position,12);assert.equal(offline.playing,false);
  f.sqlite.prepare('DELETE FROM bot_state').run();
  assert.equal((await publicRoom(f.request,original,false)).discordOnline,false,'the room also persists authority mode if its heartbeat is missing');
  assert.deepEqual(f.roomRow(code),original,'presence reads do not update the checkpoint');
 }finally{delete syntheticEnv.GUTTA_CORE_PUBLIC_URL;delete syntheticEnv.ADMIN_BRIDGE_KEY;f.close();}
});

test('D1 user search shares title and artist ranking without extra provider requests', async () => {
  const f = fixture();
  try {
    const ids = ['remix000001', 'original001', 'unrelated01'];
    let calls = 0;
    globalThis.fetch = async target => {
      calls++;
      const url = new URL(String(target));
      assert.equal(url.origin, 'https://www.googleapis.com');
      if (url.pathname.endsWith('/search'))
        return Response.json({ items: ids.map(videoId => ({ id: { videoId } })) });
      return Response.json({ items: ids.map((id, i) => ({ id,
        snippet: { title: ['Janji - Heroes Tonight (Remix)', 'Janji - Heroes Tonight (Official Audio)', 'Unrelated'][i], channelTitle: 'Janji', categoryId: '10' },
        contentDetails: { duration: 'PT3M' }, status: { embeddable: true },
      })) });
    };
    assert.deepEqual((await searchHandler(f.request, 'Janji Heroes Tonight')).videos.map(video => video.id), [ids[1], ids[0], ids[2]]);
    await searchHandler(f.request, 'Janji Heroes Tonight');
    assert.equal(calls, 2, 'one discovery and one metadata batch, reused on subsequent reads');
  } finally { f.close(); }
});

test('D1 bypasses old metadata when newer declared-AI evidence is only in the description', async () => {
  const f = fixture();
  try {
    const id = 'declared001';
    const previous = { ...next, id, title: 'Artist - Original', artist: 'Artist', aiGenerated: undefined };
    f.sqlite.prepare('INSERT INTO cached(key,data,expires_at) VALUES(?,?,?)')
      .run(`videos:v4:${id}`, JSON.stringify([previous]), Date.now() + 3600000);
    let metadataReads = 0;
    globalThis.fetch = async target => {
      const url = new URL(String(target));
      assert.equal(url.origin, 'https://www.googleapis.com');
      if (url.pathname.endsWith('/search')) return Response.json({ items: [{ id: { videoId: id } }] });
      metadataReads++;
      return Response.json({ items: [{ id,
        snippet: { title: previous.title, channelTitle: previous.artist, categoryId: '10', description: 'AI-produced music' },
        contentDetails: { duration: 'PT3M' }, status: { embeddable: true },
      }] });
    };
    const result = await searchHandler(f.request, 'new classification');
    assert.equal(metadataReads, 1);
    assert.equal(result.videos[0].aiGenerated, true);
  } finally { f.close(); }
});


test('Worker transport receipts deduplicate a stale retry without undoing a newer pause', async () => {
  const f = fixture();
  try {
    await f.save('TESTROOM', { current: seed, queue: [], playing: true, position: 0, radio: false });
    const command = { action: 'seek', position: 10, version: 1,
      commandId: '11111111-1111-4111-8111-111111111111' };
    const committed = (await mutate(f.request, 'TESTROOM', command)).room;
    assert.deepEqual(committed.commandReceipt, { id: command.commandId, version: 2 });
    await mutate(f.request, 'TESTROOM', { action: 'pause', version: 2 });
    const duplicate = (await mutate(f.request, 'TESTROOM', command)).room;
    assert.equal(duplicate.version, 3); assert.equal(duplicate.playing, false);
    assert.equal(duplicate.commandReceipt, undefined);
    await assert.rejects(() => mutate(f.request, 'TESTROOM', { ...command, position: 20 }), { status: 409 });
    assert.equal(JSON.stringify(await publicRoom(f.request, f.roomRow(), false, false)).includes('commandReceipts'), false);
  } finally { f.close(); }
});

test('Worker forwards correlated native transport to Core with its own scoped actor', async (t) => {
  const f = fixture();
  try {
    await f.save('TESTROOM', { current: seed, queue: [], playing: true, position: 0, radio: false });
    syntheticEnv.GUTTA_CORE_PUBLIC_URL = 'https://synthetic-core.invalid';
    syntheticEnv.ADMIN_BRIDGE_KEY = 'synthetic-key';
    const actor = await hash('synthetic-host'), commandId = crypto.randomUUID();
    const timeline = { code: 'TESTROOM', name: 'Test', version: 1, current: seed, queue: [],
      playing: true, position: 0, serverTime: Date.now(), viewers: 0, isHost: false,
      expiresAt: Date.now() + 60000, syncSource: 'live', syncEpoch: 'core-epoch', syncValidForMs: 5000 };
    let committed = false;
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      const command = JSON.parse(String(init.body));
      if (command.operation === 'import') return Response.json({ room: timeline });
      assert.equal(command.commandId, commandId); assert.equal(command.syncEpoch, 'core-epoch');
      assert.equal(command.actorHash, actor); assert.equal(command.version, 1);
      committed = true;
      return Response.json({ room: { ...timeline, version: 2, position: 42,
        commandReceipt: { id: commandId, version: 2 } } });
    });
    const result = (await mutate(f.request, 'TESTROOM', { action: 'seek', position: 42, version: 1,
      commandId, syncEpoch: 'core-epoch', actorHash: 'spoofed' })).room;
    assert.equal(committed, true); assert.equal(result.isHost, true);
    assert.deepEqual(result.commandReceipt, { id: commandId, version: 2 });
  } finally {
    delete syntheticEnv.GUTTA_CORE_PUBLIC_URL; delete syntheticEnv.ADMIN_BRIDGE_KEY; f.close();
  }
});
