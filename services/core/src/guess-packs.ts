import { readFileSync } from 'node:fs';
import { copyGuessSong, UnavailableGuessCatalog } from './guess-catalog.ts';
import type { YoutubeGuessRecord } from './guess-youtube.ts';
import { UserError } from './types.ts';

type PackTrack = Omit<YoutubeGuessRecord, 'permission'> & {
  sourceUrl: string; uploaderName: string; evidenceUrl?: string; verifiedAt: string;
};
export type GuessPack = { id: string; name: string; tracks: PackTrack[] };
export type GuessPackSummary = { id: string; name: string; count: number };
export type GuessPackTemplate = Omit<YoutubeGuessRecord, 'permission'> & {
  permission: { approved: false; reference: ''; expiresAt: 0 };
};
const unavailable = () => new UserError('The game playlist configuration is unavailable.', 503);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() &&
  value === value.trim() && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value);
function httpsReference(value: unknown): value is string {
  if (!text(value, 2048)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; }
  catch { return false; }
}

/** Server-only manifest validation. This module must never be imported into public catalog/browser code. */
export function validateGuessPack(value: unknown): GuessPack {
  try {
    if (!object(value) || value.id !== 'edm-festival-hits' || value.name !== 'EDM festival hits' ||
      !Array.isArray(value.tracks) || !value.tracks.length || value.tracks.length > 8 || 'permission' in value) throw unavailable();
    const allowed = new UnavailableGuessCatalog().categories().map(category => category.id), seen = new Set<string>();
    const tracks = [...value.tracks].map((raw: unknown): PackTrack => {
      if (!object(raw) || typeof raw.videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(raw.videoId) ||
        seen.has(raw.videoId) || 'permission' in raw || !Array.isArray(raw.aliases) || raw.aliases.length > 8 ||
        [...raw.aliases].some(alias => typeof alias !== 'string') ||
        !Array.isArray(raw.categoryIds) || !raw.categoryIds.length || raw.categoryIds.length > allowed.length ||
        new Set(raw.categoryIds).size !== raw.categoryIds.length || !raw.categoryIds.includes(value.id) ||
        ![...raw.categoryIds].every(id => typeof id === 'string' && allowed.includes(id)) ||
        typeof raw.startSeconds !== 'number' || !Number.isFinite(raw.startSeconds) || raw.startSeconds < 0 || raw.startSeconds > 3600 ||
        typeof raw.durationSeconds !== 'number' || !Number.isInteger(raw.durationSeconds) || raw.durationSeconds < 15 || raw.durationSeconds > 30 ||
        raw.sourceUrl !== `https://www.youtube.com/watch?v=${raw.videoId}` || !text(raw.uploaderName, 120) ||
        (raw.evidenceUrl !== undefined && !httpsReference(raw.evidenceUrl)) || typeof raw.verifiedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(raw.verifiedAt) || !Number.isFinite(Date.parse(raw.verifiedAt)) ||
        new Date(raw.verifiedAt).toISOString().slice(0, 10) !== raw.verifiedAt) throw unavailable();
      const song = copyGuessSong({ id: raw.videoId, title: raw.title as string, artist: raw.artist as string,
        aliases: raw.aliases as string[], mediaKey: 'private_pack_validation' });
      seen.add(raw.videoId);
      return { videoId: raw.videoId, title: song.title, artist: song.artist, aliases: [...song.aliases],
        categoryIds: [...raw.categoryIds] as string[], startSeconds: raw.startSeconds, durationSeconds: raw.durationSeconds,
        sourceUrl: raw.sourceUrl, uploaderName: raw.uploaderName, verifiedAt: raw.verifiedAt,
        ...(raw.evidenceUrl !== undefined ? { evidenceUrl: raw.evidenceUrl } : {}) };
    });
    return { id: value.id, name: value.name, tracks };
  } catch { throw unavailable(); }
}
function bundledPack(): GuessPack {
  try {
    const bytes = readFileSync(new URL('../quiz-playlists.json', import.meta.url));
    if (!bytes.length || bytes.length > 32_768) throw unavailable();
    return validateGuessPack(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch { throw unavailable(); }
}
export function listGuessPacks(): GuessPackSummary[] {
  const pack = bundledPack(); return [{ id: pack.id, name: pack.name, count: pack.tracks.length }];
}
export function getGuessPack(id: string): GuessPack {
  const pack = bundledPack(); if (id !== pack.id) throw unavailable(); return pack;
}
/** Server-selected bundled recording metadata only. Does not create approval or licensing records. */
export function getGuessPackClips(id: string): Omit<YoutubeGuessRecord, 'permission'>[] {
  return getGuessPack(id).tracks.map(track => ({ videoId: track.videoId, title: track.title, artist: track.artist,
    aliases: [...track.aliases!], categoryIds: [...track.categoryIds], startSeconds: track.startSeconds, durationSeconds: track.durationSeconds }));
}

/** Official-source verification never supplies permission. Omitted approvals deliberately produce an inactive template. */
export function buildGuessPackInventory(id: string): GuessPackTemplate[];
export function buildGuessPackInventory(id: string, approvals: unknown, now?: number): YoutubeGuessRecord[];
export function buildGuessPackInventory(id: string, approvals?: unknown, now = Date.now()): (YoutubeGuessRecord | GuessPackTemplate)[] {
  try {
    const pack = getGuessPack(id), permissions = new Map<string, YoutubeGuessRecord['permission']>();
    if (arguments.length >= 2) {
      if (!Number.isSafeInteger(now) || !Array.isArray(approvals) || approvals.length !== pack.tracks.length) throw unavailable();
      for (const entry of approvals) {
        if (!object(entry) || Object.keys(entry).some(key => !['videoId', 'permission'].includes(key)) ||
          typeof entry.videoId !== 'string' || !pack.tracks.some(track => track.videoId === entry.videoId) ||
          permissions.has(entry.videoId) || !object(entry.permission)) throw unavailable();
        const permission = entry.permission;
        if (Object.keys(permission).some(key => !['approved', 'reference', 'expiresAt'].includes(key)) ||
          permission.approved !== true || !httpsReference(permission.reference) ||
          typeof permission.expiresAt !== 'number' || !Number.isSafeInteger(permission.expiresAt) || permission.expiresAt <= now) throw unavailable();
        permissions.set(entry.videoId, { approved: true, reference: permission.reference, expiresAt: permission.expiresAt });
      }
    }
    return pack.tracks.map(track => {
      const record = { videoId: track.videoId, title: track.title, artist: track.artist,
        aliases: [...track.aliases!], categoryIds: [...track.categoryIds], startSeconds: track.startSeconds, durationSeconds: track.durationSeconds };
      const permission = permissions.get(track.videoId);
      return permission ? { ...record, permission } : { ...record, permission: { approved: false as const, reference: '' as const, expiresAt: 0 as const } };
    });
  } catch { throw unavailable(); }
}
