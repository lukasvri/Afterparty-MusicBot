import { DatabaseSync, type StatementSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { defaultSettings, type Settings, type PublicTrack } from "./types.ts";
export class Store {
  db: DatabaseSync;
  private statements = new Map<string, StatementSync>();
  /** Reuse fixed SQL across clock ticks without retaining unbounded dynamic statements. */
  prepare(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      if (this.statements.size >= 64)
        this.statements.delete(this.statements.keys().next().value!);
      this.statements.set(sql, statement);
    }
    return statement;
  }
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY,video TEXT NOT NULL,at INTEGER NOT NULL,sent INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS favorites(id TEXT PRIMARY KEY,author TEXT NOT NULL,name TEXT NOT NULL,query TEXT NOT NULL,UNIQUE(author,name));
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL,result TEXT NOT NULL,at INTEGER NOT NULL,sent INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS history_at ON history(at); CREATE INDEX IF NOT EXISTS history_pending ON history(at) WHERE sent=0; CREATE INDEX IF NOT EXISTS jobs_at ON jobs(at); CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(at) WHERE sent=0 AND status IN ('done','failed','unknown'); CREATE INDEX IF NOT EXISTS jobs_bridge_pending ON jobs(at) WHERE sent=0 AND status IN ('done','failed','unknown') AND json_extract(payload,'$.bridge')=1; UPDATE jobs SET status='unknown',result='Prosessen startet på nytt før resultatet var bekreftet.' WHERE status='processing';`);
  }
  get<T>(key: string, fallback: T): T {
    const row = this.prepare("SELECT value FROM kv WHERE key=?").get(key) as
      | { value: string }
      | undefined;
    try {
      return row ? JSON.parse(row.value) : fallback;
    } catch {
      return fallback;
    }
  }
  set(key: string, value: unknown) {
    this.prepare(
      "INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(key, JSON.stringify(value));
  }
  transaction(fn: () => void) {
    this.db.exec("SAVEPOINT core_write");
    try {
      fn();
      this.db.exec("RELEASE core_write");
    } catch (error) {
      this.db.exec("ROLLBACK TO core_write; RELEASE core_write");
      throw error;
    }
  }
  setMany(values: Record<string, unknown>) {
    this.transaction(() => {
      for (const [key, value] of Object.entries(values)) this.set(key, value);
    });
  }
  settings(): Settings {
    return {
      ...defaultSettings,
      ...this.get<Partial<Settings>>("settings", {}),
    };
  }
  record(id: string, video: PublicTrack, at = Date.now()) {
    this.prepare(
      "INSERT OR IGNORE INTO history(id,video,at) VALUES(?,?,?)",
    ).run(id, JSON.stringify(video), at);
  }
  history(limit = 20) {
    return this.prepare(
      "SELECT id,video,at FROM history ORDER BY at DESC LIMIT ?",
    )
      .all(limit)
      .map((r) => ({
        id: String(r.id),
        video: JSON.parse(String(r.video)) as PublicTrack,
        at: Number(r.at),
      }));
  }
  events() {
    return this.prepare(
      "SELECT id,video,at FROM history WHERE sent=0 ORDER BY at LIMIT 20",
    )
      .all()
      .map((r) => ({
        id: String(r.id),
        video: JSON.parse(String(r.video)),
        at: Number(r.at),
      }));
  }
  acknowledge(ids: string[]) {
    const q = this.prepare("UPDATE history SET sent=1 WHERE id=?");
    if (ids.length)
      this.transaction(() => {
        for (const id of ids) q.run(id);
      });
  }
  favorites(author?: string) {
    return this.prepare(
      `SELECT id,author,name,query FROM favorites ${author ? "WHERE author=?" : ""} ORDER BY name`,
    ).all(...(author ? [author] : [])) as {
      id: string;
      author: string;
      name: string;
      query: string;
    }[];
  }
  favorite(author: string, name: string, query: string) {
    this.prepare(
      "INSERT INTO favorites VALUES(?,?,?,?) ON CONFLICT(author,name) DO UPDATE SET query=excluded.query",
    ).run(randomUUID(), author, name.slice(0, 80), query.slice(0, 2000));
  }
  removeFavorite(author: string, name: string) {
    this.prepare("DELETE FROM favorites WHERE author=? AND name=?").run(
      author,
      name,
    );
  }
  job(id: string, payload: unknown) {
    const previous = this.prepare(
      "SELECT status,result FROM jobs WHERE id=?",
    ).get(id);
    if (previous) return previous as { status: string; result: string };
    this.prepare(
      "INSERT INTO jobs(id,payload,status,result,at) VALUES(?,?,'processing','',?)",
    ).run(id, JSON.stringify(payload), Date.now());
    return null;
  }
  finishJob(id: string, status: string, result: string) {
    this.prepare("UPDATE jobs SET status=?,result=? WHERE id=?").run(
      status,
      result.slice(0, 250),
      id,
    );
  }
  bridgeResults() {
    return this.prepare(
      "SELECT id,status,result FROM jobs WHERE sent=0 AND status IN ('done','failed','unknown') AND json_extract(payload,'$.bridge')=1 ORDER BY at LIMIT 20",
    )
      .all()
      .map((r) => ({
        id: String(r.id),
        ok: r.status === "done",
        message: String(r.result),
      }));
  }
  acknowledgeJobs(ids: string[]) {
    const q = this.prepare("UPDATE jobs SET sent=1 WHERE id=?");
    if (ids.length)
      this.transaction(() => {
        for (const id of ids) q.run(id);
      });
  }
  jobs() {
    return this.prepare(
      "SELECT id,payload,status,result,at AS createdAt FROM jobs ORDER BY at DESC LIMIT 30",
    )
      .all()
      .map((r) => ({ id: String(r.id), status: String(r.status), result: String(r.result), createdAt: Number(r.createdAt), payload: JSON.parse(String(r.payload)) as Record<string, unknown> }));
  }

  close() {
    this.statements.clear();
    this.db.close();
  }
}
