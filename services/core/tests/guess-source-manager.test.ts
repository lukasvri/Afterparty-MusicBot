import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { GuessSourceManager, type GuessSourceFactory } from '../src/guess-source-manager.ts';
import { prepareOperatorGuessInventory } from '../src/guess-operator-inventory.ts';
import { GUESS_AUDIO_RATE, guessWave, guessWaveSeconds } from '../src/guess-audio-format.ts';
import { GuessGame, DEFAULT_GUESS_SETTINGS, type GuessAccess } from '../src/guess-game.ts';
import { Store } from '../src/store.ts';
import { Providers } from '../src/providers.ts';
import { Engine } from '../src/engine.ts';
import { Commands } from '../src/commands.ts';
import type { Sink } from '../src/audio.ts';
import { syntheticSong } from './radio-queue-fixture.ts';
import { deferred } from './deferred.ts';

const env = { GUESS_YOUTUBE_CLIPS: '1', GUESS_YOUTUBE_PACK: 'synthetic-fixture-pack' };
const signal = () => new AbortController().signal;
const selection = { exclude: [], durationSeconds: 30 };
const unavailable = { status: 503 };
const host: GuessAccess = { scope: 'room', scopeId: 'MANAGER1', actor: 'synthetic-host', host: true };
function source(n: number, lifetimeMs = 300_000) {
  const pcm = new Uint8Array(GUESS_AUDIO_RATE * 2 * 30); pcm.fill(n);
  const inventory = prepareOperatorGuessInventory([{ song: { id: `synthetic-${n}`, title: `Fictional Signal ${n}`, artist: 'Fictional Artist', aliases: [] },
    categoryIds: ['2010s'], permission: { approved: true, reference: 'https://approval.example.test/private', expiresAt: Date.now() + 3_600_000 }, wav: guessWave(pcm) }], { lifetimeMs });
  let releases = 0;
  return { ...inventory, dispose() { releases++; inventory.dispose(); }, releases: () => releases };
}
type Source = ReturnType<typeof source>;
function manager(prepare: GuessSourceFactory, lifetime = new AbortController()) {
  return new GuessSourceManager({ env, signal: lifetime.signal, prepare });
}

test('disabled manager never calls the factory or activates through caller env mutation', async t => {
  let calls = 0; const config: NodeJS.ProcessEnv = { GUESS_YOUTUBE_CLIPS: '0' }, lifetime = new AbortController();
  const m = new GuessSourceManager({ env: config, signal: lifetime.signal, prepare: () => { calls++; throw Error('private error'); } }); t.after(m.dispose);
  config.GUESS_YOUTUBE_CLIPS = '1';
  assert.equal(m.configured, false); assert.equal(m.status, 'disabled'); assert.equal(await m.reload(), false); assert.equal(await m.reload(), false);
  assert.equal(calls, 0); assert(m.catalog.categories().every(category => !category.available));
  assert.throws(() => m.catalog.select('2010s', selection), unavailable);
  await assert.rejects(m.media.read('not-a-source-key', signal()), unavailable);
  lifetime.abort(); assert.equal(await m.reload(), false);
});

test('concurrent reloads share one preparation and publish through stable proxies only after validation', async t => {
  const gate = deferred<Source>(), entered = deferred<void>(); let calls = 0, preparationSignal: AbortSignal | undefined;
  const m = manager((_config, options) => { calls++; preparationSignal = options.signal; entered.resolve(); return gate.promise; }); t.after(m.dispose);
  const catalog = m.catalog, media = m.media;
  const a = m.reload(), b = m.reload(); assert.equal(a, b); await entered.promise;
  assert.equal(m.status, 'loading');
  assert.equal(calls, 1); assert(m.catalog.categories().every(category => !category.available));
  const prepared = source(1); gate.resolve(prepared);
  assert.equal(await a, true); assert.equal(await b, true);
  assert.equal(m.status, 'ready');
  assert.equal(m.catalog, catalog); assert.equal(m.media, media); assert.equal(preparationSignal?.aborted, false);
  const song = catalog.select('2010s', selection);
  assert.equal(guessWaveSeconds(await media.read(song.mediaKey, signal())), 30);
  assert.equal(await m.reload(), true); assert.equal(calls, 1); assert.equal(prepared.releases(), 0);
});

test('expired source stays unavailable without automatic work and explicit reload restores new games without remapping old keys', async t => {
  let clock = 1_000_000; t.mock.method(Date, 'now', () => clock);
  let calls = 0; const prepared: Source[] = [];
  const m = manager(() => { const s = source(++calls, 30_000); prepared.push(s); return s; }); t.after(m.dispose);
  const catalog = m.catalog, media = m.media, game = new GuessGame({ catalog, now: () => clock });
  assert.equal(await m.reload(), true);
  let state = game.apply(host, { action: 'join', eventId: randomUUID() }).game;
  state = game.apply(host, { action: 'configure', sessionId: state.sessionId, roundId: null, revision: state.revision,
    eventId: randomUUID(), categoryId: '2010s', settings: { ...DEFAULT_GUESS_SETTINGS, roundCount: 1 } }).game;
  // The inventory remains healthy during selection and a local reload cannot replace the active game.
  state = game.apply(host, { action: 'start', sessionId: state.sessionId, roundId: null, revision: state.revision, eventId: randomUUID() }).game;
  clock = state.round!.startsAt;
  const round = { sessionId: state.sessionId, roundId: state.round!.roundId };
  const first = catalog.select('2010s', selection); assert.equal(await m.reload(), true); assert.equal(calls, 1);
  assert.equal((await media.read(game.media(host, round).key, signal()))[44], 1);
  assert.equal(game.apply(host, { action: 'read' }).game.round!.roundId, round.roundId);
  clock = 1_030_000;
  assert(catalog.categories().every(category => !category.available));
  assert.equal(m.status, 'unavailable');
  await assert.rejects(media.read(first.mediaKey, signal()), unavailable); assert.equal(calls, 1);
  assert.equal(await m.reload(), true); assert.equal(calls, 2); assert.equal(prepared[0].releases(), 1);
  assert.equal(m.catalog, catalog); assert.equal(m.media, media);
  const second = catalog.select('2010s', selection); assert.notEqual(second.mediaKey, first.mediaKey);
  await assert.rejects(media.read(first.mediaKey, signal()), unavailable);
  assert.throws(() => catalog.media(first.mediaKey), unavailable);
  assert.throws(() => game.media(host, round), unavailable);
  assert.equal((await media.read(second.mediaKey, signal()))[44], 2);
  const newGame = new GuessGame({ catalog, now: () => clock }), other = { ...host, scopeId: 'MANAGER2' };
  let next = newGame.apply(other, { action: 'join', eventId: randomUUID() }).game;
  assert.equal(next.categories[0].count, 1);
  next = newGame.apply(other, { action: 'configure', sessionId: next.sessionId, roundId: null, revision: next.revision,
    eventId: randomUUID(), categoryId: '2010s', settings: { ...DEFAULT_GUESS_SETTINGS, roundCount: 1 } }).game;
  next = newGame.apply(other, { action: 'start', sessionId: next.sessionId, roundId: null, revision: next.revision, eventId: randomUUID() }).game;
  clock = next.round!.startsAt;
  const playable = newGame.media(other, { sessionId: next.sessionId, roundId: next.round!.roundId });
  assert.equal((await media.read(playable.key, signal()))[44], 2);
});

test('reload captures original config and retains an existing snapshot on failure or when it recovers during preparation', async t => {
  const config = { ...env }, old = source(1), late = source(2), gate = deferred<Source>();
  let available = true, calls = 0;
  const originalCategories = old.catalog.categories;
  old.catalog.categories = () => originalCategories().map(category => available ? category : { ...category, count: 0, available: false, durations: [] });
  const m = new GuessSourceManager({ env: config, signal: signal(), prepare: (snapshot) => {
    assert.equal(snapshot.GUESS_YOUTUBE_PACK, env.GUESS_YOUTUBE_PACK);
    snapshot.GUESS_YOUTUBE_PACK = 'mutation'; calls++;
    if (calls === 1) return old;
    if (calls === 2) throw Error('private /path and provider URL');
    return gate.promise;
  } }); t.after(m.dispose); config.GUESS_YOUTUBE_PACK = 'external-mutation';
  assert.equal(await m.reload(), true); const key = m.catalog.select('2010s', selection).mediaKey;
  available = false; assert.equal(await m.reload(), false); assert.equal(old.releases(), 0);
  const reload = m.reload(); await nextTurn(); available = true; gate.resolve(late);
  assert.equal(await reload, true); assert.equal(old.releases(), 0); assert.equal(late.releases(), 1);
  assert.equal(m.catalog.select('2010s', selection).mediaKey, key);
  assert.equal((await m.media.read(key, signal()))[44], 1);
});

test('invalid and unavailable prepared sources are disposed and never published; public summaries are copied', async t => {
  const malformed = source(1), empty = source(2), valid = source(3); let calls = 0;
  malformed.catalog.categories = () => [{ id: '2010s', name: '2010s', available: true, count: 2, durations: [{ seconds: 30, count: 1 }] }];
  empty.dispose();
  const original = valid.catalog.categories;
  valid.catalog.categories = () => original().map(category => ({ ...category, providerUrl: 'https://private.example.test', secret: 'private' }));
  const m = manager(() => [malformed, empty, valid][calls++]); t.after(m.dispose);
  assert.equal(await m.reload(), false); assert.equal(malformed.releases(), 1);
  assert.equal(await m.reload(), false); assert.equal(empty.releases(), 2);
  assert.equal(await m.reload(), true);
  const summary = m.catalog.categories(); assert(!JSON.stringify(summary).includes('private'));
  summary[0].count = 999; summary[0].durations![0].count = 999;
  assert.equal(m.catalog.categories()[0].count, 1); assert.equal(m.catalog.categories()[0].durations![0].count, 1);
});

test('a failed reload reports a recovered old source as usable without disposing or replacing it', async t => {
  const old = source(1), gate = deferred<Source>(); let available = true, calls = 0;
  const categories = old.catalog.categories;
  old.catalog.categories = () => categories().map(category => available ? category : { ...category, count: 0, available: false, durations: [] });
  const m = manager(() => ++calls === 1 ? old : gate.promise); t.after(m.dispose);
  assert.equal(await m.reload(), true); const key = m.catalog.select('2010s', selection).mediaKey;
  available = false; const pending = m.reload(); await nextTurn(); available = true;
  gate.reject(Error('private failed provider request'));
  assert.equal(await pending, true); assert.equal(old.releases(), 0); assert.equal(calls, 2);
  assert.equal((await m.media.read(key, signal()))[44], 1);
});

test('shutdown during candidate validation cannot publish a partially inspected source', async t => {
  const prepared = source(1), categories = prepared.catalog.categories;
  const m = manager(() => prepared); t.after(m.dispose);
  prepared.catalog.categories = () => { m.dispose(); return categories(); };
  assert.equal(await m.reload(), false); assert.equal(prepared.releases(), 1);
  assert(m.catalog.categories().every(category => !category.available));
});

test('shutdown aborts preparation promptly, suppresses late publication and disposes its eventual result exactly once', async t => {
  const lifetime = new AbortController(), gate = deferred<Source>(), entered = deferred<void>(); let calls = 0, pendingSignal: AbortSignal | undefined;
  const m = manager((_config, options) => { calls++; pendingSignal = options.signal; entered.resolve(); return gate.promise; }, lifetime); t.after(m.dispose);
  const pending = m.reload(); await entered.promise; lifetime.abort();
  assert.equal(await pending, false); assert.equal(pendingSignal?.aborted, true); assert.equal(await m.reload(), false);
  const late = source(1); gate.resolve(late); await nextTurn();
  assert.equal(late.releases(), 1); m.dispose(); assert.equal(late.releases(), 1); assert.equal(calls, 1);
  assert(m.catalog.categories().every(category => !category.available));
  await assert.rejects(m.media.read('private-key', signal()), unavailable);
});

test('shutdown before the startup microtask performs no factory work and late rejection is safely consumed', async t => {
  let calls = 0; const m = manager(() => { calls++; throw Error('private failure'); }); t.after(m.dispose);
  const pending = m.reload(); m.dispose(); assert.equal(await pending, false); assert.equal(calls, 0);
  const gate = deferred<Source>(), n = manager(() => gate.promise); t.after(n.dispose);
  const started = n.reload(); await nextTurn(); n.dispose(); assert.equal(await started, false);
  gate.reject(Error('private delayed failure')); await nextTurn(); assert.equal(await n.reload(), false);
});

test('sixty-second preparation timeout retains single-flight capacity until the ignored dependency settles', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  const gate = deferred<Source>(); let calls = 0;
  const m = manager(() => { calls++; return calls === 1 ? gate.promise : source(2); }); t.after(m.dispose);
  const pending = m.reload(); await nextTurn(); t.mock.timers.tick(60_000);
  assert.equal(await pending, false); assert.equal(await m.reload(), false); assert.equal(calls, 1);
  assert.equal(m.status, 'unavailable', 'an ignored timed-out dependency cannot leave the UI loading forever');
  const late = source(1); gate.resolve(late); await nextTurn(); assert.equal(late.releases(), 1);
  assert.equal(await m.reload(), true); assert.equal(calls, 2);
});

test('alpha default selection configures the manager without fetching until an explicit reload', async t => {
  let calls = 0;
  const m = new GuessSourceManager({ env: {}, signal: signal(), prepare: () => { calls++; return source(1); } }); t.after(m.dispose);
  assert.equal(m.configured, true); assert.equal(m.status, 'unavailable'); assert.equal(calls, 0);
  assert.equal(await m.reload(), true); assert.equal(m.status, 'ready'); assert.equal(calls, 1);
  m.dispose(); assert.equal(m.status, 'unavailable');
});

test('closing a published source cancels reads whose adapters ignore cancellation and clears the synthetic label', async t => {
  const prepared = source(1), gate = deferred<Uint8Array>(), entered = deferred<void>(); let readSignal: AbortSignal | undefined;
  Object.assign(prepared.catalog, { syntheticTest: true });
  prepared.media.read = async (_key, s) => { readSignal = s; entered.resolve(); return gate.promise; };
  const m = manager(() => prepared); t.after(m.dispose); assert.equal(await m.reload(), true);
  assert.equal(m.catalog.syntheticTest, true);
  const key = m.catalog.select('2010s', selection).mediaKey, read = m.media.read(key, signal()); await entered.promise;
  m.dispose(); await assert.rejects(read, { name: 'AbortError' });
  assert.equal(readSignal?.aborted, true); assert.equal(prepared.releases(), 1); assert.equal(m.catalog.syntheticTest, undefined);
  gate.resolve(guessWave(new Uint8Array(GUESS_AUDIO_RATE * 2 * 30))); await nextTurn();
});

test('cancelling one media request preserves the published source and other clients', async t => {
  const prepared = source(1), m = manager(() => prepared); t.after(m.dispose); assert.equal(await m.reload(), true);
  const key = m.catalog.select('2010s', selection).mediaKey, controller = new AbortController();
  const read = m.media.read(key, controller.signal); controller.abort(); await assert.rejects(read, { name: 'AbortError' });
  assert.equal(prepared.releases(), 0); assert.equal(guessWaveSeconds(await m.media.read(key, signal())), 30);
});

test('source reloads and failures preserve two independent ordinary guild queues, clocks, pause intent and checkpoints', async t => {
  const resources = [1, 2].map(n => {
    const store = new Store(':memory:');
    const sink: Sink = { onIdle: null, onError: null, play() { assert.fail('quiz lifecycle must not start ordinary audio'); },
      stop() {}, pause() {}, resume() {}, advancing: () => false, buffering: () => false, duration: () => n * 2000 };
    const engine = new Engine(store, new Providers(store, {}), sink), commands = new Commands(engine); clearInterval(engine.timer);
    engine.current = syntheticSong(n, { radio: false, concert: false }); engine.queue = [syntheticSong(n + 10, { concert: false, radio: false })];
    engine.connected = true; engine.paused = n === 1; engine.ready = true; engine.checkpoint();
    t.after(() => { commands.close(); engine.close(); store.close(); });
    return { engine, commands, store };
  });
  const state = () => structuredClone(resources.map(({ engine, commands, store }) => ({ current: engine.current, queue: engine.queue,
    paused: engine.paused, connected: engine.connected, revision: engine.revision(), queueRevision: commands.concertQueue.revision(),
    position: engine.snapshot().position, recovery: store.get('recovery', null), settings: store.settings() })));
  const before = state(), first = source(1); let available = true, calls = 0;
  const original = first.catalog.categories;
  first.catalog.categories = () => original().map(category => available ? category : { ...category, count: 0, available: false, durations: [] });
  const m = manager(() => { calls++; if (calls === 2) throw Error('private preparation failure'); return calls === 1 ? first : source(2); }); t.after(m.dispose);
  assert.equal(await m.reload(), true); assert.equal(await m.reload(), true);
  available = false; assert.equal(await m.reload(), false); assert.deepEqual(state(), before);
  assert.equal(await m.reload(), true); assert.deepEqual(state(), before); m.dispose(); assert.deepEqual(state(), before);
});
