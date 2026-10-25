import { request as browserRequest } from '../../../../../lib/browser-api.ts';
import { browserStorage } from '../../../../../lib/browser-storage.ts';
import { LiveClock } from '../../../../../lib/live-clock.ts';
import {
  ROOM_QUEUE_LIMIT,
  roomQueueCapacity,
  elapsedPlayingMs,
  readRoomTimeline,
} from '../../../../../services/core/src/protocol.ts';
import {
  compensateDelivery,
  isDuplicateSnapshot,
  isOlderSnapshot,
  playbackTarget,
  roomPollUpdate,
} from '../../../../../lib/playback-sync.ts';
import type { Room, Video } from '../../../../../lib/types.ts';

export type RoomAction =
  | 'add'
  | 'play-video'
  | 'play'
  | 'pause'
  | 'seek'
  | 'next'
  | 'remove'
  | 'move'
  | 'clear'
  | 'undo'
  | 'radio'
  | 'approval'
  | 'approve'
  | 'reject'
  | 'vote'
  | 'skip-vote'
  | 'visibility';
export type RoomActionFields = {
  videoId?: string;
  position?: number;
  to?: number;
  enabled?: boolean;
  isPublic?: boolean;
};

export type RoomClientState = {
  room: Room | null;
  connection: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  busy: boolean;
  error: string;
  searching: boolean;
  results: Video[];
  query: string;
  receivedAt: number;
};
type Storage = Pick<typeof browserStorage, 'get' | 'set'>;
type RoomStream = Pick<EventSource, 'addEventListener' | 'close' | 'readyState'>;
export type RoomClientOptions = {
  request?: typeof browserRequest;
  storage?: Storage;
  now?: () => number;
  pollMs?: number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  eventSource?: ((url: string) => RoomStream) | null;
  clockRequest?: typeof fetch;
};
type Realtime = {
  source: RoomStream | null;
  clock: LiveClock;
  sampling: LiveClock | null;
  calibrated: boolean;
  epoch: string;
  latest: Room | null;
  freshUntil: number;
  retry?: ReturnType<typeof setTimeout>;
  measure?: ReturnType<typeof setTimeout>;
  lease?: ReturnType<typeof setTimeout>;
};
type Session = {
  code: string;
  generation: number;
  controller: AbortController;
  serial: number;
  realtime: Realtime | null;
  authority: { room: Room; receivedAt: number } | null;
};

/** Browser rooms only. The existing website owns authorization, persistence and progression. */
export function createRoomClient(options: RoomClientOptions = {}) {
  const request = options.request ?? browserRequest;
  const storage = options.storage ?? browserStorage;
  const now = options.now ?? (() => performance.now());
  const schedule = options.setTimeout ?? globalThis.setTimeout;
  const cancel = options.clearTimeout ?? globalThis.clearTimeout;
  const eventSource =
    options.eventSource === undefined
      ? typeof EventSource === 'undefined'
        ? null
        : (url: string) => new EventSource(url)
      : options.eventSource;
  const listeners = new Set<(state: RoomClientState) => void>();
  let state: RoomClientState = {
    room: null,
    connection: 'idle',
    busy: false,
    error: '',
    searching: false,
    results: [],
    query: '',
    receivedAt: 0,
  };
  let session: Session | null = null;
  let generation = 0,
    searchSerial = 0,
    destroyed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let searchController: AbortController | null = null;
  const publish = (change: Partial<RoomClientState>) => {
    if (destroyed) return;
    state = { ...state, ...change };
    listeners.forEach((listener) => listener(state));
  };
  const current = (target: Session) =>
    !destroyed && session === target && !target.controller.signal.aborted;
  const signal = (controller: AbortController, budget = 12000) =>
    AbortSignal.any([controller.signal, AbortSignal.timeout(budget)]);
  const message = (error: unknown) =>
    error instanceof Error ? error.message : 'The room is temporarily unavailable. Try again.';
  const headers = (code?: string) => {
    let visitor = storage.get('afterparty-visitor');
    if (!visitor) {
      visitor = crypto.randomUUID();
      storage.set('afterparty-visitor', visitor);
    }
    const token = code ? storage.get(`afterparty-host:${code}`) : null;
    return {
      'Content-Type': 'application/json',
      'X-Afterparty-Visitor': visitor,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };
  const retire = () => {
    const realtime = session?.realtime;
    if (realtime) {
      realtime.source?.close();
      realtime.source = null;
      realtime.clock.reset();
      for (const pending of [realtime.retry, realtime.measure, realtime.lease])
        if (pending !== undefined) cancel(pending);
    }
    session?.controller.abort();
    session = null;
    generation++;
    if (timer !== undefined) {
      cancel(timer);
      timer = undefined;
    }
    searchController?.abort();
    searchController = null;
    searchSerial++;
  };
  const begin = (code: string) => {
    retire();
    const target: Session = {
      code,
      generation,
      controller: new AbortController(),
      serial: 0,
      realtime: null,
      authority: null,
    };
    session = target;
    publish({
      room: null,
      connection: 'connecting',
      busy: false,
      error: '',
      searching: false,
      results: [],
      query: '',
      receivedAt: 0,
    });
    return target;
  };
  const accept = (target: Session, room: Room, sent: number) => {
    if (!current(target)) return;
    if (
      !room ||
      room.code !== target.code ||
      room.mode === 'discord' ||
      room.guildId ||
      !Number.isSafeInteger(room.version) ||
      !Number.isFinite(room.serverTime) ||
      !Array.isArray(room.queue)
    )
      throw new Error('This view supports browser rooms only.');
    const next = compensateDelivery(room, now() - sent);
    target.authority = { room: next, receivedAt: now() };
    const live = target.realtime;
    if (live && live.epoch !== next.syncEpoch) {
      live.epoch = next.syncEpoch ?? '';
      live.freshUntil = 0;
      live.latest = null;
      live.calibrated = false;
      live.clock.reset();
      live.clock = new LiveClock(now);
      if (live.source) void sampleClock(target, live);
    }
    const update = roomPollUpdate(state.room, next, Boolean(live && live.freshUntil > now()));
    publish({
      room: update.snapshot,
      connection: 'connected',
      ...(update.timeline ? { receivedAt: now() } : {}),
    });
    startStream(target);
  };
  const loseStream = (target: Session, live: Realtime) => {
    if (!current(target) || target.realtime !== live) return;
    live.freshUntil = 0;
    const authority = target.authority,
      previous = state.room;
    if (
      authority &&
      previous &&
      authority.room.version === previous.version &&
      authority.room.syncEpoch === previous.syncEpoch &&
      authority.room.current?.id === previous.current?.id &&
      authority.room.playing === previous.playing &&
      !playbackTarget(authority.room, authority.receivedAt, now()).stale
    ) {
      // A fresh authenticated poll can sustain playback after a stream outage.
      // Do not return to an older revision or extend its original lease.
      publish({ room: authority.room, receivedAt: authority.receivedAt });
    } else {
      publish({ connection: 'reconnecting', error: 'Live playback is reconnecting.' });
    }
  };
  const sampleClock = async (target: Session, live: Realtime) => {
    const clock = live.clock;
    if (live.sampling === clock) return;
    live.sampling = clock;
    const trip = await clock.sample(target.controller.signal, options.clockRequest);
    if (!current(target) || target.realtime !== live || live.clock !== clock) return;
    live.sampling = null;
    if (trip !== null) live.calibrated = true;
    else {
      live.calibrated = false;
      loseStream(target, live);
    }
  };
  const startStream = (target: Session) => {
    if (
      !eventSource ||
      !current(target) ||
      target.realtime ||
      state.room?.syncSource !== 'live' ||
      !state.room.syncEpoch
    )
      return;
    const live: Realtime = {
      source: null,
      clock: new LiveClock(now),
      sampling: null,
      calibrated: false,
      epoch: state.room.syncEpoch,
      latest: null,
      freshUntil: 0,
    };
    target.realtime = live;
    const connect = () => {
      if (!current(target)) return;
      let source: RoomStream;
      try {
        source = eventSource(`/api/realtime/stream?room=${target.code}`);
      } catch {
        live.retry = schedule(connect, 10000);
        return;
      }
      live.source = source;
      const active = () => current(target) && live.source === source;
      source.addEventListener('open', () => {
        if (active()) void sampleClock(target, live);
      });
      source.addEventListener('message', (event) => {
        if (!active() || !live.calibrated || state.busy || state.connection !== 'connected') return;
        try {
          const message = JSON.parse((event as MessageEvent<string>).data);
          const timeline = message.type === 'room' ? readRoomTimeline(message.room) : null;
          const previous = state.room;
          if (
            !timeline ||
            !previous ||
            timeline.code !== target.code ||
            message.room.mode === 'discord' ||
            message.room.guildId ||
            timeline.syncEpoch !== live.epoch ||
            previous.syncSource !== 'live' ||
            previous.syncEpoch !== timeline.syncEpoch ||
            timeline.version < previous.version ||
            isOlderSnapshot(previous, timeline) ||
            isDuplicateSnapshot(previous, timeline) ||
            isOlderSnapshot(live.latest, timeline) ||
            isDuplicateSnapshot(live.latest, timeline)
          )
            return;
          const age = live.clock.age(timeline.serverTime, timeline.syncValidForMs);
          if (age >= timeline.syncValidForMs) {
            loseStream(target, live);
            return;
          }
          const next: Room = {
            ...timeline,
            position:
              timeline.position +
              (timeline.playing
                ? elapsedPlayingMs(timeline.serverTime, timeline.startsAt, age) / 1000
                : 0),
            syncSampledAt: timeline.serverTime,
            serverTime: timeline.serverTime + age,
            syncValidForMs: timeline.syncValidForMs - age,
            // The stream carries a public timeline, never the user's authority.
            isHost: previous.isHost,
            isOwner: previous.isOwner,
            isPublic: previous.isPublic,
            viewers: previous.viewers,
          };
          live.latest = next;
          live.freshUntil = now() + next.syncValidForMs!;
          if (live.lease !== undefined) cancel(live.lease);
          const expiresAt = live.freshUntil;
          live.lease = schedule(() => {
            if (active() && live.freshUntil === expiresAt && now() >= expiresAt)
              loseStream(target, live);
          }, next.syncValidForMs!);
          publish({ room: next, receivedAt: now() });
        } catch {
          // Invalid messages cannot alter permissions, playback or the lease.
        }
      });
      source.addEventListener('error', () => {
        if (!active()) return;
        live.calibrated = false;
        live.clock.reset();
        live.clock = new LiveClock(now);
        loseStream(target, live);
        if (source.readyState === 2) {
          source.close();
          live.source = null;
          live.retry = schedule(connect, 10000);
        }
      });
    };
    const measure = () => {
      if (!current(target)) return;
      if (live.source) void sampleClock(target, live);
      live.measure = schedule(measure, 10000);
    };
    connect();
    live.measure = schedule(measure, 10000);
  };
  const read = async (target: Session, clearError = false) => {
    if (!current(target) || state.busy) return;
    const recovering = state.connection === 'reconnecting';
    const serial = ++target.serial,
      sent = now();
    try {
      const room = await request<Room>(`/api/rooms/${target.code}`, {
        headers: headers(target.code),
        cache: 'no-store',
        signal: signal(target.controller),
      });
      if (!current(target) || target.serial !== serial) return;
      accept(target, room, sent);
      if (clearError || recovering) publish({ error: '' });
    } catch (error) {
      if (current(target) && target.serial === serial)
        publish({ connection: 'reconnecting', error: message(error) });
    }
  };
  const poll = (target: Session) => {
    if (!current(target)) return;
    timer = schedule(() => {
      const live = target.realtime;
      // SSE supplies the live timeline. Keep authenticated roles and presence
      // bounded to five seconds without repeating the same snapshot each second.
      // The local one-second timer restores reads as soon as the live lease fails.
      const liveFresh =
        live?.calibrated &&
        live.source?.readyState === 1 &&
        live.freshUntil > now() &&
        state.connection === 'connected';
      const authorityFresh = target.authority && now() - target.authority.receivedAt < 5000;
      if (liveFresh && authorityFresh) poll(target);
      else void read(target).finally(() => poll(target));
    }, options.pollMs ?? 1000);
  };
  const mutate = async (action: RoomAction, fields: RoomActionFields = {}) => {
    const target = session,
      room = state.room;
    if (!target || !room || !current(target) || state.busy || state.connection !== 'connected')
      return false;
    if (action === 'visibility' && !room.isOwner) {
      publish({ error: 'Only the room owner can change its visibility.' });
      return false;
    }
    if (!['add', 'vote', 'skip-vote'].includes(action) && !room.isHost) {
      publish({ error: 'Only the room host can control playback.' });
      return false;
    }
    ++target.serial;
    publish({ busy: true, error: '' });
    let refreshAfterConflict = false;
    try {
      const sent = now();
      const result = await request<{ room: Room }>(`/api/rooms/${target.code}`, {
        method: 'POST',
        headers: headers(target.code),
        signal: signal(
          target.controller,
          ['next', 'radio', 'skip-vote'].includes(action) ? 35000 : 12000,
        ),
        body: JSON.stringify({
          ...fields,
          ...(action === 'add' || action === 'play-video'
            ? {
                displayName:
                  (storage.get('afterparty-display-name') ?? '').trim().slice(0, 32) || 'Guest',
              }
            : {}),
          action,
          version: room.version,
        }),
      });
      if (!current(target)) return false;
      accept(target, result.room, sent);
      return true;
    } catch (error) {
      if (current(target)) {
        publish({ error: message(error) });
        refreshAfterConflict = (error as { status?: number })?.status === 409;
      }
      return false;
    } finally {
      if (current(target)) {
        publish({ busy: false });
        if (refreshAfterConflict) await read(target);
      }
    }
  };
  const manageHosts = async (action: 'invite' | 'transfer-invite' | 'revoke-hosts') => {
    const target = session,
      room = state.room;
    if (!target || !room || !current(target) || state.busy || state.connection !== 'connected')
      return null;
    if (!room.isOwner) {
      publish({ error: 'Only the room owner can share or revoke host access.' });
      return null;
    }
    ++target.serial;
    publish({ busy: true, error: '' });
    let refreshAfterConflict = false;
    try {
      const sent = now();
      const result = await request<{ room: Room; token?: string }>(`/api/rooms/${target.code}`, {
        method: 'POST',
        headers: headers(target.code),
        signal: signal(target.controller),
        body: JSON.stringify({ action, version: room.version }),
      });
      if (!current(target)) return null;
      if (action !== 'revoke-hosts' && !/^[a-f0-9]{64}$/.test(result.token ?? ''))
        throw new Error('A private invitation could not be created. Try again.');
      accept(target, result.room, sent);
      return { token: result.token };
    } catch (error) {
      if (current(target)) {
        // Access credentials belong only in private fragment links and local storage.
        publish({ error: message(error).replace(/[a-f0-9]{64}/gi, '[private token]') });
        refreshAfterConflict = (error as { status?: number })?.status === 409;
      }
      return null;
    } finally {
      if (current(target)) {
        publish({ busy: false });
        if (refreshAfterConflict) await read(target);
      }
    }
  };
  return {
    subscribe(listener: (state: RoomClientState) => void) {
      if (destroyed) return () => {};
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    async create(name: string, isPublic = false) {
      if (destroyed) return false;
      const target = begin('');
      publish({ busy: true });
      try {
        const result = await request<{ room: Room; token: string }>('/api/rooms', {
          method: 'POST',
          headers: headers(),
          signal: signal(target.controller),
          body: JSON.stringify({ name: name.trim(), isPublic }),
        });
        if (!current(target)) return false;
        if (
          !/^[A-Z0-9]{8}$/.test(result.room?.code) ||
          result.room.code === 'DISCORD1' ||
          !/^[a-f0-9]{64}$/.test(result.token)
        )
          throw new Error('The room could not be created. Try again.');
        target.code = result.room.code;
        storage.set(`afterparty-host:${target.code}`, result.token);
        // Creation returns a guest snapshot because the token was not in that request.
        publish({ busy: false });
        await read(target, true);
        poll(target);
        return current(target) && state.room !== null;
      } catch (error) {
        if (current(target))
          publish({ busy: false, connection: 'reconnecting', error: message(error) });
        return false;
      }
    },
    async join(value: string, invitation?: string) {
      if (destroyed) return false;
      const code = value.trim().toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(code) || code === 'DISCORD1') {
        publish({ error: 'Enter an eight-character browser room code.' });
        return false;
      }
      const target = begin(code);
      if (invitation !== undefined) {
        if (!/^[a-f0-9]{64}$/.test(invitation)) {
          publish({ connection: 'idle', error: 'This private invitation is invalid.' });
          return false;
        }
        publish({ busy: true });
        try {
          const result = await request<{ token: string }>(`/api/rooms/${code}`, {
            method: 'POST',
            headers: headers(),
            signal: signal(target.controller),
            body: JSON.stringify({ action: 'claim-host', token: invitation }),
          });
          if (!current(target)) return false;
          if (!/^[a-f0-9]{64}$/.test(result.token))
            throw new Error('The invitation could not be accepted. Ask the owner for a new link.');
          storage.set(`afterparty-host:${code}`, result.token);
        } catch (error) {
          if (current(target))
            publish({
              connection: 'idle',
              error: message(error).replace(/[a-f0-9]{64}/gi, '[private token]'),
            });
          return false;
        } finally {
          if (current(target)) publish({ busy: false });
        }
      }
      await read(target, true);
      poll(target);
      return current(target) && state.room !== null;
    },
    async refresh() {
      if (session) await read(session, true);
    },
    async createInvitation(type: 'cohost' | 'transfer' = 'cohost') {
      const result = await manageHosts(type === 'transfer' ? 'transfer-invite' : 'invite');
      return result?.token ?? null;
    },
    async revokeHosts() {
      return (await manageHosts('revoke-hosts')) !== null;
    },
    async search(value: string) {
      if (destroyed) return;
      const query = value.trim(),
        serial = ++searchSerial,
        roomGeneration = generation;
      searchController?.abort();
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
          // Preserve the existing cold-provider budget instead of the generic
          // twelve-second API deadline. Editing or leaving still aborts promptly.
          { headers: headers(), signal: signal(controller, 35000) },
        );
        if (!destroyed && serial === searchSerial && roomGeneration === generation)
          publish({ results: result.videos, searching: false });
      } catch (error) {
        if (!destroyed && serial === searchSerial && roomGeneration === generation)
          publish({ searching: false, error: message(error) });
      }
    },
    cancelSearch() {
      searchSerial++;
      searchController?.abort();
      searchController = null;
      publish({ searching: false, results: [], query: '' });
    },
    add(videoId: string) {
      return mutate('add', { videoId });
    },
    async append(input: readonly string[]) {
      const target = session;
      if (!target || !current(target) || state.busy || state.connection !== 'connected')
        throw new Error('Connect to the room before adding music.');
      const ids = [...new Set(input)];
      if (!ids.length || ids.length > ROOM_QUEUE_LIMIT || ids.some((id) => !/^[\w-]{11}$/.test(id)))
        throw new Error('Choose between one and fifty YouTube tracks.');
      await read(target);
      const active = () => current(target) && state.connection === 'connected' && state.room;
      const present = (room: Room, id: string) =>
        room.current?.id === id ||
        [...room.queue, ...(room.requests ?? [])].some((video) => video.id === id);
      const initial = active();
      if (!initial) throw new Error('The room changed or disconnected. Check the queue.');
      const missing = ids.filter((id) => !present(initial, id));
      const capacity = roomQueueCapacity(initial.queue.length, initial.requests?.length);
      if (missing.length > capacity)
        throw new Error(
          `The queue has room for ${Math.max(0, capacity)} more tracks. Select fewer tracks.`,
        );
      let added = 0;
      for (const videoId of missing) {
        const room = active();
        if (!room) throw new Error('The room changed or disconnected. Adding was stopped.');
        if (present(room, videoId)) continue;
        if (!(await mutate('add', { videoId })))
          throw new Error(
            `${added} tracks added. ${current(target) ? state.error || 'Adding was interrupted.' : 'The room changed.'} Check the queue before retrying.`,
          );
        added++;
      }
    },
    action: mutate,
    playVideo(videoId: string) {
      return mutate('play-video', { videoId });
    },
    remove(videoId: string) {
      return mutate('remove', { videoId });
    },
    move(videoId: string, to: number) {
      return mutate('move', { videoId, to });
    },
    setVisibility(isPublic: boolean) {
      return mutate('visibility', { isPublic });
    },
    control(action: 'play' | 'pause' | 'seek' | 'next', position?: number) {
      return mutate(action, action === 'seek' ? { position } : {});
    },
    playback() {
      if (!state.room) return null;
      const target = playbackTarget(state.room, state.receivedAt, now());
      return state.connection === 'connected' ? target : { ...target, playing: false, stale: true };
    },
    leave() {
      if (destroyed) return;
      retire();
      publish({
        room: null,
        connection: 'idle',
        busy: false,
        error: '',
        searching: false,
        results: [],
        query: '',
        receivedAt: 0,
      });
    },
    destroy() {
      retire();
      destroyed = true;
      listeners.clear();
    },
  };
}
