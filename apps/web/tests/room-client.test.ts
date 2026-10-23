import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Room } from '../../../lib/types.ts';
import type { RoomClientOptions, RoomClientState } from '../src/lib/room-client.ts';
import type { RoomLiveOptions } from '../src/lib/room-live.ts';

// The shared browser helper predates Node's explicit TypeScript extensions.
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/lib/browser-api.ts') && specifier === './browser-storage')
      return next('./browser-storage.ts', context);
    return next(specifier, context);
  },
});
const { createRoomClient } = await import('../src/lib/room-client.ts');
hook.deregister();

const room = (code = 'ROOM0001', version = 1, isHost = true): Room => ({
  code,
  version,
  name: 'Synthetic room',
  current: {
    id: 'current0001',
    title: 'Synthetic song',
    artist: 'Synthetic artist',
    duration: 180,
    image: '',
    live: false,
    embeddable: true,
  },
  queue: [],
  playing: false,
  position: 12,
  serverTime: 1000 + version,
  viewers: 1,
  isHost,
  expiresAt: 999999,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(
  fetcher: (path: string, init: RequestInit) => Promise<Response>,
  options: Partial<RoomClientOptions> = {},
) {
  const data = new Map<string, string>([['afterparty-visitor', 'a'.repeat(32)]]);
  const calls: { path: string; init: RequestInit }[] = [];
  const scheduled: (() => void)[] = [];
  const client = createRoomClient({
    request: async <T>(path: string, init: RequestInit = {}): Promise<T> => {
      calls.push({ path, init });
      const response = await fetcher(path, init),
        result = (await response.json()) as T & { error?: string };
      if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
      return result;
    },
    storage: {
      get: (key) => data.get(key) ?? null,
      set: (key, value) => {
        data.set(key, value);
        return true;
      },
    },
    now: () => 100,
    setTimeout: ((callback: () => void) => {
      scheduled.push(callback);
      return scheduled.length;
    }) as unknown as typeof setTimeout,
    clearTimeout: (() => {}) as typeof clearTimeout,
    ...options,
  });
  let state!: RoomClientState;
  client.subscribe((next) => {
    state = next;
  });
  return {
    client,
    data,
    calls,
    scheduled,
    get state() {
      return state;
    },
  };
}
const json = (value: unknown, status = 200) => Response.json(value, { status });

test('a delayed room response cannot cross a room switch, even when transport ignores abort', async () => {
  const slow = deferred<Response>();
  const f = fixture(async (path) =>
    path.endsWith('ROOM0001') ? slow.promise : json(room('ROOM0002')),
  );
  const first = f.client.join('room0001');
  assert.equal(await f.client.join('ROOM0002'), true);
  assert(f.calls[0].init.signal?.aborted);
  slow.resolve(json(room('ROOM0001', 99)));
  assert.equal(await first, false);
  assert.equal((f.state as RoomClientState).room?.code, 'ROOM0002');
  f.client.destroy();
});

test('private creation saves ownership and reads it back with existing visitor and host headers', async () => {
  const token = 'b'.repeat(64);
  const f = fixture(async (path, init) => {
    if (path === '/api/rooms') {
      assert.deepEqual(JSON.parse(String(init.body)), { name: 'Private evening', isPublic: false });
      return json({ room: room('ROOM0001', 1, false), token });
    }
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${token}`);
    assert.equal(new Headers(init.headers).get('X-Afterparty-Visitor'), 'a'.repeat(32));
    return json(room());
  });
  assert.equal(await f.client.create(' Private evening '), true);
  assert.equal(f.data.get('afterparty-host:ROOM0001'), token);
  assert.equal(f.state.room?.isHost, true);
  f.client.destroy();
});

test('guests may add but cannot issue host transport commands; Discord snapshots are rejected', async () => {
  const f = fixture(async (_path, init) => {
    if (init.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), {
        action: 'add',
        version: 1,
        videoId: 'newtrack001',
      });
      return json({ room: room('ROOM0001', 2, false) });
    }
    return json(room('ROOM0001', 1, false));
  });
  await f.client.join('ROOM0001');
  assert.equal(await f.client.control('play'), false);
  assert.match(f.state.error, /host/);
  assert.equal(f.calls.length, 1);
  assert.equal(await f.client.add('newtrack001'), true);
  f.client.destroy();
  const discord = fixture(async () =>
    json({ ...room(), guildId: '111111111111111111', mode: 'discord' }),
  );
  assert.equal(await discord.client.join('ROOM0001'), false);
  assert.equal(discord.state.room, null);
  assert.equal(discord.state.connection, 'reconnecting');
  discord.client.destroy();
});

test('a mutation invalidates an older poll and suspends refresh until its revision is accepted', async () => {
  const poll = deferred<Response>(),
    command = deferred<Response>();
  let reads = 0;
  const f = fixture(async (_path, init) =>
    init.method === 'POST' ? command.promise : ++reads === 1 ? json(room()) : poll.promise,
  );
  await f.client.join('ROOM0001');
  const refreshing = f.client.refresh();
  const changing = f.client.control('pause');
  await f.client.refresh();
  assert.equal(reads, 2);
  assert.equal(f.state.busy, true);
  assert.deepEqual(JSON.parse(String(f.calls.at(-1)?.init.body)), { action: 'pause', version: 1 });
  command.resolve(json({ room: room('ROOM0001', 3) }));
  assert.equal(await changing, true);
  poll.resolve(json(room('ROOM0001', 2)));
  await refreshing;
  assert.equal(f.state.room?.version, 3);
  assert.equal(f.state.busy, false);
  f.client.destroy();
});

test('409 refreshes current room without replaying the command and retains actionable error', async () => {
  let reads = 0;
  const f = fixture(async (_path, init) =>
    init.method === 'POST'
      ? json({ error: 'The queue changed.' }, 409)
      : json(room('ROOM0001', ++reads)),
  );
  await f.client.join('ROOM0001');
  assert.equal(await f.client.control('next'), false);
  assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 1);
  assert.equal(f.state.room?.version, 2);
  assert.equal(f.state.error, 'The queue changed.');
  f.client.destroy();
});

test('older polling snapshots preserve the newer clock while updating permissions', async () => {
  let reads = 0;
  const f = fixture(async () =>
    json(
      ++reads === 1
        ? room('ROOM0001', 5)
        : { ...room('ROOM0001', 2, false), position: 0, viewers: 3 },
    ),
  );
  await f.client.join('ROOM0001');
  await f.client.refresh();
  assert.equal(f.state.room?.version, 5);
  assert.equal(f.state.room?.position, 12);
  assert.equal(f.state.room?.isHost, false);
  assert.equal(f.state.room?.viewers, 3);
  f.client.destroy();
});

test('seek sends server position and revision; read failures stop local playback without transport commands', async () => {
  let reads = 0;
  const f = fixture(async (_path, init) => {
    if (init.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), { action: 'seek', version: 1, position: 42 });
      return json({ room: { ...room('ROOM0001', 2), position: 42, playing: true } });
    }
    reads++;
    return reads === 2
      ? json({ error: 'Synthetic connection loss' }, 503)
      : json({ ...room('ROOM0001', reads === 1 ? 1 : 3), playing: true });
  });
  await f.client.join('ROOM0001');
  assert.equal(await f.client.control('seek', 42), true);
  assert.equal(f.client.playback()?.position, 42);
  await f.client.refresh();
  assert.equal(f.state.connection, 'reconnecting');
  assert.equal(f.client.playback()?.playing, false);
  assert.equal(f.client.playback()?.stale, true);
  await f.client.refresh();
  assert.equal(f.state.connection, 'connected');
  assert.equal(f.client.playback()?.playing, true);
  assert.equal(f.state.error, '');
  assert.equal(
    f.calls.filter((call) => call.init.method === 'POST').length,
    1,
    'reconnecting never sends a playback command',
  );
  f.client.destroy();
});

test('late search errors and destroyed sessions cannot overwrite current state or issue polling', async () => {
  const oldSearch = deferred<Response>();
  const f = fixture(async (path) =>
    path.includes('q=old')
      ? oldSearch.promise
      : path.startsWith('/api/search')
        ? json({ videos: [room().current] })
        : json(room()),
  );
  await f.client.join('ROOM0001');
  const retired = f.client.search('old');
  await f.client.search('new');
  oldSearch.resolve(json({ error: 'Retired search failed' }, 503));
  await retired;
  assert.equal(f.state.query, 'new');
  assert.equal(f.state.results.length, 1);
  assert.equal(f.state.error, '');
  const count = f.calls.length;
  f.client.destroy();
  f.scheduled.forEach((callback) => callback());
  await f.client.refresh();
  await f.client.search('another');
  assert.equal(await f.client.join('ROOM0002'), false);
  assert.equal(f.calls.length, count);
});

test('editing a query cancels its request and retires late results before the next search', async () => {
  const pending = deferred<Response>();
  const f = fixture(async (path) =>
    path.includes('q=old')
      ? pending.promise
      : path.startsWith('/api/search')
        ? json({ videos: [room().current] })
        : json(room()),
  );
  await f.client.join('ROOM0001');
  const search = f.client.search('old');
  const signal = f.calls.at(-1)?.init.signal;
  f.client.cancelSearch();
  assert.equal(signal?.aborted, true);
  assert.equal(f.state.searching, false);
  assert.equal(f.state.query, '');
  await f.client.search('new');
  pending.resolve(json({ error: 'Retired search failed' }, 503));
  await search;
  assert.equal(f.state.query, 'new');
  assert.equal(f.state.results.length, 1);
  assert.equal(f.state.error, '');
  f.client.destroy();
});

test('leave cancels reads, searches and polling, clears the view and preserves ownership for a later join', async () => {
  const pendingRead = deferred<Response>(),
    pendingSearch = deferred<Response>();
  let reads = 0;
  const f = fixture(async (path) => {
    if (path.startsWith('/api/search')) return pendingSearch.promise;
    if (path.endsWith('ROOM0002')) return json(room('ROOM0002'));
    return ++reads === 1 ? json(room()) : pendingRead.promise;
  });
  const savedToken = 'c'.repeat(64);
  f.data.set('afterparty-host:ROOM0001', savedToken);
  await f.client.join('ROOM0001');
  const oldRead = f.client.refresh(),
    oldSearch = f.client.search('retiring search');
  const signals = f.calls.slice(-2).map((call) => call.init.signal);
  f.client.leave();
  assert(signals.every((signal) => signal?.aborted));
  assert.deepEqual(f.state, {
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
  assert.equal(f.client.playback(), null);
  assert.equal(f.data.get('afterparty-host:ROOM0001'), savedToken);
  const requestsAfterLeave = f.calls.length;
  f.scheduled.forEach((callback) => callback());
  await f.client.refresh();
  assert.equal(f.calls.length, requestsAfterLeave, 'retired polling cannot issue requests');
  assert.equal(await f.client.join('ROOM0002'), true);
  pendingRead.resolve(json(room('ROOM0001', 99)));
  pendingSearch.resolve(json({ error: 'Retired search failed' }, 503));
  await Promise.all([oldRead, oldSearch]);
  assert.equal((f.state as RoomClientState).room?.code, 'ROOM0002');
  assert.equal(f.state.error, '');
  assert.equal(f.state.connection, 'connected');
  f.client.destroy();
});

test('leave retires a pending command even when the same client joins another room', async () => {
  const pending = deferred<Response>();
  const f = fixture(async (path, init) =>
    init.method === 'POST'
      ? pending.promise
      : json(room(path.endsWith('ROOM0002') ? 'ROOM0002' : 'ROOM0001')),
  );
  await f.client.join('ROOM0001');
  const command = f.client.control('next');
  assert.equal(f.state.busy, true);
  const commandSignal = f.calls.at(-1)?.init.signal;
  f.client.leave();
  assert(commandSignal?.aborted);
  assert.equal(f.state.busy, false);
  await f.client.join('ROOM0002');
  pending.resolve(json({ room: room('ROOM0001', 99) }));
  assert.equal(await command, false);
  assert.equal(f.state.room?.code, 'ROOM0002');
  assert.equal(f.state.busy, false);
  f.client.destroy();
});

test('disconnected clients reject next and additions without POST, then a new joined session can control its room', async () => {
  let firstReads = 0;
  const f = fixture(async (path, init) => {
    if (path.endsWith('ROOM0001'))
      return ++firstReads === 1 ? json(room()) : json({ error: 'Synthetic disconnect' }, 503);
    return json(init.method === 'POST' ? { room: room('ROOM0002', 2) } : room('ROOM0002'));
  });
  await f.client.join('ROOM0001');
  await f.client.refresh();
  assert.equal(f.state.connection, 'reconnecting');
  assert.equal(await f.client.control('next'), false);
  assert.equal(await f.client.add('newtrack001'), false);
  assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 0);
  assert.equal(f.state.error, 'Synthetic disconnect');
  await f.client.join('ROOM0002');
  assert.equal(await f.client.control('next'), true);
  const posts = f.calls.filter((call) => call.init.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, '/api/rooms/ROOM0002');
  assert.equal(f.state.room?.version, 2);
  f.client.destroy();
});

function liveHarness() {
  const sources: { options: RoomLiveOptions; fresh: boolean; closed: number }[] = [];
  return {
    sources,
    live: ((options: RoomLiveOptions) => {
      const source = { options, fresh: false, closed: 0 };
      sources.push(source);
      return {
        isFresh: () => source.fresh,
        destroy() {
          source.closed++;
        },
      };
    }) as NonNullable<RoomClientOptions['live']>,
    send(snapshot: Room, index = sources.length - 1) {
      const source = sources[index];
      if (!source.options.onSnapshot(snapshot)) return false;
      source.fresh = true;
      source.options.onFresh(true);
      return true;
    },
  };
}
const liveRoom = (version: number, code = 'ROOM0001'): Room => ({
  ...room(code, version),
  syncSource: 'live',
  syncEpoch: 'synthetic-core',
  syncValidForMs: 5000,
  syncSampledAt: 1000 + version,
});

test('live updates retain authenticated permissions and old polls update rights without replacing the live clock', async () => {
  const live = liveHarness();
  let reads = 0;
  const f = fixture(
    async (_path, init) =>
      init.method === 'POST'
        ? json({ room: liveRoom(6) })
        : json({ ...room('ROOM0001', 1, ++reads === 1), isOwner: reads === 1 }),
    { live: live.live },
  );
  await f.client.join('ROOM0001');
  assert.equal(
    live.send({ ...liveRoom(5), isHost: false, isOwner: false, viewers: 0, position: 42 }),
    true,
  );
  assert.equal(f.state.live, true);
  assert.equal(f.state.room?.isHost, true);
  assert.equal(f.state.room?.isOwner, true);
  assert.equal(f.state.room?.viewers, 1, 'Core stream counts do not overwrite room presence');
  await f.client.refresh();
  assert.equal(f.state.room?.version, 5);
  assert.equal(f.state.room?.position, 42);
  assert.equal(f.state.room?.isHost, false);
  assert.equal(f.state.room?.isOwner, false);
  assert.equal(
    live.send({ ...liveRoom(5), isHost: true }),
    false,
    'duplicates do not renew a lease',
  );
  assert.equal(live.send({ ...liveRoom(6), isHost: true, isOwner: true }), true);
  assert.equal(f.state.room?.isHost, false, 'a public stream cannot promote a guest');
  assert.equal(f.state.room?.isOwner, false);
  assert.equal(await f.client.control('play'), false);
  assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 0);
  f.client.destroy();
});

test('a newer live timeline wins over a pending command reply without replaying the command', async () => {
  const live = liveHarness(),
    pending = deferred<Response>();
  const f = fixture(
    async (_path, init) => (init.method === 'POST' ? pending.promise : json(liveRoom(1))),
    { live: live.live },
  );
  await f.client.join('ROOM0001');
  const command = f.client.control('pause');
  assert.equal(f.state.busy, true);
  live.send({ ...liveRoom(7), position: 90, playing: false });
  pending.resolve(json({ room: { ...liveRoom(2), position: 15, playing: true } }));
  assert.equal(await command, true);
  assert.equal(f.state.room?.version, 7);
  assert.equal(f.state.room?.position, 90);
  assert.equal(f.state.room?.playing, false);
  assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 1);
  f.client.destroy();
});

test('live messages cannot restore failed authenticated reads or resume playback during reconnect', async () => {
  const live = liveHarness();
  let reads = 0;
  const f = fixture(
    async () =>
      ++reads === 2
        ? json({ error: 'Synthetic unavailable room' }, 503)
        : json(liveRoom(reads === 1 ? 1 : 3)),
    { live: live.live },
  );
  await f.client.join('ROOM0001');
  await f.client.refresh();
  live.send({ ...liveRoom(2), playing: true });
  assert.equal(f.state.connection, 'reconnecting');
  assert.equal(f.client.playback()?.playing, false);
  assert.equal(await f.client.control('next'), false);
  assert.equal(await f.client.add('newtrack001'), false);
  await f.client.refresh();
  assert.equal(f.state.connection, 'connected');
  assert.equal(f.state.room?.version, 3);
  assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 0);
  f.client.destroy();
});

test('leaving closes live transport and late stream callbacks cannot cross a room switch', async () => {
  const live = liveHarness();
  const f = fixture(async (path) => json(room(path.slice(-8))), { live: live.live });
  await f.client.join('ROOM0001');
  live.send(liveRoom(2));
  assert.equal(f.state.live, true);
  f.client.leave();
  assert.equal(live.sources[0].closed, 1);
  assert.equal(live.sources[0].options.signal.aborted, true);
  assert.equal(f.state.live, false);
  await f.client.join('ROOM0002');
  assert.equal(live.send(liveRoom(99), 0), false);
  live.sources[0].options.onFresh(true);
  assert.equal(f.state.room?.code, 'ROOM0002');
  assert.equal(f.state.live, false);
  f.client.destroy();
  assert.equal(live.sources[1].closed, 1);
});

test('an expired live lease blocks writes until an authoritative read restores the clock', async () => {
  let now = 0;
  const f = fixture(
    async (_path, init) =>
      json(
        init.method === 'POST'
          ? { room: { ...liveRoom(2), serverTime: 1000 + now, syncSampledAt: 1000 + now } }
          : { ...liveRoom(1), serverTime: 1000 + now, syncSampledAt: 1000 + now },
      ),
    { now: () => now },
  );
  await f.client.join('ROOM0001');
  now = 5001;
  assert.equal(f.client.playback()?.stale, true);
  assert.equal(await f.client.control('play'), false);
  assert.equal(await f.client.add('newtrack001'), false);
  assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 0);
  await f.client.refresh();
  assert.equal(f.client.playback()?.stale, false);
  assert.equal(await f.client.control('play'), true);
  f.client.destroy();
});

test('a new Core epoch learned by polling fences old live frames even before the stream sees the restart', async () => {
  const live = liveHarness();
  let reads = 0;
  const f = fixture(
    async () => json({ ...liveRoom(++reads), syncEpoch: reads === 1 ? 'old-core' : 'new-core' }),
    { live: live.live },
  );
  await f.client.join('ROOM0001');
  live.send({ ...liveRoom(2), syncEpoch: 'old-core' });
  live.sources[0].fresh = false;
  live.sources[0].options.onFresh(false);
  await f.client.refresh();
  assert.equal(f.state.room?.syncEpoch, 'new-core');
  assert.equal(live.send({ ...liveRoom(99), syncEpoch: 'old-core' }), false);
  assert.equal(f.state.room?.syncEpoch, 'new-core');
  f.client.destroy();
});

test('a poll from a retired Core epoch cannot replace a newer stream after its lease expires', async () => {
  const live = liveHarness(),
    pending = deferred<Response>();
  let reads = 0;
  const f = fixture(async () => (++reads === 1 ? json(liveRoom(1)) : pending.promise), {
    live: live.live,
  });
  await f.client.join('ROOM0001');
  const refreshing = f.client.refresh();
  live.send({ ...liveRoom(1), syncEpoch: 'new-core', position: 80 });
  live.sources[0].fresh = false;
  live.sources[0].options.onFresh(false);
  pending.resolve(json({ ...liveRoom(99), isHost: false, isOwner: false, viewers: 3 }));
  await refreshing;
  assert.equal(f.state.room?.syncEpoch, 'new-core');
  assert.equal(f.state.room?.version, 1);
  assert.equal(f.state.room?.position, 80);
  assert.equal(f.state.room?.isHost, false);
  assert.equal(f.state.room?.viewers, 3);
  f.client.destroy();
});

test('stream flapping cannot postpone authenticated reads or create parallel read loops', async () => {
  let now = 0,
    nextTimer = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const live = liveHarness(),
    pending = deferred<Response>();
  let reads = 0;
  const f = fixture(async () => (++reads === 1 ? json(room()) : pending.promise), {
    live: live.live,
    now: () => now,
    setTimeout: ((callback: () => void, delay: number) => {
      const id = ++nextTimer;
      timers.set(id, { at: now + delay, callback });
      return id;
    }) as unknown as typeof setTimeout,
    clearTimeout: ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout,
  });
  const scheduledAt = () => {
    assert.equal(timers.size, 1, 'there is only one scheduled read');
    return [...timers.values()][0].at;
  };
  const fire = () => {
    const [id, timer] = [...timers.entries()][0];
    timers.delete(id);
    now = timer.at;
    timer.callback();
  };
  await f.client.join('ROOM0001');
  live.send(liveRoom(2));
  assert.equal(scheduledAt(), 10000);
  now = 9000;
  live.sources[0].fresh = false;
  live.sources[0].options.onFresh(false);
  now = 9100;
  live.send(liveRoom(3));
  assert.equal(scheduledAt(), 10000);
  now = 9900;
  live.sources[0].fresh = false;
  live.sources[0].options.onFresh(false);
  now = 9950;
  live.send(liveRoom(4));
  assert.equal(scheduledAt(), 10000, 'recovery retains the original permission-read deadline');
  fire();
  assert.equal(reads, 2);
  live.sources[0].fresh = false;
  live.sources[0].options.onFresh(false);
  live.send(liveRoom(5));
  assert.equal(scheduledAt(), 11000, 'a pending read uses a bounded retry interval');
  fire();
  assert.equal(reads, 2, 'a stream transition cannot start another pending read');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduledAt(), 12000, 'pending reads cannot spin zero-delay timers');
  pending.resolve(json({ ...room('ROOM0001', 6, false), isOwner: false }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.state.room?.isHost, false);
  assert.equal(f.state.room?.version, 5, 'permission reads preserve the live timeline');
  assert.equal(scheduledAt(), 21000);
  f.client.destroy();
  assert.equal(timers.size, 0);
});

test('a revision conflict cancels an older pending read and refreshes without replaying the command', async () => {
  const pending = deferred<Response>();
  let reads = 0;
  const f = fixture(async (_path, init) => {
    if (init.method === 'POST') return json({ error: 'The room changed.' }, 409);
    return ++reads === 2 ? pending.promise : json(room('ROOM0001', reads));
  });
  await f.client.join('ROOM0001');
  const retiredRead = f.client.refresh();
  const oldSignal = f.calls.at(-1)?.init.signal;
  assert.equal(await f.client.control('pause'), false);
  assert.equal(oldSignal?.aborted, true);
  assert.equal(f.state.room?.version, 3);
  assert.equal(f.state.error, 'The room changed.');
  assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 1);
  pending.resolve(json(room('ROOM0001', 2)));
  await retiredRead;
  assert.equal(f.state.room?.version, 3);
  f.client.destroy();
});
