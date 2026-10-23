import { request as browserRequest } from '../../../../lib/browser-api.ts';
import { browserStorage } from '../../../../lib/browser-storage.ts';
import {
  compensateDelivery,
  playbackTarget,
  roomPollUpdate,
} from '../../../../lib/playback-sync.ts';
import type { Room, Video } from '../../../../lib/types.ts';

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
export type RoomClientOptions = {
  request?: typeof browserRequest;
  storage?: Storage;
  now?: () => number;
  pollMs?: number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
};
type Session = { code: string; generation: number; controller: AbortController; serial: number };

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
    const target: Session = { code, generation, controller: new AbortController(), serial: 0 };
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
    const update = roomPollUpdate(state.room, next, false);
    publish({
      room: update.snapshot,
      connection: 'connected',
      ...(update.timeline ? { receivedAt: now() } : {}),
    });
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
      void read(target).finally(() => poll(target));
    }, options.pollMs ?? 1000);
  };
  const mutate = async (action: string, fields: Record<string, unknown> = {}) => {
    const target = session,
      room = state.room;
    if (!target || !room || !current(target) || state.busy || state.connection !== 'connected')
      return false;
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
      if (session) await read(session, true);
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
