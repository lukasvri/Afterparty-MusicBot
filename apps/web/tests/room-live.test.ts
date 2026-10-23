import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Room } from '../../../lib/types.ts';
import type { RoomTimeline } from '../../../services/core/src/protocol.ts';
import { createRoomLive, type RoomLiveOptions } from '../src/lib/room-live.ts';

const timeline = (change: Partial<RoomTimeline> = {}): RoomTimeline => ({
  code: 'ROOM0001',
  name: 'Synthetic private room',
  current: {
    id: 'current0001',
    title: 'Synthetic song',
    artist: 'Synthetic artist',
    image: '',
    duration: 180,
    live: false,
    embeddable: true,
  },
  queue: [],
  playing: true,
  position: 12,
  version: 1,
  serverTime: 100000,
  viewers: 1,
  isHost: false,
  expiresAt: 999999,
  syncSource: 'live',
  syncEpoch: 'epoch-a',
  syncValidForMs: 5000,
  ...change,
});
class Source extends EventTarget {
  readyState = 0;
  closes = 0;
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  frame(room: unknown) {
    this.raw(JSON.stringify({ type: 'room', room }));
  }
  raw(data: string) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
  error(state: number) {
    this.readyState = state;
    this.dispatchEvent(new Event('error'));
  }
  close() {
    this.readyState = 2;
    this.closes++;
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(overrides: Partial<RoomLiveOptions> = {}) {
  let time = 0,
    serial = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const callbacks: (() => void)[] = [];
  const sources: Source[] = [];
  const paths: string[] = [];
  const snapshots: Room[] = [];
  const freshness: boolean[] = [];
  const requests: { path: RequestInfo | URL; init?: RequestInit }[] = [];
  const controller = new AbortController();
  const live = createRoomLive({
    code: 'ROOM0001',
    signal: controller.signal,
    onSnapshot: (room) => {
      snapshots.push(room);
      return true;
    },
    onFresh: (fresh) => freshness.push(fresh),
    eventSource: (path) => {
      paths.push(path);
      const source = new Source();
      sources.push(source);
      return source;
    },
    request: async (path, init) => {
      requests.push({ path, init });
      return Response.json({ serverTime: 100000 });
    },
    now: () => time,
    setTimeout: ((callback: () => void, delay: number) => {
      const id = ++serial;
      callbacks.push(callback);
      timers.set(id, { at: time + delay, callback });
      return id;
    }) as unknown as typeof setTimeout,
    clearTimeout: ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout,
    ...overrides,
  });
  return {
    live,
    sources,
    snapshots,
    freshness,
    requests,
    paths,
    controller,
    timers,
    callbacks,
    advance(ms: number) {
      const end = time + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      time = end;
    },
    elapseWithoutTimers(ms: number) {
      time += ms;
    },
  };
}

test('validated private timelines get bounded leases; malformed, older and duplicate frames never renew them', () => {
  const f = fixture(),
    source = f.sources[0];
  assert.deepEqual(f.paths, ['/api/realtime/stream?room=ROOM0001']);
  assert.equal(f.live.isFresh(), false);
  source.frame(timeline());
  assert.equal(f.live.isFresh(), true);
  assert.deepEqual(f.freshness, [true]);
  f.advance(4000);
  source.raw('{');
  source.raw('null');
  source.raw(JSON.stringify({ type: 'state', room: timeline({ version: 2 }) }));
  for (const invalid of [
    timeline(),
    timeline({ position: 200 }),
    timeline({ version: 1, serverTime: 99999 }),
    timeline({ version: 0 }),
    timeline({ code: 'ROOM0002' }),
    timeline({ syncValidForMs: 5001 }),
    timeline({ current: { ...timeline().current!, duration: -1 } }),
    { ...timeline(), guildId: '111111111111111111' },
    { ...timeline(), guildId: '' },
    { ...timeline(), mode: 'discord' },
  ])
    source.frame(invalid);
  assert.equal(f.snapshots.length, 1);
  f.advance(1000);
  assert.equal(f.live.isFresh(), false);
  assert.deepEqual(f.freshness, [true, false]);
  source.frame(timeline({ version: 2, serverTime: 101000, syncValidForMs: 1200 }));
  f.advance(1199);
  assert.equal(f.live.isFresh(), true);
  f.advance(1);
  assert.equal(f.live.isFresh(), false);
  f.live.destroy();
  assert.equal(f.timers.size, 0);
});

test('shared clock compensates delivery, respects scheduled starts and discards permission extensions', async () => {
  const f = fixture(),
    source = f.sources[0];
  source.open();
  await settle();
  assert.equal(f.requests[0].path, '/api/realtime/clock');
  assert.equal(f.requests[0].init?.cache, 'no-store');
  f.advance(1000);
  source.frame({
    ...timeline({ startsAt: 100300 }),
    isHost: true,
    isOwner: true,
    syncSampledAt: 1,
  });
  assert.equal(f.snapshots[0].position, 12.7);
  assert.equal(f.snapshots[0].serverTime, 101000);
  assert.equal(f.snapshots[0].syncSampledAt, 100000);
  assert.equal(f.snapshots[0].syncValidForMs, 4000);
  assert.equal(f.snapshots[0].isHost, false);
  assert.equal(f.snapshots[0].isOwner, undefined);
  f.advance(500);
  source.frame(timeline({ version: 2, playing: false }));
  assert.equal(f.snapshots[1].position, 12);
  source.frame(timeline({ version: 3, serverTime: 90000 }));
  assert.equal(f.snapshots.length, 2, 'expired calibrated samples are not delivered');
  assert.equal(f.live.isFresh(), false);
  f.live.destroy();
});

test('parent rejection cannot renew a lease; querying expiry is pure until the watchdog runs', () => {
  let accepted = true;
  const f = fixture({ onSnapshot: () => accepted }),
    source = f.sources[0];
  source.frame(timeline());
  f.advance(4000);
  accepted = false;
  source.frame(timeline({ version: 2, serverTime: 101000 }));
  f.elapseWithoutTimers(1000);
  assert.equal(f.live.isFresh(), false);
  assert.equal(f.live.isFresh(), false);
  assert.deepEqual(f.freshness, [true], 'queries never synchronously publish freshness loss');
  source.frame(timeline({ version: 3 }));
  assert.equal(f.live.isFresh(), false);
  f.advance(0);
  assert.deepEqual(f.freshness, [true, false], 'watchdog publishes loss exactly once');
  f.live.destroy();
});

test('epoch rollover resets calibration immediately and fences delayed frames from retired epochs', async () => {
  const f = fixture(),
    source = f.sources[0];
  source.open();
  await settle();
  source.frame(timeline({ version: 8 }));
  f.advance(100);
  source.frame(timeline({ syncEpoch: 'epoch-b', serverTime: 1 }));
  assert.equal(f.snapshots.length, 2);
  assert.equal(f.snapshots[1].serverTime, 1, 'old clock offset cannot expire the new epoch');
  assert.equal(f.snapshots[1].syncValidForMs, 5000);
  source.frame(timeline({ version: 99, serverTime: 110000 }));
  source.frame(timeline({ syncEpoch: 'epoch-b', serverTime: 1 }));
  assert.equal(f.snapshots.length, 2);
  assert.equal(f.requests.length, 2, 'new epoch starts a new calibration');
  f.live.destroy();
});

test('browser retries CONNECTING sources; terminal CLOSED replaces only after ten seconds and fences old sources', () => {
  const f = fixture(),
    source = f.sources[0];
  source.frame(timeline());
  source.error(0);
  assert.equal(f.live.isFresh(), false);
  f.advance(10000);
  assert.equal(f.sources.length, 1);
  assert.equal(source.closes, 0);
  source.frame(timeline({ version: 2 }));
  assert.equal(f.live.isFresh(), true);
  source.error(2);
  source.error(2);
  source.frame(timeline({ version: 100 }));
  source.open();
  assert.equal(f.snapshots.length, 2);
  assert.equal(f.requests.length, 0, 'retired open events cannot start calibration');
  f.advance(9999);
  assert.equal(f.sources.length, 1);
  f.advance(1);
  assert.equal(f.sources.length, 2);
  source.frame(timeline({ version: 101 }));
  f.sources[1].frame(timeline({ version: 3 }));
  assert.equal(f.snapshots.length, 3);
  assert.equal(f.snapshots[2].version, 3);
  f.live.destroy();
});

test('calibration never overlaps, epoch reset cancels old samples, and late completions cannot poison the clock', async () => {
  const pending: ReturnType<typeof deferred<Response>>[] = [];
  const signals: AbortSignal[] = [];
  const f = fixture({
    request: async (_path, init) => {
      signals.push(init!.signal!);
      const request = deferred<Response>();
      pending.push(request);
      return request.promise;
    },
  });
  const source = f.sources[0];
  source.open();
  source.open();
  source.frame(timeline());
  f.advance(10000);
  assert.equal(pending.length, 1);
  source.frame(timeline({ syncEpoch: 'epoch-b', serverTime: 1000 }));
  assert.equal(signals[0].aborted, true);
  assert.equal(pending.length, 2);
  pending[1].resolve(Response.json({ serverTime: 1000 }));
  pending[0].resolve(Response.json({ serverTime: 999999999 }));
  await settle();
  f.advance(100);
  source.frame(timeline({ syncEpoch: 'epoch-b', serverTime: 1001, version: 2 }));
  assert.equal(f.snapshots.at(-1)?.syncValidForMs, 4901);
  f.advance(9900);
  assert.equal(pending.length, 3, 'periodic calibration continues after the completed sample');
  f.controller.abort();
  assert.equal(signals[2].aborted, true);
  const count = f.snapshots.length,
    statusCount = f.freshness.length;
  pending[2].resolve(Response.json({ serverTime: 1000 }));
  await settle();
  source.open();
  source.frame(timeline({ version: 100 }));
  source.error(2);
  f.callbacks.forEach((callback) => callback());
  assert.equal(f.snapshots.length, count);
  assert.equal(f.freshness.length, statusCount, 'abort and late callbacks publish nothing');
  assert.equal(pending.length, 3);
  assert.equal(f.live.isFresh(), false);
  assert.equal(f.timers.size, 0);
  assert.equal(source.closes, 1);
});

test('destroy cancels a terminal retry and teardown publishes nothing, including late source events', () => {
  const f = fixture(),
    source = f.sources[0];
  source.frame(timeline());
  f.live.destroy();
  f.live.destroy();
  source.frame(timeline({ version: 99 }));
  source.error(2);
  source.open();
  f.callbacks.forEach((callback) => callback());
  assert.deepEqual(f.freshness, [true]);
  assert.equal(f.snapshots.length, 1);
  assert.equal(f.sources.length, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(source.closes, 1);
  const retry = fixture();
  retry.sources[0].error(2);
  retry.live.destroy();
  retry.advance(20000);
  assert.equal(retry.sources.length, 1);
});

test('already aborted sessions, invalid room codes and SSR without EventSource remain inert', () => {
  const controller = new AbortController();
  controller.abort();
  const aborted = fixture({ signal: controller.signal });
  assert.equal(aborted.sources.length, 0);
  assert.equal(aborted.timers.size, 0);
  const invalid = fixture({ code: 'DISCORD1' });
  assert.equal(invalid.sources.length, 0);
  assert.equal(invalid.timers.size, 0);
  invalid.live.destroy();
  assert.equal(typeof EventSource, 'undefined');
  const ssr = fixture({ eventSource: undefined });
  assert.equal(ssr.sources.length, 0);
  assert.equal(ssr.timers.size, 0);
  assert.equal(ssr.live.isFresh(), false);
  ssr.live.destroy();
});
