import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

export const visitorNow = 1_000_000;
export const visitorIndexMigration = "0004_room_visitors.sql";
export const visitorMigrations = readdirSync(new URL("../drizzle/", import.meta.url))
  .filter(file => file.endsWith(".sql")).sort();
export const migrationSQL = (file: string) => readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
export const roomCode = (index: number) => `R${String(index).padStart(7, "0")}`;
export const visitorKey = (index: number, rooms: number) => `${roomCode(index % rooms)}:${index.toString(16).padStart(32, "0")}`;

export function visitorDatabase(indexed = true) {
  const database = new DatabaseSync(":memory:");
  for (const file of visitorMigrations) database.exec(migrationSQL(file));
  if (!indexed) database.exec("DROP INDEX visitors_room_until");
  return database;
}

/** Synthetic data only, including private, guild, expired and boundary cases. */
export function seedVisitors(database: DatabaseSync, rooms: number, visitors: number) {
  const room = database.prepare("INSERT INTO rooms(code,name,owner_hash,state,version,updated_at,expires_at,is_public,guild_id) VALUES(?,?,?,'{}',1,?,?,?,?)");
  const visitor = database.prepare("INSERT INTO visitors VALUES(?,?,?)");
  database.exec("BEGIN");
  try {
    for (let i = 0; i < rooms; i++) room.run(roomCode(i), `Synthetic room ${i}`, "a".repeat(64), visitorNow - i,
      i % 10 === 9 ? visitorNow - 1 : visitorNow + 60000, Number(i % 4 !== 3), i % 7 === 6 ? "111111111111111" : null);
    for (const [code, guild] of [["DISCORD1", null], ["G0000000", "222222222222222"]])
      room.run(code, "Excluded synthetic room", "b".repeat(64), visitorNow, visitorNow + 60000, 1, guild);
    for (let i = 0; i < visitors; i++) visitor.run(visitorKey(i, rooms), roomCode(i % rooms),
      i % 10 === 0 ? visitorNow : i % 4 === 0 ? visitorNow - 1 : visitorNow + 45000);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}
