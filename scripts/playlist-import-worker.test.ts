// Source Worker route + real Workerd Request/fetch and D1 budgets. The outbound
// Core JSON transport is synthetic; no providers, accounts or queues are used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, Response as WorkerResponse, type Request as WorkerRequest } from 'miniflare';

const root = fileURLToPath(new URL('../', import.meta.url));
const key = 'synthetic-playlist-worker-bridge', site = 'https://site.example';
const youtube = 'https://www.youtube.com/playlist?list=PLsynthetic134sets';
const spotify = 'https://open.spotify.com/playlist/' + 'A'.repeat(22);
const unavailableSpotify = 'https://open.spotify.com/playlist/' + 'B'.repeat(22);
type Job = { id: string; token: string; url: string; status: string; source: string };
type Payload = { id: string; token?: string; status: string; source: string; videos: { id: string; title: string; artist: string }[]; total?: number; skipped: number; limited: boolean; error?: string };

test('playlist Worker preserves public metadata jobs, private capabilities and bounded transport', { timeout: 20000 }, async t => {
  const bundle = await build({ stdin: { contents: `import { POST } from './lib/api/playlists/route.ts';
    export default { fetch(request) { return POST(request); } };`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'] });
  const calls: Record<string, unknown>[] = [], jobs = new Map<string, Job>();
  const videos = Array.from({ length: 134 }, (_, i) => ({ id: 'fixture' + String(i).padStart(4, '0'), title: `Public festival set ${i + 1}`, artist: 'Fixture DJ',
    image: `https://i.ytimg.com/vi/fixture${String(i).padStart(4, '0')}/hqdefault.jpg`, duration: 3600, live: false, embeddable: true }));
  let redirect = 0;
  const worker = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], bindings: { GUTTA_CORE_PUBLIC_URL: 'https://core.example', ADMIN_BRIDGE_KEY: key },
    outboundService: async (request: WorkerRequest) => {
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://core.example'); assert.equal(url.pathname, '/v1/playlists'); assert.equal(url.search, '');
      assert.equal(request.method, 'POST'); assert.equal(request.headers.get('authorization'), 'Bearer ' + key);
      assert.equal(request.headers.get('content-type'), 'application/json');
      for (const header of ['cookie', 'x-provider-token', 'x-owner-token', 'x-guild-id']) assert.equal(request.headers.get(header), null, header);
      const input = await request.json() as Record<string, unknown>; calls.push(input);
      if (redirect) return new WorkerResponse(null, { status: redirect, headers: { Location: 'https://untrusted.example/capture?private=source', 'X-Provider-Token': 'upstream-private-token' } });
      if (input.action === 'start') {
        assert.deepEqual(Object.keys(input).sort(), ['action', 'url']);
        const url = String(input.url), id = randomUUID(), token = randomBytes(32).toString('base64url');
        const job = { id, token, url, status: 'processing', source: url.includes('spotify') ? 'spotify' : 'youtube' }; jobs.set(id, job);
        return WorkerResponse.json({ id, token, status: job.status, source: job.source, videos: [], skipped: 0, limited: false });
      }
      assert.deepEqual(Object.keys(input).sort(), ['action', 'id', 'token']);
      const job = jobs.get(String(input.id));
      if (!job || job.token !== input.token) return WorkerResponse.json({ error: 'The playlist import is unavailable.' }, { status: 404 });
      if (input.action === 'cancel') job.status = 'cancelled';
      else if (job.status === 'processing') job.status = job.url === unavailableSpotify ? 'failed' : 'done';
      const failed = job.status === 'failed', complete = job.status === 'done';
      return WorkerResponse.json({ id: job.id, status: job.status, source: job.source,
        videos: complete ? job.source === 'spotify' ? videos.slice(0, 3) : videos : [],
        ...(complete ? { total: job.source === 'spotify' ? 7 : 134 } : {}),
        skipped: complete && job.source === 'spotify' ? 2 : 0, limited: complete && job.source === 'spotify',
        ...(failed ? { error: 'The playlist could not be imported. It may be private or unavailable.' } : {}) });
    },
  }));
  let disabled: Miniflare | undefined;
  try {
    const db = await worker.getD1Database('DB');
    for (const name of (await readdir(new URL('../drizzle/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) {
      const sql = await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8');
      for (const statement of sql.split(';').map(value => value.replaceAll('--> statement-breakpoint', '').trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    await db.prepare('INSERT INTO rooms(code,name,owner_hash,state,updated_at,expires_at) VALUES(?,?,?,?,?,?)').bind('PLAYLIST', 'Untouched fixture room', 'synthetic-owner-hash', '{"queue":[{"id":"abcdefghijk"}],"playing":false,"position":7}', Date.now(), Date.now() + 600000).run();
    const roomBefore = (await db.prepare('SELECT * FROM rooms').all()).results;
    const call = (input: unknown, ip = '192.0.2.1', options: { origin?: string; raw?: string; contentType?: string; path?: string } = {}) => worker.dispatchFetch(site + (options.path ?? '/api/playlists'), {
      method: 'POST', headers: { 'Content-Type': options.contentType ?? 'application/json', Origin: options.origin ?? site, 'CF-Connecting-IP': ip,
        Authorization: 'Bearer forged-client-credential', Cookie: 'provider_session=private', 'X-Provider-Token': 'private-client-provider-token', 'X-Owner-Token': 'forged-owner', 'X-Guild-Id': '100000000000000001' },
      body: options.raw ?? JSON.stringify(input),
    });
    const ok = async (input: unknown, ip?: string) => { const response = await call(input, ip); assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); return await response.json() as Payload; };
    let capability: { id: string; token: string };
    await t.test('watch links import the whole 134-set playlist; forged authority and provider fields never cross the bridge', async () => {
      const start = await ok({ action: 'start', url: 'https://www.youtube.com/watch?v=abcdefghijk&list=PLsynthetic134sets&index=82', host: true, guildId: 'forged-guild', queueRevision: 7, providerUrl: 'http://127.0.0.1/private', token: 'forged', mode: 'one-video' });
      assert.equal(start.status, 'processing'); assert(start.token); capability = { id: start.id, token: start.token }; assert.equal(calls.at(-1)?.url, youtube);
      const read = await ok({ action: 'read', ...capability, host: true, url: 'http://127.0.0.1/private', providerHeaders: { Authorization: 'private' }, queueRevision: 7 });
      assert.equal(read.status, 'done'); assert.equal(read.source, 'youtube'); assert.equal(read.total, 134); assert.equal(read.videos.length, 134);
      assert.equal(read.skipped, 0); assert.equal(read.limited, false); assert.equal(read.token, undefined);
      assert.deepEqual(read.videos.map(video => video.id), videos.map(video => video.id)); assert.equal(new Set(read.videos.map(video => video.id)).size, 134);
      assert.equal(JSON.stringify(read).includes(key), false); assert.equal(JSON.stringify(read).includes(capability.token), false);
    });
    await t.test('Spotify metadata retains incomplete counts and ordinary unavailable errors; cancellation is forwarded explicitly', async () => {
      const start = await ok({ action: 'start', url: spotify + '?si=public-share' }, '192.0.2.2');
      assert.equal(calls.at(-1)?.url, spotify);
      const done = await ok({ action: 'read', id: start.id, token: start.token }, '192.0.2.2');
      assert.equal(done.status, 'done'); assert.equal(done.source, 'spotify'); assert.equal(done.total, 7); assert.equal(done.videos.length, 3); assert.equal(done.skipped, 2); assert.equal(done.limited, true);
      const missing = await ok({ action: 'start', url: unavailableSpotify }, '192.0.2.2');
      const failed = await ok({ action: 'read', id: missing.id, token: missing.token }, '192.0.2.2'); assert.equal(failed.status, 'failed'); assert.equal(failed.videos.length, 0); assert.match(failed.error!, /private or unavailable/);
      const pending = await ok({ action: 'start', url: youtube }, '192.0.2.2');
      const cancelled = await ok({ action: 'cancel', id: pending.id, token: pending.token, host: true }, '192.0.2.2');
      assert.equal(cancelled.status, 'cancelled'); assert.deepEqual(cancelled.videos, []); assert.equal(cancelled.token, undefined);
      assert.equal((await ok({ action: 'read', id: pending.id, token: pending.token }, '192.0.2.2')).status, 'cancelled');
    });
    await t.test('malformed input, cross-origin requests and oversized bodies stop before Core; capabilities stay in JSON only', async () => {
      const before = calls.length;
      const urls = ['http://www.youtube.com/playlist?list=PLsynthetic134sets', 'https://youtube.com.evil.test/playlist?list=PLsynthetic134sets', 'https://user:pass@www.youtube.com/playlist?list=PLsynthetic134sets', 'https://www.youtube.com:443/playlist?list=PLsynthetic134sets', 'https://www.youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com/playlist?list=PLsynthetic134sets&list=PLduplicate12345', 'https://open.spotify.com/track/' + 'A'.repeat(22), 'https://127.0.0.1/private', 'https://www.youtube.com/playlist?list=PLsynthetic134sets\r\nX-Header: x'];
      for (const [index, url] of urls.entries()) assert.equal((await call({ action: 'start', url }, `198.51.100.${index + 1}`)).status, 400, url);
      for (const input of [{ action: 'read', id: randomUUID(), token: 'short' }, { action: 'cancel', id: 'not-a-uuid', token: 'A'.repeat(43) }, { action: 'enqueue', ...capability }, { action: 'read' }, { action: 'start' }, []]) assert.equal((await call(input, '192.0.2.3')).status, 400);
      assert.equal((await call({ action: 'read' }, '192.0.2.3', { path: `/api/playlists?id=${capability.id}&token=${capability.token}` })).status, 400, 'Query capabilities never substitute for the JSON body');
      assert.equal((await call({ action: 'start', url: youtube }, '192.0.2.3', { origin: 'https://untrusted.example' })).status, 403);
      assert.equal((await call({}, '192.0.2.3', { raw: JSON.stringify({ action: 'start', url: youtube, padding: 'x'.repeat(4096) }) })).status, 413);
      assert.equal((await call({}, '192.0.2.3', { raw: '{' })).status, 400); assert.equal((await call({}, '192.0.2.3', { contentType: 'text/plain' })).status, 415);
      assert.equal(calls.length, before);
      const denied = await call({ action: 'read', id: capability.id, token: 'Z'.repeat(43) }, '192.0.2.3'); assert.equal(denied.status, 404);
    });
    await t.test('six starts and 240 polls have independent ten-minute D1 budgets', async () => {
      const ip = '203.0.113.90', before = calls.length, began = Date.now();
      for (let i = 0; i < 6; i++) assert.equal((await call({ action: 'start', url: youtube }, ip)).status, 200);
      assert.equal((await call({ action: 'start', url: youtube }, ip)).status, 429); assert.equal(calls.length, before + 6);
      for (let i = 0; i < 240; i++) assert.equal((await call({ action: 'read', ...capability }, ip)).status, 200, `poll ${i + 1}`);
      assert.equal((await call({ action: 'cancel', ...capability }, ip)).status, 429, 'read/cancel share only the poll budget'); assert.equal(calls.length, before + 246);
      const identity = createHash('sha256').update(ip).digest('hex');
      for (const [scope, count] of [['playlist-start', 6], ['playlist-poll', 240]] as const) {
        const row = await db.prepare('SELECT count,until FROM limits WHERE key=?').bind(`${scope}:${identity}`).first<{ count: number; until: number }>();
        assert(row); assert.equal(row.count, count); assert(row.until >= began + 600000 && row.until <= Date.now() + 600000);
      }
      await db.prepare('UPDATE limits SET until=? WHERE key=?').bind(Date.now() - 1, `playlist-start:${identity}`).run();
      assert.equal((await call({ action: 'start', url: youtube }, ip)).status, 200, 'an expired start window permits a new import');
      const renewed = await db.prepare('SELECT count FROM limits WHERE key=?').bind(`playlist-start:${identity}`).first<{ count: number }>();
      assert.equal(renewed?.count, 1); assert.equal((await call({ action: 'read', ...capability }, ip)).status, 429, 'resetting start does not reset poll');
      assert.equal((await call({ action: 'start', url: youtube }, '203.0.113.91')).status, 200, 'one visitor cannot spend another visitor budget');
    });
    await t.test('redirects never receive bridge credentials or expose provider headers', async () => {
      for (const status of [301, 302, 303, 307, 308]) {
        redirect = status; const before = calls.length, response = await call({ action: 'read', ...capability }, '192.0.2.4');
        assert(response.status >= 400); assert.equal(calls.length, before + 1, 'manual redirect makes exactly one known-Core request');
        assert.equal(response.headers.get('location'), null); assert.equal(response.headers.get('x-provider-token'), null);
        const payload = await response.text(); for (const secret of [key, 'untrusted.example', 'upstream-private-token', capability.token]) assert.equal(payload.includes(secret), false);
      }
      redirect = 0;
    });
    await t.test('an unconfigured Core reports 503 without outbound requests', async () => {
      let outbound = 0;
      disabled = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'], outboundService: () => { outbound++; return WorkerResponse.json({}); } }));
      const response = await disabled.dispatchFetch(site + '/api/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: site }, body: JSON.stringify({ action: 'start', url: youtube }) });
      assert.equal(response.status, 503); assert.match((await response.json() as { error: string }).error, /connected, updated Core/); assert.equal(outbound, 0);
    });
    assert.deepEqual((await db.prepare('SELECT * FROM rooms').all()).results, roomBefore, 'metadata import never touches existing room playback or queues');
  } finally { await disabled?.dispose(); await worker.dispose(); }
});
