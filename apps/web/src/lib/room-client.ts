import { request as browserRequest } from '../../../../lib/browser-api.ts';
import { browserStorage } from '../../../../lib/browser-storage.ts';
import {
  compensateDelivery,
  isDuplicateSnapshot,
  isOlderSnapshot,
  playbackTarget,
  roomPollUpdate,
} from '../../../../lib/playback-sync.ts';
import type { Room, Video } from '../../../../lib/types.ts';
import { createRoomLive } from './room-live.ts';

export type RoomClientState = {
  room: Room | null;
  connection: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  live: boolean;
  busy: boolean;
  error: string;
  searching: boolean;
  results: Video[];
  query: string;
  receivedAt: number;
};
type Storage = Pick<typeof browserStorage, 'get' | 'set'>;
export type RoomClientOptions = {
  request?: typeof browserRequest;
  storage?: Storage;
  now?: () => number;
  pollMs?: number;
  livePollMs?: number;
  live?: typeof createRoomLive;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
};
type Session = {
  code: string;
  generation: number;
  controller: AbortController;
  serial: number;
  reading?: AbortController;
  readAt: number;
  epoch?: string;
  retiredEpochs: Set<string>;
  live?: ReturnType<typeof createRoomLive>;
};

/** Browser rooms only. The existing website owns authorization, persistence and progression. */
export function createRoomClient(options: RoomClientOptions = {}) {
  const request = options.request ?? browserRequest;
  const storage = options.storage ?? browserStorage;
  const now = options.now ?? (() => performance.now());
  const schedule = options.setTimeout ?? globalThis.setTimeout;
  const cancel = options.clearTimeout ?? globalThis.clearTimeout;
  const listeners = new Set<(state: RoomClientState) => void>();
  let state: RoomClientState = {
    room: null,
    connection: 'idle',
    live: false,
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
    session?.controller.abort();
    session?.live?.destroy();
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
      readAt: now(),
      retiredEpochs: new Set(),
    };
    session = target;
    publish({
      room: null,
      connection: 'connecting',
      live: false,
      busy: false,
      error: '',
      searching: false,
      results: [],
      query: '',
      receivedAt: 0,
    });
    return target;
  };
  const retiredTimeline = (target: Session, room: Room) =>
    room.syncSource === 'live' &&
    Boolean(room.syncEpoch && target.retiredEpochs.has(room.syncEpoch));
  const rememberEpoch = (target: Session, room: Room) => {
    if (room.syncSource !== 'live' || !room.syncEpoch) return;
    if (target.epoch && target.epoch !== room.syncEpoch) {
      target.retiredEpochs.add(target.epoch);
      if (target.retiredEpochs.size > 16)
        target.retiredEpochs.delete(target.retiredEpochs.values().next().value!);
    }
    target.epoch = room.syncEpoch;
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
    const update =
      retiredTimeline(target, next) && state.room
        ? {
            snapshot: {
              ...state.room,
              isHost: next.isHost,
              isOwner: next.isOwner,
              isPublic: next.isPublic,
              viewers: next.viewers,
            },
            timeline: false,
          }
        : roomPollUpdate(state.room, next, target.live?.isFresh() ?? false);
    if (update.timeline) rememberEpoch(target, next);
    publish({
      room: update.snapshot,
      connection: 'connected',
      ...(update.timeline ? { receivedAt: now() } : {}),
    });
  };
  const connectLive = (target: Session) => {
    if (!current(target) || !state.room || target.live) return;
    target.live = (options.live ?? createRoomLive)({
      code: target.code,
      signal: target.controller.signal,
      now,
      setTimeout: schedule,
      clearTimeout: cancel,
      onSnapshot(room) {
        if (
          !current(target) ||
          !state.room ||
          room.code !== target.code ||
          retiredTimeline(target, room) ||
          isOlderSnapshot(state.room, room) ||
          isDuplicateSnapshot(state.room, room)
        )
          return false;
        rememberEpoch(target, room);
        // The public timeline cannot grant or revoke authenticated room rights.
        publish({
          room: {
            ...room,
            isHost: state.room.isHost,
            isOwner: state.room.isOwner,
            isPublic: state.room.isPublic,
            viewers: state.room.viewers,
          },
          receivedAt: now(),
        });
        return true;
      },
      onFresh(live) {
        if (!current(target)) return;
        publish({ live });
        poll(target);
      },
    });
  };
  const read = async (target: Session, clearError = false, replacePending = false) => {
    if (!current(target) || state.busy || (target.reading && !replacePending)) return;
    target.reading?.abort();
    const reading = new AbortController();
    target.reading = reading;
    const recovering = state.connection === 'reconnecting';
    const serial = ++target.serial,
      sent = now();
    try {
      const room = await request<Room>(`/api/rooms/${target.code}`, {
        headers: headers(target.code),
        cache: 'no-store',
        signal: AbortSignal.any([signal(target.controller), reading.signal]),
      });
      if (!current(target) || target.serial !== serial) return;
      accept(target, room, sent);
      target.readAt = now();
      connectLive(target);
      if (clearError || recovering) publish({ error: '' });
    } catch (error) {
      if (current(target) && target.serial === serial)
        publish({ connection: 'reconnecting', error: message(error) });
    } finally {
      if (target.reading === reading) target.reading = undefined;
    }
  };
  const poll = (target: Session) => {
    if (!current(target)) return;
    if (timer !== undefined) cancel(timer);
    const fallback = options.pollMs ?? 1000,
      interval = options.livePollMs ?? 10000;
    const delay =
      state.busy || target.reading || state.connection !== 'connected'
        ? fallback
        : Math.min(
            target.live?.isFresh() ? interval : fallback,
            Math.max(0, target.readAt + interval - now()),
          );
    timer = schedule(() => {
      timer = undefined;
      void read(target).finally(() => poll(target));
    }, delay);
  };
  const mutate = async (action: string, fields: Record<string, unknown> = {}) => {
    const target = session,
      room = state.room;
    if (!target || !room || !current(target) || state.busy || state.connection !== 'connected')
      return false;
    if (playbackTarget(room, state.receivedAt, now()).stale) {
      publish({ error: 'The room connection is stale. Reconnect before changing playback.' });
      return false;
    }
    if (action !== 'add' && !room.isHost) {
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
        signal: signal(target.controller, action === 'next' ? 35000 : 12000),
        body: JSON.stringify({ action, version: room.version, ...fields }),
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
        if (refreshAfterConflict) await read(target, false, true);
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
    async create(name: string) {
      if (destroyed) return false;
      const target = begin('');
      publish({ busy: true });
      try {
        const result = await request<{ room: Room; token: string }>('/api/rooms', {
          method: 'POST',
          headers: headers(),
          signal: signal(target.controller),
          body: JSON.stringify({ name: name.trim(), isPublic: false }),
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
    async join(value: string) {
      if (destroyed) return false;
      const code = value.trim().toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(code) || code === 'DISCORD1') {
        publish({ error: 'Enter an eight-character browser room code.' });
        return false;
      }
      const target = begin(code);
      await read(target, true);
      poll(target);
      return current(target) && state.room !== null;
    },
    async refresh() {
      if (session) await read(session, true, true);
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
        live: false,
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
