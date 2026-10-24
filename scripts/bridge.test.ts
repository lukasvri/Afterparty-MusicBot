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
  env: { ADMIN_BRIDGE_KEY: string; GUTTA_CORE_BRIDGE_MODE?: string };
  core: Record<string,unknown> | null;
  coreRequest: ((...args: unknown[])=>Promise<unknown>) | null;
  db: FixtureDatabase | null;
} = { env: { ADMIN_BRIDGE_KEY: "synthetic-key" }, db: null, core: null, coreRequest: null };
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
          export const coreUrl=()=>globalThis.__bridgeTestContext.core?'https://synthetic.invalid':null;
          export const corePresence=async(guild,room)=>{const state=globalThis.__bridgeTestContext.core;if(!state||guild&&state.guildId!==guild||room&&state.roomCode!==room)throw Error('Core unavailable');return state;};
          export const legacyBridgeOverride=()=>globalThis.__bridgeTestContext.env.GUTTA_CORE_BRIDGE_MODE==='legacy';
          export const commandTicket=async()=>({});
          export const coreRequest=async(...args)=>{if(globalThis.__bridgeTestContext.coreRequest)return globalThis.__bridgeTestContext.coreRequest(...args);throw Error('Unexpected Core request');};
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
const { bridge, discord, publicCommand } = await import("../lib/party.ts");
hooks.deregister();

function fixture() {
  context.core=null;
  context.coreRequest=null;
  delete context.env.GUTTA_CORE_BRIDGE_MODE;
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
      assert.equal(changes() - before, 1, "Only the canonical guild heartbeat is written");
      assert.deepEqual(readRoom(), initial);
      const heartbeats = sqlite.prepare("SELECT updated_at FROM bot_state").all();
      assert.equal(heartbeats.length, 1);
      assert(heartbeats.every(row => row.updated_at === now));
    }
  } finally {
    sqlite.close();
  }
});

test("default Discord reads use the canonical guild heartbeat and retain its 15-second lease", async (t) => {
  const sqlite = fixture();
  let now = 1800000000000;
  t.mock.method(Date, "now", () => now);
  try {
    await bridge(request(), { guildId: guild, roomCode: "DISCORD1", state });
    await bridge(request(), { guildId: otherGuild, roomCode: "D0123456", state: { ...state, volume: 20 } });
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM bot_state").get()!.n, 2,
      "Multiple guilds each keep one heartbeat, including the default guild");
    assert.equal((await discord()).state?.guildId, guild);
    assert.equal((await discord()).state?.volume, 100);
    assert.equal((await discord(false, otherGuild)).state?.volume, 20);
    const heartbeat = now;
    now += 14999;
    assert.equal((await discord()).state?.online, true);
    now += 1;
    const expired = (await discord()).state;
    assert.equal(expired?.online, false);
    assert.equal(expired?.lastSeen, heartbeat);
    await bridge(request(), { guildId: guild, roomCode: "DISCORD1", state });
    assert.equal((await discord()).state?.online, true);
    assert.equal((await discord(false, otherGuild)).state?.online, false,
      "Refreshing the default guild cannot renew another guild's lease");
  } finally {
    sqlite.close();
  }
});

test("legacy unscoped Discord bridges retain their single heartbeat and default lookup", async () => {
  const sqlite = fixture();
  try {
    await bridge(request(), { state: { ...state, volume: 35 } });
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM bot_state").get()!.n, 1);
    assert.equal(sqlite.prepare("SELECT key FROM bot_state").get()!.key, "discord");
    assert.equal((await discord()).state?.volume, 35);
    assert.equal((await discord()).state?.online, true);
    assert.equal((await discord(false, guild)).state, null,
      "An explicit guild cannot inherit a legacy unscoped snapshot");
  } finally {
    sqlite.close();
  }
});

test("rebound default rooms ignore obsolete aliases and never fall back to another guild", async (t) => {
  const sqlite = fixture();
  let now = 1800000000000;
  t.mock.method(Date, "now", () => now);
  try {
    await bridge(request(), { state: { ...state, volume: 10 } });
    const legacy = sqlite.prepare("SELECT * FROM bot_state WHERE key='discord'").get();
    now += 5000;
    await bridge(request(), { guildId: guild, roomCode: "DISCORD1", state: { ...state, volume: 45 } });
    assert.equal((await discord()).state?.guildId, guild);
    assert.equal((await discord()).state?.volume, 45);
    assert.deepEqual(sqlite.prepare("SELECT * FROM bot_state WHERE key='discord'").get(), legacy,
      "Upgrading a legacy bridge leaves the old alias untouched rather than writing it again");
    now += 5000;
    await bridge(request(), { guildId: otherGuild, roomCode: "DISCORD1", state: { ...state, volume: 65 } });
    assert.equal((await discord()).state?.guildId, otherGuild);
    assert.equal((await discord()).state?.volume, 65);
    assert.equal((await discord(false, guild)).state?.volume, 45);
    sqlite.prepare("DELETE FROM bot_state WHERE key=?").run("discord:" + otherGuild);
    assert.equal((await discord()).state, null,
      "A missing canonical default snapshot cannot reuse an old alias or another guild");
    assert.equal((await discord(false, otherGuild)).state, null);
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

test("five-minute idle and advancing windows measure checkpoint writes without changing the heartbeat budget", async (t) => {
  let now = 1800000000000;
  t.mock.method(Date, 'now', () => now);
  const measured: Record<string, number> = {};
  const concert = { id: 'abcdefghijk', title: 'Synthetic concert', artist: 'Synthetic artist', duration: 600, concert: true };
  for (const active of [false, true]) for (const checkpointed of [false, true]) {
    const sqlite = fixture();
    try {
      const base = now;
      let baseline = 0;
      for (let sample = 0; sample <= 60; sample++) {
        now = base + sample * 5000;
        await bridge(request(), {
          guildId: guild, roomCode: 'DISCORD1',
          ...(checkpointed ? { bridgeRevision: sample + 1, checkpointRevision: active ? 1 + Math.floor(sample / 12) * 12 : 1 } : {}),
          state: { ...state, current: active ? concert : null, playing: active, position: active ? sample * 5 : 0 },
        });
        if (sample === 0) baseline = Number(sqlite.prepare('SELECT total_changes() AS n').get()!.n);
      }
      const writes = Number(sqlite.prepare('SELECT total_changes() AS n').get()!.n) - baseline;
      measured[`${active ? 'active' : 'idle'}-${checkpointed ? 'checkpointed' : 'legacy'}`] = writes;
      assert.equal(writes, active ? checkpointed ? 65 : 120 : 60);
      assert.equal((await discord()).state?.online, true);
    } finally { sqlite.close(); }
  }
  t.diagnostic(`Five-minute table-row writes excluding initial seed: ${JSON.stringify(measured)}`);
});

test("monotonic room checkpoints preserve pause, seek, replacement and newer restart state against delayed publications", async (t) => {
  const sqlite = fixture();
  let now = 1800000000000;
  t.mock.method(Date, 'now', () => now);
  const concert = { id: 'abcdefghijk', title: 'Synthetic concert', artist: 'Synthetic artist', duration: 600, concert: true };
  const publish = (bridgeRevision: number, checkpointRevision: number, playing: boolean, position: number, current = concert) =>
    bridge(request(), { guildId: guild, roomCode: 'DISCORD1', bridgeRevision, checkpointRevision, state: { ...state, current, playing, position, playbackKey: `core:${current.id}` } });
  const saved = () => sqlite.prepare("SELECT * FROM rooms WHERE code='DISCORD1'").get()!;
  try {
    await publish(1, 1, true, 10);
    const initial = saved();
    now += 5000;
    await publish(2, 1, true, 15);
    assert.deepEqual(saved(), initial, 'advancing presence does not rewrite the durable checkpoint');
    await publish(3, 3, false, 15);
    assert.equal(JSON.parse(String(saved().state)).playing, false);
    await publish(4, 4, false, 42);
    assert.equal(JSON.parse(String(saved().state)).position, 42);
    const replacement = { ...concert, id: 'bcdefghijkl', title: 'Replacement concert' };
    await publish(5, 5, false, 0, replacement);
    await publish(6, 6, false, 0, replacement);
    const restarted = saved();
    const presence = sqlite.prepare('SELECT * FROM bot_state').get();
    now += 5000;
    for (const old of [[2, 1], [3, 3], [6, 6], [7, 1]]) await publish(old[0], old[1], true, 99);
    assert.deepEqual(saved(), restarted);
    assert.deepEqual(sqlite.prepare('SELECT * FROM bot_state').get(), presence, 'late samples cannot extend liveness or restore older intent');
    assert.equal((await discord()).state?.current?.id, replacement.id);
    assert.equal((await discord()).state?.playing, false);
    now += 10000;
    assert.equal((await discord()).state?.online, false, 'retries do not renew the exact 15-second boundary');
  } finally { sqlite.close(); }
});

test("stale checkpoints can acknowledge idempotent history and results without overwriting playback or crossing guilds", async () => {
  const sqlite = fixture();
  const now = Date.now();
  const concert = { id: 'abcdefghijk', title: 'Synthetic concert', artist: 'Synthetic artist', duration: 600, concert: true };
  try {
    await bridge(request(), { guildId: guild, roomCode: 'DISCORD1', bridgeRevision: 10, checkpointRevision: 10, state });
    await bridge(request(), { guildId: otherGuild, roomCode: 'D0123456', bridgeRevision: 1, checkpointRevision: 1, state: { ...state, volume: 20 } });
    assert.equal((await discord(false, otherGuild)).state?.volume, 20, 'revision order is local to the selected guild');
    const saved = sqlite.prepare('SELECT * FROM rooms ORDER BY code').all();
    const presence = sqlite.prepare('SELECT * FROM bot_state ORDER BY key').all();
    for (const id of ['own', 'foreign']) sqlite.prepare("INSERT INTO bot_commands(id,guild_id,payload,status,created_at,expires_at) VALUES(?,?,'{}','processing',?,?)").run(id, id === 'own' ? guild : otherGuild, now, now + 30000);
    const replay = () => bridge(request(), {
      guildId: guild, roomCode: 'DISCORD1', bridgeRevision: 9, checkpointRevision: 9,
      state: { ...state, current: concert, playing: true, position: 99 },
      events: [{ id: 'synthetic-event', at: now, video: concert }],
      results: [{ id: 'own', ok: true, message: 'Confirmed once' }, { id: 'foreign', ok: true }],
    });
    await replay();
    await replay();
    assert.deepEqual(sqlite.prepare('SELECT * FROM rooms ORDER BY code').all(), saved);
    assert.deepEqual(sqlite.prepare('SELECT * FROM bot_state ORDER BY key').all(), presence);
    assert.equal(sqlite.prepare("SELECT status FROM bot_commands WHERE id='own'").get()!.status, 'done');
    assert.equal(sqlite.prepare("SELECT status FROM bot_commands WHERE id='foreign'").get()!.status, 'processing');
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM playback_history').get()!.n, 1);
  } finally { sqlite.close(); }
});

test("invalid checkpoint counters are rejected before any durable state or receipts are written", async () => {
  const sqlite = fixture();
  try {
    for (const fields of [
      { bridgeRevision: 1 }, { checkpointRevision: 1 },
      { bridgeRevision: 1, checkpointRevision: 2 },
      { bridgeRevision: 0, checkpointRevision: 0 },
      { bridgeRevision: 1.5, checkpointRevision: 1 },
      { bridgeRevision: Number.MAX_SAFE_INTEGER + 1, checkpointRevision: 1 },
      { bridgeRevision: '2', checkpointRevision: 1 },
    ]) await assert.rejects(bridge(request(), { ...fields, state }), (error: unknown) => error instanceof Error && 'status' in error && error.status === 400);
    assert.equal(sqlite.prepare('SELECT total_changes() AS n').get()!.n, 0);
  } finally { sqlite.close(); }
});

test("equal publication counters with altered checkpoint or payload cannot update or recreate a room", async (t) => {
  const sqlite = fixture();
  let now = 1800000000000;
  t.mock.method(Date, 'now', () => now);
  const publish = (checkpointRevision: number, changedState = state) => bridge(request(), {
    guildId: guild, roomCode: 'DISCORD1', bridgeRevision: 10, checkpointRevision, state: changedState,
  });
  try {
    await publish(5);
    const room = sqlite.prepare('SELECT * FROM rooms').all();
    const presence = sqlite.prepare('SELECT * FROM bot_state').all();
    const before = Number(sqlite.prepare('SELECT total_changes() AS n').get()!.n);
    now += 5000;
    await publish(10, { ...state, volume: 20 });
    await publish(5, { ...state, volume: 30 });
    assert.deepEqual(sqlite.prepare('SELECT * FROM rooms').all(), room);
    assert.deepEqual(sqlite.prepare('SELECT * FROM bot_state').all(), presence);
    assert.equal(Number(sqlite.prepare('SELECT total_changes() AS n').get()!.n), before);
    sqlite.prepare("DELETE FROM rooms WHERE code='DISCORD1'").run();
    await publish(5, { ...state, volume: 30 });
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM rooms').get()!.n, 0,
      'an equal revision with a different canonical payload cannot recreate a deleted/restored room');
    assert.deepEqual(sqlite.prepare('SELECT * FROM bot_state').all(), presence);
    await publish(5);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM rooms').get()!.n, 1,
      'an exact duplicate may reconstruct only its previously accepted checkpoint');
    assert.deepEqual(sqlite.prepare('SELECT * FROM bot_state').all(), presence, 'exact retries never extend liveness');
  } finally { sqlite.close(); }
});

const authorityCapability = 'core-authority-v1';
function authorityPublication(bridgeRevision: number, checkpointRevision: number, extra: Record<string, unknown> = {}) {
 const live = { ...state, epoch:'epoch-current', sequence:1, buffering:false, guildId:guild, roomCode:'DISCORD1', online:true, ...extra };
 context.core=live;
 return {guildId:guild,roomCode:'DISCORD1',presenceCapability:authorityCapability,bridgeRevision,checkpointRevision,state:live};
}
test('Core authority eliminates idle presence writes and bounds active writes to durable checkpoints',async(t)=>{
 let now=1800000000000;t.mock.method(Date,'now',()=>now);
 const measured:Record<string,number>={};
 for(const active of [false,true]){
  const sqlite=fixture();
  try{
   let baseline=0;
   for(let sample=0;sample<=60;sample++){
    const publication=authorityPublication(sample+1,active?1+Math.floor(sample/12)*12:1,{playing:active,position:sample*5,current:active?{id:'abcdefghijk',title:'Concert',artist:'Test',duration:900,concert:true}:null});
    now+=5000;
    await bridge(request(),publication);
    if(sample===0)baseline=Number(sqlite.prepare('SELECT total_changes() AS n').get()!.n);
   }
   measured[active?'active':'idle']=Number(sqlite.prepare('SELECT total_changes() AS n').get()!.n)-baseline;
   assert.equal(measured[active?'active':'idle'],active?10:0);
   assert.equal((await discord(false,guild)).state?.online,true);
   context.core=null;
   const offline=(await discord(false,guild)).state!;
   assert.equal(offline.online,false);assert.equal(offline.playing,false);
  }finally{sqlite.close();}
 }
 t.diagnostic('Negotiated five-minute table-row writes excluding seed: '+JSON.stringify(measured));
});
test('negotiated state rejects stale intent and other guilds, cannot silently downgrade, and requires verified fresh checkpoint to roll back',async()=>{
 const sqlite=fixture();
 try{
  await bridge(request(),authorityPublication(10,10));
  const saved=()=>sqlite.prepare('SELECT * FROM bot_state').all();
  const initial=saved();
  const stale=authorityPublication(11,11);context.core={...context.core!,sequence:2};
  await assert.rejects(bridge(request(),stale),{status:409});assert.deepEqual(saved(),initial);
  context.core={...context.core!,guildId:otherGuild};
  await bridge(request(),stale);assert.deepEqual(saved(),initial);
  context.core=null;
  await bridge(request(),stale);assert.deepEqual(saved(),initial);
  // A rolling old binary cannot remove persisted mode even with a stale payload
  // whose publication counter appears newer.
  for(const override of [undefined,'legacy']){
   context.env.GUTTA_CORE_BRIDGE_MODE=override;
   await bridge(request(),{guildId:guild,roomCode:'DISCORD1',state:{...state,volume:20},bridgeRevision:100,checkpointRevision:100});
   await bridge(request(),{guildId:guild,roomCode:'DISCORD1',state:{...state,volume:20}});
   assert.deepEqual(saved(),initial);
  }
  await bridge(request(),authorityPublication(11,10));assert.deepEqual(saved(),initial,'rollback also waits for a newer verified checkpoint');
  await bridge(request(),authorityPublication(12,12,{sequence:2,playing:false,position:42}));
  const rolled=JSON.parse(String(saved()[0].state));
  assert.equal(rolled.presenceCapability,undefined);assert.equal(rolled.position,0);
  const room=sqlite.prepare("SELECT state FROM rooms WHERE code='DISCORD1'").get()!;
  assert.equal(JSON.parse(String(room.state)).checkpointRevision,12);
 }finally{context.core=null;sqlite.close();}
});
test('authoritative pause seek replacement and restart checkpoints retain guild-scoped idempotent receipts',async()=>{
 const sqlite=fixture();
 const concert={id:'abcdefghijk',title:'Concert',artist:'Test',duration:900,concert:true};
 try{
  await bridge(request(),authorityPublication(10,10,{current:concert,playing:true,position:10}));
  const publish=async(revision:number,extra:Record<string,unknown>)=>bridge(request(),authorityPublication(revision,revision,{current:concert,...extra}));
  await publish(11,{sequence:2,playing:false,position:10});
  await publish(12,{sequence:3,playing:false,position:42});
  await publish(13,{sequence:4,playing:false,position:0,current:{...concert,id:'bcdefghijkl'}});
  const read=()=>JSON.parse(String(sqlite.prepare("SELECT state FROM rooms WHERE code='DISCORD1'").get()!.state));
  assert.equal(read().current.id,'bcdefghijkl');assert.equal(read().playing,false);
  await publish(14,{epoch:'normal-restart',sequence:0,playing:false,position:0});
  const restored=authorityPublication(2,2,{epoch:'restored-backup',sequence:0});
  await assert.rejects(bridge(request(),restored),{status:409,code:'bridge_reconciliation_required'});
  assert.equal(JSON.parse(String(sqlite.prepare('SELECT state FROM bot_state').get()!.state)).epoch,'normal-restart');
  sqlite.prepare("INSERT INTO bot_commands(id,payload,status,created_at,expires_at,guild_id) VALUES('mine','{}','processing',?,?,?),('other','{}','processing',?,?,?)").run(Date.now(),Date.now()+30000,guild,Date.now(),Date.now()+30000,otherGuild);
  for(let i=0;i<2;i++)await bridge(request(),{...authorityPublication(15+i,14,{epoch:'normal-restart',sequence:0}),events:[{id:'authority-event',at:Date.now(),video:concert}],results:[{id:'mine',ok:true,message:'Done'},{id:'other',ok:true,message:'Forbidden'}]});
  sqlite.prepare("INSERT INTO bot_commands(id,payload,status,created_at,expires_at,guild_id) VALUES('pending','{}','pending',?,?,?)").run(Date.now(),Date.now()+30000,guild);
  context.core=null;const outage=await bridge(request(),{...restored,bridgeRevision:30,checkpointRevision:14,state:{...restored.state,epoch:'normal-restart'},events:[{id:'outage-event',at:Date.now(),video:concert}]});
  assert.deepEqual(outage.commands,[]);assert.equal(sqlite.prepare("SELECT status FROM bot_commands WHERE id='pending'").get()!.status,'pending');
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM playback_history').get()!.n,2);
  assert.equal(sqlite.prepare("SELECT status FROM bot_commands WHERE id='mine'").get()!.status,'done');
  assert.equal(sqlite.prepare("SELECT status FROM bot_commands WHERE id='other'").get()!.status,'processing');
 }finally{context.core=null;sqlite.close();}
});

test('missing canonical heartbeat cannot downgrade authority, restore lower intent, or divert jobs to a legacy publisher',async()=>{
 for(const missing of [false,true])for(const ordered of [false,true])for(const differentRoom of [false,true])for(const scoped of [false,true]){
  const sqlite=fixture();
  try{
   await bridge(request(),authorityPublication(10,10));
   const room=sqlite.prepare("SELECT * FROM rooms WHERE code='DISCORD1'").get();
   if(missing)sqlite.prepare('DELETE FROM bot_state').run();
   const bot=sqlite.prepare('SELECT * FROM bot_state').all();
   sqlite.prepare("INSERT INTO bot_commands(id,payload,status,created_at,expires_at,guild_id) VALUES('pending','{}','pending',?,?,?)").run(Date.now(),Date.now()+30000,scoped?guild:null);
   const reply=await bridge(request(),{...scoped?{guildId:guild}:{},roomCode:differentRoom?'D0C0FFEE':'DISCORD1',state,...ordered?{bridgeRevision:100,checkpointRevision:100}:{}});
   assert.deepEqual(reply.commands,[]);assert.equal(sqlite.prepare("SELECT status FROM bot_commands WHERE id='pending'").get()!.status,'pending');
   assert.deepEqual(sqlite.prepare("SELECT * FROM rooms WHERE code='DISCORD1'").get(),room);
   assert.deepEqual(sqlite.prepare('SELECT * FROM bot_state').all(),bot);
   await assert.rejects(bridge(request(),{...authorityPublication(2,2,{epoch:'restored-lower',sequence:0}),roomCode:differentRoom?'D0C0FFEE':'DISCORD1'}),{status:409,code:'bridge_reconciliation_required'});
   assert.deepEqual(sqlite.prepare("SELECT * FROM rooms WHERE code='DISCORD1'").get(),room);
  }finally{context.core=null;sqlite.close();}
 }
});

test('pending public receipt fallback uses the short Core deadline and caller cancellation',async()=>{
 const sqlite=fixture();
 try{
  context.core={};
  let forwarded:AbortSignal|undefined;
  context.coreRequest=async(...args)=>{
   forwarded=args[4] as AbortSignal;
   if(forwarded.aborted)throw forwarded.reason;
   return await new Promise((_resolve,reject)=>forwarded!.addEventListener('abort',()=>reject(forwarded!.reason),{once:true}));
  };
  const id='public:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  sqlite.prepare("INSERT INTO bot_commands(id,payload,status,created_at,expires_at,guild_id) VALUES(?,'{}','pending',?,?,?)").run(id,Date.now(),Date.now()+30000,guild);
  const start=performance.now();
  assert.equal((await publicCommand(id,guild))?.status,'pending');
  assert(performance.now()-start<2500);assert.equal(forwarded!.aborted,true);
  const controller=new AbortController();controller.abort();
  assert.equal((await publicCommand(id,guild,controller.signal))?.status,'pending');
  assert.equal(forwarded!.aborted,true);
 }finally{context.core=null;context.coreRequest=null;sqlite.close();}
});
