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
import { OperatorGuessCatalog } from '../src/guess-catalog.ts';
import { DEFAULT_GUESS_SETTINGS, type GuessResult } from '../src/guess-game.ts';
import { GUESS_AUDIO_RATE, guessWave } from '../src/guess-audio-format.ts';
import type { GuessMediaSource } from '../src/guess-media.ts';
import type { Sink } from '../src/audio.ts';

const A = '100000000000000001', B = '100000000000000002', key = 'synthetic-guess-media-http-key';
const mediaKey = 'synthetic_media_0001';
const wave = guessWave(new Uint8Array(GUESS_AUDIO_RATE * 2 * 30));
type Result = GuessResult & { token?: string; canManage: boolean; mediaAvailable: boolean };
type Context = Record<string, unknown>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function promptly<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(Error('The local HTTP operation did not settle promptly.')), 2000);
    })]);
  } finally { clearTimeout(timer); }
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function grant(scope: string, expires: number, id: string = randomUUID()) {
  const payload = Buffer.from(JSON.stringify({ scope, id, expires })).toString('base64url');
  return payload + '.' + createHmac('sha256', key).update('guess:' + payload).digest('hex');
}
function catalog() {
  return new OperatorGuessCatalog([1, 2].map(n => ({
    rightsCleared: true as const, categoryIds: ['2010s'],
    song: { id: `synthetic-song-${n}`, title: `Hidden Fictional Title ${n}`, artist: 'Hidden Fictional Artist', aliases: [], mediaKey: `synthetic_media_000${n}` },
    media: { key: `synthetic_media_000${n}`, mimeType: 'audio/wav' as const, durationSeconds: 30 },
  })), () => 0);
}
async function fixture(media: GuessMediaSource, oauth?: DiscordOAuth) {
  const guilds = new Guilds(A);
  const resources = [A, B].map(id => {
    const store = new Store(':memory:');
    const sink: Sink = { onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {}, duration: () => 0, advancing: () => false, buffering: () => false };
    const engine = new Engine(store, new Providers(store, {}), sink), commands = new Commands(engine);
    clearInterval(engine.timer); engine.ready = true;
    engine.current = { id: 'abcdefghijk', entryId: id, title: 'Private ordinary music', artist: 'Private ordinary artist', image: '', duration: 600, live: false, embeddable: true, concert: false };
    engine.queue = [{ ...engine.current, entryId: id + '-queued' }];
    guilds.register({ id, name: 'Synthetic guild', roomCode: guilds.roomCode(id), engine, commands, bot: {} as never });
    return { store, engine, commands };
  });
  const server = await createServers(resources[0].engine, resources[0].commands, {
    key, origin: 'https://site.example', publicPort: 0, host: '127.0.0.1', guilds, oauth,
    guessCatalog: catalog(), guessMedia: media,
  });
  const base = 'http://127.0.0.1:' + (server.publicServer.address() as { port: number }).port;
  const call = (input: Context, signal?: AbortSignal, authorized = true) => fetch(base + '/v1/guess', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer ' + key } : {}) },
    body: JSON.stringify(input), signal: signal ?? AbortSignal.timeout(5000),
  });
  const state = () => structuredClone(resources.map(({ engine, commands }) => ({
    current: engine.current, queue: engine.queue, revision: engine.revision(),
    queueRevision: commands.concertQueue.revision(), paused: engine.paused,
  })));
  return { server, base, call, state, async close() {
    await server.close();
    for (const { commands, engine, store } of resources) { commands.close(); engine.close(); store.close(); }
  } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const mutation = (state: Result, action: string, fields: Context = {}) => ({
  action, sessionId: state.game.sessionId, revision: state.game.revision,
  roundId: state.game.round?.roundId ?? null, eventId: randomUUID(), ...fields,
});
const mediaRequest = (context: Context, state: Result, fields: Context = {}) => ({
  ...context, action: 'media', sessionId: state.game.sessionId, roundId: state.game.round!.roundId,
  eventId: randomUUID(), ...fields,
});
async function result(f: Fixture, input: Context) {
  const response = await f.call(input);
  assert.equal(response.status, 200, await response.clone().text());
  return await response.json() as Result;
}
async function start(f: Fixture, scope: Context) {
  let host = await result(f, { ...scope, action: 'join', eventId: randomUUID(), nickname: 'Synthetic host' });
  const context = { ...scope, token: host.token };
  host = await result(f, { ...context, ...mutation(host, 'configure', {
    categoryId: '2010s', settings: { ...DEFAULT_GUESS_SETTINGS, roundCount: 2 },
  }) });
  host = await result(f, { ...context, ...mutation(host, 'start') });
  return { context, host };
}
function watchNextResponse(f: Fixture) {
  let peer: ServerResponse | undefined;
  const closed = deferred();
  f.server.publicServer.once('request', (_request, response) => { peer = response; response.once('close', closed.resolve); });
  return { closed: closed.promise, peer: () => peer };
}
function oauthFixture(clock: () => number) {
  let calls = 0, revoked = false;
  const gates = new Map<number, { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> }>();
  const oauth = new DiscordOAuth(key, 'synthetic-app', 'synthetic-secret', 'https://site.example', async () => {
    const gate = gates.get(++calls);
    if (gate) { gate.entered.resolve(); await gate.release.promise; }
    return Response.json(revoked ? [] : [{ id: A, permissions: '32' }]);
  });
  return {
    oauth, calls: () => calls, revoke: () => { revoked = true; },
    context: () => ({ scope: 'guild', scopeId: A, tokenCipher: oauth.seal({
      access: 'synthetic-access', expiresAt: clock() + 3_600_000, user: { id: A, name: 'Private OAuth identity' },
    }) }),
    block(number: number) { const gate = { entered: deferred(), release: deferred() }; gates.set(number, gate); return gate; },
    release() { for (const gate of gates.values()) gate.release.resolve(); },
  };
}

test('media action requires scoped bridge and participant grants and returns only the active canonical WAV', async t => {
  let clock = Date.now(), bytes = wave, failSource = false;
  t.mock.method(Date, 'now', () => clock);
  const reads: string[] = [];
  const f = await fixture({ async read(key) {
    reads.push(key);
    if (failSource) throw Error('Hidden Fictional Title: https://provider.example/private-title.mp3');
    return bytes;
  } });
  const before = f.state();
  const scope = { scope: 'room', scopeId: 'MEDIAR01', host: true, roomExpiresAt: clock + 3_600_000 };
  try {
    const { context, host } = await start(f, scope);
    assert.equal(host.mediaAvailable, true);
    assert.equal((await f.call(mediaRequest(context, host))).status, 409, 'countdown is not playable');
    clock = host.game.round!.startsAt;
    const valid = mediaRequest(context, host);
    const cases: [Context, number][] = [
      [{ token: undefined }, 419], [{ token: 'forged' }, 419],
      [{ token: grant('room:MEDIAR02', clock + 60_000) }, 419],
      [{ token: grant('room:MEDIAR01', clock - 1) }, 419],
      [{ scopeId: 'MEDIAR02' }, 419],
      [{ token: grant('room:MEDIAR01', clock + 60_000) }, 403],
      [{ sessionId: randomUUID() }, 409], [{ roundId: randomUUID() }, 409],
      [{ eventId: undefined }, 400], [{ eventId: 'not-a-uuid' }, 400],
      [{ scopeId: 'DISCORD1' }, 404], [{ roomExpiresAt: clock - 1 }, 404],
    ];
    assert.equal((await f.call(valid, undefined, false)).status, 403);
    for (const [fields, status] of cases) assert.equal((await f.call({ ...valid, ...fields })).status, status, JSON.stringify(fields));
    assert.equal(reads.length, 0, 'invalid authority never invokes the source');
    const active = await result(f, { ...context, action: 'read' });
    const request = { ...valid, revision: -999, title: 'Forged title', artist: 'Forged artist',
      mediaKey: 'forged_media_0001', providerUrl: 'https://provider.example/private-title.mp3' };
    const response = await f.call(request);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/wav');
    assert.equal(response.headers.get('content-length'), String(wave.length));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-disposition'), null);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    const received = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(received, wave);
    assert.deepEqual(reads, [mediaKey], 'only the server-selected descriptor reaches the source');
    const exposed = JSON.stringify([...response.headers]) + Buffer.from(received).toString('utf8') + JSON.stringify(active);
    for (const secret of ['Hidden Fictional', 'synthetic-song', mediaKey, 'provider.example', 'Private OAuth', 'Private ordinary', 'Forged title', 'Forged artist', 'providerUrl']) {
      assert.equal(exposed.includes(secret), false, secret);
    }
    assert.equal((await f.call(request)).status, 409, 'a replay cannot read the clip twice');
    assert.equal(reads.length, 1);
    for (const invalid of [new Uint8Array([1, 2, 3]), guessWave(new Uint8Array(GUESS_AUDIO_RATE * 2 * 15)),
      new Uint8Array([...wave, ...Buffer.from('Hidden Fictional Title')])]) {
      bytes = invalid;
      assert.equal((await f.call(mediaRequest(context, host))).status, 503, 'reject noncanonical or short source audio');
    }
    failSource = true;
    const failed = await f.call(mediaRequest(context, host));
    assert.equal(failed.status, 503);
    const failure = await failed.text();
    assert.equal(failure.includes('Hidden Fictional'), false); assert.equal(failure.includes('provider.example'), false);
    const latest = await result(f, { ...context, action: 'read' });
    assert.deepEqual(latest.game, active.game, 'media success, replay and source failure do not mutate game revision or scores');
    assert.equal((await fetch(f.base + '/v1/guess/media')).status, 404);
    assert.equal((await fetch(f.base + '/v1/guess/media', { method: 'POST' })).status, 404);
    assert.equal((await fetch(f.base + '/v1/guess', { headers: { Authorization: 'Bearer ' + key } })).status, 405);
    assert.deepEqual(f.state(), before, 'media never changes either guild playback or concert revisions');
  } finally { await f.close(); }
});

test('media rechecks round, session, grant and browser room after source awaits', async t => {
  for (const change of ['reveal', 'deadline', 'reset', 'grant expiry', 'room expiry'] as const) {
    await t.test(change, async t => {
      let clock = Date.now();
      t.mock.method(Date, 'now', () => clock);
      const entered = deferred(), release = deferred();
      const f = await fixture({ async read() { entered.resolve(); await release.promise; return wave; } });
      const scope = { scope: 'room', scopeId: 'MEDIAR01', host: true, roomExpiresAt: clock + 3_600_000 };
      let pending: Promise<Response> | undefined;
      try {
        const { context, host } = await start(f, scope);
        clock = host.game.round!.startsAt;
        const fields: Context = {};
        if (change === 'room expiry') fields.roomExpiresAt = clock + 500;
        if (change === 'grant expiry') {
          const actor = JSON.parse(Buffer.from(String(context.token).split('.')[0], 'base64url').toString()) as { id: string };
          fields.token = grant('room:MEDIAR01', clock + 500, actor.id);
        }
        pending = f.call(mediaRequest(context, host, fields));
        await promptly(entered.promise);
        if (change === 'reveal') await result(f, { ...context, ...mutation(host, 'reveal') });
        else if (change === 'reset') {
          const ended = await result(f, { ...context, ...mutation(host, 'end') });
          await result(f, { ...context, ...mutation(ended, 'reset') });
        } else clock = change === 'deadline' ? host.game.round!.deadline : clock + 1000;
        release.resolve();
        const response = await promptly(pending);
        assert.equal(response.status, change === 'grant expiry' ? 419 : change === 'room expiry' ? 404 : 409);
        assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
        const body = await response.text();
        assert.equal(body.includes('RIFF'), false); assert.equal(body.includes(mediaKey), false);
      } finally { release.resolve(); await pending?.catch(() => {}); await f.close(); }
    });
  }
});

test('guild media rechecks fresh membership after the source and before returning audio', async t => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const auth = oauthFixture(() => clock), entered = deferred(), release = deferred();
  let reads = 0;
  const f = await fixture({ async read() { reads++; entered.resolve(); await release.promise; return wave; } }, auth.oauth);
  const before = f.state();
  let pending: Promise<Response> | undefined;
  try {
    const { context, host } = await start(f, auth.context());
    clock = host.game.round!.startsAt;
    assert.equal((await f.call(mediaRequest({ ...context, scopeId: B }, host))).status, 403);
    assert.equal(reads, 0);
    pending = f.call(mediaRequest(context, host));
    await promptly(entered.promise); auth.revoke(); release.resolve();
    const response = await promptly(pending);
    assert.equal(response.status, 403); assert.equal((await response.text()).includes('RIFF'), false);
    assert.equal((await f.call(mediaRequest(context, host))).status, 403);
    assert.equal(reads, 1, 'revoked guild members never reach the source again');
    assert.deepEqual(f.state(), before);
  } finally { release.resolve(); auth.release(); await pending?.catch(() => {}); await f.close(); }
});

test('cancellation during the initial guild check detaches the handler without starting media', async t => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const auth = oauthFixture(() => clock);
  let reads = 0;
  const f = await fixture({ async read() { reads++; return wave; } }, auth.oauth);
  const abort = new AbortController();
  try {
    const { context, host } = await start(f, auth.context());
    clock = host.game.round!.startsAt;
    const gate = auth.block(auth.calls() + 1), watch = watchNextResponse(f);
    const pending = f.call(mediaRequest(context, host), abort.signal).catch(() => undefined);
    await promptly(gate.entered.promise);
    abort.abort(); await promptly(pending); await promptly(watch.closed); await turn();
    assert.equal(reads, 0);
    assert(watch.peer()?.destroyed); assert.equal(watch.peer()?.headersSent, false);
    assert.equal(watch.peer()?.listenerCount('close'), 0, 'cleanup does not wait for an uncooperative OAuth adapter');
    gate.release.resolve(); await turn();
    const response = await f.call(mediaRequest(context, host));
    assert.equal(response.status, 200); await response.arrayBuffer();
    assert.equal(reads, 1);
  } finally { abort.abort(); auth.release(); await f.close(); }
});

test('aborted media releases the two-request limit even when a source or second membership ignores cancellation', async t => {
  for (const stage of ['source', 'second membership'] as const) {
    await t.test(stage, async t => {
      let clock = Date.now();
      t.mock.method(Date, 'now', () => clock);
      const auth = oauthFixture(() => clock), sources = [deferred(), deferred()], entered = [deferred(), deferred()];
      const signals: AbortSignal[] = [];
      let reads = 0;
      const f = await fixture({ async read(_key, signal) {
        const index = reads++; signals.push(signal);
        if (stage === 'source' && index < 2) { entered[index].resolve(); await sources[index].promise; }
        return wave;
      } }, auth.oauth);
      const before = f.state(), aborts = [new AbortController(), new AbortController()];
      const pending: Promise<Response | undefined>[] = [];
      try {
        const { context, host } = await start(f, auth.context());
        clock = host.game.round!.startsAt;
        const active = await result(f, { ...context, action: 'read' });
        const baseline = auth.calls(), membershipGates = stage === 'second membership'
          ? [auth.block(baseline + 2), auth.block(baseline + 4)] : [];
        const watches: ReturnType<typeof watchNextResponse>[] = [];
        for (let index = 0; index < 2; index++) {
          watches.push(watchNextResponse(f));
          pending.push(f.call(mediaRequest(context, host), aborts[index].signal).catch(() => undefined));
          await promptly(stage === 'source' ? entered[index].promise : membershipGates[index].entered.promise);
        }
        assert.equal(reads, 2);
        assert.equal((await f.call(mediaRequest(context, host))).status, 429, 'at most two unresolved reads are admitted');
        aborts[0].abort(); await promptly(pending[0]); await promptly(watches[0].closed); await turn();
        assert.equal(signals[0].aborted, true);
        assert.equal(watches[0].peer()?.headersSent, false);
        assert.equal(watches[0].peer()?.listenerCount('close'), 0);
        // Both adapter promises are still unresolved here. A canceled request
        // must free its permit without waiting for either promise to cooperate.
        const recovered = await promptly(f.call(mediaRequest(context, host)));
        assert.equal(recovered.status, 200); assert.deepEqual(new Uint8Array(await recovered.arrayBuffer()), wave);
        aborts[1].abort(); await promptly(pending[1]); await promptly(watches[1].closed); await turn();
        assert.equal(signals[1].aborted, true);
        assert.equal(watches[1].peer()?.headersSent, false);
        assert.equal(watches[1].peer()?.listenerCount('close'), 0);
        const latest = await result(f, { ...context, action: 'read' });
        assert.deepEqual(latest.game, active.game);
        assert.deepEqual(f.state(), before, 'aborted reads preserve both guilds and all playback revisions');
      } finally {
        for (const abort of aborts) abort.abort();
        for (const source of sources) source.resolve();
        auth.release(); await Promise.all(pending); await f.close();
      }
    });
  }
});
