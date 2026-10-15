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
  requestedBy?: string;
  radio?: boolean;
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
    r.queue.length > 50 ||
    !r.queue.every((v) => v && video(v)) ||
    typeof r.syncEpoch !== "string" ||
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
