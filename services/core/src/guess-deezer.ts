import { randomUUID } from 'node:crypto';
import { copyGuessSong, UnavailableGuessCatalog } from './guess-catalog.ts';
import { guessAbort, readGuessBytes, guessWaveSeconds, GUESS_AUDIO_MAX_BYTES } from './guess-audio-format.ts';
import { decodeGuessMp3 } from './guess-decode.ts';
import { prepareOperatorGuessInventory, type OperatorGuessInventoryRecord } from './guess-operator-inventory.ts';
import { UserError } from './types.ts';

/** Private operator attestations only. This does not verify recording or provider permission. */
export type DeezerGuessRecord = {
  trackId: string; categoryIds: readonly string[];
  permission: { approved: true; reference: string; expiresAt: number };
};
export type DeezerGuessOptions = {
  signal: AbortSignal; fetcher?: typeof fetch;
  decode?: (input: Uint8Array, signal: AbortSignal) => Promise<Uint8Array>;
};
type Inventory = ReturnType<typeof prepareOperatorGuessInventory>;
const unavailable = () => new UserError('The approved Deezer game preview inventory is unavailable.', 503);
const control = /[\p{Cc}\p{Cf}]/u, idPattern = /^[1-9][0-9]{0,19}$/;
const categoryIds = new Set(new UnavailableGuessCatalog().categories().map(category => category.id));
const previewHosts = new Set('0123456789abcdef'.split('').map(hex => `cdns-preview-${hex}.dzcdn.net`));
let activePreparations = 0;
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

function snapshot(records: readonly DeezerGuessRecord[]): DeezerGuessRecord[] {
  if (!Array.isArray(records) || records.length > 8) throw unavailable();
  const seen = new Set<string>();
  return records.map(record => {
    if (!record || typeof record.trackId !== 'string' || !idPattern.test(record.trackId) || seen.has(record.trackId) ||
      !Array.isArray(record.categoryIds) || !record.categoryIds.length || record.categoryIds.length > categoryIds.size ||
      new Set(record.categoryIds).size !== record.categoryIds.length || !record.categoryIds.every((id: unknown) => typeof id === 'string' && categoryIds.has(id))) throw unavailable();
    const permission = record.permission;
    if (!permission || permission.approved !== true || !Number.isSafeInteger(permission.expiresAt) || permission.expiresAt <= Date.now() ||
      typeof permission.reference !== 'string' || permission.reference.length > 2048 || permission.reference.trim() !== permission.reference || control.test(permission.reference)) throw unavailable();
    let reference: URL;
    try { reference = new URL(permission.reference); } catch { throw unavailable(); }
    if (reference.protocol !== 'https:' || !reference.hostname || reference.username || reference.password) throw unavailable();
    seen.add(record.trackId);
    return { trackId: record.trackId, categoryIds: [...record.categoryIds], permission: { approved: true, reference: permission.reference, expiresAt: permission.expiresAt } };
  });
}

/** Reviewed legacy preview path only. Other CDN formats require a separate review. */
function previewUrl(value: unknown): URL {
  if (typeof value !== 'string' || !/^https:\/\/cdns-preview-[0-9a-f]\.dzcdn\.net\/stream\/c-[0-9a-f]{32}-[0-9]{1,2}\.mp3$/.test(value)) throw unavailable();
  const url = new URL(value);
  if (!previewHosts.has(url.hostname)) throw unavailable();
  return url;
}

function answer(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120 || control.test(value)) throw unavailable();
  return value.trim();
}

function recording(value: unknown, trackId: string) {
  const data = object(value), artist = object(data?.artist);
  const id = typeof data?.id === 'number' && Number.isSafeInteger(data.id) ? String(data.id) : data?.id;
  if (!data || data.error !== undefined || id !== trackId || data.type !== 'track' || data.readable !== true || data.playable === false ||
    typeof data.duration !== 'number' || !Number.isFinite(data.duration) || data.duration <= 0 || data.duration > 86400) throw unavailable();
  let title = answer(data.title);
  if (data.title_version !== undefined && data.title_version !== null && data.title_version !== '') {
    const version = answer(data.title_version), lower = title.toLowerCase(), wanted = version.toLowerCase();
    if (![ ` ${wanted}`, `(${wanted})`, `[${wanted}]` ].some(suffix => lower.endsWith(suffix))) title += ' ' + version;
  }
  const song = copyGuessSong({ id: randomUUID(), title, artist: answer(artist?.name), aliases: [], mediaKey: randomUUID().replaceAll('-', '') });
  return { song: { id: song.id, title: song.title, artist: song.artist, aliases: song.aliases }, preview: previewUrl(data.preview) };
}

/** Default-off trusted adapter. No routes, environment activation, uploads or automatic discovery. */
export async function prepareDeezerGuessInventory(records: readonly DeezerGuessRecord[], options: DeezerGuessOptions): Promise<Inventory> {
  const inputs = snapshot(records);
  if (!options || !(options.signal instanceof AbortSignal) || options.signal.aborted ||
    options.fetcher !== undefined && typeof options.fetcher !== 'function' || options.decode !== undefined && typeof options.decode !== 'function' || activePreparations >= 2) throw unavailable();
  const fetcher = options.fetcher ?? fetch, decode = options.decode ?? decodeGuessMp3, externalSignal = options.signal;
  const controller = new AbortController(), deadline = Date.now() + 45_000;
  const expiresAt = Math.min(Date.now() + 300_000, ...inputs.map(record => record.permission.expiresAt));
  let inventory: Inventory | undefined, disposed = false, ready = false, expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => { disposed = true; controller.abort(); inventory?.dispose(); clearTimeout(expiryTimer); externalSignal.removeEventListener('abort', dispose); };
  const active = () => { if (disposed || controller.signal.aborted || externalSignal.aborted || Date.now() >= expiresAt || !ready && Date.now() >= deadline) throw unavailable(); };
  externalSignal.addEventListener('abort', dispose, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(0, Math.min(deadline, expiresAt) - Date.now()));
  const prepared: OperatorGuessInventoryRecord[] = [];
  const pendingDependencies = new Set<Promise<unknown>>();
  const track = <T>(pending: Promise<T>): Promise<T> => {
    pendingDependencies.add(pending);
    void pending.then(() => pendingDependencies.delete(pending), () => pendingDependencies.delete(pending));
    return pending;
  };
  activePreparations++;
  try {
    const request = async (url: URL, maximum: number, media: boolean): Promise<Uint8Array> => {
      active();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
      let response: Response | undefined;
      try {
        const pending = track(fetcher(url, { redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: media ? 'audio/mpeg' : 'application/json' }, signal }));
        await guessAbort(pending.then(result => { response = result; if (signal.aborted) void result.body?.cancel().catch(() => {}); return result; }), signal);
        if (!response) throw unavailable();
        active();
        if (response.status !== 200 || response.redirected || response.url && response.url !== url.href) throw unavailable();
        const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (media ? !['audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(type ?? '') : type !== 'application/json') throw unavailable();
        const bytes = await readGuessBytes(response, maximum, signal); active(); signal.throwIfAborted(); return bytes;
      } finally { if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {}); }
    };
    for (const record of inputs) {
      active();
      const metadata = await request(new URL(`https://api.deezer.com/track/${record.trackId}`), 512 * 1024, false);
      const item = recording(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadata)), record.trackId);
      active();
      const encoded = await request(item.preview, 2 * 1024 * 1024, true);
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
        active();
        const decoded = await guessAbort(track(decode(encoded, signal)), signal); active(); signal.throwIfAborted();
        if (!(decoded instanceof Uint8Array) || decoded.byteLength > GUESS_AUDIO_MAX_BYTES || guessWaveSeconds(decoded) < 15) throw unavailable();
        prepared.push({ song: item.song, categoryIds: record.categoryIds, permission: { ...record.permission, expiresAt }, wav: new Uint8Array(decoded) });
      } finally { encoded.fill(0); }
    }
    active(); inventory = prepareOperatorGuessInventory(prepared); active(); ready = true;
    expiryTimer = setTimeout(dispose, Math.max(0, expiresAt - Date.now())); expiryTimer.unref();
    return { catalog: inventory.catalog, media: inventory.media, dispose };
  } catch { dispose(); throw unavailable(); }
  finally {
    // Reject callers promptly, but keep capacity occupied by dependencies that ignore cancellation.
    if (pendingDependencies.size) void Promise.allSettled([...pendingDependencies]).then(() => { activePreparations--; });
    else activePreparations--;
    clearTimeout(timer); for (const record of prepared) record.wav.fill(0);
  }
}
