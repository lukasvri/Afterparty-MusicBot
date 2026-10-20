import { normalizeGuess } from './guess-catalog.ts';
import { UserError } from './types.ts';

export type DeezerSeed = {
  artist: string; title: string; originalYear: number; originalReleaseSource: string;
  categoryIds: ('2010s' | 'edm-classics')[];
};
export type DeezerPermission = {
  enabled: boolean; privateDevelopment: boolean; providerPermissionReference: string;
  recordings: readonly string[];
};
/** Private server metadata only. Full duration does not establish preview duration or usage rights. */
export type ResolvedDeezerSeed = DeezerSeed & {
  previewUrl: string; providerTrackId: string; fullDurationSeconds: number;
};

const MAX_BYTES = 64 * 1024;
const REQUEST_MS = 5_000;
const TOTAL_MS = 50_000;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const unavailable = () => new UserError('The private Deezer metadata catalog is unavailable.', 503);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  value.length <= 120 && !CONTROL.test(value) && Boolean(normalizeGuess(value));
export function seedIdentity(seed: Pick<DeezerSeed, 'artist' | 'title'>): string {
  return `${normalizeGuess(seed.artist)}|${normalizeGuess(seed.title)}`;
}

/** Validate again at the server media boundary. Never expose this provider URL to a browser. */
export function validateDeezerPreviewUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[^\x21-\x7e]|[%\\#]/.test(value) ||
    !value.startsWith('https://cdnt-preview.dzcdn.net/')) throw unavailable();
  let url: URL;
  try { url = new URL(value); } catch { throw unavailable(); }
  if (url.protocol !== 'https:' || url.hostname !== 'cdnt-preview.dzcdn.net' || url.port ||
    url.username || url.password || url.hash || url.href !== value ||
    !/^\/(?:api|preview)\/[A-Za-z0-9/_-]+\.mp3$/.test(url.pathname) || url.pathname.includes('//')) throw unavailable();
  return value;
}

function copySeed(seed: DeezerSeed): DeezerSeed {
  if (!seed || !text(seed.artist) || !text(seed.title) || !Number.isInteger(seed.originalYear) ||
    seed.originalYear < 1900 || seed.originalYear > 2100 ||
    typeof seed.originalReleaseSource !== 'string' || seed.originalReleaseSource.length > 2048 ||
    CONTROL.test(seed.originalReleaseSource) || !Array.isArray(seed.categoryIds) || !seed.categoryIds.length ||
    seed.categoryIds.length > 2 || new Set(seed.categoryIds).size !== seed.categoryIds.length ||
    !seed.categoryIds.every(id => id === '2010s' || id === 'edm-classics') ||
    (seed.categoryIds.includes('2010s') && (seed.originalYear < 2010 || seed.originalYear > 2019))) throw unavailable();
  let evidence: URL;
  try { evidence = new URL(seed.originalReleaseSource); } catch { throw unavailable(); }
  if (evidence.protocol !== 'https:' || !evidence.hostname || evidence.username || evidence.password ||
    seed.originalReleaseSource.trim() !== seed.originalReleaseSource) throw unavailable();
  return { artist: seed.artist, title: seed.title, originalYear: seed.originalYear,
    originalReleaseSource: seed.originalReleaseSource, categoryIds: [...seed.categoryIds] };
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { cleanup(); reject(unavailable()); };
    signal.addEventListener('abort', abort, { once: true });
    // Always consume the underlying promise, including a fetch that aborted synchronously.
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}

async function metadata(url: URL, fetcher: typeof fetch, totalSignal: AbortSignal): Promise<unknown> {
  const request = new AbortController();
  const abort = () => request.abort();
  totalSignal.addEventListener('abort', abort, { once: true });
  if (totalSignal.aborted) request.abort();
  const timer = setTimeout(abort, REQUEST_MS);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (request.signal.aborted) throw unavailable();
    response = await abortable(fetcher(url.href, { redirect: 'error', signal: request.signal,
      headers: { Accept: 'application/json' } }), request.signal);
    if (!response.ok || response.redirected || (response.url && response.url !== url.href) ||
      !/^application\/json(?:\s*;[^\r\n]*)?$/i.test(response.headers.get('content-type') ?? '') || !response.body) throw unavailable();
    let bytes = 0;
    response.headers.forEach((value, key) => { bytes += Buffer.byteLength(`${key}: ${value}\r\n`); });
    const length = response.headers.get('content-length');
    if (bytes > MAX_BYTES || (length !== null && (!/^\d+$/.test(length) || Number(length) + bytes > MAX_BYTES))) throw unavailable();
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const chunk = await abortable(reader.read(), request.signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) throw unavailable();
      chunks.push(chunk.value);
    }
    if (request.signal.aborted) throw unavailable();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw unavailable(); }
  finally {
    clearTimeout(timer);
    totalSignal.removeEventListener('abort', abort);
    // Cancellation is best effort and must not extend the bounded operation.
    if (reader) void reader.cancel().catch(() => {});
    else if (response?.body) void response.body.cancel().catch(() => {});
  }
}

type JsonRecord = Record<string, unknown>;
function object(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  return value as JsonRecord;
}
function trackId(value: unknown): string {
  if ((typeof value !== 'number' || !Number.isSafeInteger(value)) && typeof value !== 'string') throw unavailable();
  const id = String(value);
  if (!/^[1-9]\d{0,15}$/.test(id)) throw unavailable();
  return id;
}
function matches(track: JsonRecord, seed: DeezerSeed): boolean {
  const artist = object(track.artist);
  return text(track.title) && text(artist.name) && normalizeGuess(track.title) === normalizeGuess(seed.title) &&
    normalizeGuess(artist.name) === normalizeGuess(seed.artist);
}
function matchesReleaseDate(value: unknown, year: number): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) !== year) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Disabled by default: only an explicit permission object can allow requests.
 * Seeds and original-release evidence are curated and owned by the operator, never public inputs.
 * Provider dates cross-check that evidence; they do not prove the original release or confer rights.
 * No preview is downloaded here. A separate private media adapter must verify playable duration.
 */
export async function resolveDeezerSeeds(options: {
  seeds: readonly DeezerSeed[]; permission?: DeezerPermission; fetcher?: typeof fetch; signal?: AbortSignal;
}): Promise<ResolvedDeezerSeed[]> {
  const permission = options.permission;
  if (!permission || permission.enabled === false) return [];
  if (permission.enabled !== true || permission.privateDevelopment !== true ||
    typeof permission.providerPermissionReference !== 'string' || !permission.providerPermissionReference.trim() ||
    permission.providerPermissionReference.length > 2048 || CONTROL.test(permission.providerPermissionReference) ||
    !Array.isArray(permission.recordings) || permission.recordings.length > 8 ||
    !permission.recordings.every(id => typeof id === 'string' && id.length <= 241 &&
      id.split('|').length === 2 && id.split('|').every(part => Boolean(part) && normalizeGuess(part) === part)) ||
    !Array.isArray(options.seeds) || options.seeds.length > 8 || options.signal?.aborted) throw unavailable();
  const seeds = options.seeds.map(copySeed);
  if (seeds.some(seed => !permission.recordings.includes(seedIdentity(seed)))) throw unavailable();
  const unique = new Map<string, DeezerSeed>();
  for (const seed of seeds) {
    const prior = unique.get(seedIdentity(seed));
    if (prior && (prior.originalYear !== seed.originalYear || prior.originalReleaseSource !== seed.originalReleaseSource)) throw unavailable();
    if (prior) prior.categoryIds = [...new Set([...prior.categoryIds, ...seed.categoryIds])];
    else unique.set(seedIdentity(seed), seed);
  }
  const total = new AbortController();
  const abort = () => total.abort();
  const timer = setTimeout(abort, TOTAL_MS);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) total.abort();
  const resolved: ResolvedDeezerSeed[] = [], selectedIds = new Set<string>();
  try {
    for (const seed of unique.values()) {
      const searchUrl = new URL('https://api.deezer.com/search');
      searchUrl.searchParams.set('q', `artist:"${seed.artist}" track:"${seed.title}"`);
      searchUrl.searchParams.set('limit', '5');
      const search = object(await metadata(searchUrl, options.fetcher ?? fetch, total.signal));
      if (search.error || !Array.isArray(search.data) || search.data.length > 5) throw unavailable();
      const ids = new Set<string>();
      for (const value of search.data) {
        const candidate = object(value);
        if (matches(candidate, seed)) ids.add(trackId(candidate.id));
      }
      if (ids.size !== 1) throw unavailable();
      const id = [...ids][0];
      const track = object(await metadata(new URL(`https://api.deezer.com/track/${id}`), options.fetcher ?? fetch, total.signal));
      if (track.error || trackId(track.id) !== id || !matches(track, seed) || track.readable !== true ||
        !matchesReleaseDate(track.release_date, seed.originalYear) ||
        typeof track.duration !== 'number' || !Number.isFinite(track.duration) || track.duration <= 0 || track.duration > 86_400 ||
        selectedIds.has(id)) throw unavailable();
      selectedIds.add(id);
      resolved.push({ ...seed, categoryIds: [...seed.categoryIds], previewUrl: validateDeezerPreviewUrl(track.preview),
        providerTrackId: id, fullDurationSeconds: track.duration });
    }
    if (total.signal.aborted) throw unavailable();
    return resolved;
  } catch { throw unavailable(); }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
