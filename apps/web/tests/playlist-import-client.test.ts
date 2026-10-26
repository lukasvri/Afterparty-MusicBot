import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPlaylistImport,
  playlistJob,
  type PlaylistState,
} from '../src/lib/library/playlist-import-client.ts';
const id = '12345678-1234-1234-1234-123456789abc';
const token = 'a'.repeat(40);
const job = (status: 'processing' | 'done' = 'processing') => ({
  id,
  token,
  status,
  source: 'youtube',
  videos: [],
  total: 0,
  skipped: 0,
  limited: false,
});
const url = 'https://www.youtube.com/playlist?list=PL1234567890123456789';
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(fetcher: typeof fetch, hidden = () => false) {
  const timers = new Map<number, () => void>();
  const delays: number[] = [];
  let counter = 0;
  const client = createPlaylistImport({
    fetch: fetcher,
    hidden,
    setTimeout: ((callback: () => void, delay: number) => {
      delays.push(delay);
      const key = ++counter;
      timers.set(key, callback);
      return key;
    }) as unknown as typeof setTimeout,
    clearTimeout: ((key: number) => {
      timers.delete(key);
    }) as unknown as typeof clearTimeout,
  });
  let state: PlaylistState | undefined;
  client.subscribe((value) => {
    state = value;
  });
  return {
    client,
    timers,
    delays,
    state: () => state!,
    tick: async () => {
      const active = [...timers.values()];
      timers.clear();
      active.forEach((callback) => callback());
      await flush();
    },
  };
}
test('preview validates links before requesting and never mutates a queue', async () => {
  const bodies: Record<string, unknown>[] = [];
  const f = fixture((async (_url, options) => {
    bodies.push(JSON.parse(String(options?.body)));
    return Response.json(job('done'));
  }) as typeof fetch);
  await f.client.load('https://attacker.invalid/playlist');
  assert.match(f.state().error, /YouTube or Spotify/);
  assert.equal(bodies.length, 0);
  await f.client.load(url);
  assert.equal(f.state().job?.status, 'done');
  assert.deepEqual(bodies, [{ action: 'start', url }]);
  assert.equal(f.timers.size, 0);
  f.client.destroy();
});
test('jobs poll with their capability and terminate after completion', async () => {
  const bodies: Record<string, unknown>[] = [];
  const f = fixture((async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    bodies.push(body);
    return Response.json(job(body.action === 'start' ? 'processing' : 'done'));
  }) as typeof fetch);
  await f.client.load(url);
  assert.equal(f.state().loading, true);
  assert.equal(f.timers.size, 1);
  await f.tick();
  assert.equal(f.state().loading, false);
  assert.equal(f.state().job?.status, 'done');
  assert.deepEqual(bodies[1], { action: 'read', id, token });
  f.client.destroy();
  assert.equal(bodies.length, 2);
});
test('cancel and destroy revoke active jobs and scheduled polling', async () => {
  const bodies: Record<string, unknown>[] = [];
  const f = fixture((async (_url, options) => {
    bodies.push(JSON.parse(String(options?.body)));
    return Response.json(job());
  }) as typeof fetch);
  await f.client.load(url);
  f.client.cancel();
  assert.equal(f.timers.size, 0);
  assert.equal(f.state().job, null);
  assert.equal(f.state().loading, false);
  assert.match(f.state().notice, /cancelled/);
  await flush();
  assert.deepEqual(bodies[1], { action: 'cancel', id, token });
  await f.client.load(url);
  f.client.destroy();
  await flush();
  assert.deepEqual(bodies[3], { action: 'cancel', id, token });
  assert.equal(f.timers.size, 0);
});
test('a late start result cannot revive a cancelled job and is cancelled remotely', async () => {
  let resolve!: (value: Response) => void;
  const bodies: Record<string, unknown>[] = [];
  const f = fixture((async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    bodies.push(body);
    if (body.action === 'start')
      return new Promise<Response>((done) => {
        resolve = done;
      });
    return Response.json(job());
  }) as typeof fetch);
  const loading = f.client.load(url);
  f.client.cancel();
  resolve(Response.json(job()));
  await loading;
  await flush();
  assert.equal(f.state().job, null);
  assert.equal(f.state().loading, false);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(bodies[1], { action: 'cancel', id, token });
  f.client.destroy();
});
test('background polling suspends and resumes without room mutations', async () => {
  let hidden = false;
  const actions: string[] = [];
  const f = fixture(
    (async (_url, options) => {
      actions.push(JSON.parse(String(options?.body)).action);
      return Response.json(job());
    }) as typeof fetch,
    () => hidden,
  );
  await f.client.load(url);
  hidden = true;
  f.client.visibility();
  assert.equal(f.timers.size, 0);
  hidden = false;
  f.client.visibility();
  await flush();
  assert.deepEqual(actions, ['start', 'read']);
  f.client.destroy();
});
test('mismatched polling result fails closed and cancels original capability', async () => {
  const bodies: Record<string, unknown>[] = [];
  const f = fixture((async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    bodies.push(body);
    return Response.json(
      body.action === 'read' ? { ...job(), id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } : job(),
    );
  }) as typeof fetch);
  await f.client.load(url);
  await f.tick();
  assert.equal(f.state().loading, false);
  assert.match(f.state().error, /could not be loaded/);
  assert.deepEqual(bodies[2], { action: 'cancel', id, token });
  f.client.destroy();
});
test('malformed provider results and invalid capabilities are rejected', () => {
  assert.throws(() => playlistJob({ ...job(), token: 'secret' }));
  assert.throws(() => playlistJob({ ...job(), videos: [{ id: '<script>' }] }));
  assert.throws(() => playlistJob({ ...job(), total: -1 }));
});

test('a transient poll failure retries the existing preview without cancelling or restarting it', async () => {
  const actions: string[] = [];
  let reads = 0;
  const f = fixture((async (_url, options) => {
    const { action } = JSON.parse(String(options?.body));
    actions.push(action);
    if (action === 'read' && ++reads === 1) throw new TypeError('Network disconnected');
    return Response.json(job(action === 'read' ? 'done' : 'processing'));
  }) as typeof fetch);
  await f.client.load(url);
  await f.tick();
  assert.equal(f.state().loading, true);
  assert.match(f.state().notice, /retrying/i);
  assert.equal(f.timers.size, 1);
  assert.deepEqual(actions, ['start', 'read']);
  await f.tick();
  assert.equal(f.state().loading, false);
  assert.equal(f.state().job?.status, 'done');
  assert.equal(f.state().notice, '');
  assert.deepEqual(actions, ['start', 'read', 'read']);
  f.client.destroy();
});
test('temporary server failures retry with a bound and cancellation stops recovery', async () => {
  const actions: string[] = [];
  const f = fixture((async (_url, options) => {
    const { action } = JSON.parse(String(options?.body));
    actions.push(action);
    return action === 'read'
      ? new Response('Temporarily unavailable', { status: 503 })
      : Response.json(job());
  }) as typeof fetch);
  await f.client.load(url);
  for (let attempt = 0; attempt < 3; attempt++) {
    await f.tick();
    assert.equal(f.state().loading, true);
  }
  await f.tick();
  await flush();
  assert.equal(f.state().loading, false);
  assert.match(f.state().error, /could not be loaded/);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(actions, ['start', 'read', 'read', 'read', 'read', 'cancel']);
  assert.deepEqual(f.delays, [1500, 3000, 6000, 12000]);
  await f.client.load(url);
  await f.tick();
  f.client.cancel();
  await f.tick();
  assert.equal(f.state().job, null);
  assert.equal(f.timers.size, 0);
  assert.equal(actions.filter((action) => action === 'start').length, 2);
  f.client.destroy();
});
test('failed start requests and denied polling are never retried automatically', async () => {
  let starts = 0;
  const failed = fixture((async () => {
    starts++;
    throw new TypeError('Network disconnected');
  }) as typeof fetch);
  await failed.client.load(url);
  assert.equal(failed.state().loading, false);
  assert.equal(failed.timers.size, 0);
  assert.equal(starts, 1);
  failed.client.destroy();
  const actions: string[] = [];
  const denied = fixture((async (_url, options) => {
    const { action } = JSON.parse(String(options?.body));
    actions.push(action);
    return action === 'read'
      ? Response.json({ error: 'This preview has expired.' }, { status: 403 })
      : Response.json(job());
  }) as typeof fetch);
  await denied.client.load(url);
  await denied.tick();
  assert.equal(denied.state().loading, false);
  assert.equal(denied.timers.size, 0);
  assert.equal(denied.state().error, 'This preview has expired.');
  assert.deepEqual(actions, ['start', 'read', 'cancel']);
  denied.client.destroy();
});
