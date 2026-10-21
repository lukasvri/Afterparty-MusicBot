import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { normalizePlaylistUrl } from './playlist-url.ts';
import { publicTrack, UserError, type PublicTrack, type Track } from './types.ts';

export type PlaylistMetadata = { videos: Track[]; total?: number; skipped: number; limited: boolean };
export type PlaylistImportResult = {
  id: string; token?: string; status: 'processing' | 'done' | 'failed' | 'cancelled';
  source: 'youtube' | 'spotify'; videos: PublicTrack[]; total?: number; skipped: number; limited: boolean; error?: string;
};
type Job = { result: PlaylistImportResult; digest: Buffer; until: number; controller: AbortController;
  timer: ReturnType<typeof setTimeout>; expiryTimer: ReturnType<typeof setTimeout> };
const TTL = 600_000, DEADLINE = 180_000, CAPACITY = 32, CONCURRENCY = 2;
const digest = (value: string) => createHash('sha256').update(value).digest();
const unavailable = () => new UserError('The playlist import is unavailable.', 404);
const safeText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value);
function copyVideos(input: unknown): { videos: PublicTrack[]; skipped: number } {
  if (!Array.isArray(input) || input.length > 500) throw new Error('Invalid playlist metadata.');
  const videos: PublicTrack[] = [], ids = new Set<string>(); let skipped = 0;
  for (const value of input) {
    const track = value as Track;
    if (!track || typeof track !== 'object' || Array.isArray(track) || typeof track.id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(track.id) || ids.has(track.id) ||
      !safeText(track.title, 500) || !track.title.trim() || !safeText(track.artist, 200) ||
      !Number.isFinite(track.duration) || track.duration < 0 || track.duration > 86_400 ||
      typeof track.live !== 'boolean' || track.embeddable !== true ||
      track.source !== undefined && track.source !== 'youtube') { skipped++; continue; }
    // Only canonical public thumbnail URLs are retained. No provider headers, catalog proof or source URLs.
    const clean: Track = { id: track.id, entryId: '', title: track.title, artist: track.artist,
      duration: track.duration, image: `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`, live: track.live, embeddable: true,
      ...(typeof track.music === 'boolean' ? { music: track.music } : {}),
      ...(track.aiGenerated === true ? { aiGenerated: true } : {}),
      ...(Array.isArray(track.genres) ? { genres: track.genres.filter((genre): genre is string => safeText(genre, 80)).slice(0, 12) } : {}) };
    ids.add(track.id); videos.push(publicTrack(clean)!);
  }
  return { videos, skipped };
}

/** Ephemeral capability-isolated metadata jobs. They never enqueue, persist a playlist or change guild settings. */
export class PlaylistImports {
  private readonly jobs = new Map<string, Job>();
  private running = 0;
  private closed = false;
  private readonly resolve: (url: string, signal: AbortSignal) => Promise<PlaylistMetadata>;
  constructor(resolve: (url: string, signal: AbortSignal) => Promise<PlaylistMetadata>) { this.resolve = resolve; }
  private prune() {
    for (const [id, job] of this.jobs) if (job.until <= Date.now()) {
      job.controller.abort(); clearTimeout(job.timer); clearTimeout(job.expiryTimer); this.jobs.delete(id);
    }
  }
  private snapshot(job: Job): PlaylistImportResult {
    return { ...job.result, videos: job.result.videos.map(video => ({ ...video, ...(video.genres ? { genres: [...video.genres] } : {}) })) };
  }
  start(value: unknown): PlaylistImportResult {
    if (this.closed) throw new UserError('The playlist importer is closed.', 503);
    let normalized: ReturnType<typeof normalizePlaylistUrl>;
    try { if (typeof value !== 'string') throw Error(); normalized = normalizePlaylistUrl(value); }
    catch { throw new UserError('Enter a valid YouTube or Spotify playlist URL.'); }
    this.prune();
    if (this.jobs.size >= CAPACITY || this.running >= CONCURRENCY) throw new UserError('The playlist importer is busy. Try again shortly.', 429);
    const id = randomUUID(), token = randomBytes(32).toString('base64url'), controller = new AbortController();
    const result: PlaylistImportResult = { id, status: 'processing', source: normalized.source, videos: [], skipped: 0, limited: false };
    const job: Job = { result, digest: digest(token), until: Date.now() + TTL, controller, timer: undefined!, expiryTimer: undefined! };
    job.expiryTimer = setTimeout(() => {
      if (this.jobs.get(id) === job) { controller.abort(); clearTimeout(job.timer); this.jobs.delete(id); }
    }, TTL); job.expiryTimer.unref();
    job.timer = setTimeout(() => {
      if (job.result.status !== 'processing') return;
      job.result = { ...job.result, status: 'failed', error: 'The playlist import timed out. Try again later.' };
      controller.abort();
    }, DEADLINE); job.timer.unref();
    this.jobs.set(id, job); this.running++;
    // Keep the raw dependency's slot until it settles, even if it ignores cancellation.
    void Promise.resolve().then(() => { controller.signal.throwIfAborted(); return this.resolve(normalized.url, controller.signal); }).then(metadata => {
      if (this.closed || controller.signal.aborted || this.jobs.get(id) !== job || job.until <= Date.now() || job.result.status !== 'processing') return;
      if (!metadata || !Number.isSafeInteger(metadata.skipped) || metadata.skipped < 0 || metadata.skipped > 10_000_000 ||
        typeof metadata.limited !== 'boolean' || metadata.total !== undefined && (!Number.isSafeInteger(metadata.total) || metadata.total < 0 || metadata.total > 10_000_000)) throw Error();
      const copied = copyVideos(metadata.videos);
      job.result = { ...result, status: 'done', videos: copied.videos, skipped: metadata.skipped + copied.skipped,
        limited: metadata.limited, ...(metadata.total !== undefined ? { total: metadata.total } : {}) };
    }).catch(() => {
      if (!this.closed && !controller.signal.aborted && job.result.status === 'processing' && this.jobs.get(id) === job)
        job.result = { ...result, status: 'failed', error: 'The playlist could not be imported. It may be private or unavailable.' };
    }).finally(() => { clearTimeout(job.timer); this.running--; });
    return { ...this.snapshot(job), token };
  }
  read(id: unknown, token: unknown, cancel = false): PlaylistImportResult {
    this.prune();
    if (typeof id !== 'string' || typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw unavailable();
    const job = this.jobs.get(id);
    if (!job || !timingSafeEqual(job.digest, digest(token))) throw unavailable();
    if (cancel && job.result.status === 'processing') {
      job.result = { ...job.result, status: 'cancelled' }; clearTimeout(job.timer); job.controller.abort();
    }
    return this.snapshot(job);
  }
  close() {
    this.closed = true;
    for (const job of this.jobs.values()) { clearTimeout(job.timer); clearTimeout(job.expiryTimer); job.controller.abort(); }
    this.jobs.clear();
  }
}
