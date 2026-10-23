import { LiveClock } from '../../../../lib/live-clock.ts';
import { isDuplicateSnapshot, isOlderSnapshot } from '../../../../lib/playback-sync.ts';
import type { Room } from '../../../../lib/types.ts';
import {
  elapsedPlayingMs,
  readRoomTimeline,
  ROOM_LEASE_MS,
} from '../../../../services/core/src/protocol.ts';

export type RoomEventSource = Pick<EventSource, 'readyState' | 'close'> & {
  addEventListener(type: string, listener: EventListener): void;
};
export type RoomLiveOptions = {
  code: string;
  signal: AbortSignal;
  onSnapshot: (room: Room) => boolean;
  onFresh: (fresh: boolean) => void;
  eventSource?: (url: string) => RoomEventSource;
  request?: typeof fetch;
  now?: () => number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
};

/** Private browser timelines only. Permissions always come from authenticated room reads. */
export function createRoomLive(options: RoomLiveOptions) {
  const now = options.now ?? (() => performance.now());
  const schedule = options.setTimeout ?? globalThis.setTimeout;
  const cancel = options.clearTimeout ?? globalThis.clearTimeout;
  const factory =
    options.eventSource ??
    (typeof EventSource === 'undefined' ? undefined : (url: string) => new EventSource(url));
  const controller = new AbortController();
  const clock = new LiveClock(now);
  const retiredEpochs = new Set<string>();
  let stopped = false,
    fresh = false,
    expiresAt = 0;
  let latest: Room | null = null;
  let source: RoomEventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let measure: ReturnType<typeof setTimeout> | undefined;
  let watch: ReturnType<typeof setTimeout> | undefined;
  const active = () => !stopped && !options.signal.aborted;
  const current = (stream: RoomEventSource) => active() && source === stream;
  const freshness = (value: boolean) => {
    if (!active() || fresh === value) return;
    fresh = value;
    options.onFresh(value);
  };
  const lost = () => {
    if (watch !== undefined) cancel(watch);
    watch = undefined;
    freshness(false);
  };
  const calibrate = () => {
    if (active() && source?.readyState === 1) void clock.sample(controller.signal, options.request);
  };
  const receive = (stream: RoomEventSource, event: Event) => {
    if (!current(stream)) return;
    try {
      const message: unknown = JSON.parse((event as MessageEvent<string>).data);
      if (
        !message ||
        typeof message !== 'object' ||
        !('type' in message) ||
        message.type !== 'room'
      )
        return;
      const room = readRoomTimeline('room' in message ? message.room : null);
      if (
        !room ||
        room.code !== options.code ||
        'guildId' in room ||
        ('mode' in room && room.mode === 'discord') ||
        !Number.isSafeInteger(room.version) ||
        retiredEpochs.has(room.syncEpoch)
      )
        return;
      // Ignore wire extensions such as permissions or a pre-compensated sample timestamp.
      const next: Room = {
        code: room.code,
        name: room.name,
        current: room.current,
        queue: room.queue,
        playing: room.playing,
        position: room.position,
        version: room.version,
        serverTime: room.serverTime,
        viewers: room.viewers,
        isHost: false,
        expiresAt: room.expiresAt,
        playbackKey: room.playbackKey,
        syncSource: room.syncSource,
        syncEpoch: room.syncEpoch,
        syncValidForMs: room.syncValidForMs,
        startsAt: room.startsAt,
        radio: room.radio,
        approvalRequired: room.approvalRequired,
        requests: room.requests,
        history: room.history,
        voteCounts: room.voteCounts,
        skipVotes: room.skipVotes,
      };
      if (isOlderSnapshot(latest, next) || isDuplicateSnapshot(latest, next)) return;
      const changedEpoch = latest && latest.syncEpoch !== next.syncEpoch;
      if (changedEpoch) {
        // A restarted Core may have a completely different wall clock.
        clock.reset();
        calibrate();
      }
      const receivedAt = now();
      const age = clock.age(room.serverTime, room.syncValidForMs);
      const remaining = Math.min(ROOM_LEASE_MS, room.syncValidForMs) - age;
      if (remaining <= 0) {
        lost();
        return;
      }
      const accepted = options.onSnapshot({
        ...next,
        position:
          room.position +
          (room.playing ? elapsedPlayingMs(room.serverTime, room.startsAt, age) / 1000 : 0),
        syncSampledAt: room.serverTime,
        serverTime: room.serverTime + age,
        syncValidForMs: remaining,
      });
      if (!accepted || !current(stream)) return;
      if (changedEpoch && latest?.syncEpoch) {
        retiredEpochs.add(latest.syncEpoch);
        if (retiredEpochs.size > 16) retiredEpochs.delete(retiredEpochs.values().next().value!);
      }
      latest = next;
      expiresAt = receivedAt + remaining;
      if (watch !== undefined) cancel(watch);
      watch = schedule(
        () => {
          watch = undefined;
          if (current(stream) && now() >= expiresAt) lost();
        },
        Math.max(0, expiresAt - now()),
      );
      freshness(now() < expiresAt);
    } catch {
      // Invalid frames cannot update the timeline or prolong its lease.
    }
  };
  const reconnect = () => {
    if (active() && retry === undefined)
      retry = schedule(() => {
        retry = undefined;
        connect();
      }, 10000);
  };
  const connect = () => {
    if (!active() || !factory) return;
    try {
      const stream = factory('/api/realtime/stream?room=' + encodeURIComponent(options.code));
      source = stream;
      stream.addEventListener('open', () => {
        if (current(stream)) calibrate();
      });
      stream.addEventListener('message', (event) => receive(stream, event));
      stream.addEventListener('error', () => {
        if (!current(stream)) return;
        lost();
        // A CONNECTING source owns its native browser retry. CLOSED needs a replacement.
        if (stream.readyState === 2) {
          source = null;
          stream.close();
          clock.reset();
          reconnect();
        }
      });
    } catch {
      lost();
      reconnect();
    }
  };
  const measureLater = () => {
    measure = schedule(() => {
      measure = undefined;
      if (!active()) return;
      calibrate();
      measureLater();
    }, 10000);
  };
  const destroy = () => {
    if (stopped) return;
    stopped = true;
    fresh = false;
    options.signal.removeEventListener('abort', destroy);
    controller.abort();
    clock.reset();
    const stream = source;
    source = null;
    stream?.close();
    for (const timer of [retry, measure, watch]) if (timer !== undefined) cancel(timer);
    retry = measure = watch = undefined;
  };
  options.signal.addEventListener('abort', destroy, { once: true });
  if (options.signal.aborted) destroy();
  if (active() && factory && /^[A-Z0-9]{8}$/.test(options.code) && options.code !== 'DISCORD1') {
    connect();
    measureLater();
  }
  return {
    destroy,
    isFresh() {
      return active() && fresh && now() < expiresAt;
    },
  };
}
