import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { visitorSQL } from "../lib/room-visitors.ts";
import { migrationSQL, roomCode, seedVisitors, visitorDatabase, visitorIndexMigration, visitorKey, visitorMigrations, visitorNow } from "./visitor-fixture.ts";

test("visitor index upgrades existing rooms and visitors without rewriting identity, expiry or ownership", () => {
  const database = new DatabaseSync(":memory:");
  try {
    for (const file of visitorMigrations.filter(file => file < visitorIndexMigration)) database.exec(migrationSQL(file));
    seedVisitors(database, 10, 1000);
    const before = {
      rooms: database.prepare("SELECT * FROM rooms ORDER BY code").all(),
      visitors: database.prepare("SELECT * FROM visitors ORDER BY key").all(),
      directory: database.prepare(visitorSQL.directory).all(visitorNow, visitorNow),
    };
    database.exec(migrationSQL(visitorIndexMigration));
    assert.deepEqual(database.prepare("SELECT * FROM rooms ORDER BY code").all(), before.rooms);
    assert.deepEqual(database.prepare("SELECT * FROM visitors ORDER BY key").all(), before.visitors);
    assert.deepEqual(database.prepare(visitorSQL.directory).all(visitorNow, visitorNow), before.directory);
    assert.match(JSON.stringify(database.prepare("EXPLAIN QUERY PLAN " + visitorSQL.count).all(roomCode(1), visitorNow)), /COVERING INDEX visitors_room_until/);
  } finally { database.close(); }
});

test("indexed visitor queries preserve counts, directory privacy, ordering and the sixty-room limit", () => {
  for (const [rooms, count] of [[1,100], [10,1000], [200,10000]]) {
    const baseline = visitorDatabase(false), indexed = visitorDatabase();
    try {
      for (const database of [baseline, indexed]) seedVisitors(database, rooms, count);
      for (const code of [roomCode(0), roomCode(1), "MISSING1"])
        assert.deepEqual(indexed.prepare(visitorSQL.count).get(code, visitorNow), baseline.prepare(visitorSQL.count).get(code, visitorNow));
      const rows = indexed.prepare(visitorSQL.directory).all(visitorNow, visitorNow);
      assert.deepEqual(rows, baseline.prepare(visitorSQL.directory).all(visitorNow, visitorNow));
      assert(rows.length > 0 && rows.length <= 60);
      if (rooms === 200) assert.equal(rows.length, 60);
      for (const row of rows) {
        assert.notEqual(row.code, "DISCORD1"); assert.notEqual(row.code, "G0000000");
        const stored = indexed.prepare("SELECT * FROM rooms WHERE code=?").get(row.code)!;
        assert.equal(stored.is_public, 1); assert.equal(stored.guild_id, null); assert(Number(stored.expires_at) > visitorNow);
        assert.deepEqual(Object.keys(row).sort(), ["code", "expires_at", "name", "viewers"]);
      }
      const plans = [visitorSQL.count, visitorSQL.directory].map(sql => JSON.stringify(indexed.prepare("EXPLAIN QUERY PLAN " + sql).all(...(sql === visitorSQL.count ? [roomCode(0), visitorNow] : [visitorNow, visitorNow]))));
      for (const plan of plans) assert.match(plan, /COVERING INDEX visitors_room_until/);
      assert.match(JSON.stringify(indexed.prepare("EXPLAIN QUERY PLAN " + visitorSQL.expire).all(visitorNow)), /SCAN visitors/);
    } finally { baseline.close(); indexed.close(); }
  }
});

test("indexed heartbeat keeps the fifteen-second renewal guard and exact expiry boundaries", () => {
  const database = visitorDatabase();
  try {
    seedVisitors(database, 2, 100);
    const key = visitorKey(1,2), heartbeat = database.prepare(visitorSQL.heartbeat);
    const first = database.prepare("SELECT * FROM visitors WHERE key=?").get(key)!;
    assert.equal(heartbeat.run(key, roomCode(1), visitorNow + 45000, visitorNow + 30000).changes, 0);
    assert.equal(heartbeat.run(key, roomCode(1), visitorNow + 60000, visitorNow + 45000).changes, 0, "exactly fifteen seconds is still suppressed");
    assert.equal(heartbeat.run(key, roomCode(0), visitorNow + 60001, visitorNow + 45001).changes, 1);
    assert.deepEqual({ ...database.prepare("SELECT * FROM visitors WHERE key=?").get(key) }, { ...first, until: visitorNow + 60001 });
    const before = Number(database.prepare(visitorSQL.count).get(roomCode(0), visitorNow)!.n);
    const insert = database.prepare("INSERT INTO visitors VALUES(?,?,?)");
    insert.run("boundary",roomCode(0),visitorNow); insert.run("future",roomCode(0),visitorNow+1);
    assert.equal(Number(database.prepare(visitorSQL.count).get(roomCode(0),visitorNow)!.n),before+1);
    database.prepare(visitorSQL.expire).run(visitorNow);
    assert(database.prepare("SELECT key FROM visitors WHERE key='boundary'").get(), "cleanup retains the exact boundary");
    assert(database.prepare("SELECT key FROM visitors WHERE key='future'").get());
    const other = database.prepare("SELECT * FROM visitors WHERE room=? ORDER BY key").all(roomCode(1));
    database.prepare(visitorSQL.removeRoom).run(roomCode(0));
    assert.deepEqual(database.prepare("SELECT * FROM visitors WHERE room=? ORDER BY key").all(roomCode(1)),other);
  } finally { database.close(); }
});
