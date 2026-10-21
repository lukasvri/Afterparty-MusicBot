import type { RoomPlayback } from "../services/core/src/room-state";
export type Video = {
  entryId?: string;
  waitSeconds?: number | null;
  id: string;
  title: string;
  artist: string;
  image: string;
  duration: number;
  live: boolean;
  embeddable: boolean;
  concert?: boolean;
  source?: "youtube" | "soundcloud";
  url?: string;
  genres?: string[];
  music?: boolean;
  /** Explicit provider/upload declaration, not a general provenance detector. */
  aiGenerated?: boolean;
  requestedBy?: string;
  radio?: boolean;
};
export type RoomState = RoomPlayback & {
  buffering?: boolean;
  cohostHashes?: string[];
  inviteHashes?: string[];
  transferHash?: string;
  engineOwnerHash?: string;
};
export type OpenRoom = {
  code: string;
  name: string;
  viewers: number;
  expiresAt: number;
};
export type Room = {
  isOwner?: boolean;
  approvalRequired?: boolean;
  requests?: Video[];
  history?: Video[];
  voteCounts?: Record<string, number>;
  skipVotes?: number;
  radio?: boolean;
  isPublic?: boolean;
  code: string;
  name: string;
  current: Video | null;
  queue: Video[];
  playing: boolean;
  position: number;
  version: number;
  serverTime: number;
  /** Original server sample time before client transit compensation. */
  syncSampledAt?: number;
  viewers: number;
  isHost: boolean;
  expiresAt: number;
  mode?: "discord";
  buffering?: boolean;
  discordOnline?: boolean;
  playbackKey?: string;
  syncValidForMs?: number;
  syncSource?: "live" | "bridge";
  syncEpoch?: string;
  guildId?: string;
  startsAt?: number;
};
export type DiscordState = {
  guildId?: string;
  roomCode?: string;
  guildName?: string;
  ready: boolean;
  connected: boolean;
  playing: boolean;
  position: number;
  volume: number;
  current: Video | null;
  queue: Video[];
  queueRevision: string;
  lastSeen: number;
  online: boolean;
};
export type HistoryVideo = Video & {
  plays: number;
  lastPlayed: number;
  source: string;
};
export const time = (seconds: number) => {
  const s = Math.floor(Math.max(0, seconds));
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
