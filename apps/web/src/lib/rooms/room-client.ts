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
  transportChanged,
} from '../../../../../lib/playback-sync.ts';
import type { Room, Video } from '../../../../../lib/types.ts';
import type { PlayerIntent, PlayerIntentReceipt } from './player-intent.ts';

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
  searchError: string;
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
  wallNow?: () => number;
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
  pollRecovering: boolean;
  accessLost: boolean;
  awaitingClock: boolean;
  command?: {
    id: string;
    epoch: string;
    version: number;
    videoId: string;
    playbackKey?: string;
    playing: boolean;
    complete: (room: Room) => void;
  };
};

/** Browser rooms only. The existing website owns authorization, persistence and progression. */
export function createRoomClient(options: RoomClientOptions = {}) {
  const request = options.request ?? browserRequest;
  const storage = options.storage ?? browserStorage;
  const now = options.now ?? (() => performance.now());
  const wallNow = options.wallNow ?? (() => Date.now());
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
    searchError: '',
    results: [],
    query: '',
    receivedAt: 0,
  };
  let session: Session | null = null;
  let pendingRecovery: Session | null = null;
  let generation = 0,
    searchSerial = 0,
    destroyed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let searchController: AbortController | null = null;
  let timeSample = { monotonic: now(), wall: wallNow() };
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
  const stopStream = (target: Session) => {
    const realtime = target.realtime;
    target.realtime = null;
    if (realtime) {
      realtime.source?.close();
      realtime.source = null;
      realtime.clock.reset();
      for (const pending of [realtime.retry, realtime.measure, realtime.lease])
        if (pending !== undefined) cancel(pending);
    }
  };
  const retire = () => {
    pendingRecovery = null;
    if (session) stopStream(session);
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
  const begin = (code: string, recovering = false) => {
    retire();
    timeSample = { monotonic: now(), wall: wallNow() };
    const target: Session = {
      code,
      generation,
      controller: new AbortController(),
      serial: 0,
      realtime: null,
      authority: null,
      pollRecovering: false,
      accessLost: false,
      awaitingClock: recovering,
    };
    session = target;
    publish({
      ...(recovering
        ? { room: state.room ? { ...state.room, isHost: false, isOwner: false } : null }
        : { room: null, results: [], query: '', receivedAt: 0 }),
      connection: recovering ? 'reconnecting' : 'connecting',
      busy: false,
      error: recovering ? 'Reconnecting to the room…' : '',
      searching: false,
      searchError: '',
    });
    return target;
  };
  const accept = (target: Session, room: Room, sent: number, sampleAge?: number) => {
    if (!current(target) || clockDiscontinuity()) return;
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
    const next = compensateDelivery(room, now() - sent, sampleAge);
    const recovering = target.awaitingClock;
    if (recovering && (isOlderSnapshot(state.room, next) || isDuplicateSnapshot(state.room, next)))
      return;
    target.authority = { room: next, receivedAt: now() };
    target.pollRecovering = false;
    target.accessLost = false;
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
    const update = roomPollUpdate(
      recovering ? null : state.room,
      next,
      Boolean(live && live.freshUntil > now()),
    );
    if (next.syncSource !== 'live') target.awaitingClock = false;
    publish({
      room: update.snapshot,
      connection: target.awaitingClock ? 'reconnecting' : 'connected',
      ...(update.timeline ? { receivedAt: now() } : {}),
    });
    startStream(target);
    if (target.awaitingClock && target.realtime) void sampleClock(target, target.realtime);
  };
  const loseStream = (target: Session, live: Realtime) => {
    if (!current(target) || target.realtime !== live) return;
    live.freshUntil = 0;
    target.pollRecovering = false;
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
    if (
      !current(target) ||
      target.realtime !== live ||
      live.clock !== clock ||
      clockDiscontinuity()
    )
      return;
    live.sampling = null;
    if (trip !== null) {
      live.calibrated = true;
      const authority = target.authority;
      if (
        target.awaitingClock &&
        authority &&
        !target.accessLost &&
        authority.room.syncEpoch === live.epoch &&
        !playbackTarget(authority.room, authority.receivedAt, now()).stale
      ) {
        target.awaitingClock = false;
        publish({ connection: 'connected', error: '' });
      }
    } else {
      live.calibrated = false;
      loseStream(target, live);
    }
  };
  const startStream = (target: Session) => {
    if (
      (!eventSource && !target.awaitingClock) ||
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
    const activeStream = () => current(target) && target.realtime === live;
    const connect = () => {
      if (!activeStream() || !eventSource) return;
      let source: RoomStream;
      try {
        source = eventSource(`/api/realtime/stream?room=${target.code}`);
      } catch {
        live.retry = schedule(connect, 10000);
        return;
      }
      live.source = source;
      const active = () => activeStream() && live.source === source;
      source.addEventListener('open', () => {
        if (active() && !clockDiscontinuity() && !live.calibrated) void sampleClock(target, live);
      });
      source.addEventListener('message', (event) => {
        if (
          !active() ||
          clockDiscontinuity() ||
          !live.calibrated ||
          (state.connection !== 'connected' && !target.pollRecovering)
        )
          return;
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
          const command = target.command;
          if (
            command &&
            state.connection === 'connected' &&
            !target.accessLost &&
            target.authority?.room.isHost &&
            now() - target.authority.receivedAt < 5000 &&
            timeline.syncEpoch === command.epoch &&
            timeline.version === command.version + 1 &&
            timeline.commandReceipt?.id === command.id &&
            timeline.commandReceipt.version === timeline.version &&
            timeline.current?.id === command.videoId &&
            timeline.playbackKey === command.playbackKey &&
            timeline.playing === command.playing
          )
            command.complete(next);
        } catch {
          // Invalid messages cannot alter permissions, playback or the lease.
        }
      });
      source.addEventListener('error', () => {
        if (!active() || clockDiscontinuity()) return;
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
      if (!activeStream() || clockDiscontinuity()) return;
      if (live.source) void sampleClock(target, live);
      live.measure = schedule(measure, 10000);
    };
    connect();
    live.measure = schedule(measure, 10000);
  };
  const read = async (target: Session, clearError = false, duringMutation = false) => {
    if (!current(target) || (state.busy && !duringMutation)) return;
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
      const reconnecting = state.connection === 'reconnecting';
      accept(target, room, sent);
      if (!current(target)) return;
      if (clearError || recovering || reconnecting) publish({ error: '' });
    } catch (error) {
      if (current(target) && target.serial === serial && !clockDiscontinuity()) {
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 403 || status === 404) target.accessLost = true;
        target.pollRecovering = !target.accessLost && (!status || status >= 500);
        publish({ connection: 'reconnecting', error: message(error) });
      }
    }
  };
  const poll = (target: Session) => {
    if (!current(target)) return;
    timer = schedule(() => {
      if (!current(target) || clockDiscontinuity()) return;
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
  const mutate = async (
    action: RoomAction,
    fields: RoomActionFields = {},
    onAccepted?: (room: Room) => void,
  ) => {
    if (clockDiscontinuity()) return false;
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
      for (let attempt = 0; attempt < 2; attempt++) {
        const before = state.room!;
        const commandId =
          onAccepted && before.syncSource === 'live' && before.syncEpoch
            ? crypto.randomUUID()
            : undefined;
        let complete!: (value: { room: Room; streamed: boolean }) => void;
        const receipt = new Promise<{ room: Room; streamed?: boolean }>((resolve) => {
          complete = resolve;
        });
        if (commandId)
          target.command = {
            id: commandId,
            epoch: before.syncEpoch!,
            version: before.version,
            videoId: before.current?.id ?? '',
            playbackKey: before.playbackKey,
            playing: action === 'seek' ? before.playing : action === 'play',
            complete: (room) => complete({ room, streamed: true }),
          };
        try {
          const sent = now();
          const response = request<{ room: Room; streamed?: boolean }>(
            `/api/rooms/${target.code}`,
            {
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
                        (storage.get('afterparty-display-name') ?? '').trim().slice(0, 32) ||
                        'Guest',
                    }
                  : {}),
                action,
                version: before.version,
                ...(commandId ? { commandId, syncEpoch: before.syncEpoch } : {}),
              }),
            },
          );
          const result = await (commandId ? Promise.race([response, receipt]) : response);
          if (!current(target) || clockDiscontinuity()) return false;
          if (!result.streamed) {
            const authority = target.authority;
            // The capped RTT compensation cannot date an arbitrarily held reply.
            // A committed gesture is acknowledged, but an expired sample cannot
            // grant a new playback lease. A fresh authenticated poll can recover it.
            const sampleAge =
              commandId &&
              authority &&
              result.room.code === target.code &&
              result.room.syncSource === 'live' &&
              authority.room.syncSource === 'live' &&
              result.room.syncEpoch === authority.room.syncEpoch
                ? Math.max(
                    0,
                    authority.room.serverTime +
                      now() -
                      authority.receivedAt -
                      result.room.serverTime,
                  )
                : undefined;
            if (sampleAge === undefined || sampleAge < (result.room.syncValidForMs ?? 0))
              accept(target, result.room, sent, sampleAge);
            else if (state.room && playbackTarget(state.room, state.receivedAt, now()).stale)
              publish({ connection: 'reconnecting', error: 'Live playback is reconnecting.' });
          }
          if (!current(target)) return false;
          onAccepted?.(result.room);
          return true;
        } catch (error) {
          if (!current(target) || clockDiscontinuity()) return false;
          const conflict = (error as { status?: number })?.status === 409;
          if (conflict && attempt === 0 && ['play', 'pause', 'seek'].includes(action)) {
            // Only a rejected command can be retried, never an uncertain receipt.
            // Refresh under the mutation lock and keep all server revision checks.
            await read(target, false, true);
            if (!current(target) || state.connection !== 'connected') return false;
            const fresh = state.room;
            if (
              current(target) &&
              state.connection === 'connected' &&
              fresh?.isHost &&
              fresh.version > before.version &&
              fresh.code === before.code &&
              fresh.current?.id === before.current?.id &&
              fresh.playbackKey === before.playbackKey &&
              fresh.syncSource === before.syncSource &&
              fresh.syncEpoch === before.syncEpoch &&
              fresh.startsAt === before.startsAt &&
              fresh.buffering === before.buffering &&
              !transportChanged(before, fresh)
            )
              continue;
          } else refreshAfterConflict = conflict;
          publish({ error: message(error) });
          return false;
        } finally {
          if (target.command?.id === commandId) target.command = undefined;
        }
      }
      return false;
    } finally {
      if (current(target) && !clockDiscontinuity()) {
        publish({ busy: false });
        if (refreshAfterConflict) await read(target);
      }
    }
  };
  const manageHosts = async (action: 'invite' | 'transfer-invite' | 'revoke-hosts') => {
    if (clockDiscontinuity()) return null;
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
      if (!current(target) || clockDiscontinuity()) return null;
      if (action !== 'revoke-hosts' && !/^[a-f0-9]{64}$/.test(result.token ?? ''))
        throw new Error('A private invitation could not be created. Try again.');
      accept(target, result.room, sent);
      if (!current(target)) return null;
      return { token: result.token };
    } catch (error) {
      if (current(target) && !clockDiscontinuity()) {
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
  const clockDiscontinuity = (defer = false) => {
    if (session && pendingRecovery === session) return true;
    const sample = { monotonic: now(), wall: wallNow() },
      previous = timeSample;
    timeSample = sample;
    const monotonicElapsed = sample.monotonic - previous.monotonic;
    const gap = sample.wall - previous.wall - monotonicElapsed;
    // Wall time is only a discontinuity signal, never playback authority.
    if (
      !session ||
      destroyed ||
      (monotonicElapsed >= 0 && Number.isFinite(gap) && Math.abs(gap) < 5000)
    )
      return false;
    const previousSession = session;
    const recover = () => {
      if (!current(previousSession)) return;
      const target = begin(previousSession.code, true);
      void read(target, true).finally(() => poll(target));
    };
    if (defer) {
      pendingRecovery = previousSession;
      // playback() is read from a Svelte derived value. Stop its projection
      // immediately, but publish recovery only after that calculation ends.
      queueMicrotask(() => {
        if (pendingRecovery === previousSession) recover();
      });
    } else recover();
    return true;
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
      if (clockDiscontinuity()) return;
      const target = session;
      if (!target || !current(target) || state.busy) return;
      if (state.connection === 'connected') {
        await read(target, true);
        return;
      }
      // An explicit retry replaces the failed transport now, while retaining
      // the room identity, saved ownership and current shared playback intent.
      stopStream(target);
      publish({ busy: true, connection: 'connecting', error: 'Reconnecting to the room…' });
      startStream(target);
      try {
        await read(target, true, true);
      } finally {
        if (current(target)) publish({ busy: false });
      }
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
      publish({ query, results: [], searching: false, searchError: '' });
      if (query.length < 2 || query.length > 120) {
        publish({ searchError: 'Enter between 2 and 120 characters.' });
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
        if (!destroyed && serial === searchSerial && roomGeneration === generation) {
          const timedOut =
            error instanceof Error &&
            (error.name === 'TimeoutError' ||
              (error as Error & { status?: number }).status === 504);
          publish({
            searching: false,
            searchError: timedOut ? 'Music search took too long. Try again.' : message(error),
          });
        }
      }
    },
    cancelSearch() {
      searchSerial++;
      searchController?.abort();
      searchController = null;
      publish({ searching: false, results: [], query: '', searchError: '' });
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
    async controlNative(
      action: PlayerIntent['action'],
      position?: number,
    ): Promise<PlayerIntentReceipt> {
      let version: number | undefined;
      const accepted = await mutate(action, action === 'seek' ? { position } : {}, (room) => {
        version = room.version;
      });
      return { accepted, version };
    },
    playback() {
      const recovering = clockDiscontinuity(true);
      if (!state.room) return null;
      const target = playbackTarget(state.room, state.receivedAt, now());
      const live = session?.realtime;
      // A temporary authenticated-read failure disables commands, but does not
      // invalidate an independently calibrated, unexpired public timeline.
      // Stream loss/lease expiry and access failures still stop playback.
      const sustained =
        session?.pollRecovering &&
        live?.calibrated &&
        live.source?.readyState === 1 &&
        live.freshUntil > now();
      return !recovering && (state.connection === 'connected' || sustained)
        ? target
        : { ...target, playing: false, stale: true };
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
        searchError: '',
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
