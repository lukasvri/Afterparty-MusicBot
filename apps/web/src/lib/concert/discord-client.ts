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
  });
  let view = empty();
  let session: Session | null = null;
  let audio: ReturnType<typeof createConcertAudio> | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { id: string; expires: number } | null = null;
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
  const signal = (target: Session) =>
    AbortSignal.any([target.controller.signal, AbortSignal.timeout(12000)]);
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
  const read = async (target: Session, clearError = false) => {
    if (!current(target) || (view.busy && !pending)) return;
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
      publish({
        guildId: resolvedGuild,
        state: view.audioLive ? view.state : result.state ? publicState(result.state) : null,
        queue,
        connected: true,
        loading: false,
        ...(clearError ? { error: '' } : {}),
      });
      if (resolvedGuild && !audio) {
        audio = createConcertAudio(resolvedGuild, target.selectedGuildId, options.audio);
        audio.subscribe((value) => {
          if (current(target))
            publish({
              audioRoom: value.room,
              audioLive: value.live,
              audioPhase: value.phase,
              ...(value.state ? { state: publicState(value.state) } : {}),
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
        const receipt = await request<{ id: string; status: string }>('/api/discord', {
          method: 'POST',
          headers: headers(),
          signal: signal(target),
          body: JSON.stringify({
            action,
            guildId: target.guildId,
            commandId: crypto.randomUUID(),
            playbackKey: state.playbackKey,
            queueRevision: state.queueRevision,
          }),
        });
        if (!current(target)) return false;
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
        return true;
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
