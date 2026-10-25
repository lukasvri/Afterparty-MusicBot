import { LiveClock } from '../../../../../lib/live-clock.ts';
import {
  acceptsLiveState,
  DISCORD_LIVE_LEASE_MS,
  liveRoom,
  readLiveState,
  type LiveState,
} from '../../../../../lib/live-room.ts';
import { playbackTarget } from '../../../../../lib/playback-sync.ts';
import type { Room } from '../../../../../lib/types.ts';

export type ConcertAudioView = {
  room: Room | null;
  state: LiveState | null;
  live: boolean;
  phase: string;
};
export type ConcertAudioOptions = {
  source?: (path: string) => EventSource;
  fetch?: typeof fetch;
  monotonic?: () => number;
  wallTime?: number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
};

/** Only calibrated, fresh Core SSE frames can authorize local concert audio. */
export function createConcertAudio(
  guildId: string,
  streamGuildId: string | undefined,
  options: ConcertAudioOptions = {},
) {
  const monotonic = options.monotonic ?? (() => performance.now());
  const clock = new LiveClock(monotonic, options.wallTime ?? Date.now());
  const sourceFactory =
    options.source ??
    (typeof EventSource !== 'undefined' ? (path: string) => new EventSource(path) : null);
  const scheduleInterval = options.setInterval ?? globalThis.setInterval;
  const cancelInterval = options.clearInterval ?? globalThis.clearInterval;
  const scheduleTimeout = options.setTimeout ?? globalThis.setTimeout;
  const cancelTimeout = options.clearTimeout ?? globalThis.clearTimeout;
  const listeners = new Set<(view: ConcertAudioView) => void>();
  const controller = new AbortController();
  let view: ConcertAudioView = {
    room: null,
    state: null,
    live: false,
    phase: 'Connecting shared clock…',
  };
  let latest: LiveState | null = null,
    source: EventSource | null = null;
  let expiresAt = 0,
    receivedAt = 0,
    calibrated = false,
    calibrationAt = -Infinity;
  let closed = false,
    retry: ReturnType<typeof setTimeout> | undefined;
  let measure: ReturnType<typeof setInterval> | undefined,
    watch: ReturnType<typeof setInterval> | undefined;
  const publish = (change: Partial<ConcertAudioView>) => {
    if (closed) return;
    view = { ...view, ...change };
    listeners.forEach((listener) => listener(view));
  };
  const suspend = (phase = 'Reconnecting shared clock…') => {
    expiresAt = 0;
    publish({ room: null, state: null, live: false, phase });
  };
  const sample = async () => {
    const trip = await clock.sample(controller.signal, options.fetch);
    if (closed) return;
    if (trip !== null) {
      calibrated = true;
      calibrationAt = monotonic();
    } else if (monotonic() - calibrationAt >= 60000) {
      calibrated = false;
      suspend('Shared clock unavailable. Audio is paused.');
    }
  };
  const reconnect = () => {
    cancelTimeout(retry);
    if (!closed)
      retry = scheduleTimeout(() => {
        void connect();
      }, 10000);
  };
  const connect = async () => {
    if (closed || !sourceFactory) return;
    await sample();
    if (closed) return;
    try {
      const stream = sourceFactory(
        '/api/realtime/stream' + (streamGuildId ? '?guildId=' + streamGuildId : ''),
      );
      source = stream;
      stream.onopen = () => {
        if (!closed && source === stream) void sample();
      };
      stream.onmessage = (event) => {
        if (closed || source !== stream) return;
        try {
          const message = JSON.parse(event.data);
          const state = message.type === 'state' ? readLiveState(message.state) : null;
          if (!state || !acceptsLiveState(latest, state, guildId)) return;
          if (latest && latest.epoch !== state.epoch) {
            clock.reset();
            calibrated = false;
            latest = state;
            suspend('Reconnecting shared clock…');
            void sample();
            return;
          }
          if (!calibrated || monotonic() - calibrationAt >= 60000) {
            suspend('Calibrating shared clock…');
            void sample();
            return;
          }
          const age = clock.age(state.serverTime, DISCORD_LIVE_LEASE_MS);
          if (age >= DISCORD_LIVE_LEASE_MS) {
            suspend('The shared clock expired. Audio is paused.');
            return;
          }
          latest = state;
          const current = state.current?.concert === true ? state.current : null;
          const safe: LiveState = {
            ...state,
            current,
            queue: state.queue.filter((video) => video.concert === true),
            playing: Boolean(current) && state.playing,
            playbackKey: current ? state.playbackKey : null,
            position: current ? state.position : 0,
          };
          const room = liveRoom(
            {
              ...safe,
              // Hold the local clock without rewriting the shared transport intent.
              buffering: state.buffering || !state.ready || !state.connected,
            },
            age,
          );
          receivedAt = monotonic();
          expiresAt = receivedAt + DISCORD_LIVE_LEASE_MS - age;
          publish({ room, state: safe, live: true, phase: 'Live shared clock' });
        } catch {
          suspend('The shared clock sent invalid data. Audio is paused.');
        }
      };
      stream.onerror = () => {
        if (closed || source !== stream) return;
        suspend();
        if (stream.readyState === 2) {
          stream.close();
          source = null;
          reconnect();
        }
      };
    } catch {
      suspend('Shared clock unavailable. Audio is paused.');
      reconnect();
    }
  };
  if (sourceFactory) {
    void connect();
    measure = scheduleInterval(() => {
      void sample();
    }, 10000);
    watch = scheduleInterval(() => {
      if (view.live && monotonic() >= expiresAt)
        suspend('The shared clock expired. Audio is paused.');
    }, 250);
  } else publish({ phase: 'Shared clock unavailable. Audio is paused.' });
  return {
    subscribe(listener: (value: ConcertAudioView) => void) {
      listeners.add(listener);
      listener(view);
      return () => {
        listeners.delete(listener);
      };
    },
    playback() {
      if (closed || !view.room || !view.live) return { position: 0, playing: false, stale: true };
      const target = playbackTarget(view.room, receivedAt, monotonic());
      return monotonic() >= expiresAt
        ? { ...target, playing: false, stale: true }
        : {
            ...target,
            playing:
              target.playing &&
              Boolean(view.state?.ready && view.state.connected && !view.state.buffering),
          };
    },
    suspend,
    destroy() {
      closed = true;
      view = { room: null, state: null, live: false, phase: 'Disconnected' };
      controller.abort();
      clock.reset();
      source?.close();
      source = null;
      cancelTimeout(retry);
      if (measure !== undefined) cancelInterval(measure);
      if (watch !== undefined) cancelInterval(watch);
      listeners.clear();
    },
  };
}
