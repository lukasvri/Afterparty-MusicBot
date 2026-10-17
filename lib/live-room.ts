import type { DiscordState, Room, Video } from "./types.ts";

export const DISCORD_LIVE_LEASE_MS = 7000;
export type LiveState = DiscordState & {
  engine: "gutta-krutt-core";
  epoch: string;
  sequence: number;
  serverTime: number;
  buffering: boolean;
  playbackKey: string | null;
};

export function readLiveState(value: unknown): LiveState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as LiveState;
  if (
    state.engine !== "gutta-krutt-core" ||
    typeof state.epoch !== "string" ||
    !state.epoch ||
    state.epoch.length > 200 ||
    !Number.isSafeInteger(state.sequence) ||
    state.sequence < 0 ||
    !Number.isFinite(state.serverTime) ||
    !Number.isFinite(state.position) ||
    state.position < 0 ||
    !Number.isFinite(state.volume) ||
    state.volume < 0 ||
    state.volume > 100 ||
    typeof state.ready !== "boolean" ||
    typeof state.connected !== "boolean" ||
    typeof state.playing !== "boolean" ||
    typeof state.buffering !== "boolean" ||
    typeof state.queueRevision !== "string" ||
    (state.playbackKey !== null && typeof state.playbackKey !== "string") ||
    (state.guildId !== undefined && (typeof state.guildId !== "string" || !/^\d{14,22}$/.test(state.guildId))) ||
    (state.roomCode !== undefined && (typeof state.roomCode !== "string" || !/^[A-Z0-9]{8}$/.test(state.roomCode))) ||
    !Array.isArray(state.queue) ||
    state.queue.length > 40
  )
    return null;
  const valid = (video: Video | null) =>
    video === null ||
    Boolean(
      video &&
      typeof video.id === "string" &&
      typeof video.title === "string" &&
      typeof video.artist === "string" &&
      typeof video.image === "string" &&
      Number.isFinite(video.duration) &&
      video.duration >= 0 &&
      typeof video.live === "boolean" &&
      (video.source === "soundcloud"
        ? typeof video.url === "string" && video.url.startsWith("https://soundcloud.com/")
        : /^[\w-]{11}$/.test(video.id)),
    );
  if (!valid(state.current) || state.queue.some((video) => !video || !valid(video)))
    return null;
  return state;
}

/** Keep a late frame from a prior subscription out of another server's state. */
export function acceptsLiveState(previous: LiveState | null, next: LiveState, guildId?: string) {
  if (guildId && next.guildId !== guildId) return false;
  if (previous?.guildId !== next.guildId || previous?.roomCode !== next.roomCode || previous?.epoch !== next.epoch)
    return true;
  return next.sequence > previous.sequence ||
    (next.sequence === previous.sequence && next.serverTime > previous.serverTime);
}

export function liveRoom(state: LiveState, ageMs = 0): Room {
  const age = Number.isFinite(ageMs)
    ? Math.max(0, Math.min(DISCORD_LIVE_LEASE_MS, ageMs))
    : 0;
  return {
    code: state.roomCode ?? "DISCORD1",
    guildId: state.guildId,
    name: "Discord · " + (state.guildName ?? "Afterparty"),
    current: state.current,
    queue: state.queue,
    playing: state.playing,
    buffering: state.buffering,
    position: state.position + (state.playing && !state.buffering ? age / 1000 : 0),
    version: state.sequence,
    syncSampledAt: state.serverTime,
    serverTime: state.serverTime + age,
    viewers: 0,
    isHost: false,
    expiresAt: state.serverTime + 172800000,
    mode: "discord",
    discordOnline: state.ready,
    playbackKey: state.playbackKey ?? undefined,
    syncValidForMs: DISCORD_LIVE_LEASE_MS - age,
    syncSource: "live",
    syncEpoch: state.epoch,
  };
}

export const liveMetadata = (state: LiveState) =>
  JSON.stringify([
    state.guildId,
    state.roomCode,
    state.epoch,
    state.sequence,
    state.ready,
    state.connected,
    state.playing,
    state.volume,
    state.queueRevision,
    state.current?.id,
    state.playbackKey,
    state.buffering,
  ]);
