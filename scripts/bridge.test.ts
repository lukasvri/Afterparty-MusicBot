import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { registerHooks } from "node:module";
import { transpileFixtureModule } from "./fixture-transpile.mjs";
import { readFileSync, readdirSync } from "node:fs";

// Exercise the actual Worker bridge with migrated, isolated in-memory databases.
type FixtureRow = Record<string, SQLOutputValue>;
type BindValue = SQLInputValue | boolean;
interface FixtureStatement {
  bind(...values: BindValue[]): FixtureStatement;
  run(): Promise<{ meta: { changes: number } }>;
  all(): Promise<{ results: FixtureRow[] }>;
  first(): Promise<FixtureRow | null>;
}
interface FixtureDatabase {
  prepare(sql: string): FixtureStatement;
  batch(statements: FixtureStatement[]): Promise<unknown[]>;
}
const context: {
  env: { ADMIN_BRIDGE_KEY: string };
  db: FixtureDatabase | null;
} = { env: { ADMIN_BRIDGE_KEY: "synthetic-key" }, db: null };
const globals = globalThis as typeof globalThis & {
  __bridgeTestContext: typeof context;
};
globals.__bridgeTestContext = context;
const moduleUrl = (source: string) =>
  "data:text/javascript," + encodeURIComponent(source);
const hooks = registerHooks({
  resolve(specifier, options, next) {
    if (specifier === "cloudflare:workers")
      return {
        url: moduleUrl("export const env=globalThis.__bridgeTestContext.env;"),
        shortCircuit: true,
      };
    if (options.parentURL?.endsWith("/lib/party.ts")) {
      if (specifier === "./server")
        return {
          url: moduleUrl(`
          import {createHash} from 'node:crypto';
          export const db=()=>globalThis.__bridgeTestContext.db;
          export const hash=async value=>createHash('sha256').update(value).digest('hex');
          export const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
          export const isAdmin=async()=>false;
          export const limit=async()=>{};
        `),
          shortCircuit: true,
        };
      if (specifier === "./core-server" || specifier === "./discord-auth")
        return {
          url: moduleUrl(`
          export const coreUrl=()=>null;
          export const commandTicket=async()=>({});
          export const coreRequest=async()=>{throw Error('Unexpected Core request');};
          export const adminState=async()=>{throw Error('Unexpected admin request');};
        `),
          shortCircuit: true,
        };
      if (specifier === "./password") return next("./password.ts", options);
    }
    return next(specifier, options);
  },
  load(url, options, next) {
    if (url.endsWith("/lib/party.ts"))
      return {
        format: "module",
        source: transpileFixtureModule(url),
        shortCircuit: true,
      };
    return next(url, options);
  },
});
const { bridge, publicCommand } = await import("../lib/party.ts");
hooks.deregister();

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(
      readFileSync(new URL("../drizzle/" + file, import.meta.url), "utf8"),
    );
  const prepare = (sql: string, args: SQLInputValue[] = []): FixtureStatement => ({
    bind(...values) {
      return prepare(sql, values.map(value => typeof value === "boolean" ? Number(value) : value));
    },
    async run() {
      return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } };
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...args) };
    },
    async first() {
      return sqlite.prepare(sql).get(...args) ?? null;
    },
  });
  context.db = {
    prepare,
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
  return sqlite;
}
const guild = "111111111111111",
  otherGuild = "222222222222222";
const state = {
  ready: true,
  connected: true,
  playing: false,
  position: 0,
  volume: 100,
  current: null,
  queue: [],
  queueRevision: "synthetic",
};
const request = () =>
  new Request("https://site.example/api/bridge", {
    method: "POST",
    headers: { Authorization: "Bearer synthetic-key" },
  });

test("idle bridge heartbeats update presence without rewriting unchanged room snapshots", async (t) => {
  const sqlite = fixture();
  let now = 1800000000000;
  t.mock.method(Date, "now", () => now);
  try {
    const publish = () => bridge(request(), { guildId: guild, roomCode: "DISCORD1", state });
    await publish();
    const readRoom = () => sqlite.prepare("SELECT * FROM rooms WHERE code='DISCORD1'").get();
    const initial = readRoom();
    const changes = () => Number(sqlite.prepare("SELECT total_changes() AS n").get()!.n);
    for (let i = 0; i < 6; i++) {
      const before = changes();
      now += 5000;
      await publish();
      assert.equal(changes() - before, 2, "Only the guild heartbeat and default alias are written");
      assert.deepEqual(readRoom(), initial);
      const heartbeats = sqlite.prepare("SELECT updated_at FROM bot_state").all();
      assert.equal(heartbeats.length, 2);
      assert(heartbeats.every(row => row.updated_at === now));
    }
  } finally {
    sqlite.close();
  }
});

test("changed bridge playback snapshots and guild bindings persist immediately", async (t) => {
  const sqlite = fixture();
  let now = 1800000000000;
  t.mock.method(Date, "now", () => now);
  const concert = { id: "abcdefghijk", title: "Synthetic concert", artist: "Synthetic artist", duration: 120, concert: true };
  try {
    const publish = (playingState: Record<string, unknown>, guildId = guild) =>
      bridge(request(), { guildId, roomCode: "D0123456", state: playingState });
    await publish(state);
    now += 50;
    await publish({ ...state, current: concert, playing: true, position: 10 });
    const first = sqlite.prepare("SELECT state,version,updated_at FROM rooms WHERE code='D0123456'").get()!;
    assert.equal(first.version, 2);
    assert.equal(first.updated_at, now);
    assert.equal(JSON.parse(String(first.state)).position, 10);
    now += 50;
    await publish({ ...state, current: concert, playing: true, position: 12 });
    const moved = sqlite.prepare("SELECT state,version,updated_at FROM rooms WHERE code='D0123456'").get()!;
    assert.equal(moved.version, 3);
    assert.equal(moved.updated_at, now);
    assert.equal(JSON.parse(String(moved.state)).position, 12);
    now += 50;
    await publish({ ...state, current: concert, playing: false, position: 12 });
    const paused = sqlite.prepare("SELECT state,version,updated_at FROM rooms WHERE code='D0123456'").get()!;
    assert.equal(paused.version, 4);
    assert.equal(paused.updated_at, now);
    assert.equal(JSON.parse(String(paused.state)).playing, false);
    now += 50;
    await publish(state, otherGuild);
    const rebound = sqlite.prepare("SELECT state,version,guild_id FROM rooms WHERE code='D0123456'").get()!;
    assert.equal(rebound.version, 5);
    assert.equal(rebound.guild_id, otherGuild);
    now += 50;
    await publish(state, guild);
    const reboundAgain = sqlite.prepare("SELECT version,guild_id FROM rooms WHERE code='D0123456'").get()!;
    assert.equal(reboundAgain.version, 6, "An identical state with a changed guild still updates");
    assert.equal(reboundAgain.guild_id, guild);
  } finally {
    sqlite.close();
  }
});

test("unchanged bridge rooms renew their 48-hour expiry only when 24 hours remain", async (t) => {
  const sqlite = fixture();
  let now = 1800000000000;
  t.mock.method(Date, "now", () => now);
  try {
    const publish = () => bridge(request(), { guildId: guild, roomCode: "D0123456", state });
    await publish();
    const readRoom = () => sqlite.prepare("SELECT version,updated_at,expires_at FROM rooms WHERE code='D0123456'").get()!;
    const initial = readRoom();
    now += 86400000 - 1;
    await publish();
    assert.deepEqual(readRoom(), initial);
    now += 1;
    await publish();
    assert.deepEqual({ ...readRoom() }, { version: 2, updated_at: now, expires_at: now + 172800000 });
    const renewed = readRoom();
    now += 5000;
    await publish();
    assert.deepEqual(readRoom(), renewed);
  } finally {
    sqlite.close();
  }
});

test("all twenty Core results are durable before a full batch is acknowledged, with server isolation", async () => {
  const sqlite = fixture();
  try {
    const now = Date.now();
    const insert = sqlite.prepare(
      "INSERT INTO bot_commands(id,guild_id,payload,status,created_at,expires_at) VALUES(?,?,'{}','processing',?,?)",
    );
    for (let i = 0; i < 21; i++)
      insert.run(
        "result:" + i,
        i === 20 ? otherGuild : guild,
        now,
        now + 30000,
      );
    const results = Array.from({ length: 20 }, (_, i) => ({
      id: "result:" + i,
      ok: i % 2 === 0,
      message: "synthetic:" + i,
    }));
    await bridge(request(), {
      guildId: guild,
      roomCode: "D0123456",
      state,
      results,
    });
    const completed = sqlite
      .prepare("SELECT id,status,result FROM bot_commands WHERE guild_id=?")
      .all(guild);
    assert.equal(completed.length, 20);
    for (const row of completed) {
      const index = Number(String(row.id).split(":")[1]);
      assert.equal(row.status, index % 2 === 0 ? "done" : "failed");
      assert.equal(row.result, "synthetic:" + index);
    }
    await bridge(request(), {
      guildId: guild,
      roomCode: "D0123456",
      state,
      results: [{ id: "result:20", ok: true }],
    });
    assert.equal(
      sqlite
        .prepare("SELECT status FROM bot_commands WHERE id='result:20'")
        .get()!.status,
      "processing",
    );
  } finally {
    sqlite.close();
  }
});

test("an unauthenticated bridge cannot acknowledge any command results", async () => {
  const sqlite = fixture();
  try {
    await assert.rejects(
      bridge(new Request("https://site.example/api/bridge"), {
        state,
        results: [],
      }),
      (error: unknown) => error instanceof Error && "status" in error && error.status === 403,
    );
    assert.equal(
      sqlite.prepare("SELECT count(*) AS n FROM bot_state").get()!.n,
      0,
    );
  } finally {
    sqlite.close();
  }
});

test("fallback command receipts remain scoped to the selected guild", async () => {
  const sqlite = fixture();
  try {
    const id = "public:12345678-1234-1234-1234-123456789abc";
    sqlite.prepare(
      "INSERT INTO bot_commands(id,guild_id,payload,status,created_at,expires_at,result) VALUES(?,?,'{}','done',?,?,?)",
    ).run(id, guild, Date.now(), Date.now() + 30000, "Synthetic guild result");
    assert.equal((await publicCommand(id, guild))?.result, "Synthetic guild result");
    assert.equal(await publicCommand(id, otherGuild), null);
    assert.equal(await publicCommand(id), null);

    const legacyId = "public:abcdef12-1234-1234-1234-123456789abc";
    sqlite.prepare(
      "INSERT INTO bot_commands(id,guild_id,payload,status,created_at,expires_at,result) VALUES(?,NULL,'{}','done',?,?,?)",
    ).run(legacyId, Date.now(), Date.now() + 30000, "Synthetic default result");
    assert.equal((await publicCommand(legacyId))?.result, "Synthetic default result");
    assert.equal(await publicCommand(legacyId, guild), null);
    await bridge(request(), { guildId: guild, roomCode: "DISCORD1", state });
    assert.equal((await publicCommand(legacyId, guild))?.result, "Synthetic default result");
    assert.equal(await publicCommand(legacyId, otherGuild), null);
    await assert.rejects(publicCommand(id, "invalid-guild"), (error: unknown) =>
      error instanceof Error && "status" in error && error.status === 400,
    );
  } finally {
    sqlite.close();
  }
});
