// Shared by the web client and the local Discord/room service. No runtime secrets.
export type RoomVideo = {
  id: string;
  title: string;
  artist: string;
  image: string;
  duration: number;
  live: boolean;
  embeddable: boolean;
  genres?: string[];
  music?: boolean;
  /** Explicit provider/upload declaration, not a general provenance detector. */
  aiGenerated?: boolean;
  requestedBy?: string;
  radio?: boolean;
  /** Private room recommendation proof; removed from publicPlayback snapshots. */
  radioRelatedTo?: string;
};
export type RoomTimeline = {
  code: string;
  name: string;
  current: RoomVideo | null;
  queue: RoomVideo[];
  playing: boolean;
  position: number;
  version: number;
  serverTime: number;
  viewers: number;
  isHost: boolean;
  expiresAt: number;
  playbackKey?: string;
  syncSource: "live";
  syncEpoch: string;
  syncValidForMs: number;
  startsAt?: number;
  radio?: boolean;
  approvalRequired?: boolean;
  requests?: RoomVideo[];
  history?: RoomVideo[];
  voteCounts?: Record<string, number>;
  skipVotes?: number;
};
export const ROOM_START_LEAD_MS = 1500;
export const ROOM_LEASE_MS = 5000;
export const ROOM_QUEUE_LIMIT = 50;
/** Pending guest requests reserve the same room capacity as queued tracks. */
export function roomQueueCapacity(queueLength: number, pendingLength = 0): number {
  if (!Number.isSafeInteger(queueLength) || queueLength < 0 ||
      !Number.isSafeInteger(pendingLength) || pendingLength < 0) return 0;
  return Math.max(0, ROOM_QUEUE_LIMIT - queueLength - pendingLength);
}
// Clients project the timestamped timeline locally between these snapshots.
// Control changes and buffering transitions are still sent immediately.
export const LIVE_SNAPSHOT_INTERVAL_MS = 1000;
export function readRoomTimeline(value: unknown): RoomTimeline | null {
  if (!value || typeof value !== "object") return null;
  const r = value as RoomTimeline;
  const video = (v: RoomVideo | null) =>
    v === null ||
    Boolean(
      v &&
      /^[\w-]{11}$/.test(v.id) &&
      typeof v.title === "string" &&
      typeof v.artist === "string" &&
      typeof v.image === "string" &&
      Number.isFinite(v.duration) &&
      v.duration >= 0 &&
      (v.music === undefined || typeof v.music === "boolean") &&
      typeof v.live === "boolean",
    );
  if (
    !/^[A-Z0-9]{8}$/.test(r.code) ||
    r.code === "DISCORD1" ||
    typeof r.name !== "string" ||
    !Number.isInteger(r.version) ||
    r.version < 1 ||
    !Number.isFinite(r.serverTime) ||
    !Number.isFinite(r.position) ||
    r.position < 0 ||
    typeof r.playing !== "boolean" ||
    (r.radio !== undefined && typeof r.radio !== "boolean") ||
    !video(r.current) ||
    !Array.isArray(r.queue) ||
    r.queue.length > ROOM_QUEUE_LIMIT ||
    !r.queue.every((v) => v && video(v)) ||
    r.syncSource !== "live" ||
    typeof r.syncEpoch !== "string" ||
    !r.syncEpoch ||
    r.syncEpoch.length > 160 ||
    !Number.isFinite(r.syncValidForMs) ||
    r.syncValidForMs < 0 ||
    r.syncValidForMs > ROOM_LEASE_MS ||
    !Number.isFinite(r.expiresAt) ||
    !Number.isInteger(r.viewers) ||
    r.viewers < 0 ||
    typeof r.isHost !== "boolean" ||
    (r.startsAt !== undefined && !Number.isFinite(r.startsAt))
  )
    return null;
  return r;
}
export function elapsedPlayingMs(
  serverTime: number,
  startsAt: number | undefined,
  elapsedMs: number,
) {
  return Math.max(
    0,
    serverTime + elapsedMs - Math.max(serverTime, startsAt ?? serverTime),
  );
}
