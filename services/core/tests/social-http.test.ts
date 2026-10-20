import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { Guilds } from '../src/guilds.ts';
import { DiscordOAuth } from '../src/oauth.ts';
import { Store } from '../src/store.ts';
import { Engine } from '../src/engine.ts';
import { Commands } from '../src/commands.ts';
import { Providers } from '../src/providers.ts';
import { createServers } from '../src/server.ts';
import type { Sink } from '../src/audio.ts';
import type { SocialState } from '../src/social.ts';
const A = '100000000000000001', B = '100000000000000002';

test('social HTTP verifies guild membership and host roles; stream and rejected events leave playback intact', async (t) => {
  const guilds = new Guilds(A);
  const resources = [A, B].map(id => {
    const store = new Store(':memory:');
    const sink: Sink = { onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {}, duration: () => 0, advancing: () => false, buffering: () => false };
    const engine = new Engine(store, new Providers(store, {}), sink), commands = new Commands(engine);
    clearInterval(engine.timer);
    engine.current = { id: 'abcdefghijk', entryId: id, title: 'Synthetic concert', artist: 'Artist', image: '', duration: 600, live: false, embeddable: true, concert: true };
    engine.queue = [{ ...engine.current, entryId: id + '-queued' }];
    guilds.register({ id, name: id, roomCode: guilds.roomCode(id), engine, commands, bot: {} as never });
    return { store, engine, commands };
  });
  // Exercise real sealed grants and member() parsing; only the external Discord API is synthetic.
  let revoked = false;
  const oauth = new DiscordOAuth('synthetic-key', 'app', 'secret', 'https://site.example', async (_url, init) => Response.json(
    new Headers(init?.headers).get('Authorization') === 'Bearer host' && !revoked ? [{ id: A, permissions: '32' }] : [{ id: A, permissions: '0' }],
  ));
  const grant = (access: string) => oauth.seal({ access, expiresAt: Date.now() + 60000, user: { id: A, name: 'Synthetic user' } });
  const member = grant('member'), host = grant('host');
  const server = await createServers(resources[0].engine, resources[0].commands, { key: 'synthetic-key', origin: 'https://site.example', guilds, oauth, publicPort: 0, host: '127.0.0.1' });
  const base = 'http://127.0.0.1:' + (server.publicServer.address() as { port: number }).port;
  const call = (input: Record<string, unknown>, authorized = true, path = '/v1/social') => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer synthetic-key' } : {}) }, body: JSON.stringify(input), signal: AbortSignal.timeout(5000) });
  const state = () => resources.map(r => ({ revision: r.engine.revision(), current: r.engine.current, queue: [...r.engine.queue], paused: r.engine.paused, queueRevision: r.commands.concertQueue.revision() }));
  const before = state();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const join = { scope: 'guild', scopeId: A, action: 'join', tokenCipher: member };
    assert.equal((await call(join, false)).status, 403);
    assert.equal((await call({ ...join, tokenCipher: undefined, host: true })).status, 401);
    assert.equal((await call({ ...join, scopeId: B })).status, 403);
    assert.equal((await call({ ...join, tokenCipher: host, scopeId: B })).status, 403, 'administrator access in A must not authorize B');
    for (const scopeId of ['DISCORD1', guilds.roomCode(B)]) assert.equal((await call({ scope: 'room', scopeId, action: 'join', host: true })).status, 404);
    const joinedResponse = await call(join);
    assert.equal(joinedResponse.status, 200);
    const joined = await joinedResponse.json() as { token: string; social: SocialState; canManage: boolean };
    assert.equal(joined.canManage, false);
    const action = { ...join, action: 'reaction', token: joined.token, playbackKey: joined.social.playbackKey, emoji: '🔥', eventId: randomUUID() };
    assert.equal((await call({ ...action, action: 'configure', enabled: false, revision: 0, host: true })).status, 403);
    assert.equal((await call({ ...action, playbackKey: 'stale' })).status, 409);
    assert.equal((await call({ ...action, emoji: '<script>' })).status, 400);
    assert.equal((await call({ ...action, scope: 'room', scopeId: 'TESTROOM' })).status, 404);
    const hostJoin = await (await call({ ...join, tokenCipher: host })).json() as { token: string; social: SocialState };
    const control = { ...join, tokenCipher: host, token: hostJoin.token, playbackKey: hostJoin.social.playbackKey, action: 'configure', enabled: true, revision: hostJoin.social.revision, eventId: randomUUID(), host: true };
    revoked = true;
    assert.equal((await call(control)).status, 403, 'revoked manager must not retain moderation rights');
    const expired = oauth.seal({ access: 'host', expiresAt: Date.now() - 1, user: { id: A, name: 'Expired' } });
    assert.equal((await call({ ...control, tokenCipher: expired })).status, 401);
    assert.equal((await call({ ...join, action: 'highlight', text: 'x'.repeat(9000) })).status, 413);


    for (let i = 0; i < 130; i++) {
      const rejected = await call({...join, action: 'read', token: 'forged-scoped-token'});
      assert([401, 429].includes(rejected.status)); await rejected.arrayBuffer();
    }
    assert.equal((await call({...join, action: 'read', token: joined.token})).status, 200, 'rejected tokens must not consume authenticated social allowance');

    let response: ServerResponse | undefined;
    server.publicServer.on('request', (req, res) => { if (req.url === '/v1/social') response = res; });
    const stream = await call({ ...join, action: 'stream', token: joined.token });
    assert.equal(stream.status, 200);
    reader = stream.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    assert.match(initial, /text|social/);
    assert(response);
    const peer = response;
    const write = t.mock.method(peer, 'write');
    const delivered = await call(action);
    assert.equal(delivered.status, 200);
    assert(write.mock.calls.some(c => String(c.arguments[0]).includes(action.eventId)), 'reaction must reach subscribed peer immediately');
    assert.equal((await call(action)).status, 409, 'repeat event must be rejected');
    const writes = write.mock.callCount();
    Object.defineProperty(peer, 'writableLength', { configurable: true, value: 20000 });
    assert.equal((await call({ ...action, eventId: randomUUID() })).status, 200);
    assert.equal(write.mock.callCount(), writes, 'slow social consumers drop reactions before buffering more bytes');
    delete (peer as unknown as { writableLength?: number }).writableLength;
    await reader.cancel(); reader = undefined;
    const rejoin = await call(join);
    const fresh = await rejoin.json() as { token: string; social: SocialState };
    assert.notEqual(fresh.token, joined.token);
    assert.equal(fresh.social.playbackKey, joined.social.playbackKey);
    assert.deepEqual(state(), before, 'every social request preserves both guild playback and concert queue revisions');
  } finally {
    await reader?.cancel();
    await server.close();
    for (const r of resources) { r.commands.close(); r.engine.close(); r.store.close(); }
  }
});

test('social pressure reserves the public socket budget and forged forwarding headers bypass neither limit', async () => {
  const store = new Store(':memory:');
  const sink: Sink = { onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {}, duration: () => 0, advancing: () => false, buffering: () => false };
  const engine = new Engine(store, new Providers(store, {}), sink), commands = new Commands(engine);
  clearInterval(engine.timer);
  engine.ready = true;
  const server = await createServers(engine, commands, { key: 'synthetic-key', origin: 'https://site.example', publicPort: 0, host: '127.0.0.1' });
  const base = 'http://127.0.0.1:' + (server.publicServer.address() as { port: number }).port;
  const forged = (n: number) => ({ 'X-Forwarded-For': `192.0.2.${n % 250 + 1}`, 'X-Real-IP': `198.51.100.${n % 250 + 1}`, 'CF-Connecting-IP': `203.0.113.${n % 250 + 1}` });
  try {
    // Unsigned traffic has a separate allowance and cannot starve participants.
    for (let i = 0; i < 625; i++) {
      const response = await fetch(base + '/v1/social', { method: 'POST', headers: forged(i), signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, i < 120 ? 403 : 429, `unsigned request ${i + 1}`);
      await response.arrayBuffer();
    }
    // Deliberately exceed the entire shared socket budget with social requests.
    // Malformed participant requests shed through a separate rejection budget.
    for (let i = 0; i < 620; i++) {
      const response = await fetch(base + '/v1/social', { method: 'POST', headers: { ...forged(i), Authorization: 'Bearer synthetic-key', 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, i < 120 ? 400 : 429, `social request ${i + 1}`);
      await response.arrayBuffer();
    }
    for (let i = 0; i < 600; i++) {
      const response = await fetch(base + '/health', { headers: forged(i + 620), signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200, `reserved public request ${i + 1}`);
      await response.arrayBuffer();
    }
    const exhausted = await fetch(base + '/health', { headers: forged(2001), signal: AbortSignal.timeout(5000) });
    assert.equal(exhausted.status, 429, 'changing untrusted forwarding headers must not reset the socket-IP budget');
    await exhausted.arrayBuffer();
  } finally {
    await server.close(); commands.close(); engine.close(); store.close();
  }
});

test('canceling a guild stream during OAuth cannot register a dead peer or leave cleanup timers', async () => {
  const store = new Store(':memory:');
  const sink: Sink = { onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {}, duration: () => 0, advancing: () => false, buffering: () => false };
  const engine = new Engine(store, new Providers(store, {}), sink), commands = new Commands(engine);
  clearInterval(engine.timer);
  const guilds = new Guilds(A);
  guilds.register({ id: A, name: 'Synthetic guild', roomCode: 'DISCORD1', engine, commands, bot: {} as never });
  let block = false;
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const oauth = new DiscordOAuth('synthetic-key', 'app', 'secret', 'https://site.example', async () => {
    if (block) { entered(); await new Promise<void>(resolve => { release = resolve; }); }
    return Response.json([{ id: A, permissions: '0' }]);
  });
  const tokenCipher = oauth.seal({ access: 'synthetic', expiresAt: Date.now() + 60000, user: { id: A, name: 'Test' } });
  const server = await createServers(engine, commands, { key: 'synthetic-key', origin: 'https://site.example', guilds, oauth, publicPort: 0, host: '127.0.0.1' });
  const url = 'http://127.0.0.1:' + (server.publicServer.address() as { port: number }).port + '/v1/social';
  const input = { scope: 'guild', scopeId: A, tokenCipher };
  const headers = { Authorization: 'Bearer synthetic-key', 'Content-Type': 'application/json' };
  let peer: ServerResponse | undefined;
  const abort = new AbortController();
  try {
    const joined = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...input, action: 'join' }) }).then(r => r.json()) as { token: string };
    let closed!: () => void;
    const close = new Promise<void>(resolve => { closed = resolve; });
    server.publicServer.on('request', (_request, response) => { peer = response; response.once('close', closed); });
    block = true;
    const pending = fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...input, action: 'stream', token: joined.token }), signal: abort.signal }).catch(() => undefined);
    await waiting;
    abort.abort(); await pending; await close;
    release();
    // Let the real asynchronous membership and request handlers finish.
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert(peer?.destroyed);
    assert.equal(peer.listenerCount('close'), 0, 'no cleanup may be attached after the peer already closed');
    assert.equal(peer.headersSent, false, 'a canceled request must never initialize an SSE response');
  } finally {
    abort.abort(); release?.(); peer?.emit('close');
    await server.close(); commands.close(); engine.close(); store.close();
  }
});
