import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync, readdirSync } from "node:fs";

// Exercise the actual Worker handlers and SQL using only an in-memory D1 adapter.
const syntheticEnv = {};
globalThis.__roomTestEnv = syntheticEnv;
const moduleUrl = (source) =>
  "data:text/javascript," + encodeURIComponent(source);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers")
      return {
        url: moduleUrl("export const env=globalThis.__roomTestEnv;"),
        shortCircuit: true,
      };
    if (specifier === "@/app/chatgpt-auth")
      return {
        url: moduleUrl("export const getChatGPTUser=async()=>null;"),
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
const { mutate, hash, publicRoom } = await import("../lib/server.ts");
hooks.deregister();
const seed = {
  id: "seed1234567",
  title: "Syn Cole - Feel Good | Future House | NCS - Copyright Free",
  artist: "NCS",
  image: "",
  duration: 200,
  live: false,
  embeddable: true,
};
const next = { ...seed, id: "next1234567", title: "Syn Cole - Synthetic next" };
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
    state = { current: seed, queue: [], playing: true, position: 199 },
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
    const url = new URL(target);
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
  return {
    sqlite,
    request,
    save,
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
    const saved = JSON.parse(
      f.sqlite.prepare("SELECT state FROM rooms").get().state,
    );
    assert.equal(saved.radioHistory[0].id, seed.id);
    await f.save("MANUAL01", {
      current: seed,
      queue: [next],
      playing: true,
      position: 199,
    });
    const calls = f.calls();
    assert.equal(
      (await mutate(f.request, "MANUAL01", { action: "next", version: 1 })).room
        .current.id,
      next.id,
    );
    assert.equal(f.calls(), calls);
    await f.save("DISCORD1");
    const offline = await publicRoom(
      f.request,
      {
        ...f.sqlite.prepare("SELECT * FROM rooms WHERE code=?").get("DISCORD1"),
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
      (error) => error.status === 403,
    );
    assert.equal(f.calls(), 0);
    let release, entered;
    const gate = new Promise((resolve) => {
        release = resolve;
      }),
      started = new Promise((resolve) => {
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
    await assert.rejects(pending, (error) => error.status === 409);
    const saved = JSON.parse(
      f.sqlite.prepare("SELECT state FROM rooms").get().state,
    );
    assert.equal(saved.current.id, seed.id);
    assert.equal(saved.playing, false);
  } finally {
    f.close();
  }
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
    assert.equal(room.current.id, next.id);
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
    assert.equal(room.current.id, next.id);
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
    assert.equal(room.current.id, seed.id);
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
      (e) => e.status === 403,
    );
    const invitation = await mutate(f.request, "TESTROOM", {
      action: "invite",
    });
    await assert.rejects(
      mutate(guest, "OTHERROM", {
        action: "claim-host",
        token: invitation.token,
      }),
      (e) => e.status === 403,
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
      (e) => e.status === 403,
    );
    const cohost = new Request(f.request.url, {
      headers: { authorization: "Bearer " + grant.token },
    });
    let value = f.sqlite
      .prepare("SELECT * FROM rooms WHERE code=?")
      .get("TESTROOM");
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
      (e) => e.status === 403,
    );
    await mutate(f.request, "TESTROOM", { action: "revoke-hosts" });
    value = f.sqlite
      .prepare("SELECT * FROM rooms WHERE code=?")
      .get("TESTROOM");
    await assert.rejects(
      mutate(cohost, "TESTROOM", { action: "play", version: value.version }),
      (e) => e.status === 403,
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
    const value = f.sqlite.prepare("SELECT * FROM rooms").get();
    assert.equal((await publicRoom(request, value, false)).isOwner, true);
    assert.equal((await publicRoom(f.request, value, false)).isHost, false);
    assert.equal(
      JSON.parse(value.state).engineOwnerHash,
      await hash("synthetic-host"),
    );
    await assert.rejects(
      mutate(f.request, "TESTROOM", { action: "invite" }),
      (e) => e.status === 403,
    );
  } finally {
    f.close();
  }
});
