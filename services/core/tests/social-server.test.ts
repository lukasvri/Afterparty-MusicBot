import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.ts';
import { Providers } from '../src/providers.ts';
import { Engine } from '../src/engine.ts';
import { Commands } from '../src/commands.ts';
import { createServers } from '../src/server.ts';
import { DiscordOAuth } from '../src/oauth.ts';
import type { Sink } from '../src/audio.ts';
test('social HTTP streams authenticate, isolate scopes, deliver reactions and recover snapshots', async () => {
  const store = new Store(':memory:');
  const sink: Sink = { onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {}, duration: () => 0, advancing: () => false, buffering: () => false };
  const engine = new Engine(store, new Providers(store, {}), sink), commands = new Commands(engine);
  const servers = await createServers(engine, commands, { key: 'social-test', origin: 'https://site.example', publicPort: 0, host: '127.0.0.1' });
  const base = 'http://127.0.0.1:' + (servers.publicServer.address() as { port: number }).port;
  const post = (path: string, input: unknown, signal?: AbortSignal) => fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer social-test', 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
  const abort = new AbortController();
  try {
    assert.equal((await fetch(base + '/v1/social', { method: 'POST', body: '{}' })).status, 403);
    const imported = await post('/v1/rooms', { operation: 'import', code: 'TESTROOM', name: 'Test', owner_hash: 'a'.repeat(64), state: { playbackKey: 'room-test-key', current: { id: 'M7lc1UVf-VE', title: 'Concert', artist: 'Band', duration: 600, live: false, embeddable: true, image: '' }, queue: [], playing: false, position: 22 }, version: 1, updated_at: Date.now(), expires_at: Date.now() + 60000 });
    assert.equal(imported.status, 200);
    const joined = await (await post('/v1/social', { action: 'join', scope: 'room', scopeId: 'TESTROOM' })).json() as { token: string; social: { playbackKey: string } };
    const context = { scope: 'room', scopeId: 'TESTROOM', token: joined.token };
    const stream = await post('/v1/social', { ...context, action: 'stream' }, abort.signal);
    assert.equal(stream.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = stream.body!.getReader(), decoder = new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value), /"canManage":false/);
    const result = await post('/v1/social', { ...context, action: 'reaction', playbackKey: joined.social.playbackKey, eventId: randomUUID(), emoji: '🔥' });
    assert.equal(result.status, 200);
    assert.match(decoder.decode((await reader.read()).value), /🔥/);
    assert.equal((await post('/v1/social', { ...context, scopeId: 'OTHERROM', action: 'read' })).status, 404);
    await reader.cancel();
    const reconnected = await post('/v1/social', { ...context, action: 'stream' }, abort.signal);
    const again = reconnected.body!.getReader();
    assert.match(decoder.decode((await again.read()).value), /🔥/); await again.cancel();
  } finally { abort.abort(); await servers.close(); commands.close(); engine.close(); store.close(); }
});
test('Discord membership authorizes ordinary members but never another server or manager powers', async () => {
  const oauth = new DiscordOAuth('synthetic-key', 'test-client', 'test-secret', 'https://site.example', async () => Response.json([{ id: '123456789012345', permissions: '0' }, { id: '223456789012345', permissions: '32' }]) as never);
  const token = oauth.seal({ access: 'synthetic-access', expiresAt: Date.now() + 60000, user: { id: '323456789012345', name: 'Tester' } });
  assert.equal((await oauth.member(token, '123456789012345')).canManage, false);
  assert.equal((await oauth.member(token, '223456789012345')).canManage, true);
  await assert.rejects(oauth.member(token, '423456789012345'), /not a member/);
});
