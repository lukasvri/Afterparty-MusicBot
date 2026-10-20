import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { Guilds } from '../src/guilds.ts';
import { DiscordOAuth } from '../src/oauth.ts';
import { Store } from '../src/store.ts';
import { Engine } from '../src/engine.ts';
import { Commands } from '../src/commands.ts';
import { Providers } from '../src/providers.ts';
import { createServers } from '../src/server.ts';
import { OperatorGuessCatalog, type GuessCatalog, type OperatorGuessRecord } from '../src/guess-catalog.ts';
import { DEFAULT_GUESS_SETTINGS, type GuessResult } from '../src/guess-game.ts';
import type { Sink } from '../src/audio.ts';

const A = '100000000000000001', B = '100000000000000002', key = 'synthetic-guess-http-key';
type Result = GuessResult & { token?: string; canManage: boolean };
function catalog(): GuessCatalog {
  const records: OperatorGuessRecord[] = [1, 2].map(n => {
    const mediaKey = `synthetic_media_${String(n).padStart(4, '0')}`;
    return { rightsCleared: true, categoryIds: ['2010s'],
      song: { id: `synthetic-song-${n}`, title: `Fictional Signal ${n}`, artist: 'Sample Artist', aliases: [`Invented Alias ${n}`], mediaKey },
      media: { key: mediaKey, mimeType: 'audio/wav', durationSeconds: 120 } };
  });
  return new OperatorGuessCatalog(records, () => 0);
}
function scopedGrant(scope: string, expires: number) {
  const payload = Buffer.from(JSON.stringify({ scope, id: randomUUID(), expires })).toString('base64url');
  return payload + '.' + createHmac('sha256', key).update('guess:' + payload).digest('hex');
}
async function fixture(options: { oauth?: DiscordOAuth; guessCatalog?: GuessCatalog } = {}) {
  const guilds = new Guilds(A);
  const resources = [A, B].map(id => {
    const store = new Store(':memory:');
    const sink: Sink = { onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {}, duration: () => 0, advancing: () => false, buffering: () => false };
    const engine = new Engine(store, new Providers(store, {}), sink), commands = new Commands(engine);
    clearInterval(engine.timer); engine.ready = true;
    engine.current = { id: 'abcdefghijk', entryId: id, title: 'Private ordinary music', artist: 'Private artist', image: '', duration: 600, live: false, embeddable: true, concert: false };
    engine.queue = [{ ...engine.current, entryId: id + '-queued' }];
    guilds.register({ id, name: 'Synthetic guild', roomCode: guilds.roomCode(id), engine, commands, bot: {} as never });
    return { store, engine, commands };
  });
  const server = await createServers(resources[0].engine, resources[0].commands, { key, origin: 'https://site.example',
    publicPort: 0, host: '127.0.0.1', guilds, ...options });
  const base = 'http://127.0.0.1:' + (server.publicServer.address() as { port: number }).port;
  const call = (input: Record<string, unknown>, authorized = true, signal?: AbortSignal) => fetch(base + '/v1/guess', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer ' + key } : {}) },
    body: JSON.stringify(input), signal: signal ?? AbortSignal.timeout(5000),
  });
  const state = () => structuredClone(resources.map(resource => ({ current: resource.engine.current, queue: resource.engine.queue,
    revision: resource.engine.revision(), queueRevision: resource.commands.concertQueue.revision(), paused: resource.engine.paused })));
  return { server, base, call, state, guilds, async close() {
    await server.close(); for (const resource of resources) { resource.commands.close(); resource.engine.close(); resource.store.close(); }
  } };
}
const mutation = (state: Result, action: string, fields: Record<string, unknown> = {}) => ({
  action, sessionId: state.game.sessionId, revision: state.game.revision, roundId: state.game.round?.roundId ?? null, eventId: randomUUID(), ...fields,
});

test('competitive HTTP refreshes roles, scopes grants, hides metadata, preserves playback and cancels OAuth before joining', async t => {
  let clock = Date.now(), revokedRole = false, revokedMembership = false, block = false;
  t.mock.method(Date, 'now', () => clock);
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const oauth = new DiscordOAuth(key, 'synthetic-app', 'synthetic-secret', 'https://site.example', async (_url, init) => {
    if (block) { entered(); await new Promise<void>(resolve => { release = resolve; }); }
    const bearer = new Headers(init?.headers).get('Authorization');
    return Response.json(revokedMembership ? [] : [{ id: A, permissions: bearer === 'Bearer host' && !revokedRole ? '32' : '0' }]);
  });
  const grant = (access: string, expiresAt = clock + 3_600_000) => oauth.seal({ access, expiresAt, user: { id: A, name: 'Private OAuth name' } });
  const memberGrant = grant('member'), hostGrant = grant('host');
  const f = await fixture({ oauth, guessCatalog: catalog() });
  const before = f.state(), member = { scope: 'guild', scopeId: A, tokenCipher: memberGrant }, manager = { ...member, tokenCipher: hostGrant };
  let peer: ServerResponse | undefined;
  const abort = new AbortController();
  try {
    assert.equal((await f.call({ ...member, action: 'join', eventId: randomUUID() }, false)).status, 403);
    assert.equal((await f.call({ ...member, scopeId: B, action: 'join', eventId: randomUUID() })).status, 403);
    assert.equal((await f.call({ ...manager, scopeId: B, action: 'join', eventId: randomUUID() })).status, 403);
    assert.equal((await f.call({ ...member, tokenCipher: grant('member', clock - 1), action: 'join', eventId: randomUUID() })).status, 401);
    let guest = await (await f.call({ ...member, action: 'join', eventId: randomUUID(), nickname: 'Blue' })).json() as Result;
    let host = await (await f.call({ ...manager, action: 'join', eventId: randomUUID(), nickname: 'Red' })).json() as Result;
    assert.equal(guest.canManage, false); assert.equal(host.canManage, true);
    const guestContext = { ...member, token: guest.token }, hostContext = { ...manager, token: host.token };
    assert.equal((await f.call({ ...guestContext, ...mutation(host, 'start'), host: true })).status, 403);
    assert.equal((await f.call({ ...guestContext, token: 'forged', action: 'read' })).status, 419);
    assert.equal((await f.call({ ...guestContext, token: scopedGrant('guild:' + A, clock - 1), action: 'read' })).status, 419);
    assert.equal((await f.call({ scope: 'room', scopeId: 'ROOM0002', roomExpiresAt: clock + 60_000, token: guest.token, action: 'read' })).status, 419);
    assert.equal((await f.call({ scope: 'room', scopeId: 'DISCORD1', roomExpiresAt: clock + 60_000, host: true, action: 'join', eventId: randomUUID() })).status, 404);
    assert.equal((await f.call({ scope: 'room', scopeId: 'ROOM0002', roomExpiresAt: clock - 1, host: true, action: 'join', eventId: randomUUID() })).status, 404);
    const settings = { ...DEFAULT_GUESS_SETTINGS, roundCount: 2 };
    assert.equal((await f.call({ ...hostContext, ...mutation(host, 'configure', { categoryId: '2010s', settings: { ...settings, durationSeconds: '30' } }) })).status, 400);
    host = await (await f.call({ ...hostContext, ...mutation(host, 'configure', { categoryId: '2010s', settings }), tracks: ['forged'], mediaUrl: 'https://example.test/client.wav' })).json() as Result;
    host = await (await f.call({ ...hostContext, ...mutation(host, 'start') })).json() as Result;
    clock = host.game.round!.startsAt;
    const wrong = { ...guestContext, ...mutation(host, 'guess', { text: 'Never a catalog answer' }), answer: 'Never a catalog answer', correct: true, score: 2000, receivedAt: clock - 100000, deadline: clock + 9999999 };
    guest = await (await f.call(wrong)).json() as Result;
    assert.deepEqual(guest.self.result, { correct: false, awarded: 0 });
    for (const secret of ['Fictional', 'Sample Artist', 'Invented Alias', 'synthetic-song', 'synthetic_media', 'Private OAuth', 'Private ordinary', 'mediaKey']) {
      assert.equal(JSON.stringify(guest.game).includes(secret), false, secret);
    }
    const correct = { ...guestContext, ...mutation(guest, 'guess', { text: 'Invented Alias 1' }) };
    guest = await (await f.call(correct)).json() as Result;
    assert.deepEqual(guest.self.result, { correct: true, awarded: 1000 });
    const renewed = await (await f.call({ ...guestContext, action: 'join', eventId: randomUUID(), nickname: 'Changed' })).json() as Result;
    assert.equal(renewed.token, guest.token ?? guestContext.token); assert.equal(renewed.self.participantId, guest.self.participantId);
    assert.equal(renewed.game.scoreboard.find(player => player.id === guest.self.participantId)!.nickname, 'Blue');
    assert.equal(renewed.self.result!.awarded, 1000);
    assert.equal((await f.call({ ...correct, revision: renewed.game.revision })).status, 409);
    host = await (await f.call({ ...hostContext, action: 'read' })).json() as Result;
    assert.equal(host.self.result, null);
    revokedRole = true;
    assert.equal((await f.call({ ...hostContext, ...mutation(host, 'reveal') })).status, 403);
    assert.equal((await (await f.call({ ...hostContext, action: 'read' })).json() as Result).canManage, false);
    revokedMembership = true;
    assert.equal((await f.call({ ...guestContext, action: 'read' })).status, 403);
    revokedMembership = false; revokedRole = false;
    host = await (await f.call({ ...hostContext, ...mutation(host, 'reveal') })).json() as Result;
    assert.equal(host.game.round!.answer!.title, 'Fictional Signal 1');
    host = await (await f.call({ ...hostContext, ...mutation(host, 'next') })).json() as Result;
    host = await (await f.call({ ...hostContext, ...mutation(host, 'end') })).json() as Result;
    assert.equal(host.game.phase, 'results'); assert.equal(host.game.scoreboard[0].total, 1000);
    clock += 26 * 60000;
    const refreshed = await (await f.call({ ...guestContext, action: 'read' })).json() as Result;
    assert.equal(refreshed.self.participantId, guest.self.participantId);
    assert.equal(refreshed.game.scoreboard[0].total, 1000);
    assert(refreshed.token && refreshed.token !== guestContext.token, 'active identity renews without losing scores');

    // A request canceled while fresh membership is pending cannot register a
    // participant or attach response cleanup after the peer has already closed.
    let closed!: () => void;
    const close = new Promise<void>(resolve => { closed = resolve; });
    const capture = (_request: unknown, response: ServerResponse) => { if (block) { peer = response; response.once('close', closed); } };
    f.server.publicServer.on('request', capture);
    const canceledToken = scopedGrant('guild:' + A, clock + 60_000);
    block = true;
    const pending = f.call({ ...member, token: canceledToken, action: 'join', eventId: randomUUID(), nickname: 'Canceled' }, true, abort.signal).catch(() => undefined);
    await waiting; abort.abort(); await pending; await close;
    block = false; release();
    await new Promise<void>(resolve => setImmediate(resolve)); await new Promise<void>(resolve => setImmediate(resolve));
    f.server.publicServer.off('request', capture);
    assert(peer?.destroyed); assert.equal(peer.headersSent, false); assert.equal(peer.listenerCount('close'), 0);
    assert.equal((await f.call({ ...member, token: canceledToken, action: 'read' })).status, 403);
    const latest = await (await f.call({ ...hostContext, action: 'read' })).json() as Result;
    assert.equal(latest.game.scoreboard.length, 2); assert.equal(latest.game.scoreboard.some(player => player.nickname === 'Canceled'), false);
    assert.deepEqual(f.state(), before, 'all game requests preserve ordinary voice and concert queue revisions in both guilds');
  } finally { abort.abort(); release?.(); await f.close(); }
});

test('default catalog has no media endpoint and rejected traffic spends neither game participants nor public socket capacity', async () => {
  const f = await fixture();
  const room = { scope: 'room', scopeId: 'TESTROOM', host: true, roomExpiresAt: Date.now() + 3_600_000 };
  const before = f.state();
  try {
    const categories = await (await f.call({ action: 'catalog' })).json() as { categories: { available: boolean; count: number }[]; playable: boolean };
    assert.equal(categories.playable, false); assert(categories.categories.every(category => !category.available && category.count === 0));
    let joined = await (await f.call({ ...room, action: 'join', eventId: randomUUID() })).json() as Result;
    const context = { ...room, token: joined.token };
    joined = await (await f.call({ ...context, ...mutation(joined, 'configure', { categoryId: '2010s', settings: DEFAULT_GUESS_SETTINGS }) })).json() as Result;
    assert.equal((await f.call({ ...context, ...mutation(joined, 'start') })).status, 503);
    assert.equal((await fetch(f.base + '/v1/guess/media')).status, 404);
    assert.equal((await f.call({ ...context, action: 'media' })).status, 400);
    for (let n = 0; n < 130; n++) {
      const unsigned = await f.call({ ...room, action: 'join', eventId: randomUUID() }, false);
      assert([403, 429].includes(unsigned.status)); await unsigned.arrayBuffer();
      const forged = await f.call({ ...context, token: 'forged', action: 'read' });
      assert([419, 429].includes(forged.status)); await forged.arrayBuffer();
      const forgedJoin = await f.call({ ...room, token: 'forged', action: 'join', eventId: randomUUID() });
      assert([419, 429].includes(forgedJoin.status)); await forgedJoin.arrayBuffer();
    }
    assert.equal((await f.call({ ...context, action: 'join', eventId: randomUUID() })).status, 200, 'forged joins cannot drain legitimate reconnect capacity');
    const current = await (await f.call({ ...context, action: 'read' })).json() as Result;
    assert.equal(current.game.phase, 'lobby'); assert.equal(current.game.scoreboard.length, 1);
    assert.equal((await f.call({ ...context, ...mutation(current, 'end') })).status, 200);
    // The one missing-endpoint request above spent one public socket request.
    for (let n = 0; n < 599; n++) {
      const response = await fetch(f.base + '/health', { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200, `reserved public request ${n + 1}`); await response.arrayBuffer();
    }
    assert.equal((await fetch(f.base + '/health')).status, 429);
    assert.deepEqual(f.state(), before);
  } finally { await f.close(); }
});
