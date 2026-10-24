import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConcertAudio, type ConcertAudioView } from '../src/lib/concert/concert-audio.ts';
import type { LiveState } from '../../../lib/live-room.ts';

const guildId = '123456789012345678',
  otherGuild = '223456789012345678',
  wall = 1000000;
const track = (concert = true) => ({
  id: 'concert0001',
  entryId: 'entry-1',
  title: concert ? 'Concert' : 'Private music',
  artist: 'Synthetic',
  duration: 180,
  image: '',
  live: false,
  embeddable: true,
  concert,
});
const frame = (extra: Partial<LiveState> = {}): LiveState => ({
  engine: 'gutta-krutt-core',
  epoch: 'epoch-1',
  sequence: 1,
  serverTime: wall,
  buffering: false,
  playbackKey: 'playback-1',
  guildId,
  roomCode: 'DISCORD1',
  ready: true,
  connected: true,
  playing: true,
  position: 20,
  volume: 50,
  current: track(),
  queue: [track()],
  queueRevision: 'queue-1',
  lastSeen: wall,
  online: true,
  ...extra,
});
class Stream {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readyState = 1;
  closed = false;
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(state: LiveState) {
    this.onmessage?.({ data: JSON.stringify({ type: 'state', state }) });
  }
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(explicit = true) {
  let mono = 0,
    clockAvailable = true;
  const streams: Stream[] = [],
    sourcePaths: string[] = [],
    fetches: string[] = [];
  const intervals: Array<() => void> = [],
    retries: Array<() => void> = [];
  const audio = createConcertAudio(guildId, explicit ? guildId : undefined, {
    monotonic: () => mono,
    wallTime: wall,
    fetch: (async (path: string) => {
      fetches.push(path);
      return clockAvailable
        ? Response.json({ serverTime: wall + mono })
        : new Response('', { status: 503 });
    }) as typeof fetch,
    source: (path) => {
      sourcePaths.push(path);
      const stream = new Stream();
      streams.push(stream);
      return stream as unknown as EventSource;
    },
    setInterval: ((callback: () => void) => {
      intervals.push(callback);
      return intervals.length;
    }) as unknown as typeof setInterval,
    clearInterval: (() => {}) as typeof clearInterval,
    setTimeout: ((callback: () => void) => {
      retries.push(callback);
      return retries.length;
    }) as unknown as typeof setTimeout,
    clearTimeout: (() => {}) as typeof clearTimeout,
  });
  let view!: ConcertAudioView;
  audio.subscribe((value) => {
    view = value;
  });
  return {
    audio,
    streams,
    intervals,
    retries,
    sourcePaths,
    fetches,
    get view() {
      return view;
    },
    setTime(value: number) {
      mono = value;
    },
    breakClock() {
      clockAvailable = false;
    },
  };
}

test('only calibrated Core frames start a scoped concert clock and advance from monotonic time', async () => {
  const f = fixture();
  try {
    await flush();
    assert.equal(f.audio.playback().playing, false);
    assert.deepEqual(f.sourcePaths, ['/api/realtime/stream?guildId=' + guildId]);
    f.streams[0].emit(frame());
    assert.equal(f.view.live, true);
    assert.equal(f.audio.playback().position, 20);
    f.setTime(1500);
    assert.equal(f.audio.playback().position, 21.5);
    assert.equal(f.audio.playback().playing, true);
    assert.deepEqual(f.fetches, ['/api/realtime/clock']);
  } finally {
    f.audio.destroy();
  }
});

test('default subscription stays unscoped on the wire but rejects another server', async () => {
  const f = fixture(false);
  try {
    await flush();
    assert.deepEqual(f.sourcePaths, ['/api/realtime/stream']);
    f.streams[0].emit(frame({ guildId: otherGuild }));
    assert.equal(f.view.room, null);
    assert.equal(f.audio.playback().playing, false);
    f.streams[0].emit(frame());
    assert.equal((f.view as ConcertAudioView).room?.guildId, guildId);
  } finally {
    f.audio.destroy();
  }
});

test('expired, duplicate and out-of-order frames cannot rewind or extend the audio lease', async () => {
  const f = fixture();
  try {
    await flush();
    f.streams[0].emit(frame({ sequence: 2 }));
    f.setTime(5000);
    f.streams[0].emit(frame({ sequence: 1, position: 2 }));
    assert.equal(f.audio.playback().position, 25);
    f.streams[0].emit(frame({ sequence: 2 }));
    f.setTime(7000);
    assert.equal(f.audio.playback().playing, false);
    f.intervals[1]();
    assert.equal(f.view.live, false);
    assert.equal(f.view.room, null);
    f.streams[0].emit(frame({ sequence: 3 }));
    assert.equal(f.view.live, false);
    f.streams[0].emit(frame({ sequence: 4, serverTime: wall + 7000, position: 27 }));
    assert.equal(f.audio.playback().playing, true);
    assert.equal(f.audio.playback().position, 27);
  } finally {
    f.audio.destroy();
  }
});

test('clock calibration failure never authorizes playback from a stream or bridge timestamp', async () => {
  const f = fixture();
  try {
    await flush();
    f.streams[0].emit(frame());
    assert.equal(f.audio.playback().playing, true);
    f.breakClock();
    f.setTime(61000);
    f.intervals[0]();
    await flush();
    assert.equal(f.view.live, false);
    f.streams[0].emit(frame({ sequence: 2, serverTime: wall + 61000 }));
    assert.equal(f.audio.playback().playing, false);
  } finally {
    f.audio.destroy();
  }
});

test('ordinary Discord tracks are absent from live current and queue and cannot play locally', async () => {
  const f = fixture();
  try {
    await flush();
    f.streams[0].emit(frame({ current: track(false), queue: [track(false)] }));
    assert.equal(f.view.room?.current, null);
    assert.deepEqual(f.view.room?.queue, []);
    assert.equal(f.view.state?.current, null);
    assert.equal(f.audio.playback().playing, false);
  } finally {
    f.audio.destroy();
  }
});

test('disconnect and teardown stop local audio and late stream messages cannot restore it', async () => {
  const f = fixture();
  await flush();
  const stream = f.streams[0];
  stream.emit(frame());
  assert.equal(f.audio.playback().playing, true);
  stream.onerror?.();
  assert.equal(f.audio.playback().playing, false);
  stream.emit(frame({ sequence: 2, playing: false, position: 35 }));
  assert.equal(f.audio.playback().playing, false);
  assert.equal(f.audio.playback().position, 35);
  f.audio.destroy();
  assert.equal(stream.closed, true);
  stream.emit(frame({ sequence: 3, position: 50 }));
  assert.equal(f.audio.playback().playing, false);
  assert.equal(f.audio.playback().position, 0);
});

test('a new engine epoch pauses audio until the new clock is calibrated', async () => {
  const f = fixture();
  try {
    await flush();
    f.streams[0].emit(frame());
    f.streams[0].emit(frame({ epoch: 'epoch-2', sequence: 1, position: 4 }));
    assert.equal(f.view.live, false);
    assert.equal(f.audio.playback().playing, false);
    await flush();
    f.streams[0].emit(frame({ epoch: 'epoch-2', sequence: 2, position: 5 }));
    assert.equal(f.view.room?.syncEpoch, 'epoch-2');
    assert.equal(f.audio.playback().position, 5);
  } finally {
    f.audio.destroy();
  }
});

test('buffering, disconnected voice and deliberate pause never start browser playback', async () => {
  const f = fixture();
  try {
    await flush();
    f.streams[0].emit(frame({ buffering: true }));
    assert.equal(f.audio.playback().playing, false);
    f.streams[0].emit(frame({ sequence: 2, connected: false }));
    assert.equal(f.audio.playback().playing, false);
    f.streams[0].emit(frame({ sequence: 3, playing: false }));
    assert.equal(f.audio.playback().playing, false);
    assert.deepEqual(f.fetches, ['/api/realtime/clock']);
  } finally {
    f.audio.destroy();
  }
});
