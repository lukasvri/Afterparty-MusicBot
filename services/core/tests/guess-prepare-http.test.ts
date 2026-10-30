import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, watch, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GuessSourceManager, type GuessSourceFactory, type GuessSourceState } from '../src/guess-source-manager.ts';
import { prepareOperatorGuessInventory } from '../src/guess-operator-inventory.ts';
import { guessWave, guessWaveSeconds, GUESS_AUDIO_RATE } from '../src/guess-audio-format.ts';
import { DEFAULT_GUESS_SETTINGS, type GuessResult } from '../src/guess-game.ts';
import { Guilds } from '../src/guilds.ts';
import { DiscordOAuth } from '../src/oauth.ts';
import { Store } from '../src/store.ts';
import { Engine } from '../src/engine.ts';
import { Commands } from '../src/commands.ts';
import { Providers } from '../src/providers.ts';
import { createServers } from '../src/server.ts';
import type { Sink } from '../src/audio.ts';
import { syntheticSong } from './radio-queue-fixture.ts';
import { deferred } from './deferred.ts';

const A = '100000000000000001', B = '100000000000000002', key = 'synthetic-prepare-key';
type Context = Record<string, unknown>;
type Result = GuessResult & { token?: string; sourceState: GuessSourceState; canPrepare: boolean; canManage: boolean };
function source(n = 1) {
  const pcm = new Uint8Array(30 * GUESS_AUDIO_RATE * 2); pcm.fill(n);
  return prepareOperatorGuessInventory([{ song: { id: `fixture-${n}`, title: `Private Fictional Signal ${n}`, artist: 'Private Artist', aliases: [] },
    categoryIds: ['2010s'], permission: { approved: true, reference: 'https://evidence.example.test/private', expiresAt: Date.now() + 3_600_000 }, wav: guessWave(pcm) }]);
}
const mutation = (state: Result, action: string, fields: Context = {}) => ({ action, sessionId: state.game.sessionId,
  revision: state.game.revision, roundId: state.game.round?.roundId ?? null, eventId: randomUUID(), ...fields });
async function fixture(t: TestContext, prepare: GuessSourceFactory, options: { disabled?: boolean; unsupported?: boolean } = {}) {
  const lifetime = new AbortController(), manager = new GuessSourceManager({ env: { GUESS_YOUTUBE_CLIPS: options.disabled ? '0' : '1' }, signal: lifetime.signal, prepare });
  let revokedRole = false, revokedMembership = false, membershipChecks = 0, authGate: ReturnType<typeof deferred<void>> | undefined;
  const oauth = new DiscordOAuth(key, 'synthetic-app', 'synthetic-secret', 'https://site.example', async (_url, init) => {
    membershipChecks++; if (authGate) await authGate.promise;
    const host = new Headers(init?.headers).get('Authorization') === 'Bearer host';
    return Response.json(revokedMembership ? [] : [{ id: A, permissions: host && !revokedRole ? '32' : '0' }]);
  });
  const guilds = new Guilds(A), resources = [A, B].map((id, n) => {
    const store = new Store(':memory:');
    const sink: Sink = { onIdle: null, onError: null, play() { assert.fail('quiz preparation must not play ordinary audio'); },
      pause() {}, resume() {}, stop() {}, duration: () => n * 2000, advancing: () => false, buffering: () => false };
    const engine = new Engine(store, new Providers(store, {}), sink), commands = new Commands(engine); clearInterval(engine.timer);
    engine.ready = true; engine.connected = true; engine.paused = n === 0;
    engine.current = syntheticSong(n + 1, { concert: false, radio: false }); engine.queue = [syntheticSong(n + 20, { concert: false, radio: false })]; engine.checkpoint();
    guilds.register({ id, name: 'Synthetic guild', roomCode: guilds.roomCode(id), engine, commands, bot: {} as never });
    return { engine, commands, store };
  });
  const server = await createServers(resources[0].engine, resources[0].commands, { key, origin: 'https://site.example', publicPort: 0, host: '127.0.0.1', guilds, oauth,
    guessCatalog: manager.catalog, guessMedia: manager.media,
    ...(options.unsupported ? {} : { prepareSource: () => manager.reload(), sourceState: () => manager.status }) });
  const base = 'http://127.0.0.1:' + (server.publicServer.address() as { port: number }).port;
  const call = (input: Context, authorized = true, signal?: AbortSignal) => fetch(base + '/v1/guess', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer ' + key } : {}) }, body: JSON.stringify(input), signal: signal ?? AbortSignal.timeout(5000) });
  const ok = async (input: Context) => { const response = await call(input); assert.equal(response.status, 200, await response.clone().text()); return await response.json() as Result; };
  const room = (host = true, id = 'PREPARE1'): Context => ({ scope: 'room', scopeId: id, host, roomExpiresAt: Date.now() + 3_600_000 });
  const guild = (host = true): Context => ({ scope: 'guild', scopeId: A, tokenCipher: oauth.seal({ access: host ? 'host' : 'guest', expiresAt: Date.now() + 3_600_000, user: { id: A, name: 'Synthetic OAuth' } }) });
  const join = async (context = room()) => { const joined = await ok({ ...context, action: 'join', eventId: randomUUID() }); return { state: joined, context: { ...context, token: joined.token } }; };
  const ordinary = () => structuredClone(resources.map(({ engine, commands, store }) => ({ current: engine.current, queue: engine.queue,
    paused: engine.paused, connected: engine.connected, revision: engine.revision(), queueRevision: commands.concertQueue.revision(),
    position: engine.snapshot().position, checkpoint: store.get('recovery', null) })));
  t.after(async () => { lifetime.abort(); manager.dispose(); authGate?.resolve(); await server.close(); for (const r of resources) { r.commands.close(); r.engine.close(); r.store.close(); } });
  return { call, ok, join, room, guild, manager, ordinary, guilds, server, checks: () => membershipChecks,
    revokeRole: (value: boolean) => { revokedRole = value; }, revokeMembership: (value: boolean) => { revokedMembership = value; },
    blockAuth: () => { authGate = deferred<void>(); return authGate; } };
}

test('catalog and ordinary reads expose safe status but never prepare; a joined host starts one asynchronous single-flight attempt', async t => {
  const gate = deferred<ReturnType<typeof source>>(); let calls = 0;
  const f = await fixture(t, () => { calls++; return gate.promise; }), before = f.ordinary();
  const catalog = await f.ok({ action: 'catalog', sourceState: 'ready', canPrepare: true });
  assert.equal(catalog.sourceState, 'unavailable'); assert.equal(catalog.canPrepare, false); assert.equal(calls, 0);
  const host = await f.join(); assert.equal(host.state.canPrepare, true); assert.equal(calls, 0);
  const prepared = await f.ok({ ...host.context, ...mutation(host.state, 'prepare') });
  assert.equal(prepared.sourceState, 'loading'); assert.equal(prepared.canPrepare, false); assert.equal(calls, 1);
  assert.deepEqual({ ...prepared.game, serverTime: 0 }, { ...host.state.game, serverTime: 0 });
  const repeat = await f.ok({ ...host.context, ...mutation(prepared, 'prepare') });
  assert.equal(repeat.sourceState, 'loading'); assert.equal(calls, 1);
  assert.equal((await f.ok({ ...host.context, action: 'read' })).canPrepare, false); assert.equal(calls, 1);
  const settled = f.manager.reload(); gate.resolve(source()); assert.equal(await settled, true);
  const ready = await f.ok({ ...host.context, action: 'read' }); assert.equal(ready.sourceState, 'ready'); assert.equal(ready.canPrepare, true);
  const publicText = JSON.stringify(ready);
  for (const secret of ['Private Fictional', 'Private Artist', 'evidence.example', 'mediaKey', 'https:']) assert(!publicText.includes(secret));
  assert.deepEqual(f.ordinary(), before);
});

test('guests, revoked room hosts, expired rooms, unsigned callers and unjoined identities cannot spend preparation capacity', async t => {
  let calls = 0; const f = await fixture(t, () => { calls++; return source(); });
  const host = await f.join(), guest = await f.join(f.room(false));
  assert.equal(guest.state.canPrepare, false);
  assert.equal((await f.call({ ...host.context, ...mutation(host.state, 'prepare') }, false)).status, 403);
  for (let n = 0; n < 8; n++) assert.equal((await f.call({ ...guest.context, ...mutation(guest.state, 'prepare') })).status, 403);
  const state = await f.ok({ ...host.context, action: 'read' });
  assert.equal((await f.call({ ...host.context, host: false, ...mutation(state, 'prepare') })).status, 403);
  assert.equal((await f.call({ ...host.context, roomExpiresAt: Date.now() - 1, ...mutation(state, 'prepare') })).status, 404);
  const payload = Buffer.from(JSON.stringify({ scope: 'room:PREPARE1', id: randomUUID(), expires: Date.now() + 60_000 })).toString('base64url');
  const unjoined = payload + '.' + createHmac('sha256', key).update('guess:' + payload).digest('hex');
  assert.equal((await f.call({ ...host.context, token: unjoined, ...mutation(state, 'prepare') })).status, 403);
  assert.equal((await f.call({ ...host.context, token: 'forged', ...mutation(state, 'prepare') })).status, 419);
  assert.equal(calls, 0);
  assert.equal((await f.call({ ...host.context, ...mutation(state, 'prepare') })).status, 200); assert.equal(calls, 1);
});

test('guild preparation refreshes selected-guild host and membership authority and rejects foreign guilds', async t => {
  let calls = 0; const f = await fixture(t, () => { calls++; return source(); });
  const host = await f.join(f.guild()), guest = await f.join(f.guild(false));
  const state = await f.ok({ ...host.context, action: 'read' });
  assert.equal((await f.call({ ...guest.context, host: true, ...mutation(state, 'prepare') })).status, 403);
  f.revokeRole(true); const checks = f.checks();
  assert.equal((await f.call({ ...host.context, host: true, ...mutation(state, 'prepare') })).status, 403); assert(f.checks() > checks);
  f.revokeRole(false); f.revokeMembership(true);
  assert.equal((await f.call({ ...host.context, ...mutation(state, 'prepare') })).status, 403);
  f.revokeMembership(false);
  assert.equal((await f.call({ ...host.context, scopeId: B, ...mutation(state, 'prepare') })).status, 403);
  assert.equal(calls, 0);
  assert.equal((await f.call({ ...host.context, ...mutation(state, 'prepare') })).status, 200); assert.equal(calls, 1);
});

test('preparation rejects stale CAS, replay, untrusted source fields and excess attempts without additional downloads', async t => {
  let clock = Date.now(); t.mock.method(Date, 'now', () => clock);
  const gate = deferred<ReturnType<typeof source>>(); let calls = 0;
  const f = await fixture(t, () => { calls++; return gate.promise; }), host = await f.join();
  for (const fields of [{ sessionId: randomUUID() }, { roundId: randomUUID() }, { revision: host.state.game.revision + 1 }])
    assert.equal((await f.call({ ...host.context, ...mutation(host.state, 'prepare', fields) })).status, 409);
  for (const fields of [{ eventId: 'bad' }, { url: 'https://evil.example.test/audio' }, { settings: {} }, { sourceState: 'ready' }, { canPrepare: true }])
    assert.equal((await f.call({ ...host.context, ...mutation(host.state, 'prepare', fields) })).status, 400);
  assert.equal(calls, 0);
  const input = { ...host.context, ...mutation(host.state, 'prepare') };
  assert.equal((await f.call(input)).status, 200); assert.equal((await f.call(input)).status, 409);
  for (let n = 0; n < 2; n++) assert.equal((await f.call({ ...host.context, ...mutation(host.state, 'prepare') })).status, 200);
  assert.equal((await f.call({ ...host.context, ...mutation(host.state, 'prepare') })).status, 429); assert.equal(calls, 1);
  clock += 60_001;
  assert.equal((await f.call(input)).status, 409, 'an old event remains a replay after the per-minute budget resets');
  assert.equal((await f.call({ ...host.context, ...mutation(host.state, 'prepare') })).status, 200); assert.equal(calls, 1);
  gate.resolve(source()); await f.manager.reload();
});

test('failed preparation stays private and retryable while source disposal and ordinary guild state remain independent', async t => {
  const gate = deferred<ReturnType<typeof source>>(); let calls = 0;
  const f = await fixture(t, () => ++calls === 1 ? gate.promise : source(2)), before = f.ordinary(), host = await f.join();
  const kicked = await f.ok({ ...host.context, ...mutation(host.state, 'prepare') }); assert.equal(kicked.sourceState, 'loading');
  const pending = f.manager.reload(); gate.reject(Error('private URL https://secret.example.test/answer'));
  assert.equal(await pending, false);
  const failed = await f.ok({ ...host.context, action: 'read' }); assert.equal(failed.sourceState, 'unavailable'); assert.equal(failed.canPrepare, true);
  assert(!JSON.stringify(failed).includes('secret.example'));
  await f.ok({ ...host.context, ...mutation(failed, 'prepare') }); await f.manager.reload();
  assert.equal((await f.ok({ ...host.context, action: 'read' })).sourceState, 'ready'); assert.equal(calls, 2); assert.deepEqual(f.ordinary(), before);
});

test('active and revealed rounds cannot prepare; an expired snapshot can be loaded from a new lobby and played again', async t => {
  let clock = Date.now(); t.mock.method(Date, 'now', () => clock);
  let calls = 0; const f = await fixture(t, () => source(++calls)), before = f.ordinary(), host = await f.join();
  await f.ok({ ...host.context, ...mutation(host.state, 'prepare') }); await f.manager.reload();
  let state = await f.ok({ ...host.context, action: 'read' });
  const first = f.manager.catalog.select('2010s', { exclude: [], durationSeconds: 30 });
  state = await f.ok({ ...host.context, ...mutation(state, 'configure', { categoryId: '2010s', settings: { ...DEFAULT_GUESS_SETTINGS, roundCount: 1 } }) });
  state = await f.ok({ ...host.context, ...mutation(state, 'start') }); assert.equal(state.canPrepare, false); clock = state.game.round!.startsAt;
  assert.equal((await f.call({ ...host.context, ...mutation(state, 'prepare') })).status, 409);
  const audio = await f.call({ ...host.context, action: 'media', sessionId: state.game.sessionId, roundId: state.game.round!.roundId, eventId: randomUUID() });
  assert.equal(audio.status, 200); assert.equal(guessWaveSeconds(new Uint8Array(await audio.arrayBuffer())), 30);
  assert.equal(f.manager.catalog.select('2010s', { exclude: [], durationSeconds: 30 }).mediaKey, first.mediaKey); assert.equal(calls, 1);
  state = await f.ok({ ...host.context, ...mutation(state, 'reveal') }); assert.equal(state.canPrepare, false);
  assert.equal((await f.call({ ...host.context, ...mutation(state, 'prepare') })).status, 409);
  state = await f.ok({ ...host.context, ...mutation(state, 'next') }); assert.equal(state.game.phase, 'results'); assert.equal(state.canPrepare, true);
  clock += 300_000; state = await f.ok({ ...host.context, action: 'read' }); assert.equal(state.sourceState, 'unavailable');
  state = await f.ok({ ...host.context, ...mutation(state, 'reset') }); assert.equal(state.game.phase, 'lobby');
  await f.ok({ ...host.context, ...mutation(state, 'prepare') }); await f.manager.reload();
  state = await f.ok({ ...host.context, action: 'read' }); assert.equal(state.sourceState, 'ready'); assert.equal(calls, 2);
  const second = f.manager.catalog.select('2010s', { exclude: [], durationSeconds: 30 }); assert.notEqual(first.mediaKey, second.mediaKey);
  await assert.rejects(f.manager.media.read(first.mediaKey, new AbortController().signal), { status: 503 });
  state = await f.ok({ ...host.context, ...mutation(state, 'start') }); clock = state.game.round!.startsAt;
  const reloaded = await f.call({ ...host.context, action: 'media', sessionId: state.game.sessionId, roundId: state.game.round!.roundId, eventId: randomUUID() });
  assert.equal(reloaded.status, 200); assert.equal(new Uint8Array(await reloaded.arrayBuffer())[44], 2); assert.deepEqual(f.ordinary(), before);
});

test('explicit-off and older unsupported Core dependencies never offer or activate website preparation', async t => {
  for (const options of [{ disabled: true }, { unsupported: true }]) {
    let calls = 0; const f = await fixture(t, () => { calls++; return source(); }, options), host = await f.join();
    assert.equal(host.state.canPrepare, false); assert.equal(host.state.sourceState, 'disabled');
    assert.equal((await f.call({ ...host.context, ...mutation(host.state, 'prepare') })).status, 503); assert.equal(calls, 0);
  }
});

test('a canceled guild authorization cannot kick a source after its caller has disconnected', async t => {
  let calls = 0; const f = await fixture(t, () => { calls++; return source(); }), host = await f.join(f.guild());
  const gate = f.blockAuth(), controller = new AbortController(), before = f.checks();
  const closed = deferred<void>(); f.server.publicServer.once('request', (_request, response) => response.once('close', () => closed.resolve()));
  const pending = f.call({ ...host.context, ...mutation(host.state, 'prepare') }, true, controller.signal);
  for (let n = 0; f.checks() === before && n < 100; n++) await nextTurn();
  assert(f.checks() > before); controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  await closed.promise; gate.resolve(); await nextTurn(); await nextTurn(); assert.equal(calls, 0);
});

test('fresh hosts cannot bypass the global preparation budget by changing rooms', async t => {
  let calls = 0; const f = await fixture(t, () => { calls++; throw Error('controlled preparation failure'); });
  for (let n = 0; n < 13; n++) {
    const host = await f.join(f.room(true, 'BUDGT' + String(n).padStart(3, '0')));
    const response = await f.call({ ...host.context, ...mutation(host.state, 'prepare') });
    assert.equal(response.status, n < 12 ? 200 : 429);
  }
  assert.equal(calls, 12);
});

test('actual shadow bootstrap serves HTTP while alpha-default quiz preparation is blocked and shuts down without a bot connection', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'afterparty-quiz-bootstrap-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const reserved = createServer();
  await new Promise<void>(resolve => reserved.listen(0, '127.0.0.1', resolve));
  const port = (reserved.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => reserved.close(error => error ? reject(error) : resolve()));
  const marker = join(dir, 'started'), extractor = join(dir, 'blocked-extractor.mjs');
  await writeFile(extractor, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.SYNTHETIC_STARTED, String(process.pid));\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
  const cancellation = new AbortController(); t.after(() => cancellation.abort());
  const events = watch(dir, { signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(10_000)]) });
  const started = (async () => { for await (const event of events) if (event.filename === 'started') return Number(await readFile(marker, 'utf8')); throw Error('Synthetic extractor did not start.'); })();
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/main.ts', import.meta.url))], {
    env: { PATH: process.env.PATH, CORE_MODE: 'shadow', DATA_DIR: dir, CORE_PORT: String(port), DISCORD_GUILD_ID: A,
      PUBLIC_SITE_ADMIN_KEY: key, PUBLIC_SITE_URL: 'https://site.example', YTDLP_PATH: extractor, SYNTHETIC_STARTED: marker },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume(); child.stderr.resume();
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
  const extractorState: { pid?: number } = {};
  t.after(async () => {
    child.kill('SIGTERM'); const hardStop = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(hardStop); }
    if (extractorState.pid) try { process.kill(extractorState.pid, 'SIGKILL'); } catch { /* Already canceled by Core. */ }
  });
  extractorState.pid = await started;
  const response = await fetch(`http://127.0.0.1:${port}/v1/guess`, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'catalog' }), signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 200);
  const result = await response.json() as { sourceState: GuessSourceState; canPrepare: boolean; playable: boolean };
  assert.equal(result.sourceState, 'loading'); assert.equal(result.canPrepare, false); assert.equal(result.playable, false);
  child.kill('SIGTERM'); assert.equal(await exited, 0);
});
