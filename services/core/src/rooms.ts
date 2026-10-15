import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { Store } from "./store.ts";
import { UserError } from "./types.ts";
import {
  ROOM_START_LEAD_MS,
  ROOM_LEASE_MS,
  readRoomTimeline,
  type RoomTimeline,
  type RoomVideo,
} from "./protocol.ts";
import { roomRecommendation } from "./room-radio.ts";
import {
  changeRoom,
  needsRecommendation,
  finished,
  publicPlayback,
  type RoomPlayback,
} from "./room-state.ts";

type Saved = {
  code: string;
  name: string;
  ownerHash: string;
  state: RoomPlayback;
  version: number;
  updatedAt: number;
  expiresAt: number;
};

/** Owns room clocks and transitions even when no browsers are connected. */
export class Rooms extends EventEmitter {
  readonly epoch = randomUUID();
  search: ((query: string) => Promise<RoomVideo[]>) | null = null;
  private advancing = new Set<string>();
  private stopped = false;
  readonly store: Store;
  readonly now: () => number;
  constructor(store: Store, now: () => number = Date.now) {
    super();
    this.store = store;
    this.now = now;
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS video_rooms(code TEXT PRIMARY KEY,data TEXT NOT NULL)",
    );
  }
  load(code: string): Saved {
    if (!/^[A-Z0-9]{8}$/.test(code) || code === "DISCORD1")
      throw new UserError("Rommet finnes ikke.", 404);
    const value = this.store.db
      .prepare("SELECT data FROM video_rooms WHERE code=?")
      .get(code);
    if (!value) throw new UserError("Rommet finnes ikke.", 404);
    const room = JSON.parse(String(value.data)) as Saved;
    if (room.expiresAt <= this.now())
      throw new UserError("Rommet er avsluttet.", 404);
    return room;
  }
  save(room: Saved) {
    this.store.db
      .prepare(
        "INSERT INTO video_rooms VALUES(?,?) ON CONFLICT(code) DO UPDATE SET data=excluded.data",
      )
      .run(room.code, JSON.stringify(room));
  }
  import(input: Record<string, unknown>) {
    const code = String(input.code ?? "");
    if (
      typeof input.owner_hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.owner_hash)
    )
      throw new UserError("Ugyldig rom.");
    try {
      return this.snapshot(code);
    } catch (error) {
      if (!(error instanceof UserError) || error.status !== 404) throw error;
    }
    const state = JSON.parse(
      typeof input.state === "string"
        ? input.state
        : JSON.stringify(input.state ?? {}),
    );
    const candidate = {
      code,
      name: input.name,
      ...state,
      version: input.version,
      serverTime: input.updated_at,
      viewers: 0,
      isHost: false,
      expiresAt: input.expires_at,
      syncSource: "live",
      syncEpoch: this.epoch,
      syncValidForMs: ROOM_LEASE_MS,
    };
    if (
      !readRoomTimeline(candidate) ||
      !Number.isFinite(input.expires_at) ||
      Number(input.expires_at) <= this.now()
    )
      throw new UserError("Ugyldig rom.");
    this.save({
      code,
      name: String(input.name),
      ownerHash: input.owner_hash,
      state,
      version: Number(input.version),
      updatedAt: Number(input.updated_at),
      expiresAt: Number(input.expires_at),
    });
    return this.snapshot(code);
  }
  snapshot(code: string): RoomTimeline {
    const room = this.load(code),
      now = this.now();
    const position = this.position(room, now);
    return {
      ...publicPlayback(room.state),
      code,
      name: room.name,
      radio: room.state.radio !== false,
      position:
        room.state.current && !room.state.current.live
          ? Math.min(Math.max(0, room.state.current.duration - 0.1), position)
          : position,
      version: room.version,
      serverTime: now,
      viewers: 0,
      isHost: false,
      expiresAt: room.expiresAt,
      syncSource: "live",
      syncEpoch: this.epoch,
      syncValidForMs: ROOM_LEASE_MS,
    };
  }
  private position(room: Saved, now: number) {
    return (
      room.state.position +
      (room.state.playing
        ? Math.max(
            0,
            now -
              Math.max(room.updatedAt, room.state.startsAt ?? room.updatedAt),
          ) / 1000
        : 0)
    );
  }
  async control(code: string, input: Record<string, unknown>) {
    const room = this.load(code);
    if (!needsRecommendation(room.state, input) || !this.search)
      return this.mutate(code, input);
    if (input.action === "next" && input.actorHash !== room.ownerHash)
      throw new UserError("Bare verten kan styre avspillingen.", 403);
    if (input.version !== room.version)
      throw new UserError("Rommet er endret. Prøv igjen.", 409);
    const recommended = await roomRecommendation(room.state, this.search);
    if (this.stopped) throw new UserError("Romtjenesten starter på nytt.", 503);
    return this.mutate(code, input, recommended);
  }
  mutate(
    code: string,
    input: Record<string, unknown>,
    recommended: RoomVideo | null = null,
  ) {
    const room = this.load(code);
    if (input.version !== room.version)
      throw new UserError("Rommet er endret. Prøv igjen.", 409);
    const now = this.now(),
      previousKey = room.state.playbackKey;
    const state = changeRoom(
      room.state,
      input,
      input.actorHash === room.ownerHash,
      this.position(room, now),
      recommended,
    );
    if (
      state.playing &&
      (state.playbackKey !== previousKey ||
        ["play", "seek"].includes(String(input.action)))
    )
      state.startsAt = now + ROOM_START_LEAD_MS;
    else if (!state.playing) delete state.startsAt;
    room.state = state;
    room.updatedAt = now;
    room.version++;
    this.save(room);
    this.emit("change", code);
    return this.snapshot(code);
  }
  async tick() {
    if (this.stopped) return;
    const rows = this.store.db
      .prepare(
        "SELECT data FROM video_rooms WHERE json_extract(data,'$.expiresAt')>? AND json_extract(data,'$.state.playing')=1",
      )
      .all(this.now());
    await Promise.all(
      rows.map(async (value) => {
        const room = JSON.parse(String(value.data)) as Saved;
        if (
          this.advancing.has(room.code) ||
          !finished(room.state, room.updatedAt, this.now())
        )
          return;
        this.advancing.add(room.code);
        const input = {
          action: "next",
          actorHash: room.ownerHash,
          version: room.version,
        };
        try {
          await this.control(room.code, input);
        } catch {
          // Failed radio lookup must not leave a finished track looping. CAS preserves newer commands.
          if (!this.stopped)
            try {
              this.mutate(room.code, input);
            } catch {
              /* a newer command or closure won */
            }
        } finally {
          this.advancing.delete(room.code);
        }
      }),
    );
  }
  dispose() {
    this.stopped = true;
    this.removeAllListeners();
  }
  close(code: string) {
    this.load(code);
    this.store.db.prepare("DELETE FROM video_rooms WHERE code=?").run(code);
    this.emit("change", code);
  }
}
