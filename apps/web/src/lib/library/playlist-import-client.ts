import type { Video } from '../../../../../lib/types.ts';
import { normalizePlaylistUrl } from '../../../../../services/core/src/playlist-url.ts';

export type PlaylistJob = {
  id: string;
  token?: string;
  status: 'processing' | 'done' | 'failed' | 'cancelled';
  source: 'youtube' | 'spotify';
  videos: Video[];
  total?: number;
  skipped: number;
  limited: boolean;
  error?: string;
};
export type PlaylistState = {
  loading: boolean;
  job: PlaylistJob | null;
  error: string;
  notice: string;
  sourceUrl: string;
};
type Capability = { id: string; token: string };
const failure = 'Playlist could not be loaded. Try again.';
class PlaylistRequestError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}
const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function playlistJob(raw: unknown): PlaylistJob {
  if (!raw || typeof raw !== 'object') throw new Error(failure);
  const job = raw as Partial<PlaylistJob>;
  if (
    typeof job.id !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(job.id) ||
    (job.token !== undefined &&
      (typeof job.token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(job.token))) ||
    !['processing', 'done', 'failed', 'cancelled'].includes(String(job.status)) ||
    !['youtube', 'spotify'].includes(String(job.source)) ||
    !Array.isArray(job.videos) ||
    job.videos.length > 500 ||
    !job.videos.every(
      (video) =>
        video &&
        typeof video.id === 'string' &&
        /^[A-Za-z0-9_-]{11}$/.test(video.id) &&
        typeof video.title === 'string' &&
        video.title.length <= 1000 &&
        typeof video.artist === 'string' &&
        video.artist.length <= 500 &&
        typeof video.image === 'string' &&
        Number.isFinite(video.duration) &&
        video.duration >= 0 &&
        typeof video.live === 'boolean' &&
        typeof video.embeddable === 'boolean',
    ) ||
    !count(job.skipped) ||
    typeof job.limited !== 'boolean' ||
    (job.total !== undefined && !count(job.total)) ||
    (job.error !== undefined && (typeof job.error !== 'string' || job.error.length > 1000))
  )
    throw new Error(failure);
  return job as PlaylistJob;
}

/** Job capabilities stay in memory and never grant permission to mutate a room. */
export function createPlaylistImport(
  options: {
    fetch?: typeof fetch;
    hidden?: () => boolean;
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
  } = {},
) {
  const fetcher = options.fetch ?? fetch;
  const schedule = options.setTimeout ?? setTimeout;
  const cancelTimer = options.clearTimeout ?? clearTimeout;
  const hidden = options.hidden ?? (() => false);
  let state: PlaylistState = { loading: false, job: null, error: '', notice: '', sourceUrl: '' };
  const listeners = new Set<(state: PlaylistState) => void>();
  let generation = 0;
  let destroyed = false;
  let capability: Capability | null = null;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll: (() => void) | null = null;
  const publish = (change: Partial<PlaylistState>) => {
    if (destroyed) return;
    state = { ...state, ...change };
    listeners.forEach((listener) => listener(state));
  };
  async function request(body: object, signal?: AbortSignal): Promise<PlaylistJob> {
    let response: Response;
    try {
      response = await fetcher('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      });
    } catch {
      throw new PlaylistRequestError(failure, true);
    }
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = data && typeof data === 'object' ? (data as { error?: unknown }).error : null;
      throw new PlaylistRequestError(
        typeof error === 'string' ? error : failure,
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }
    return playlistJob(data);
  }
  const cancelRemote = (target: Capability) => {
    void request({ action: 'cancel', ...target }).catch(() => {});
  };
  const invalidate = () => {
    generation++;
    controller?.abort();
    controller = null;
    if (timer !== undefined) cancelTimer(timer);
    timer = undefined;
    poll = null;
    if (capability) cancelRemote(capability);
    capability = null;
  };
  return {
    subscribe(listener: (value: PlaylistState) => void) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    async load(value: string) {
      if (destroyed) return;
      invalidate();
      const version = generation;
      let readFailures = 0;
      let url: string;
      try {
        url = normalizePlaylistUrl(value.trim()).url;
      } catch {
        publish({
          loading: false,
          job: null,
          error: 'Paste a YouTube or Spotify playlist link.',
          notice: '',
          sourceUrl: '',
        });
        return;
      }
      publish({ loading: true, job: null, error: '', notice: '', sourceUrl: url });
      const run = async (body: { action: string; id?: string; token?: string; url?: string }) => {
        const active = new AbortController();
        controller = active;
        try {
          const next = await request(body, active.signal);
          if (
            destroyed ||
            version !== generation ||
            active.signal.aborted ||
            controller !== active
          ) {
            if (body.action === 'start' && next.token)
              cancelRemote({ id: next.id, token: next.token });
            return;
          }
          if (body.id && next.id !== body.id) throw new Error(failure);
          readFailures = 0;
          if (next.token) capability = { id: next.id, token: next.token };
          if (next.status === 'processing' && !capability) throw new Error(failure);
          publish({
            job: next,
            loading: next.status === 'processing',
            error: next.status === 'failed' ? next.error || failure : '',
            notice: next.status === 'cancelled' ? 'Playlist loading cancelled.' : '',
          });
          if (next.status !== 'processing') {
            capability = null;
            poll = null;
          } else if (!hidden()) timer = schedule(() => poll?.(), 1500);
        } catch (error) {
          if (destroyed || version !== generation || active.signal.aborted) return;
          // Only a read can be safely repeated. A lost start response may already
          // have allocated a job, and queue mutations never belong to this client.
          if (
            body.action === 'read' &&
            capability &&
            error instanceof PlaylistRequestError &&
            error.retryable &&
            ++readFailures <= 3
          ) {
            publish({
              loading: true,
              error: '',
              notice: 'Connection interrupted. Retrying playlist loading…',
            });
            if (!hidden()) timer = schedule(() => poll?.(), 1500 * 2 ** readFailures);
            return;
          }
          if (capability) cancelRemote(capability);
          capability = null;
          poll = null;
          publish({
            loading: false,
            notice: '',
            error: error instanceof Error ? error.message : failure,
          });
        } finally {
          if (controller === active) controller = null;
        }
      };
      poll = () => {
        if (version !== generation || destroyed || hidden() || controller || !capability) return;
        void run({ action: 'read', ...capability });
      };
      await run({ action: 'start', url });
    },
    visibility() {
      if (destroyed) return;
      if (hidden()) {
        if (timer !== undefined) cancelTimer(timer);
        timer = undefined;
        // Do not abort a start response before its cancellation capability is known.
        if (capability) {
          controller?.abort();
          controller = null;
        }
      } else poll?.();
    },
    reset() {
      invalidate();
      publish({ loading: false, job: null, error: '', notice: '', sourceUrl: '' });
    },
    cancel() {
      invalidate();
      publish({ loading: false, job: null, error: '', notice: 'Playlist loading cancelled.' });
    },
    destroy() {
      invalidate();
      destroyed = true;
      listeners.clear();
    },
  };
}
