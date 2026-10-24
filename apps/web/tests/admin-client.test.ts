import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import type { AdminDetail, AdminState } from '../src/lib/admin/admin-client.ts';
import type { request } from '../../../lib/browser-api.ts';

const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/lib/browser-api.ts') && specifier === './browser-storage')
      return next('./browser-storage.ts', context);
    return next(specifier, context);
  },
});
const { createAdminClient, safeAdminLink } = await import('../src/lib/admin/admin-client.ts');
hook.deregister();

const first = '111111111111111111',
  second = '222222222222222222';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function detail(guildId = first): AdminDetail {
  return {
    guildId,
    roomCode: 'TESTROOM',
    state: {
      guildId,
      ready: true,
      connected: true,
      playing: false,
      position: 0,
      volume: 50,
      current: null,
      queue: [],
      queueRevision: 'revision-7',
      lastSeen: 0,
      online: true,
    },
    settings: { defaultVolume: 50 },
    player: {
      loopCurrentSong: false,
      loopCurrentQueue: false,
      bitrate: 192000,
      radioProvider: 'artist',
    },
    snapshots: [],
    commands: [],
    sleepTimerEndsAt: null,
  };
}
function access() {
  return {
    authenticated: true,
    globalAdmin: false,
    guilds: [
      { id: first, name: 'First server', roomCode: 'FIRSTONE', installed: true },
      { id: second, name: 'Second server', roomCode: 'SECONDON', installed: true },
    ],
    invite: '',
  };
}
function fixture(handler?: (path: string, init: RequestInit) => unknown | Promise<unknown>) {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const client = createAdminClient({
    request: (async (path: string, init: RequestInit = {}) => {
      calls.push({ path, init });
      const response = await handler?.(path, init);
      if (response !== undefined) return response;
      if (path === '/api/admin/guilds') return access();
      if (path.startsWith('/api/admin/control?'))
        return detail(new URL(path, 'https://test.invalid').searchParams.get('guildId')!);
      if (path === '/api/admin/control') return { id: 'job-1', status: 'done' };
      if (path === '/api/admin/session') return { authenticated: false, method: 'owner' };
      return {};
    }) as typeof request,
    delay: async () => {},
  });
  let state!: AdminState;
  client.subscribe((value) => {
    state = value;
  });
  return { client, calls, state: () => state };
}

test('only listed servers are selected and each command captures its server and queue revision', async () => {
  const f = fixture();
  try {
    await f.client.loadAccess(first);
    await tick();
    assert.equal(f.state().detail?.guildId, first);
    f.client.select('999999999999999999');
    assert.equal(f.state().guildId, first);
    await f.client.command('remove', {
      index: 0,
      queueRevision: 'caller-override',
      action: 'stop',
    });
    const write = f.calls.find((call) => call.init.method === 'POST');
    assert.deepEqual(JSON.parse(write!.init.body as string), {
      operation: 'command',
      guildId: first,
      commandId: JSON.parse(write!.init.body as string).commandId,
      command: { index: 0, queueRevision: 'revision-7', action: 'remove' },
    });
    assert(f.calls.every((call) => call.init.cache === 'no-store'));
  } finally {
    f.client.destroy();
  }
});

test('late reads from the previous server never populate the newly selected server', async () => {
  let release: ((value: AdminDetail) => void) | undefined;
  let hold = false;
  const f = fixture((path) =>
    path.includes(first) && hold
      ? new Promise<AdminDetail>((resolve) => {
          release = resolve;
        })
      : undefined,
  );
  try {
    await f.client.loadAccess(first);
    await tick();
    hold = true;
    const oldRead = f.client.refresh();
    const signal = f.calls.at(-1)!.init.signal!;
    f.client.select(second);
    await tick();
    assert(signal.aborted);
    assert.equal(f.state().detail?.guildId, second);
    release!(detail(first));
    await oldRead;
    assert.equal(f.state().detail?.guildId, second);
    assert.equal(f.state().guildId, second);
  } finally {
    f.client.destroy();
  }
});

test('switching server during a command retires its result and sends no retry', async () => {
  let release: ((value: unknown) => void) | undefined;
  const f = fixture((path, init) =>
    path === '/api/admin/control' && init.method === 'POST'
      ? new Promise((resolve) => {
          release = resolve;
        })
      : undefined,
  );
  try {
    await f.client.loadAccess(first);
    await tick();
    const oldCommand = f.client.command('pause');
    f.client.select(second);
    await tick();
    release!({ id: 'old-command', status: 'done' });
    assert.equal(await oldCommand, null);
    assert.equal(f.state().detail?.guildId, second);
    assert.equal(f.state().notice, '');
    assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 1);
  } finally {
    f.client.destroy();
  }
});

test('rejects mismatched server snapshots before exposing private state', async () => {
  const f = fixture((path) =>
    path.startsWith('/api/admin/control?') ? detail(second) : undefined,
  );
  try {
    await f.client.loadAccess(first);
    await tick();
    assert.equal(f.state().detail, null);
    assert.match(f.state().error, /different Discord server/);
  } finally {
    f.client.destroy();
  }
});

test('failed or uncertain commands stay visible after reconciliation and are not replayed', async () => {
  const f = fixture((path, init) =>
    path === '/api/admin/control' && init.method === 'POST'
      ? { id: 'failed-command', status: 'unknown' }
      : undefined,
  );
  try {
    await f.client.loadAccess(first);
    await tick();
    assert.equal(await f.client.command('skip'), null);
    assert.match(f.state().error, /not confirmed/);
    assert.equal(f.calls.filter((call) => call.init.method === 'POST').length, 1);
    assert.equal(f.state().busy, false);
    assert.equal(f.state().detail?.guildId, first);
  } finally {
    f.client.destroy();
  }
});

test('settings success requires the server to echo every requested setting', async () => {
  let saved = false;
  const f = fixture((path, init) =>
    path === '/api/admin/control' && init.method === 'POST'
      ? { settings: saved ? { defaultVolume: 70 } : { defaultVolume: 50 } }
      : undefined,
  );
  try {
    await f.client.loadAccess(first);
    await tick();
    assert.equal(await f.client.control('settings', { settings: { defaultVolume: 70 } }), null);
    assert.match(f.state().error, /did not confirm/);
    saved = true;
    assert(await f.client.control('settings', { settings: { defaultVolume: 70 } }));
    assert.equal(f.state().notice, 'Settings saved for this server.');
  } finally {
    f.client.destroy();
  }
});

test('permission revocation clears detail and does not create an automatic retry loop', async () => {
  let deny = false;
  const f = fixture((path) => {
    if (path.startsWith('/api/admin/control?') && deny)
      throw Object.assign(Error('Access revoked'), { status: 403 });
    return undefined;
  });
  try {
    await f.client.loadAccess(first);
    await tick();
    deny = true;
    await f.client.refresh();
    await tick();
    assert.equal(f.state().detail, null);
    assert.equal(f.state().globalAdmin, false);
    assert.equal(f.calls.filter((call) => call.path.startsWith('/api/admin/control?')).length, 2);
    assert.equal(await f.client.command('pause'), null);
  } finally {
    f.client.destroy();
  }
});

test('owner update link requires a current password session and expires independently of Discord grants', async () => {
  let password = true;
  const f = fixture((path) => {
    if (path === '/api/admin/guilds')
      return { ...access(), globalAdmin: true, ownerUpdateUrl: '/owner-updates' };
    if (path === '/api/admin/session')
      return { authenticated: password, method: password ? 'password' : 'owner' };
    return undefined;
  });
  try {
    await f.client.loadAccess(first);
    await tick();
    assert.equal(f.state().ownerUpdateUrl, '/owner-updates');
    password = false;
    await f.client.validateOwnerSession();
    await tick();
    assert.equal(f.state().ownerUpdateUrl, '');
    assert.equal(f.state().authenticated, true);
    assert.equal(f.state().detail?.guildId, first);
  } finally {
    f.client.destroy();
  }
});

test('invite and owner links reject executable protocols and pin valid guild selection', () => {
  assert.equal(safeAdminLink('javascript:alert(1)'), '');
  assert.equal(safeAdminLink('data:text/html,unsafe'), '');
  assert.equal(safeAdminLink('https://discord.com/oauth2/authorize', 'invalid'), '');
  const url = new URL(safeAdminLink('https://discord.com/oauth2/authorize?client_id=123', first));
  assert.equal(url.searchParams.get('guild_id'), first);
  assert.equal(url.searchParams.get('disable_guild_select'), 'true');
});
