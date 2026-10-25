// Synthetic SQLite microbenchmark. No network, credentials or production database.
// Run: node scripts/measure-room-visitors.ts
import assert from "node:assert/strict";
import { cpus } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { visitorSQL } from "../lib/room-visitors.ts";
import { roomCode, seedVisitors, visitorDatabase, visitorKey, visitorNow } from "./visitor-fixture.ts";

const iterations = 10, rounds = 5, warmup = 3, batchSize = 50;
function operations(database: DatabaseSync, rooms: number, visitors: number) {
  const heartbeat = database.prepare(visitorSQL.heartbeat);
  const count = database.prepare(visitorSQL.count), directory = database.prepare(visitorSQL.directory);
  const expire = database.prepare(visitorSQL.expire), remove = database.prepare(visitorSQL.removeRoom);
  const target = roomCode(rooms > 1 ? 1 : 0);
  const fresh = Array.from({ length: visitors }, (_, i) => i).filter(i => i % 4 !== 0 && i % 10 !== 0).slice(0, batchSize);
  const rollback = (run: () => number) => {
    database.exec("BEGIN");
    try { return run(); } finally { database.exec("ROLLBACK"); }
  };
  const beat = (offset: number, now: number, indices: number[]) => rollback(() => indices.reduce((n, i) => n + Number(
    heartbeat.run(visitorKey(i + offset, rooms), roomCode((i + offset) % rooms), now + 45000, now + 30000).changes), 0));
  const indices = Array.from({ length: batchSize }, (_, i) => i);
  return {
    count: () => count.get(target, visitorNow),
    directory: () => directory.all(visitorNow, visitorNow),
    insert50: () => beat(visitors + 1000, visitorNow, indices),
    renew50: () => beat(0, visitorNow + 20000, indices),
    suppressed50: () => beat(0, visitorNow, fresh),
    expire: () => rollback(() => Number(expire.run(visitorNow).changes)),
    removeRoom: () => rollback(() => Number(remove.run(target).changes)),
  };
}

const results = [];
for (const [rooms, visitors] of [[1, 100], [10, 1000], [100, 10000]]) {
  const databases = { baseline: visitorDatabase(false), indexed: visitorDatabase() };
  try {
    for (const database of Object.values(databases)) seedVisitors(database, rooms, visitors);
    const pair = { baseline: operations(databases.baseline, rooms, visitors), indexed: operations(databases.indexed, rooms, visitors) };
    const measurements = [];
    for (const name of Object.keys(pair.baseline) as (keyof ReturnType<typeof operations>)[]) {
      const expected = pair.baseline[name]();
      assert.deepEqual(pair.indexed[name](), expected, `${rooms} rooms: ${name}`);
      const samples = { baseline: [] as number[], indexed: [] as number[] };
      for (const side of ["baseline", "indexed"] as const) for (let i = 0; i < warmup; i++) pair[side][name]();
      for (let round = 0; round < rounds; round++) {
        const order = round % 2 ? ["indexed", "baseline"] as const : ["baseline", "indexed"] as const;
        for (const side of order) {
          const start = performance.now();
          for (let i = 0; i < iterations; i++) pair[side][name]();
          samples[side].push((performance.now() - start) / iterations);
        }
      }
      measurements.push({ operation: name, returned: typeof expected === "number" ? expected : Array.isArray(expected) ? expected.length : expected?.n,
        ...Object.fromEntries(Object.entries(samples).map(([side, values]) => [side, { medianMs: values.toSorted((a,b) => a-b)[Math.floor(rounds/2)], samplesMs: values }])) });
    }
    results.push({ rooms, visitors, measurements,
      storage: Object.fromEntries(Object.entries(databases).map(([side, database]) => [side, {
        pageBytes: database.prepare("PRAGMA page_size").get()!.page_size,
        pages: database.prepare("PRAGMA page_count").get()!.page_count,
        index: database.prepare("SELECT sum(pgsize) AS bytes FROM dbstat WHERE name='visitors_room_until'").get()!.bytes,
      }])),
      plans: Object.fromEntries(Object.entries(databases).map(([side, database]) => [side, {
        count: database.prepare("EXPLAIN QUERY PLAN " + visitorSQL.count).all(roomCode(rooms > 1 ? 1 : 0), visitorNow),
        directory: database.prepare("EXPLAIN QUERY PLAN " + visitorSQL.directory).all(visitorNow, visitorNow),
        expire: database.prepare("EXPLAIN QUERY PLAN " + visitorSQL.expire).all(visitorNow),
      }])),
    });
  } finally { for (const database of Object.values(databases)) database.close(); }
}
console.log(JSON.stringify({ scope: "In-memory migrated SQLite; synthetic visitors. Elapsed time includes rollback for write operations. Not D1 billing, disk durability or production latency.",
  environment: { node: process.version, sqlite: process.versions.sqlite, cpu: cpus()[0]?.model },
  workload: { iterations, rounds, warmup, batchSize }, results }, null, 2));
