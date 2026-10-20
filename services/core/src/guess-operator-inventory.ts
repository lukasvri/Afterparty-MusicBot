import { randomUUID } from 'node:crypto';
import { OperatorGuessCatalog, type GuessCatalog, type GuessSong, type OperatorGuessRecord } from './guess-catalog.ts';
import { GUESS_AUDIO_MAX_BYTES, guessWaveSeconds } from './guess-audio-format.ts';
import type { GuessMediaSource } from './guess-media.ts';
import { UserError } from './types.ts';

/** Trusted private inputs only. Approval and evidence are operator attestations, not legal verification. */
export type OperatorGuessInventoryRecord = {
  song: Omit<GuessSong, 'mediaKey'>;
  categoryIds: readonly string[];
  permission: { approved: true; reference: string; expiresAt: number };
  wav: Uint8Array;
};
const unavailable = () => new UserError('The authorized game inventory is unavailable.', 503);
const MAX_TTL_MS = 300_000;

function permissionExpires(permission: OperatorGuessInventoryRecord['permission'], now: number): number {
  if (!permission || permission.approved !== true || !Number.isSafeInteger(permission.expiresAt) ||
    permission.expiresAt <= now || typeof permission.reference !== 'string' ||
    permission.reference.length > 2048 || /[\p{Cc}\p{Cf}]/u.test(permission.reference) ||
    permission.reference.trim() !== permission.reference) throw unavailable();
  let reference: URL;
  try { reference = new URL(permission.reference); } catch { throw unavailable(); }
  if (reference.protocol !== 'https:' || !reference.hostname || reference.username || reference.password) throw unavailable();
  return permission.expiresAt;
}

/**
 * Prepare at most eight already-authorized canonical WAVs without fetching, files or provider activation.
 * The entire snapshot expires at the earliest recording permission or after five minutes.
 * References remain private and are only checked syntactically. Call dispose to release bytes early.
 */
export function prepareOperatorGuessInventory(records: readonly OperatorGuessInventoryRecord[]): {
  catalog: GuessCatalog; media: GuessMediaSource; dispose(): void;
} {
  const now = Date.now();
  if (!Array.isArray(records) || records.length > 8) throw unavailable();
  const clips = new Map<string, Uint8Array>();
  let expiresAt = now + MAX_TTL_MS;
  const prepared: OperatorGuessRecord[] = records.map(record => {
    if (!record || !(record.wav instanceof Uint8Array) || record.wav.byteLength > GUESS_AUDIO_MAX_BYTES) throw unavailable();
    expiresAt = Math.min(expiresAt, permissionExpires(record.permission, now));
    // Uint8Array construction copies Buffer inputs too; Buffer.slice() would retain caller-owned memory.
    const bytes = new Uint8Array(record.wav);
    let durationSeconds: number;
    try { durationSeconds = guessWaveSeconds(bytes); } catch { throw unavailable(); }
    if (durationSeconds < 15) throw unavailable();
    const mediaKey = randomUUID().replaceAll('-', '');
    clips.set(mediaKey, bytes);
    return { rightsCleared: true, categoryIds: record.categoryIds,
      song: { ...record.song, mediaKey }, media: { key: mediaKey, mimeType: 'audio/wav', durationSeconds } };
  });
  const stored = new OperatorGuessCatalog(prepared);
  let disposed = false;
  const dispose = () => { disposed = true; clips.clear(); clearTimeout(timer); };
  const active = () => {
    if (disposed || Date.now() >= expiresAt) { dispose(); throw unavailable(); }
  };
  const timer = setTimeout(dispose, Math.max(0, expiresAt - Date.now())); timer.unref();
  const catalog: GuessCatalog = {
    categories() {
      if (disposed || Date.now() >= expiresAt) { dispose(); return stored.categories().map(c => ({ ...c, available: false, count: 0 })); }
      return stored.categories();
    },
    select(categoryId, options) { active(); const song = stored.select(categoryId, options); active(); return song; },
    media(key) { active(); const descriptor = stored.media(key); active(); return descriptor; },
  };
  const media: GuessMediaSource = {
    async read(key, signal) {
      active(); signal.throwIfAborted();
      const bytes = clips.get(key); if (!bytes) throw unavailable();
      const copy = new Uint8Array(bytes);
      // Recheck after yielding so cancellation/disposal/permission expiry cannot return a stale copy.
      await Promise.resolve();
      active(); signal.throwIfAborted(); return copy;
    },
  };
  return { catalog, media, dispose };
}
