import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Guilds } from '../src/guilds.ts';
import { Store } from '../src/store.ts';
import { Engine } from '../src/engine.ts';
import { Commands } from '../src/commands.ts';
import { Providers } from '../src/providers.ts';
import { createServers } from '../src/server.ts';
import { prepareOperatorGuessInventory, type OperatorGuessInventoryRecord } from '../src/guess-operator-inventory.ts';
import { DEFAULT_GUESS_SETTINGS, type GuessResult } from '../src/guess-game.ts';
import { GUESS_AUDIO_RATE, guessWave, guessWaveSeconds } from '../src/guess-audio-format.ts';
import type { Sink } from '../src/audio.ts';

const key = 'synthetic-operator-http-key';
type Context = Record<string, unknown>;
type Result = GuessResult & { token?: string; canManage: boolean; mediaAvailable: boolean };
function recordings(expiresAt: number): OperatorGuessInventoryRecord[] {
  return [1, 2].map(n => {
    const pcm = new Uint8Array(GUESS_AUDIO_RATE * 2 * 30), view = new DataView(pcm.buffer);
    for (let sample = 0; sample < pcm.length / 2; sample++) {
      view.setInt16(sample * 2, Math.round(6000 * Math.sin(2 * Math.PI * (220 * n) * sample / GUESS_AUDIO_RATE)), true);
    }
    return { song: { id: `owned-test-${n}`, title: `Hidden Fictional Signal ${n}`, artist: 'Hidden Fictional Performer', aliases: [`Private Alias ${n}`] },
      categoryIds: ['2010s'], permission: { approved: true, reference: `https://evidence.example.test/private-approval/${n}`, expiresAt },
      wav: guessWave(pcm) };
  });
}
async function fixture(records: OperatorGuessInventoryRecord[]) {
  const inventory = prepareOperatorGuessInventory(records);
  const ids = ['100000000000000001', '100000000000000002'], guilds = new Guilds(ids[0]);
  const resources = ids.map(id => {
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
    key, origin: 'https://site.example', publicPort: 0, host: '127.0.0.1', guilds,
    guessCatalog: inventory.catalog, guessMedia: inventory.media,
  });
  const base = 'http://127.0.0.1:' + (server.publicServer.address() as { port: number }).port;
  const call = (input: Context) => fetch(base + '/v1/guess', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(input), signal: AbortSignal.timeout(5000) });
  const result = async (input: Context) => {
    const response = await call(input);
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as Result;
  };
  const state = () => structuredClone(resources.map(({ engine, commands }) => ({
    current: engine.current, queue: engine.queue, revision: engine.revision(),
    queueRevision: commands.concertQueue.revision(), paused: engine.paused,
  })));
  return { inventory, call, result, state, async close() {
    inventory.dispose(); await server.close();
    for (const { commands, engine, store } of resources) { commands.close(); engine.close(); store.close(); }
  } };
}
const mutation = (state: Result, action: string, fields: Context = {}) => ({ action,
  sessionId: state.game.sessionId, revision: state.game.revision,
  roundId: state.game.round?.roundId ?? null, eventId: randomUUID(), ...fields });
const mediaRequest = (context: Context, state: Result) => ({ ...context, action: 'media',
  sessionId: state.game.sessionId, roundId: state.game.round!.roundId, eventId: randomUUID() });
async function players(f: Awaited<ReturnType<typeof fixture>>, clock: number) {
  const scope = { scope: 'room', scopeId: 'OPERATR1', roomExpiresAt: clock + 3_600_000 };
  const host = await f.result({ ...scope, host: true, action: 'join', eventId: randomUUID(), nickname: 'Red' });
  const guest = await f.result({ ...scope, host: false, action: 'join', eventId: randomUUID(), nickname: 'Blue' });
  assert.equal(host.canManage, true); assert.equal(guest.canManage, false);
  assert.notEqual(host.token, guest.token); assert.notEqual(host.self.participantId, guest.self.participantId);
  const hostContext = { ...scope, host: true, token: host.token }, guestContext = { ...scope, host: false, token: guest.token };
  let latest = await f.result({ ...hostContext, action: 'read' });
  latest = await f.result({ ...hostContext, ...mutation(latest, 'configure', {
    categoryId: '2010s', settings: { ...DEFAULT_GUESS_SETTINGS, roundCount: 2 },
  }) });
  latest = await f.result({ ...hostContext, ...mutation(latest, 'start') });
  return { hostContext, guestContext, latest };
}
function assertPrivate(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of ['Hidden Fictional', 'Private Alias', 'owned-test-', 'mediaKey', 'evidence.example', 'private-approval', 'https://', 'Private ordinary']) {
    assert.equal(text.includes(secret), false, secret);
  }
}

test('real HTTP combines authorized inventory with two concurrent scorers across distinct rounds without touching music', async t => {
  let clock = Date.now(); t.mock.method(Date, 'now', () => clock);
  const records = recordings(clock + 600_000), f = await fixture(records), before = f.state();
  try {
    const catalogResponse = await f.call({ action: 'catalog' });
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json() as { playable: boolean; categories: { count: number }[] };
    assert.equal(catalog.playable, true); assert.equal(catalog.categories[0].count, 2); assertPrivate(catalog);
    const { hostContext, guestContext, latest } = await players(f, clock);
    let current = latest;
    const seen = new Set<string>();
    for (let round = 1; round <= 2; round++) {
      assert.equal(current.game.roundNumber, round);
      clock = current.game.round!.startsAt;
      current = await f.result({ ...hostContext, action: 'read' }); assertPrivate(current);
      assert.equal(current.game.phase, 'round'); assert.equal(current.game.round!.answer, undefined);
      const decoded = await Promise.all([hostContext, guestContext].map(async context => {
        const response = await f.call(mediaRequest(context, current));
        assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'audio/wav');
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(response.headers.get('content-disposition'), null); assertPrivate([...response.headers]);
        const bytes = new Uint8Array(await response.arrayBuffer());
        assert.equal(guessWaveSeconds(bytes), 30); assert(bytes.subarray(44).some(value => value !== 0));
        assertPrivate(Buffer.from(bytes).toString('utf8'));
        return bytes;
      }));
      assert.deepEqual(decoded[0], decoded[1]);
      const recording = records.find(record => Buffer.from(record.wav).equals(Buffer.from(decoded[0])));
      assert(recording, 'HTTP returned exactly one of the prepared, generated canonical WAVs');
      assert(!seen.has(recording.song.id), 'the next round must use a different recording'); seen.add(recording.song.id);
      // Both HTTP requests deliberately retain the exact original revision; the first answer changes it.
      const shared = mutation(current, 'guess', { text: recording.song.aliases[0] });
      const answers = await Promise.all([hostContext, guestContext].map(context => f.result({
        ...context, ...shared, eventId: randomUUID(),
      })));
      for (const answer of answers) {
        assert.deepEqual(answer.self.result, { correct: true, awarded: 1000 });
        assert.equal(answer.game.round!.answer, undefined); assertPrivate(answer);
      }
      current = await f.result({ ...hostContext, action: 'read' });
      assert.equal(current.game.answeredCount, 2);
      assert.deepEqual(current.game.scoreboard.map(player => player.total), [round * 1000, round * 1000]);
      assert.equal((await f.call({ ...guestContext, ...mutation(current, 'reveal') })).status, 403);
      current = await f.result({ ...hostContext, ...mutation(current, 'reveal') });
      assert.equal(current.game.phase, 'reveal');
      assert.deepEqual(current.game.round!.answer, { title: recording.song.title, artist: recording.song.artist });
      const reveal = JSON.stringify(current);
      for (const secret of ['Private Alias', 'owned-test-', 'mediaKey', 'evidence.example', 'private-approval']) assert(!reveal.includes(secret));
      assert.equal((await f.call(mediaRequest(guestContext, current))).status, 409);
      assert.equal((await f.call({ ...guestContext, ...shared, eventId: randomUUID() })).status, 409);
      current = await f.result({ ...hostContext, ...mutation(current, 'next') });
    }
    assert.equal(seen.size, 2); assert.equal(current.game.phase, 'results');
    assert.deepEqual(current.game.scoreboard.map(player => player.total), [2000, 2000]);
    assert.deepEqual(f.state(), before, 'ordinary music, queues and revisions stay unchanged in both guilds');
  } finally { await f.close(); }
});

test('HTTP catalog and active media fail closed after inventory disposal or permission expiry', async t => {
  for (const mode of ['dispose', 'expire'] as const) await t.test(mode, async t => {
    let clock = Date.now(); t.mock.method(Date, 'now', () => clock);
    const expiresAt = clock + 10_000, f = await fixture(recordings(expiresAt)), before = f.state();
    try {
      const { hostContext, guestContext, latest } = await players(f, clock);
      clock = latest.game.round!.startsAt;
      const accepted = await f.call(mediaRequest(guestContext, latest));
      assert.equal(accepted.status, 200); assert.equal(guessWaveSeconds(new Uint8Array(await accepted.arrayBuffer())), 30);
      if (mode === 'dispose') f.inventory.dispose();
      else clock = expiresAt;
      assert(clock < latest.game.round!.deadline, 'the round is still active when authorization expires');
      const response = await f.call({ action: 'catalog' }); assert.equal(response.status, 200);
      const catalog = await response.json() as { playable: boolean; categories: { available: boolean; count: number }[] };
      assert.equal(catalog.playable, false); assert(catalog.categories.every(c => !c.available && c.count === 0)); assertPrivate(catalog);
      const rejected = await f.call(mediaRequest(guestContext, latest));
      assert.equal(rejected.status, 503);
      assertPrivate(await rejected.text());
      assert.deepEqual(f.state(), before);
      // The expired snapshot also blocks starting another game through the ordinary HTTP control path.
      let current = await f.result({ ...hostContext, action: 'read' });
      current = await f.result({ ...hostContext, ...mutation(current, 'end') });
      current = await f.result({ ...hostContext, ...mutation(current, 'reset') });
      assert.equal((await f.call({ ...hostContext, ...mutation(current, 'start') })).status, 503);
    } finally { await f.close(); }
  });
});
