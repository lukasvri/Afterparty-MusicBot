import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Room } from '../../../lib/types.ts';
import type { RoomClientOptions, RoomClientState } from '../src/lib/rooms/room-client.ts';

// The shared browser helper predates Node's explicit TypeScript extensions.
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/lib/browser-api.ts') && specifier === './browser-storage')
      return next('./browser-storage.ts', context);
    return next(specifier, context);
  },
});
const { createRoomClient } = await import('../src/lib/rooms/room-client.ts');
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
  options: RoomClientOptions = {},
) {
  const data = new Map<string, string>([['afterparty-visitor', 'a'.repeat(32)]]);
  const calls: { path: string; init: RequestInit }[] = [];
  const scheduled: (() => void)[] = [];
  const delays: (number | undefined)[] = [];
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
    setTimeout: ((callback: () => void, delay?: number) => {
      scheduled.push(callback);
      delays.push(delay);
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
    delays,
    get state() {
      return state;
    },
  };
}
const json = (value: unknown, status = 200) => Response.json(value, { status });

test('library retry skips confirmed tracks and uses each new room revision', async () => {
  let snapshot = room(),
    fail = true;
  const f = fixture(async (_path, init) => {
    if (init.method !== 'POST') return json(snapshot);
    const input = JSON.parse(String(init.body));
    assert.equal(input.version, snapshot.version);
    if (input.videoId === 'newtrack002' && fail) return json({ error: 'Temporary failure' }, 503);
    snapshot = {
      ...snapshot,
      version: snapshot.version + 1,
      queue: [...snapshot.queue, { ...snapshot.current!, id: input.videoId }],
    };
    return json({ room: snapshot });
  });
  try {
    await f.client.join('ROOM0001');
    await assert.rejects(
      f.client.append(['current0001', 'newtrack001', 'newtrack002']),
      /1 tracks added/,
    );
    fail = false;
    await f.client.append(['current0001', 'newtrack001', 'newtrack002']);
    assert.deepEqual(
      snapshot.queue.map((video) => video.id),
      ['newtrack001', 'newtrack002'],
    );
    const writes = f.calls.filter((call) => call.init.method === 'POST');
    assert.deepEqual(
      writes.map((call) => JSON.parse(String(call.init.body)).videoId),
      ['newtrack001', 'newtrack002', 'newtrack002'],
    );
  } finally {
    f.client.destroy();
  }
});

test('library additions preflight the full queue including pending requests without partial writes', async () => {
  const snapshot = room();
  snapshot.queue = Array.from({ length: 48 }, (_, index) => ({
    ...snapshot.current!,
    id: `q${String(index).padStart(10, '0')}`,
  }));
  snapshot.requests = [{ ...snapshot.current!, id: 'requested01' }];
  const f = fixture(async () => json(snapshot));
  try {
    await f.client.join('ROOM0001');
    await assert.rejects(f.client.append(['newtrack001', 'newtrack002']), /room for 1 more/);
    assert.equal(
      f.calls.some((call) => call.init.method === 'POST'),
      false,
    );
    await f.client.append(['current0001', 'requested01']);
    assert.equal(
      f.calls.some((call) => call.init.method === 'POST'),
      false,
    );
  } finally {
    f.client.destroy();
  }
});

test('a library batch cannot continue after leaving and rejoining the same room', async () => {
  const command = deferred<Response>();
  const f = fixture(async (_path, init) =>
    init.method === 'POST' ? command.promise : json(room()),
  );
  try {
    await f.client.join('ROOM0001');
    const adding = f.client.append(['newtrack001', 'newtrack002']);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const rejected = assert.rejects(adding, /room changed/);
    f.client.leave();
    await f.client.join('ROOM0001');
    command.resolve(json({ room: room('ROOM0001', 2) }));
    await rejected;
    assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 1);
    assert.equal(f.state.room?.version, 1);
  } finally {
    f.client.destroy();
  }
});

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
        displayName: 'Guest',
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

test('queue moderation uses entry identities and the latest accepted room revision', async () => {
  const commands: unknown[] = [];
  let version = 10;
  const f = fixture(async (_path, init) => {
    if (init.method === 'POST') {
      commands.push(JSON.parse(String(init.body)));
      return json({ room: room('ROOM0001', ++version) });
    }
    return json(room('ROOM0001', version));
  });
  await f.client.join('ROOM0001');
  assert.equal(await f.client.move('entry-duplicate-2', 0), true);
  assert.equal(await f.client.remove('entry-duplicate-1'), true);
  assert.equal(await f.client.action('approval', { enabled: true }), true);
  assert.equal(await f.client.action('approve', { videoId: 'pending-entry-1' }), true);
  assert.equal(await f.client.action('reject', { videoId: 'pending-entry-2' }), true);
  assert.equal(await f.client.action('clear'), true);
  assert.equal(await f.client.action('undo'), true);
  assert.deepEqual(commands, [
    { action: 'move', version: 10, videoId: 'entry-duplicate-2', to: 0 },
    { action: 'remove', version: 11, videoId: 'entry-duplicate-1' },
    { action: 'approval', version: 12, enabled: true },
    { action: 'approve', version: 13, videoId: 'pending-entry-1' },
    { action: 'reject', version: 14, videoId: 'pending-entry-2' },
    { action: 'clear', version: 15 },
    { action: 'undo', version: 16 },
  ]);
  f.client.destroy();
});

test('guest voting is permitted while queue edits, moderation and radio stay host-only', async () => {
  let version = 1;
  const commands: unknown[] = [];
  const f = fixture(async (_path, init) => {
    if (init.method === 'POST') {
      commands.push(JSON.parse(String(init.body)));
      return json({ room: room('ROOM0001', ++version, false) });
    }
    return json(room('ROOM0001', version, false));
  });
  await f.client.join('ROOM0001');
  assert.equal(await f.client.action('vote', { videoId: 'entry-1' }), true);
  assert.equal(await f.client.action('skip-vote'), true);
  assert.equal(await f.client.remove('entry-1'), false);
  assert.equal(await f.client.move('entry-1', 0), false);
  assert.equal(await f.client.action('approval', { enabled: true }), false);
  assert.equal(await f.client.action('approve', { videoId: 'entry-1' }), false);
  assert.equal(await f.client.action('clear'), false);
  assert.equal(await f.client.action('undo'), false);
  assert.equal(await f.client.action('radio', { enabled: true }), false);
  assert.equal(await f.client.playVideo('newtrack001'), false);
  assert.equal(await f.client.setVisibility(true), false);
  assert.deepEqual(commands, [
    { action: 'vote', version: 1, videoId: 'entry-1' },
    { action: 'skip-vote', version: 2 },
  ]);
  f.client.destroy();
});

test('cohosts cannot list a room publicly, while owners retain the existing visibility contract', async () => {
  let owner = false;
  const commands: unknown[] = [];
  const f = fixture(async (_path, init) => {
    if (init.method === 'POST') {
      commands.push(JSON.parse(String(init.body)));
      return json({ room: { ...room(), isOwner: owner, isPublic: true } });
    }
    return json({ ...room(), isOwner: owner });
  });
  await f.client.join('ROOM0001');
  assert.equal(await f.client.setVisibility(true), false);
  assert.equal(commands.length, 0);
  assert.match(f.state.error, /owner/);
  owner = true;
  await f.client.refresh();
  assert.equal(await f.client.setVisibility(true), true);
  assert.deepEqual(commands, [{ action: 'visibility', version: 1, isPublic: true }]);
  assert.equal(f.state.room?.isPublic, true);
  f.client.destroy();
});

test('public creation is explicit and additions use the saved, bounded participant name', async () => {
  const commands: unknown[] = [];
  const token = 'd'.repeat(64);
  const f = fixture(async (path, init) => {
    if (path === '/api/rooms') {
      assert.deepEqual(JSON.parse(String(init.body)), { name: 'Public evening', isPublic: true });
      return json({ room: room('ROOM0001', 1, false), token });
    }
    if (init.method === 'POST') {
      commands.push(JSON.parse(String(init.body)));
      return json({ room: room('ROOM0001', 2) });
    }
    return json(room());
  });
  f.data.set('afterparty-display-name', `  ${'N'.repeat(40)}  `);
  assert.equal(await f.client.create(' Public evening ', true), true);
  assert.equal(await f.client.add('newtrack001'), true);
  assert.deepEqual(commands, [
    { action: 'add', version: 1, videoId: 'newtrack001', displayName: 'N'.repeat(32) },
  ]);
  f.client.destroy();
});

test('action callers cannot replace the room revision or selected action through fields', async () => {
  const commands: unknown[] = [];
  const f = fixture(async (_path, init) => {
    if (init.method === 'POST') {
      commands.push(JSON.parse(String(init.body)));
      return json({ room: room('ROOM0001', 2) });
    }
    return json(room());
  });
  await f.client.join('ROOM0001');
  const fields = { enabled: false, version: 999, action: 'play' };
  assert.equal(await f.client.action('radio', fields), true);
  assert.deepEqual(commands, [{ action: 'radio', version: 1, enabled: false }]);
  f.client.destroy();
});

test('only owners can create invitations or revoke cohosts and invitations do not replace their credential', async () => {
  const credential = 'a'.repeat(64),
    invitation = 'b'.repeat(64);
  let owner = false,
    version = 1;
  const commands: unknown[] = [];
  const f = fixture(async (_path, init) => {
    if (init.method === 'POST') {
      assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${credential}`);
      const input = JSON.parse(String(init.body));
      commands.push(input);
      return json({
        room: { ...room('ROOM0001', ++version), isOwner: owner },
        ...(input.action !== 'revoke-hosts' ? { token: invitation } : {}),
      });
    }
    return json({ ...room('ROOM0001', version), isOwner: owner });
  });
  f.data.set('afterparty-host:ROOM0001', credential);
  await f.client.join('ROOM0001');
  assert.equal(await f.client.createInvitation(), null);
  assert.equal(await f.client.createInvitation('transfer'), null);
  assert.equal(await f.client.revokeHosts(), false);
  assert.equal(commands.length, 0);
  owner = true;
  await f.client.refresh();
  assert.equal(await f.client.createInvitation(), invitation);
  assert.equal(await f.client.createInvitation('transfer'), invitation);
  assert.equal(await f.client.revokeHosts(), true);
  assert.deepEqual(commands, [
    { action: 'invite', version: 1 },
    { action: 'transfer-invite', version: 2 },
    { action: 'revoke-hosts', version: 3 },
  ]);
  assert.equal(f.data.get('afterparty-host:ROOM0001'), credential);
  assert.equal(f.state.room?.version, 4);
  assert.equal(f.state.error, '');
  f.client.destroy();
});

test('a one-use invitation is exchanged before reading room permissions with the new credential', async () => {
  const invitation = 'b'.repeat(64),
    credential = 'c'.repeat(64);
  const f = fixture(async (path, init) => {
    assert.equal(path, '/api/rooms/ROOM0001');
    if (init.method === 'POST') {
      assert.equal(new Headers(init.headers).get('Authorization'), null);
      assert.deepEqual(JSON.parse(String(init.body)), { action: 'claim-host', token: invitation });
      return json({ token: credential, room: room('ROOM0001', 1, false) });
    }
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${credential}`);
    return json({ ...room('ROOM0001', 2), isOwner: true });
  });
  assert.equal(await f.client.join('room0001', invitation), true);
  assert.equal(f.data.get('afterparty-host:ROOM0001'), credential);
  assert.equal(f.state.room?.isHost, true);
  assert.equal(f.state.room?.isOwner, true);
  assert.equal(f.state.busy, false);
  assert.equal(f.calls.length, 2);
  f.client.destroy();
});

test('invalid and used invitations cannot silently join or overwrite a saved credential', async () => {
  const invitation = 'e'.repeat(64),
    credential = 'f'.repeat(64);
  const f = fixture(async () =>
    json({ error: `This invitation ${invitation} is no longer valid.` }, 403),
  );
  f.data.set('afterparty-host:ROOM0001', credential);
  assert.equal(await f.client.join('ROOM0001', 'not-a-token'), false);
  assert.equal(f.calls.length, 0);
  assert.equal(await f.client.join('ROOM0001', invitation), false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.state.room, null);
  assert.equal(f.state.busy, false);
  assert.equal(f.state.connection, 'idle');
  assert.equal(f.state.error.includes(invitation), false);
  assert.equal(f.data.get('afterparty-host:ROOM0001'), credential);
  f.client.destroy();
});

test('a late invitation claim cannot persist credentials after leaving or crossing a room switch', async () => {
  const pending = deferred<Response>();
  const invitation = 'b'.repeat(64),
    credential = 'c'.repeat(64);
  const f = fixture(async (path, init) =>
    init.method === 'POST' ? pending.promise : json(room('ROOM0002')),
  );
  const oldJoin = f.client.join('ROOM0001', invitation);
  const signal = f.calls[0].init.signal;
  assert.equal(await f.client.join('ROOM0002'), true);
  assert.equal(signal?.aborted, true);
  pending.resolve(json({ token: credential }));
  assert.equal(await oldJoin, false);
  assert.equal(f.data.get('afterparty-host:ROOM0001'), undefined);
  assert.equal(f.state.room?.code, 'ROOM0002');
  assert.equal(f.state.busy, false);
  f.client.destroy();
});

test('an invitation conflict refreshes permissions without recreating a one-use token', async () => {
  let reads = 0;
  const f = fixture(async (_path, init) =>
    init.method === 'POST'
      ? json({ error: 'The room changed. Try again.' }, 409)
      : json({ ...room('ROOM0001', ++reads), isOwner: reads === 1 }),
  );
  await f.client.join('ROOM0001');
  assert.equal(await f.client.createInvitation(), null);
  assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 1);
  assert.equal(f.state.room?.version, 2);
  assert.equal(f.state.room?.isOwner, false);
  assert.equal(f.state.error, 'The room changed. Try again.');
  f.client.destroy();
});

class SyntheticStream extends EventTarget {
  readyState = 0;
  closed = false;
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  send(value: unknown) {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify({ type: 'room', room: value }) }),
    );
  }
  fail(closed = false) {
    this.readyState = closed ? 2 : 0;
    this.dispatchEvent(new Event('error'));
  }
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
test('a matching live command receipt releases native controls before the held HTTP reply', async () => {
  const pending = deferred<Response>(),
    source = new SyntheticStream();
  let input: Record<string, unknown> = {},
    done = false;
  const snapshot: Room = {
    ...room(),
    playing: true,
    serverTime: 1000,
    syncSource: 'live',
    syncEpoch: 'epoch-one',
    syncValidForMs: 5000,
  };
  const f = fixture(
    async (_path, init) => {
      if (init.method !== 'POST') return json(snapshot);
      input = JSON.parse(String(init.body));
      return pending.promise;
    },
    {
      eventSource: () => source as unknown as EventSource,
      clockRequest: async () => json({ serverTime: 1000 }),
    },
  );
  let command: Promise<unknown> | undefined;
  try {
    await f.client.join('ROOM0001');
    source.open();
    await flush();
    command = f.client.controlNative('seek', 42).then((result) => {
      done = true;
      return result;
    });
    await flush();
    assert.match(String(input.commandId), /^[a-f0-9-]{36}$/);
    source.send({
      ...snapshot,
      version: 2,
      position: 42,
      commandReceipt: { id: input.commandId, version: 2 },
    });
    await flush();
    assert.equal(
      done,
      true,
      'the matching stream commit must settle the native gesture while HTTP is held',
    );
    assert.deepEqual(await command, { accepted: true, version: 2 });
    assert.equal(f.state.busy, false);
    source.send({ ...snapshot, version: 3, serverTime: 1100, playing: false });
    pending.resolve(json({ error: 'Late transport failure' }, 503));
    await flush();
    assert.equal(f.state.room?.playing, false);
    assert.equal(f.state.error, '');
  } finally {
    pending.resolve(json({ room: snapshot }));
    await command;
    f.client.destroy();
  }
});
for (const mismatch of [
  'id',
  'room',
  'epoch',
  'revision',
  'source',
  'playback',
  'pause',
  'expired',
  'authority',
])
  test(`a ${mismatch} mismatch cannot release a held native command through the stream`, async () => {
    const pending = deferred<Response>(),
      source = new SyntheticStream();
    let input: Record<string, unknown> = {},
      done = false,
      now = 100;
    const snapshot: Room = {
      ...room(),
      playing: true,
      serverTime: 1000,
      playbackKey: 'original',
      syncSource: 'live',
      syncEpoch: 'epoch-one',
      syncValidForMs: 5000,
    };
    const f = fixture(
      async (_path, init) => {
        if (init.method !== 'POST') return json(snapshot);
        input = JSON.parse(String(init.body));
        return pending.promise;
      },
      {
        now: () => now,
        eventSource: () => source as unknown as EventSource,
        clockRequest: async () => json({ serverTime: 1000 }),
      },
    );
    let command: Promise<unknown> | undefined;
    try {
      await f.client.join('ROOM0001');
      source.open();
      await flush();
      command = f.client.controlNative('seek', 42).then((result) => {
        done = true;
        return result;
      });
      await flush();
      if (mismatch === 'authority') now = 5200;
      const frame = {
        ...snapshot,
        version: 2,
        position: 42,
        commandReceipt: { id: String(input.commandId), version: 2 },
      };
      if (mismatch === 'id') frame.commandReceipt.id = crypto.randomUUID();
      if (mismatch === 'room') frame.code = 'ROOM0002';
      if (mismatch === 'epoch') frame.syncEpoch = 'another-epoch';
      if (mismatch === 'revision') {
        frame.version = 3;
        frame.commandReceipt.version = 3;
      }
      if (mismatch === 'source') frame.current = { ...snapshot.current!, id: 'another0001' };
      if (mismatch === 'playback') frame.playbackKey = 'replacement';
      if (mismatch === 'pause') frame.playing = false;
      if (mismatch === 'expired') frame.syncValidForMs = 0;
      source.send(frame);
      await flush();
      assert.equal(
        done,
        false,
        'ambiguous or stale stream evidence must leave HTTP as the receipt',
      );
      pending.resolve(json({ room: { ...snapshot, version: 2, position: 42 } }));
      assert.deepEqual(await command, { accepted: true, version: 2 });
    } finally {
      pending.resolve(json({ room: snapshot }));
      await command;
      f.client.destroy();
    }
  });
function streamFixture() {
  let monotonic = 100;
  let failedReadStatus: number | 'network' = 0;
  let snapshot: Room = {
    ...room(),
    serverTime: 1000,
    playing: true,
    isOwner: true,
    isPublic: false,
    viewers: 4,
    syncSource: 'live',
    syncEpoch: 'epoch-one',
    syncValidForMs: 5000,
  };
  const sources: SyntheticStream[] = [];
  const streamUrls: string[] = [];
  const f = fixture(
    async () => {
      if (failedReadStatus === 'network') throw new Error('Synthetic network failure');
      return failedReadStatus
        ? json({ error: 'Synthetic read failure' }, failedReadStatus)
        : json(snapshot);
    },
    {
      now: () => monotonic,
      eventSource: (url) => {
        streamUrls.push(url);
        const source = new SyntheticStream();
        sources.push(source);
        return source as unknown as EventSource;
      },
      clockRequest: async () => json({ serverTime: 1000 + monotonic - 100 }),
    },
  );
  return {
    ...f,
    get state() {
      return f.state;
    },
    sources,
    streamUrls,
    failReads(status: number | 'network') {
      failedReadStatus = status;
    },
    get snapshot() {
      return snapshot;
    },
    set snapshot(value: Room) {
      snapshot = value;
    },
    get now() {
      return monotonic;
    },
    set now(value: number) {
      monotonic = value;
    },
  };
}

test('live streaming needs a calibrated clock and retains authenticated permissions and presence', async () => {
  const f = streamFixture();
  await f.client.join('ROOM0001');
  assert.deepEqual(f.streamUrls, ['/api/realtime/stream?room=ROOM0001']);
  const source = f.sources[0];
  const next = {
    ...f.snapshot,
    version: 2,
    serverTime: 1100,
    isHost: false,
    isOwner: false,
    isPublic: true,
    viewers: 999,
  };
  source.send(next);
  assert.equal(f.state.room?.version, 1, 'frames before clock calibration are ignored');
  source.open();
  await flush();
  f.now = 200;
  source.send(next);
  assert.equal(f.state.room?.version, 2);
  assert.equal(f.state.room?.isHost, true);
  assert.equal(f.state.room?.isOwner, true);
  assert.equal(f.state.room?.isPublic, false);
  assert.equal(f.state.room?.viewers, 4);
  f.snapshot = {
    ...f.snapshot,
    version: 2,
    isHost: false,
    isOwner: false,
    isPublic: true,
    viewers: 7,
  };
  await f.client.refresh();
  assert.equal(f.state.room?.serverTime, 1100, 'an older poll cannot replace the live timeline');
  assert.equal(f.state.room?.isHost, false);
  assert.equal(f.state.room?.isOwner, false);
  assert.equal(f.state.room?.isPublic, true);
  assert.equal(f.state.room?.viewers, 7);
  source.send({ ...next, version: 3, serverTime: 1200, isHost: true, isOwner: true });
  assert.equal(f.state.room?.version, 3);
  assert.equal(f.state.room?.isHost, false, 'public frames cannot restore revoked access');
  assert.equal(f.state.room?.isOwner, false);
  f.client.destroy();
});

test('stream errors pause a newer timeline until an authenticated poll reconciles current intent', async () => {
  const f = streamFixture();
  await f.client.join('ROOM0001');
  const source = f.sources[0];
  source.open();
  await flush();
  source.send({ ...f.snapshot, version: 2, serverTime: 1100 });
  source.fail();
  assert.equal(f.state.connection, 'reconnecting');
  assert.equal(f.client.playback()?.playing, false);
  source.send({ ...f.snapshot, version: 99, serverTime: 1200 });
  assert.equal(
    f.state.room?.version,
    2,
    'an unauthenticated stream cannot recover a disconnected session',
  );
  f.snapshot = { ...f.snapshot, version: 3, serverTime: 1200, playing: false };
  await f.client.refresh();
  assert.equal(f.state.connection, 'connected');
  assert.equal(f.client.playback()?.playing, false);
  assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 0);
  f.client.destroy();
});

test('a fresh matching authoritative poll sustains playback during a stream outage without extending its lease', async () => {
  const f = streamFixture();
  await f.client.join('ROOM0001');
  const source = f.sources[0];
  source.open();
  await flush();
  f.now = 200;
  source.send({ ...f.snapshot, serverTime: 1100 });
  source.fail();
  assert.equal(f.state.connection, 'connected');
  assert.equal(f.state.receivedAt, 100);
  assert.equal(f.client.playback()?.playing, true);
  f.now = 5101;
  assert.equal(f.client.playback()?.playing, false);
  assert.equal(f.client.playback()?.stale, true);
  f.client.destroy();
});

test('a live lease expires locally even without a browser error or a responsive poll', async () => {
  const f = streamFixture();
  await f.client.join('ROOM0001');
  const source = f.sources[0];
  source.open();
  await flush();
  source.send({ ...f.snapshot, version: 2, serverTime: 1000 });
  const leaseIndex = f.delays.findLastIndex((delay) => delay === 5000);
  assert(leaseIndex >= 0);
  f.now = 5101;
  assert.equal(
    f.client.playback()?.playing,
    false,
    'the playback projection expires without a timer callback',
  );
  f.scheduled[leaseIndex]();
  assert.equal(f.state.connection, 'reconnecting');
  assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 0);
  f.client.destroy();
});

test('fresh stream pauses cross pending commands and older receipts cannot restore playback', async () => {
  const pending = deferred<Response>();
  const source = new SyntheticStream();
  const snapshot: Room = {
    ...room(),
    playing: true,
    syncSource: 'live',
    syncEpoch: 'epoch-one',
    syncValidForMs: 5000,
  };
  const f = fixture(
    async (_path, init) => (init.method === 'POST' ? pending.promise : json(snapshot)),
    {
      eventSource: () => source as unknown as EventSource,
      clockRequest: async () => json({ serverTime: 1001 }),
    },
  );
  await f.client.join('ROOM0001');
  source.open();
  await flush();
  const command = f.client.controlNative('seek', 42);
  source.send({ ...snapshot, version: 3, playing: false, serverTime: 1200 });
  assert.equal(f.state.room?.version, 3);
  assert.equal(f.client.playback()?.playing, false);
  pending.resolve(
    json({ room: { ...snapshot, version: 2, playing: true, position: 42, serverTime: 1300 } }),
  );
  assert.deepEqual(await command, { accepted: true, version: 2 });
  source.send({ ...snapshot, version: 2, serverTime: 1400 });
  assert.equal(f.state.room?.version, 3);
  assert.equal(f.client.playback()?.playing, false);
  f.client.destroy();
});

test('new stream epochs require authoritative confirmation and old epoch frames remain retired', async () => {
  const f = streamFixture();
  await f.client.join('ROOM0001');
  const source = f.sources[0];
  source.open();
  await flush();
  source.send({ ...f.snapshot, version: 2, syncEpoch: 'unconfirmed-epoch' });
  assert.equal(f.state.room?.version, 1);
  f.snapshot = {
    ...f.snapshot,
    version: 1,
    serverTime: 1200,
    syncEpoch: 'epoch-two',
    playing: false,
  };
  await f.client.refresh();
  await flush();
  source.send({ ...f.snapshot, version: 99, syncEpoch: 'epoch-one', playing: true });
  assert.equal(f.state.room?.syncEpoch, 'epoch-two');
  assert.equal(f.state.room?.version, 1);
  assert.equal(f.client.playback()?.playing, false);
  source.send({ ...f.snapshot, version: 2, serverTime: 1300 });
  assert.equal(f.state.room?.version, 2);
  assert.equal(f.state.room?.syncEpoch, 'epoch-two');
  f.client.destroy();
});

test('room changes close streams and late frames cannot affect the replacement room', async () => {
  const f = streamFixture();
  await f.client.join('ROOM0001');
  const source = f.sources[0];
  source.open();
  await flush();
  f.snapshot = { ...f.snapshot, code: 'ROOM0002' };
  await f.client.join('ROOM0002');
  assert.equal(source.closed, true);
  source.send({ ...f.snapshot, code: 'ROOM0001', version: 999 });
  assert.equal(f.state.room?.code, 'ROOM0002');
  assert.equal(f.state.room?.version, 1);
  f.client.leave();
  assert.equal(f.sources[1].closed, true);
  const calls = f.calls.length;
  f.scheduled.forEach((callback) => callback());
  assert.equal(f.calls.length, calls);
  assert.equal(f.sources.length, 2, 'retired retries cannot create another stream');
  f.client.destroy();
});

test('explicit reconnect replaces a failed live stream immediately and retires its pending retries', async () => {
  const f = streamFixture();
  try {
    await f.client.join('ROOM0001');
    const old = f.sources[0];
    old.open();
    await flush();
    old.send({ ...f.snapshot, version: 2, serverTime: 1100 });
    old.fail(true);
    const retiredCallbacks = f.scheduled.slice();
    assert.equal(f.state.connection, 'reconnecting');
    f.snapshot = { ...f.snapshot, version: 3, serverTime: 1200, playing: false };
    await f.client.refresh();
    assert.equal(f.sources.length, 2, 'the user does not have to wait for the stream retry timer');
    assert.equal(f.state.connection, 'connected');
    assert.equal(f.client.playback()?.playing, false, 'reconnect respects the current pause');
    old.send({ ...f.snapshot, version: 99, serverTime: 1400, playing: true });
    retiredCallbacks.forEach((callback) => callback());
    await flush();
    assert.equal(f.sources.length, 2, 'retired timers cannot open a duplicate stream');
    assert.equal(f.state.room?.version, 3);
    assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 0);
    assert.equal(f.data.get('afterparty-visitor'), 'a'.repeat(32));
  } finally {
    f.client.destroy();
  }
});

test('explicit reconnect reports progress, preserves ownership and cannot regain revoked access from public frames', async () => {
  const pending = deferred<Response>();
  const sources: SyntheticStream[] = [];
  let reads = 0;
  const snapshot: Room = {
    ...room(),
    playing: true,
    syncSource: 'live',
    syncEpoch: 'epoch-one',
    syncValidForMs: 5000,
  };
  const f = fixture(async () => (++reads === 1 ? json(snapshot) : pending.promise), {
    eventSource: () => {
      const source = new SyntheticStream();
      sources.push(source);
      return source as unknown as EventSource;
    },
    clockRequest: async () => json({ serverTime: 1001 }),
  });
  try {
    f.data.set('afterparty-host:ROOM0001', 'b'.repeat(64));
    await f.client.join('ROOM0001');
    sources[0].open();
    await flush();
    sources[0].send({ ...snapshot, version: 2, serverTime: 1100 });
    sources[0].fail();
    const reconnect = f.client.refresh();
    assert.equal(f.state.busy, true);
    assert.equal(f.state.connection, 'connecting');
    assert.match(f.state.error, /Reconnecting/);
    assert.equal(sources[0].closed, true);
    await f.client.refresh();
    assert.equal(reads, 2, 'repeated presses do not start overlapping retries');
    pending.resolve(json({ error: 'Room access has expired.' }, 403));
    await reconnect;
    sources[1].open();
    await flush();
    sources[1].send({ ...snapshot, version: 99, serverTime: 1200, isHost: true });
    assert.equal(f.state.busy, false);
    assert.equal(f.state.connection, 'reconnecting');
    assert.equal(f.state.error, 'Room access has expired.');
    assert.equal(f.state.room?.version, 2);
    assert.equal(f.client.playback()?.playing, false);
    assert.equal(f.data.get('afterparty-host:ROOM0001'), 'b'.repeat(64));
    assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 0);
  } finally {
    f.client.destroy();
  }
});

test('invalid, wrong-room, expired and Discord stream frames never replace a validated browser timeline', async () => {
  const f = streamFixture();
  await f.client.join('ROOM0001');
  const source = f.sources[0];
  source.open();
  await flush();
  source.send({ ...f.snapshot, version: 2, code: 'ROOM0002' });
  source.send({ ...f.snapshot, version: 2, mode: 'discord', guildId: '111111111111111111' });
  source.send({ ...f.snapshot, version: 2, position: Number.NaN });
  source.send({ ...f.snapshot, version: 2, syncValidForMs: 6000 });
  assert.equal(f.state.room?.version, 1);
  f.now = 2000;
  source.send({ ...f.snapshot, version: 2, serverTime: -5000 });
  assert.equal(f.state.room?.version, 1);
  assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 0);
  f.client.destroy();
});

test('a failed clock resample retires live playback and a closed stream retries without transport mutations', async () => {
  let now = 100,
    failClock = false;
  const snapshot: Room = {
    ...room(),
    playing: true,
    syncSource: 'live',
    syncEpoch: 'epoch-one',
    syncValidForMs: 5000,
  };
  const sources: SyntheticStream[] = [];
  const f = fixture(async () => json(snapshot), {
    now: () => now,
    eventSource: () => {
      const source = new SyntheticStream();
      sources.push(source);
      return source as unknown as EventSource;
    },
    clockRequest: async () =>
      failClock ? json({ error: 'Clock unavailable' }, 503) : json({ serverTime: 1001 }),
  });
  await f.client.join('ROOM0001');
  sources[0].open();
  await flush();
  sources[0].send({ ...snapshot, version: 2, serverTime: 1100 });
  failClock = true;
  now = 10101;
  f.scheduled[f.delays.findIndex((delay) => delay === 10000)]();
  await flush();
  assert.equal(f.state.connection, 'reconnecting');
  assert.equal(f.client.playback()?.playing, false);
  sources[0].fail(true);
  assert.equal(sources[0].closed, true);
  f.scheduled[f.delays.findLastIndex((delay) => delay === 10000)]();
  assert.equal(sources.length, 2);
  assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 0);
  f.client.destroy();
  assert.equal(sources[1].closed, true);
});

test('two clients follow a shared live revision while independently retaining their room roles', async () => {
  let snapshot: Room = {
    ...room(),
    playing: true,
    syncSource: 'live',
    syncEpoch: 'epoch-one',
    syncValidForMs: 5000,
  };
  const hostStream = new SyntheticStream(),
    guestStream = new SyntheticStream();
  const host = fixture(
    async (_path, init) => {
      if (init.method === 'POST') {
        const input = JSON.parse(String(init.body));
        assert.deepEqual(input, { action: 'pause', version: 1 });
        snapshot = { ...snapshot, version: 2, serverTime: 1100, playing: false };
        hostStream.send(snapshot);
        guestStream.send(snapshot);
        return json({ room: snapshot });
      }
      return json(snapshot);
    },
    {
      eventSource: () => hostStream as unknown as EventSource,
      clockRequest: async () => json({ serverTime: 1001 }),
    },
  );
  const guest = fixture(async () => json({ ...snapshot, isHost: false, isOwner: false }), {
    eventSource: () => guestStream as unknown as EventSource,
    clockRequest: async () => json({ serverTime: 1001 }),
  });
  await host.client.join('ROOM0001');
  await guest.client.join('ROOM0001');
  hostStream.open();
  guestStream.open();
  await flush();
  assert.equal(await host.client.control('pause'), true);
  assert.equal(host.state.room?.version, 2);
  assert.equal(guest.state.room?.version, 2);
  assert.equal(host.client.playback()?.playing, false);
  assert.equal(guest.client.playback()?.playing, false);
  assert.equal(host.state.room?.isHost, true);
  assert.equal(guest.state.room?.isHost, false);
  assert.equal(await guest.client.control('play'), false);
  assert.equal(guest.calls.filter((call) => call.init.method === 'POST').length, 0);
  host.client.destroy();
  guest.client.destroy();
});

test('healthy calibrated SSE reduces redundant reads but refreshes authenticated roles within five seconds', async () => {
  const f = streamFixture();
  await f.client.join('ROOM0001');
  const source = f.sources[0];
  source.open();
  await flush();
  source.send({ ...f.snapshot, version: 2, serverTime: 1100 });
  const runPoll = async () => {
    f.scheduled[f.delays.findLastIndex((delay) => delay === 1000)]();
    await flush();
  };
  for (const time of [1100, 2100, 3100, 4100]) {
    f.now = time;
    source.send({ ...f.snapshot, version: 2, serverTime: time + 900 });
    await runPoll();
  }
  assert.equal(f.calls.length, 1, 'fresh SSE frames replace four redundant network snapshots');
  f.snapshot = { ...f.snapshot, isHost: false, isOwner: false, viewers: 7 };
  f.now = 5100;
  source.send({ ...f.snapshot, version: 2, serverTime: 6000 });
  await runPoll();
  assert.equal(
    f.calls.length,
    2,
    'authenticated state still refreshes at the five-second boundary',
  );
  assert.equal(f.state.room?.isHost, false);
  assert.equal(f.state.room?.viewers, 7);
  f.client.destroy();
});

test('a broken stream immediately restores the existing one-second authority poll', async () => {
  const f = streamFixture();
  await f.client.join('ROOM0001');
  f.sources[0].open();
  await flush();
  f.sources[0].send({ ...f.snapshot, version: 2, serverTime: 1100 });
  f.now = 1100;
  f.sources[0].fail();
  f.scheduled[f.delays.findLastIndex((delay) => delay === 1000)]();
  await flush();
  assert.equal(f.calls.length, 2, 'stream failure does not wait for the five-second refresh');
  f.client.destroy();
});

test('a successful poll clears a reconnect error raised while the read was in flight', async () => {
  const pending = deferred<Response>();
  const sources: SyntheticStream[] = [];
  let reads = 0;
  let monotonic = 100;
  const snapshot = {
    ...room(),
    syncSource: 'live' as const,
    syncEpoch: 'epoch-one',
    syncValidForMs: 5000,
  };
  const f = fixture(async () => (++reads === 1 ? json(snapshot) : pending.promise), {
    now: () => monotonic,
    eventSource: () => {
      const source = new SyntheticStream();
      sources.push(source);
      return source as unknown as EventSource;
    },
    clockRequest: async () => json({ serverTime: snapshot.serverTime }),
  });
  try {
    await f.client.join('ROOM0001');
    sources[0].open();
    await flush();
    monotonic = 5100;
    sources[0].send({ ...snapshot, version: 2, serverTime: 6000 });
    f.scheduled[f.delays.findLastIndex((delay) => delay === 1000)]();
    assert.equal(reads, 2);
    sources[0].fail();
    assert.equal(f.state.connection, 'reconnecting');
    assert.match(f.state.error, /reconnecting/);
    pending.resolve(
      json({ ...snapshot, version: 3, current: null, playing: false, serverTime: 6100 }),
    );
    await flush();
    assert.equal(f.state.connection, 'connected');
    assert.equal(f.state.room?.version, 3);
    assert.equal(f.state.room?.current, null);
    assert.equal(f.state.error, '');
  } finally {
    f.client.destroy();
  }
});

test('an expired live lease does not suppress an authenticated room read', async () => {
  const f = streamFixture();
  await f.client.join('ROOM0001');
  f.sources[0].open();
  await flush();
  f.sources[0].send({ ...f.snapshot, version: 2, serverTime: 1100, syncValidForMs: 500 });
  f.now = 1100;
  f.scheduled[f.delays.findLastIndex((delay) => delay === 1000)]();
  await flush();
  assert.equal(f.calls.length, 2, 'a healthy transport alone cannot replace an expired timeline');
  f.client.destroy();
});

test('transport refreshes and retries one queue-only revision conflict without rejoining', async () => {
  let reads = 0;
  const sent: { action: string; version: number }[] = [];
  const f = fixture(async (_path, init) => {
    if (init.method !== 'POST') return json({ ...room('ROOM0001', ++reads), playing: true });
    const input = JSON.parse(String(init.body));
    sent.push(input);
    if (sent.length === 1) return json({ error: 'The room changed.' }, 409);
    return json({ room: { ...room('ROOM0001', 3), playing: false } });
  });
  try {
    await f.client.join('ROOM0001');
    assert.equal(await f.client.control('pause'), true);
    assert.deepEqual(sent, [
      { action: 'pause', version: 1 },
      { action: 'pause', version: 2 },
    ]);
    assert.equal(f.state.room?.playing, false);
    assert.equal(f.state.error, '');
    assert.equal(f.state.connection, 'connected');
  } finally {
    f.client.destroy();
  }
});

for (const [name, change] of Object.entries({
  pause: { playing: false },
  seek: { position: 90 },
  source: { current: { ...room().current!, id: 'another0001' } },
  instance: { playbackKey: 'another-playback' },
  authority: { isHost: false },
  epoch: { syncEpoch: 'another-epoch' },
}))
  test(`transport never retries over a concurrent ${name} change`, async () => {
    let reads = 0,
      posts = 0;
    const f = fixture(async (_path, init) => {
      if (init.method === 'POST') {
        posts++;
        return json({ error: 'The room changed.' }, 409);
      }
      return json({ ...room('ROOM0001', ++reads), playing: true, ...(reads > 1 ? change : {}) });
    });
    try {
      await f.client.join('ROOM0001');
      assert.equal(await f.client.control('seek', 42), false);
      assert.equal(posts, 1);
      assert.equal(f.state.room?.version, 2);
    } finally {
      f.client.destroy();
    }
  });

test('a transient poll failure retains the fresh SSE player while controls await authenticated recovery', async () => {
  const f = streamFixture();
  try {
    await f.client.join('ROOM0001');
    f.sources[0].open();
    await flush();
    f.now = 200;
    f.sources[0].send({ ...f.snapshot, version: 2, serverTime: 1100 });
    f.failReads(503);
    await f.client.refresh();
    assert.equal(f.state.connection, 'reconnecting');
    assert.equal(f.client.playback()?.playing, true);
    assert.equal(await f.client.control('pause'), false, 'old roles cannot dispatch controls');
    f.now = 300;
    f.sources[0].send({ ...f.snapshot, version: 3, playing: false, serverTime: 1200 });
    assert.equal(f.state.room?.version, 3);
    assert.equal(f.client.playback()?.playing, false, 'fresh shared pause is still applied');
    assert.equal(
      f.state.connection,
      'reconnecting',
      'public data cannot restore authenticated access',
    );
    f.failReads(0);
    f.snapshot = { ...f.snapshot, version: 3, playing: false, serverTime: 1200 };
    await f.client.refresh();
    assert.equal(f.state.connection, 'connected');
    assert.equal(f.state.error, '');
    assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 0);
  } finally {
    f.client.destroy();
  }
});

for (const status of [401, 403, 404])
  test(`a ${status} poll failure cannot be sustained or recovered by public frames`, async () => {
    const f = streamFixture();
    try {
      await f.client.join('ROOM0001');
      f.sources[0].open();
      await flush();
      f.sources[0].send({ ...f.snapshot, version: 2, serverTime: 1100 });
      f.failReads(status);
      await f.client.refresh();
      assert.equal(f.client.playback()?.playing, false);
      f.sources[0].send({ ...f.snapshot, version: 3, serverTime: 1200 });
      assert.equal(f.state.room?.version, 2);
      assert.equal(f.state.connection, 'reconnecting');
      for (const failure of [503, 'network', 500] as const) {
        f.failReads(failure);
        await f.client.refresh();
        f.sources[0].send({ ...f.snapshot, version: 3, serverTime: 1300 });
        assert.equal(
          f.client.playback()?.playing,
          false,
          'access loss remains latched through later transient failures',
        );
        assert.equal(f.state.room?.version, 2, 'public frames cannot restore lost access');
      }
      f.failReads(0);
      f.snapshot = { ...f.snapshot, version: 3, serverTime: 1400 };
      await f.client.refresh();
      assert.equal(f.state.connection, 'connected');
      assert.equal(
        f.client.playback()?.playing,
        true,
        'only a successful authenticated read restores playback',
      );
    } finally {
      f.client.destroy();
    }
  });

test('transport retries at most one explicit conflict and never retries an uncertain receipt', async () => {
  for (const status of [409, 503]) {
    let reads = 0,
      posts = 0;
    const f = fixture(async (_path, init) => {
      if (init.method !== 'POST') return json({ ...room('ROOM0001', ++reads), playing: true });
      posts++;
      return json({ error: 'Synthetic command failure' }, status);
    });
    try {
      await f.client.join('ROOM0001');
      assert.equal(await f.client.control('seek', 42), false);
      assert.equal(posts, status === 409 ? 2 : 1);
    } finally {
      f.client.destroy();
    }
  }
});

test('leaving during conflict reconciliation cannot replay a control or change the replacement room', async () => {
  const pending = deferred<Response>();
  let reads = 0;
  const f = fixture(async (path, init) => {
    if (init.method === 'POST') return json({ error: 'Old room conflict' }, 409);
    if (path.endsWith('ROOM0002')) return json(room('ROOM0002'));
    return ++reads === 1 ? json(room()) : pending.promise;
  });
  try {
    await f.client.join('ROOM0001');
    const changing = f.client.control('seek', 42);
    await flush();
    await f.client.join('ROOM0002');
    pending.resolve(json(room('ROOM0001', 2)));
    assert.equal(await changing, false);
    assert.equal(f.state.room?.code, 'ROOM0002');
    assert.equal(f.state.error, '');
    assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 1);
  } finally {
    pending.resolve(json(room()));
    f.client.destroy();
  }
});

for (const sampleAge of [4900, 5990])
  test(`a ${sampleAge}ms-old HTTP receipt cannot extend a lost stream lease`, async () => {
    const pending = deferred<Response>(),
      source = new SyntheticStream();
    let now = 100,
      freshRead = false;
    const snapshot: Room = {
      ...room(),
      playing: true,
      serverTime: 1000,
      syncSource: 'live',
      syncEpoch: 'epoch-one',
      syncValidForMs: 5000,
    };
    const committed: Room = { ...snapshot, version: 2, position: 42, serverTime: 1100 };
    const f = fixture(
      async (_path, init) =>
        init.method === 'POST'
          ? pending.promise
          : json(freshRead ? { ...committed, serverTime: 900 + now } : snapshot),
      {
        now: () => now,
        eventSource: () => source as unknown as EventSource,
        clockRequest: async () => json({ serverTime: 1000 }),
      },
    );
    let command: Promise<unknown> | undefined;
    try {
      await f.client.join('ROOM0001');
      source.open();
      await flush();
      command = f.client.controlNative('seek', 42);
      await flush();
      source.send(committed);
      now = sampleAge + 210;
      const leaseIndex = f.delays.findLastIndex((delay) => delay === 5000);
      assert(leaseIndex >= 0);
      f.scheduled[leaseIndex]();
      assert.equal(f.state.connection, 'reconnecting');
      pending.resolve(json({ room: { ...committed, serverTime: 1110 } }));
      assert.deepEqual(await command, { accepted: true, version: 2 });
      if (sampleAge < 5000) {
        assert.equal(f.client.playback()?.playing, true);
        now += 101;
        assert.equal(
          f.client.playback()?.playing,
          false,
          'only the actual remaining 100ms may be used',
        );
      } else {
        assert.equal(
          f.client.playback()?.playing,
          false,
          'a delayed old receipt is not a fresh playback lease',
        );
        assert.equal(f.state.connection, 'reconnecting');
      }
      freshRead = true;
      await f.client.refresh();
      assert.equal(f.state.connection, 'connected');
      assert.equal(f.client.playback()?.playing, true);
    } finally {
      pending.resolve(json({ room: snapshot }));
      await command;
      f.client.destroy();
    }
  });
