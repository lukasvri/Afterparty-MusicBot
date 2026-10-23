import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Room } from '../../../lib/types.ts';
import type { RoomClientState } from '../src/lib/room-client.ts';

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
function fixture(fetcher: (path: string, init: RequestInit) => Promise<Response>) {
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
