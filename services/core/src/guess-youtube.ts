import { randomUUID } from 'node:crypto';
import { copyGuessSong, UnavailableGuessCatalog } from './guess-catalog.ts';
import { guessAbort, readGuessBytes, guessWaveSeconds, GUESS_AUDIO_MAX_BYTES, GUESS_AUDIO_RATE } from './guess-audio-format.ts';
import { decodeGuessClip } from './guess-decode.ts';
import { runJson } from './extractor.ts';
import { prepareTrustedGuessInventory, type OperatorGuessInventoryRecord, type TrustedGuessInventoryRecord } from './guess-operator-inventory.ts';
import { getGuessPackClips } from './guess-packs.ts';
import { UserError } from './types.ts';

/** Curated private inputs only. Approval is an operator attestation, not legal verification. */
export type YoutubeGuessRecord = {
  videoId: string; title: string; artist: string; aliases?: readonly string[]; categoryIds: readonly string[];
  startSeconds?: number; durationSeconds?: number;
  permission: OperatorGuessInventoryRecord['permission'];
};
type Clip = { format: 'webm' | 'mp4'; startSeconds: number; durationSeconds: number };
export type YoutubeGuessOptions = {
  signal: AbortSignal; extract?: (args: string[], signal: AbortSignal) => Promise<unknown>; fetcher?: typeof fetch;
  decode?: (input: Uint8Array, options: Clip, signal: AbortSignal) => Promise<Uint8Array>;
};
type Inventory = ReturnType<typeof prepareTrustedGuessInventory>;
type PreparedInput = { videoId: string; song: OperatorGuessInventoryRecord['song']; categoryIds: readonly string[];
  startSeconds: number; durationSeconds: number };
const unavailable = () => new UserError('The YouTube game audio inventory is unavailable.', 503);
const controls = /[\p{Cc}\p{Cf}]/u;
const categories = new Set(new UnavailableGuessCatalog().categories().map(category => category.id));
const maximumBytes = 8 * 1024 * 1024;
export const GUESS_YOUTUBE_INVENTORY_LIFETIME_MS = 1_800_000;
let activePreparations = 0;
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

function snapshot(records: readonly Omit<YoutubeGuessRecord, 'permission'>[]): PreparedInput[] {
  if (!Array.isArray(records) || records.length < 1 || records.length > 8) throw unavailable();
  const seen = new Set<string>();
  return [...records].map(record => {
    if (!record || typeof record.videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(record.videoId) || seen.has(record.videoId) ||
      !Array.isArray(record.categoryIds) || !record.categoryIds.length || record.categoryIds.length > categories.size ||
      new Set(record.categoryIds).size !== record.categoryIds.length || ![...record.categoryIds].every((id: unknown) => typeof id === 'string' && categories.has(id)) ||
      record.aliases !== undefined && (!Array.isArray(record.aliases) || record.aliases.length > 8 || [...record.aliases].some(alias => typeof alias !== 'string'))) throw unavailable();
    const startSeconds = record.startSeconds === undefined ? 0 : record.startSeconds, durationSeconds = record.durationSeconds === undefined ? 30 : record.durationSeconds;
    if (!Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > 3600 || !Number.isInteger(durationSeconds) || durationSeconds < 15 || durationSeconds > 30) throw unavailable();
    const song = copyGuessSong({ id: randomUUID(), title: record.title, artist: record.artist, aliases: record.aliases === undefined ? [] : record.aliases, mediaKey: randomUUID().replaceAll('-', '') });
    seen.add(record.videoId);
    return { videoId: record.videoId, song: { id: song.id, title: song.title, artist: song.artist, aliases: song.aliases },
      categoryIds: [...record.categoryIds], startSeconds, durationSeconds };
  });
}

function source(value: unknown, record: PreparedInput): { url: URL; format: Clip['format'] } {
  const data = object(value);
  if (!data || data.id !== record.videoId || data._type !== undefined && data._type !== 'video' || data.is_live !== false ||
    data.is_preview !== undefined && data.is_preview !== false || data.availability !== undefined && !['public', 'unlisted'].includes(String(data.availability)) ||
    data.live_status !== undefined && !['not_live', 'was_live'].includes(String(data.live_status)) || data.vcodec !== 'none' || typeof data.acodec !== 'string' ||
    !data.acodec.trim() || data.acodec.length > 64 || controls.test(data.acodec) || ['none', 'unknown'].includes(data.acodec.toLowerCase()) ||
    typeof data.duration !== 'number' || !Number.isFinite(data.duration) || data.duration < record.startSeconds + record.durationSeconds || data.duration > 86400 ||
    (data.ext !== 'webm' && data.ext !== 'm4a') || typeof data.url !== 'string' || data.url.length > 16384 || controls.test(data.url) ||
    /\s/.test(data.url) || /%(?![0-9a-f]{2})/i.test(data.url)) throw unavailable();
  // Validate the raw path before URL normalization can remove traversal or an explicit port.
  if (!/^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+googlevideo\.com\/videoplayback(?:\?[^#]+)?$/.test(data.url)) throw unavailable();
  const url = new URL(data.url), format = data.ext === 'webm' ? 'webm' : 'mp4';
  for (const [key, value] of url.searchParams) if (controls.test(key) || controls.test(value)) throw unavailable();
  const mime = url.searchParams.get('mime');
  if (mime !== null && mime !== (format === 'webm' ? 'audio/webm' : 'audio/mp4')) throw unavailable();
  return { url, format };
}

/** Explicit private preparation only. No discovery, routes, credentials or ordinary queue activation. */
export async function prepareYoutubeGuessInventory(records: readonly YoutubeGuessRecord[], options: YoutubeGuessOptions): Promise<Inventory> {
  try {
    const inputs = snapshot(records);
    let expiresAt = Date.now() + GUESS_YOUTUBE_INVENTORY_LIFETIME_MS;
    for (const record of records) {
      const permission = record.permission;
      if (!permission || permission.approved !== true || !Number.isSafeInteger(permission.expiresAt) || permission.expiresAt <= Date.now() ||
        typeof permission.reference !== 'string' || permission.reference.length > 2048 || permission.reference.trim() !== permission.reference || controls.test(permission.reference)) throw unavailable();
      let reference: URL;
      try { reference = new URL(permission.reference); } catch { throw unavailable(); }
      if (reference.protocol !== 'https:' || !reference.hostname || reference.username || reference.password) throw unavailable();
      expiresAt = Math.min(expiresAt, permission.expiresAt);
    }
    return await prepareInputs(inputs, expiresAt, options);
  } catch { throw unavailable(); }
}

/** Explicit server-selected preset only. Source verification is metadata, never an invented permission attestation. */
export async function prepareYoutubeGuessPack(id: string, options: YoutubeGuessOptions): Promise<Inventory> {
  try {
    const inputs = snapshot(getGuessPackClips(id));
    return await prepareInputs(inputs, Date.now() + GUESS_YOUTUBE_INVENTORY_LIFETIME_MS, options);
  } catch { throw unavailable(); }
}

async function prepareInputs(inputs: PreparedInput[], expiresAt: number, options: YoutubeGuessOptions): Promise<Inventory> {
  if (!options || !(options.signal instanceof AbortSignal) || options.signal.aborted || activePreparations >= 2 ||
    options.extract !== undefined && typeof options.extract !== 'function' || options.fetcher !== undefined && typeof options.fetcher !== 'function' ||
    options.decode !== undefined && typeof options.decode !== 'function') throw unavailable();
  const extract = options.extract ?? ((args, signal) => runJson(process.env.YTDLP_PATH ?? 'yt-dlp', args, signal));
  const fetcher = options.fetcher ?? fetch, decode = options.decode ?? decodeGuessClip, externalSignal = options.signal;
  const controller = new AbortController(), deadline = Date.now() + 60_000;
  let inventory: Inventory | undefined, disposed = false, ready = false, expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => { disposed = true; controller.abort(); inventory?.dispose(); clearTimeout(expiryTimer); externalSignal.removeEventListener('abort', dispose); };
  const active = () => { if (disposed || controller.signal.aborted || externalSignal.aborted || Date.now() >= expiresAt || !ready && Date.now() >= deadline) throw unavailable(); };
  externalSignal.addEventListener('abort', dispose, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(0, Math.min(deadline, expiresAt) - Date.now()));
  const prepared: TrustedGuessInventoryRecord[] = [], pendingDependencies = new Set<Promise<unknown>>();
  const track = <T>(pending: Promise<T>): Promise<T> => {
    pendingDependencies.add(pending); void pending.then(() => pendingDependencies.delete(pending), () => pendingDependencies.delete(pending)); return pending;
  };
  const step = () => AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
  activePreparations++;
  try {
    for (const record of inputs) {
      active();
      const extractSignal = step();
      const metadata = await guessAbort(track(extract([
        '--ignore-config', '--no-cache-dir', '--no-playlist', '--dump-single-json', '--skip-download', '--js-runtimes', 'node',
        '--socket-timeout', '8', '--retries', '0', '--extractor-retries', '0',
        '-f', 'bestaudio[ext=webm]/bestaudio[ext=m4a]', '--', `https://www.youtube.com/watch?v=${record.videoId}`,
      ], extractSignal)), extractSignal);
      active(); extractSignal.throwIfAborted();
      const selected = source(metadata, record), fetchSignal = step();
      let response: Response | undefined, encoded: Uint8Array | undefined;
      try {
        const pending = track(fetcher(selected.url, { redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer',
          headers: { Accept: selected.format === 'webm' ? 'audio/webm' : 'audio/mp4' }, signal: fetchSignal }));
        await guessAbort(pending.then(result => { response = result; if (fetchSignal.aborted) void result.body?.cancel().catch(() => {}); return result; }), fetchSignal);
        active(); fetchSignal.throwIfAborted();
        if (!response || response.status !== 200 || response.redirected || response.url && response.url !== selected.url.href) throw unavailable();
        const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (selected.format === 'webm' ? mime !== 'audio/webm' : !['audio/mp4', 'audio/x-m4a'].includes(mime ?? '')) throw unavailable();
        encoded = await readGuessBytes(response, maximumBytes, fetchSignal); active(); fetchSignal.throwIfAborted();
        if (!encoded.length) throw unavailable();
        const decodeSignal = step();
        const decoded = await guessAbort(track(decode(encoded, { format: selected.format, startSeconds: record.startSeconds, durationSeconds: record.durationSeconds }, decodeSignal)), decodeSignal);
        active(); decodeSignal.throwIfAborted();
        if (!(decoded instanceof Uint8Array) || decoded.byteLength > GUESS_AUDIO_MAX_BYTES) throw unavailable();
        const seconds = guessWaveSeconds(decoded);
        if (seconds < 15 || Math.abs(seconds - record.durationSeconds) > 1 / GUESS_AUDIO_RATE) throw unavailable();
        prepared.push({ song: record.song, categoryIds: record.categoryIds, wav: new Uint8Array(decoded) });
      } finally { encoded?.fill(0); if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {}); }
    }
    active(); inventory = prepareTrustedGuessInventory(prepared, { lifetimeMs: GUESS_YOUTUBE_INVENTORY_LIFETIME_MS, expiresAt }); active(); ready = true;
    expiryTimer = setTimeout(dispose, Math.max(0, expiresAt - Date.now())); expiryTimer.unref();
    return { catalog: inventory.catalog, media: inventory.media, dispose };
  } catch { dispose(); throw unavailable(); }
  finally {
    if (pendingDependencies.size) void Promise.allSettled([...pendingDependencies]).then(() => { activePreparations--; }); else activePreparations--;
    clearTimeout(timer); for (const record of prepared) record.wav.fill(0);
  }
}
