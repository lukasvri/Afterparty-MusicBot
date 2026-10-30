import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { Store } from "./store.ts";
import { UserError } from "./types.ts";
import {
  ROOM_LEASE_MS,
  readRoomTimeline,
  type RoomTimeline,
  type RoomVideo,
} from "./protocol.ts";
import { roomRecommendation, playableRoomQueue } from "./room-radio.ts";
import {
  changeRoom,
  guestActions,
  needsRecommendation,
  finished,
  prefetchDue,
  publicPlayback,
  prepareRoomCommand,
  recordRoomCommand,
  roomCommandReceipt,
  roomPlaybackPosition,
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
  private radioLookups = new Map<string, Promise<RoomVideo | null>>();
  private skipping = new Set<string>();
  private stopped = false;
  readonly store: Store;
  readonly now: () => number;
  constructor(store: Store, now: () => number = Date.now) {
    super();
    this.store = store;
    this.now = now;
    store.db.exec(
      `CREATE TABLE IF NOT EXISTS video_rooms(code TEXT PRIMARY KEY,data TEXT NOT NULL);
       CREATE INDEX IF NOT EXISTS video_rooms_playing_expiry
       ON video_rooms(json_extract(data,'$.expiresAt'))
       WHERE json_extract(data,'$.state.playing')=1`,
    );
  }
  load(code: string): Saved {
    if (!/^[A-Z0-9]{8}$/.test(code) || code === "DISCORD1")
      throw new UserError("Room not found.", 404);
    const value = this.store
      .prepare("SELECT data FROM video_rooms WHERE code=?")
      .get(code);
    if (!value) throw new UserError("Room not found.", 404);
    const room = JSON.parse(String(value.data)) as Saved;
    if (room.expiresAt <= this.now())
      throw new UserError("The room has ended.", 404);
    return room;
  }
  save(room: Saved) {
    this.store
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
      throw new UserError("Invalid room.");
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
      throw new UserError("Invalid room.");
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
      ...roomCommandReceipt(room.state, room.version),
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
    return roomPlaybackPosition(room.state, room.updatedAt, now);
  }
  async control(code: string, input: Record<string, unknown>) {
    const room = this.load(code);
    if (!needsRecommendation(room.state, input) || !this.search)
      return this.mutate(code, input);
    if (
      !guestActions.has(String(input.action)) &&
      input.actorHash !== room.ownerHash
    )
      throw new UserError("Only the host can control playback.", 403);
    if (input.version !== room.version)
      throw new UserError("The room has changed. Try again.", 409);
    const lookupKey = `${code}:${room.version}`;
    if (input.action === "next") this.skipping.add(lookupKey);
    let lookup = this.radioLookups.get(lookupKey);
    if (!lookup) {
      lookup = roomRecommendation(
        {
          ...room.state,
          ...(input.action === "radio"
            ? { radio: input.enabled === true }
            : {}),
        },
        this.search,
      );
      this.radioLookups.set(lookupKey, lookup);
    }
    let recommended: RoomVideo | null;
    try {
      recommended = await lookup;
    } catch (error) {
      this.skipping.delete(lookupKey);
      throw error;
    } finally {
      this.radioLookups.delete(lookupKey);
    }
    if (this.stopped) throw new UserError("The room service is restarting.", 503);
    if (input.action === "radio-prefetch" && this.skipping.has(lookupKey))
      return this.snapshot(code);
    this.skipping.delete(lookupKey);
    if (input.action === "radio" && input.enabled === true && !recommended) {
      // Persist enabling and backoff even for an empty retry. Current playback
      // and its shared clock remain untouched; mutate retains the revision guard.
      this.mutate(code, input);
      throw new UserError(
        "Radio found no suitable songs. Try radio again or add a song.",
        422,
      );
    }
    if (
      input.action === "next" &&
      room.state.radio !== false &&
      room.state.current &&
      !playableRoomQueue(room.state).length &&
      !recommended &&
      !finished(room.state, room.updatedAt, this.now())
    ) {
      // The joined prefetch yields to next. Persist its normal cooldown before
      // rejecting the skip, or tick() would immediately repeat the empty lookup.
      // mutate keeps revision protection if another command won during lookup.
      this.mutate(code, { ...input, action: "radio-prefetch" });
      throw new UserError(
        "Radio could not find the next song. Try again or add a song.",
        422,
      );
    }
    return this.mutate(code, input, recommended);
  }
  mutate(
    code: string,
    input: Record<string, unknown>,
    recommended: RoomVideo | null = null,
  ) {
    const room = this.load(code);
    if (!guestActions.has(String(input.action)) && input.actorHash !== room.ownerHash)
      throw new UserError("Only the host can control playback.", 403);
    const command = prepareRoomCommand(room.state, input, room.version, this.epoch);
    if (command?.duplicate) return this.snapshot(code);
    if (input.version !== room.version)
      throw new UserError("The room has changed. Try again.", 409);
    const now = this.now();
    const state = changeRoom(
      room.state,
      { ...input, now },
      input.actorHash === room.ownerHash,
      this.position(room, now),
      recommended,
    );
    recordRoomCommand(state, command);
    room.state = state;
    room.updatedAt = now;
    room.version++;
    this.save(room);
    this.emit("change", code);
    return this.snapshot(code);
  }
  async tick() {
    if (this.stopped) return;
    const rows = this.store
      .prepare(
        "SELECT data FROM video_rooms WHERE json_extract(data,'$.expiresAt')>? AND json_extract(data,'$.state.playing')=1",
      )
      .all(this.now());
    await Promise.all(
      rows.map(async (value) => {
        const room = JSON.parse(String(value.data)) as Saved;
        if (
          this.advancing.has(room.code) ||
          !(
            finished(room.state, room.updatedAt, this.now()) ||
            prefetchDue(room.state, room.updatedAt, this.now())
          )
        )
          return;
        this.advancing.add(room.code);
        const input = {
          action: finished(room.state, room.updatedAt, this.now())
            ? "next"
            : "radio-prefetch",
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
    this.store.prepare("DELETE FROM video_rooms WHERE code=?").run(code);
    this.emit("change", code);
  }
}
