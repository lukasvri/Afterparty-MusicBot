import { request as browserRequest } from '../../../../../lib/browser-api.ts';
import { browserStorage } from '../../../../../lib/browser-storage.ts';
import type { DiscordState, Room, Video } from '../../../../../lib/types.ts';
import { createConcertAudio, type ConcertAudioOptions } from './concert-audio.ts';

export type ConcertState = DiscordState & { playbackKey?: string | null };
export type ConcertQueue = {
  state: {
    revision: string;
    queue: Video[];
    requests?: Video[];
    approvalRequired?: boolean;
    voteCounts?: Record<string, number>;
    skipVotes?: number;
    playbackKey?: string | null;
  };
  canManage: boolean;
};
export type ConcertView = {
  guildId: string | undefined;
  state: ConcertState | null;
  queue: ConcertQueue | null;
  connected: boolean;
  loading: boolean;
  busy: boolean;
  error: string;
  notice: string;
  audioRoom: Room | null;
  audioLive: boolean;
  audioPhase: string;
  adding: boolean;
  searching: boolean;
  query: string;
  results: Video[];
  history: Video[];
};
type Session = {
  guildId?: string;
  selectedGuildId?: string;
  controller: AbortController;
  serial: number;
};
type Options = {
  request?: typeof browserRequest;
  pollMs?: number;
  now?: () => number;
  audio?: ConcertAudioOptions;
  storage?: Pick<typeof browserStorage, 'get' | 'set'>;
  delay?: (signal: AbortSignal) => Promise<void>;
};

/** Concert-only public state. Every operation remains scoped and authorized by the API/Core. */
export function createDiscordClient(options: Options = {}) {
  const request = options.request ?? browserRequest;
  const storage = options.storage ?? browserStorage;
  const now = options.now ?? Date.now;
  const listeners = new Set<(value: ConcertView) => void>();
  const empty = (guildId?: string): ConcertView => ({
    guildId,
    state: null,
    queue: null,
    connected: false,
    loading: false,
    busy: false,
    error: '',
    notice: '',
    audioRoom: null,
    audioLive: false,
    audioPhase: 'Connecting shared clock…',
    adding: false,
    searching: false,
    query: '',
    results: [],
    history: [],
  });
  let view = empty();
  let session: Session | null = null;
  let audio: ReturnType<typeof createConcertAudio> | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { id: string; expires: number } | null = null;
  let additions: AbortController | null = null;
  let searchController: AbortController | null = null;
  let searchSerial = 0;
  const current = (target: Session) =>
    !stopped && session === target && !target.controller.signal.aborted;
  const publish = (change: Partial<ConcertView>) => {
    if (stopped) return;
    view = { ...view, ...change };
    listeners.forEach((listener) => listener(view));
  };
  const headers = () => {
    let visitor = storage.get('afterparty-visitor');
    if (!visitor) {
      visitor = crypto.randomUUID();
      storage.set('afterparty-visitor', visitor);
    }
    return { 'Content-Type': 'application/json', 'X-Afterparty-Visitor': visitor };
  };
  const signal = (target: Session, extra?: AbortSignal, timeout = 12000) =>
    AbortSignal.any([
      target.controller.signal,
      ...(extra ? [extra] : []),
      AbortSignal.timeout(timeout),
    ]);
  const delay =
    options.delay ??
    ((abort: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        abort.throwIfAborted();
        const cancelled = () => {
          clearTimeout(timer);
          reject(abort.reason);
        };
        const timer = setTimeout(() => {
          abort.removeEventListener('abort', cancelled);
          resolve();
        }, 500);
        abort.addEventListener('abort', cancelled, { once: true });
      }));
  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : 'The concert is unavailable. Try again.';
  const publicState = (state: ConcertState): ConcertState => ({
    ...state,
    current: state.current?.concert === true ? state.current : null,
    queue: state.queue.filter((video) => video.concert === true),
    playing: state.current?.concert === true && state.playing,
    position: state.current?.concert === true ? state.position : 0,
    playbackKey: state.current?.concert === true ? state.playbackKey : null,
  });
  const publicHistory = (next: ConcertState | null) => {
    const previous = view.state?.current;
    return previous?.concert === true && view.state?.playbackKey !== next?.playbackKey
      ? [...view.history.filter((video) => video.id !== previous.id), previous].slice(-100)
      : view.history;
  };
  const freshState = async (target: Session, abort: AbortSignal) => {
    const result = await request<{ state: ConcertState | null }>(
      `/api/discord?guildId=${target.guildId}`,
      {
        headers: headers(),
        cache: 'no-store',
        signal: signal(target, abort),
      },
    );
    abort.throwIfAborted();
    if (
      !current(target) ||
      !result.state ||
      result.state.guildId !== target.guildId ||
      !result.state.online ||
      !result.state.ready ||
      !result.state.connected ||
      typeof result.state.queueRevision !== 'string' ||
      !result.state.queueRevision ||
      !Array.isArray(result.state.queue)
    )
      throw Error('The selected concert changed or is unavailable. Refresh before trying again.');
    return publicState(result.state);
  };
  // Reads only the exact receipt. Failed/uncertain writes are never replayed.
  const confirmation = async (
    target: Session,
    id: string,
    initial: string,
    abort: AbortSignal,
    admin = false,
  ) => {
    let status = initial;
    while (current(target)) {
      abort.throwIfAborted();
      if (status === 'done') return;
      if (!['pending', 'processing'].includes(status))
        throw Error('Core did not confirm the command. Check the queue before retrying.');
      await delay(abort);
      abort.throwIfAborted();
      const path = admin
        ? `/api/admin/control?guildId=${target.guildId}`
        : `/api/discord?${new URLSearchParams({ guildId: target.guildId!, command: id })}`;
      const result = await request<{
        guildId?: string;
        state?: ConcertState | null;
        command?: { id: string; status: string } | null;
        commands?: Array<{ id: string; status: string }>;
      }>(path, { headers: headers(), cache: 'no-store', signal: signal(target, abort) });
      abort.throwIfAborted();
      if (!current(target)) break;
      if (
        (result.guildId && result.guildId !== target.guildId) ||
        (result.state?.guildId && result.state.guildId !== target.guildId)
      )
        throw Error('The command response belongs to a different Discord server.');
      // Private admin snapshots are deliberately never stored in the public view.
      const job = admin ? result.commands?.find((job) => job.id === id) : result.command;
      if (job?.id === id) status = job.status;
    }
    throw Error('The selected concert changed. Adding was stopped.');
  };
  const read = async (target: Session, clearError = false) => {
    if (!current(target) || (view.busy && !pending)) return;
    const recovering = !view.connected;
    const serial = ++target.serial;
    const params = new URLSearchParams();
    if (target.guildId) params.set('guildId', target.guildId);
    if (pending) params.set('command', pending.id);
    try {
      const result = await request<{
        state: ConcertState | null;
        command?: { id: string; status: string; result: string | null } | null;
      }>(`/api/discord${params.size ? '?' + params : ''}`, {
        headers: headers(),
        cache: 'no-store',
        signal: signal(target),
      });
      if (!current(target) || serial !== target.serial) return;
      if (result.state && target.guildId && result.state.guildId !== target.guildId)
        throw new Error(
          'The selected server did not match the concert. Reconnect before continuing.',
        );
      if (result.state && !Array.isArray(result.state.queue))
        throw new Error('Invalid concert state.');
      const resolvedGuild = target.guildId ?? result.state?.guildId;
      if (resolvedGuild && !/^\d{14,22}$/.test(resolvedGuild))
        throw new Error('Invalid concert server.');
      target.guildId = resolvedGuild;
      let queue: ConcertQueue | null = null;
      if (resolvedGuild) {
        queue = await request<ConcertQueue>(`/api/discord/queue?guildId=${resolvedGuild}`, {
          headers: headers(),
          cache: 'no-store',
          signal: signal(target),
        });
        if (!current(target) || serial !== target.serial) return;
        if (typeof queue.state?.revision !== 'string' || !Array.isArray(queue.state.queue))
          throw new Error('Invalid concert queue.');
        queue = {
          ...queue,
          state: {
            ...queue.state,
            queue: queue.state.queue.filter((video) => video.concert === true),
            requests: queue.state.requests?.filter((video) => video.concert === true),
          },
        };
      }
      const visibleState = view.audioLive
        ? view.state
        : result.state
          ? publicState(result.state)
          : null;
      publish({
        guildId: resolvedGuild,
        state: visibleState,
        history: publicHistory(visibleState),
        queue,
        connected: true,
        loading: false,
        ...(clearError || recovering ? { error: '' } : {}),
      });
      if (resolvedGuild && !audio) {
        audio = createConcertAudio(resolvedGuild, target.selectedGuildId, options.audio);
        audio.subscribe((value) => {
          if (current(target))
            publish({
              audioRoom: value.room,
              audioLive: value.live,
              audioPhase: value.phase,
              ...(value.state
                ? {
                    state: publicState(value.state),
                    history: publicHistory(publicState(value.state)),
                  }
                : {}),
            });
        });
      }
      if (pending) {
        const command = result.command;
        if (
          command?.id === pending.id &&
          ['done', 'failed', 'expired', 'unknown'].includes(command.status)
        ) {
          pending = null;
          publish({
            busy: false,
            notice: command.status === 'done' ? 'Command confirmed by Core.' : '',
            error:
              command.status === 'done'
                ? ''
                : command.result ||
                  'Core could not confirm the command. Refresh before trying again.',
          });
        } else if (now() >= pending.expires) {
          pending = null;
          publish({
            busy: false,
            error: 'Core did not confirm the command. Read the current state before trying again.',
          });
        }
      }
    } catch (error) {
      if (current(target) && serial === target.serial) {
        audio?.suspend('The concert connection was lost. Audio is paused.');
        const unconfirmed = Boolean(pending && now() >= pending.expires);
        if (unconfirmed) {
          pending = null;
          publish({ busy: false, notice: '' });
        }
        publish({
          connected: false,
          loading: false,
          queue: null,
          error: unconfirmed
            ? 'Core did not confirm the command. Reconnect to read the current state before trying again.'
            : errorText(error),
        });
      }
    }
  };
  const poll = (target: Session) => {
    if (!current(target)) return;
    timer = setTimeout(() => {
      void read(target).finally(() => poll(target));
    }, options.pollMs ?? 3000);
  };
  const retire = () => {
    additions?.abort();
    additions = null;
    searchSerial++;
    searchController?.abort();
    searchController = null;
    audio?.destroy();
    audio = null;
    session?.controller.abort();
    session = null;
    clearTimeout(timer);
    pending = null;
  };
  return {
    subscribe(listener: (value: ConcertView) => void) {
      if (stopped) return () => {};
      listeners.add(listener);
      listener(view);
      return () => {
        listeners.delete(listener);
      };
    },
    async connect(guildId?: string) {
      if (stopped) return false;
      if (guildId && !/^\d{14,22}$/.test(guildId)) {
        publish({ error: 'Enter a valid Discord server ID.' });
        return false;
      }
      retire();
      const target: Session = {
        guildId,
        selectedGuildId: guildId,
        controller: new AbortController(),
        serial: 0,
      };
      session = target;
      view = empty(guildId);
      publish({ loading: true });
      await read(target, true);
      poll(target);
      return current(target) && view.connected;
    },
    async refresh() {
      if (session) await read(session, true);
    },
    playback() {
      const target = audio?.playback() ?? { position: 0, playing: false, stale: true };
      return view.connected ? target : { ...target, playing: false, stale: true };
    },
    async search(value: string) {
      const target = session,
        query = value.trim(),
        serial = ++searchSerial;
      searchController?.abort();
      if (!target || !current(target)) return;
      const controller = new AbortController();
      searchController = controller;
      publish({ query, results: [], searching: false, error: '' });
      if (query.length < 2 || query.length > 120) {
        publish({ error: 'Enter between 2 and 120 characters.' });
        return;
      }
      publish({ searching: true });
      try {
        const result = await request<{ videos: Video[] }>(
          `/api/search?q=${encodeURIComponent(query)}`,
          {
            headers: headers(),
            signal: signal(target, controller.signal, 35000),
          },
        );
        if (current(target) && serial === searchSerial)
          publish({ results: result.videos, searching: false });
      } catch (error) {
        if (current(target) && serial === searchSerial)
          publish({ searching: false, error: errorText(error) });
      }
    },
    cancelSearch() {
      searchSerial++;
      searchController?.abort();
      searchController = null;
      publish({ searching: false, query: '', results: [] });
    },
    cancelAdditions() {
      additions?.abort();
    },
    async append(input: readonly string[]) {
      const target = session;
      const ids = [...new Set(input)];
      if (!target?.guildId || !current(target) || view.busy || !view.connected)
        throw Error('Connect to the selected concert before adding music.');
      if (!ids.length || ids.length > 50 || ids.some((id) => !/^[\w-]{11}$/.test(id)))
        throw Error('Choose between one and fifty YouTube tracks.');
      ++target.serial;
      const operation = new AbortController();
      additions = operation;
      const lifetime = AbortSignal.any([
        target.controller.signal,
        operation.signal,
        AbortSignal.timeout(300000),
      ]);
      let added = 0;
      publish({ busy: true, adding: true, error: '', notice: '' });
      try {
        for (const videoId of ids) {
          lifetime.throwIfAborted();
          const latest = await freshState(target, lifetime);
          if (latest.current?.id === videoId || latest.queue.some((video) => video.id === videoId))
            continue;
          const commandId = crypto.randomUUID();
          const bounded = AbortSignal.any([lifetime, AbortSignal.timeout(35000)]);
          const receipt = await request<{ id: string; status: string }>('/api/discord', {
            method: 'POST',
            headers: headers(),
            signal: signal(target, bounded),
            body: JSON.stringify({
              action: 'enqueue',
              guildId: target.guildId,
              videoId,
              commandId,
              queueRevision: latest.queueRevision,
            }),
          });
          bounded.throwIfAborted();
          if (!current(target)) throw Error('The selected concert changed.');
          if (receipt.id !== `public:${commandId}`)
            throw Error('Unexpected command receipt. Check the queue before retrying.');
          await confirmation(target, receipt.id, receipt.status, bounded);
          lifetime.throwIfAborted();
          added++;
          publish({ notice: `${added} track${added === 1 ? '' : 's'} confirmed by Core.` });
        }
      } catch (error) {
        const reason = operation.signal.aborted
          ? 'Adding was cancelled; a requested track may still arrive.'
          : errorText(error);
        if (current(target))
          publish({
            error: `${added} tracks confirmed. ${reason} Check the queue before retrying.`,
          });
        throw Error(reason, { cause: error });
      } finally {
        if (additions === operation) additions = null;
        if (current(target)) {
          publish({ busy: false, adding: false });
          await read(target);
        }
      }
    },
    async seek(seconds: number) {
      const target = session,
        state = view.state,
        playbackKey = state?.playbackKey;
      if (
        !target?.guildId ||
        !current(target) ||
        !view.connected ||
        view.busy ||
        !view.queue?.canManage ||
        !state?.current ||
        state.current.live ||
        !playbackKey ||
        !Number.isFinite(seconds) ||
        seconds < 0 ||
        seconds >= state.current.duration
      )
        return false;
      ++target.serial;
      publish({ busy: true, error: '', notice: '' });
      const abort = AbortSignal.any([target.controller.signal, AbortSignal.timeout(35000)]);
      try {
        const latest = await freshState(target, abort);
        if (
          latest.playbackKey !== playbackKey ||
          view.state?.playbackKey !== playbackKey ||
          !latest.current ||
          latest.current.live ||
          seconds >= latest.current.duration
        )
          throw Error('The concert track changed. Refresh before seeking.');
        const commandId = crypto.randomUUID();
        const receipt = await request<{ id: string; status: string }>('/api/admin/control', {
          method: 'POST',
          headers: headers(),
          signal: signal(target, abort, 35000),
          body: JSON.stringify({
            guildId: target.guildId,
            operation: 'command',
            commandId,
            command: { action: 'seek', seconds, queueRevision: latest.queueRevision, playbackKey },
          }),
        });
        abort.throwIfAborted();
        if (!current(target)) return false;
        if (receipt.id !== commandId)
          throw Error('Unexpected seek receipt. Refresh before trying again.');
        await confirmation(target, receipt.id, receipt.status, abort, true);
        if (!current(target) || view.state?.playbackKey !== playbackKey) return false;
        publish({ notice: 'Seek confirmed by Core.' });
        return true;
      } catch (error) {
        if (current(target)) publish({ error: errorText(error) });
        return false;
      } finally {
        if (current(target)) {
          publish({ busy: false });
          await read(target);
        }
      }
    },
    async queueAction(
      action:
        | 'vote'
        | 'skip-vote'
        | 'remove'
        | 'move'
        | 'clear'
        | 'undo'
        | 'approve'
        | 'reject'
        | 'approval',
      extra: Record<string, unknown> = {},
    ) {
      const target = session,
        queue = view.queue;
      if (!target?.guildId || !current(target) || !queue || view.busy || !view.connected)
        return false;
      if (!['vote', 'skip-vote'].includes(action) && !queue.canManage) {
        publish({ error: 'Discord administrator access is required.' });
        return false;
      }
      ++target.serial;
      publish({ busy: true, error: '', notice: '' });
      let success = false;
      try {
        await request<ConcertQueue>('/api/discord/queue', {
          method: 'POST',
          headers: headers(),
          signal: signal(target),
          body: JSON.stringify({
            ...extra,
            action,
            guildId: target.guildId,
            revision: queue.state.revision,
            ...(action === 'skip-vote' ? { playbackKey: view.state?.playbackKey } : {}),
          }),
        });
        success = current(target);
      } catch (error) {
        if (current(target)) publish({ error: errorText(error) });
      } finally {
        if (current(target)) {
          publish({ busy: false });
          await read(target);
        }
      }
      return success;
    },
    async control(action: 'pause' | 'resume' | 'skip') {
      const target = session,
        state = view.state;
      if (
        !target?.guildId ||
        !current(target) ||
        view.busy ||
        !view.connected ||
        !state?.online ||
        !state.current ||
        !state.playbackKey
      )
        return false;
      ++target.serial;
      publish({ busy: true, error: '', notice: '' });
      try {
        const commandId = crypto.randomUUID();
        const receipt = await request<{ id: string; status: string }>('/api/discord', {
          method: 'POST',
          headers: headers(),
          signal: signal(target),
          body: JSON.stringify({
            action,
            guildId: target.guildId,
            commandId,
            playbackKey: state.playbackKey,
            queueRevision: state.queueRevision,
          }),
        });
        if (!current(target)) return false;
        if (
          receipt.id !== `public:${commandId}` ||
          !['done', 'pending', 'processing', 'failed', 'expired', 'unknown'].includes(
            receipt.status,
          )
        )
          throw Error('Unexpected command receipt. Check the current state before retrying.');
        if (receipt.status === 'done')
          publish({ busy: false, notice: 'Command confirmed by Core.' });
        else if (['failed', 'expired', 'unknown'].includes(receipt.status))
          publish({
            busy: false,
            error: 'Core could not confirm the command. Read current state before trying again.',
          });
        else {
          pending = { id: receipt.id, expires: now() + 35000 };
          publish({ notice: 'Waiting for Core confirmation…' });
        }
        await read(target);
        return ['done', 'pending', 'processing'].includes(receipt.status);
      } catch (error) {
        if (current(target)) {
          publish({ busy: false, error: errorText(error) });
          await read(target);
        }
        return false;
      }
    },
    destroy() {
      retire();
      stopped = true;
      listeners.clear();
    },
  };
}
