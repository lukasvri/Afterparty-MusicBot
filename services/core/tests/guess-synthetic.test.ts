import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { SyntheticGuessSource } from '../src/guess-synthetic.ts';
import { DEFAULT_GUESS_SETTINGS, GuessGame, type GuessResult } from '../src/guess-game.ts';
import { GUESS_AUDIO_MAX_BYTES, GUESS_AUDIO_RATE, guessWaveSeconds } from '../src/guess-audio-format.ts';

test('synthetic catalog explicitly identifies five fictional recordings and rejects unsupported selections', () => {
  const source = new SyntheticGuessSource(), ids: string[] = [], titles: string[] = [];
  assert.equal(source.syntheticTest, true);
  assert.deepEqual(source.categories(), [{ id: 'synthetic-test', name: 'Synthetic test tones', available: true, count: 5,
    durations: [{ seconds: 30, count: 5 }] }]);
  source.categories()[0].name = 'Changed output';
  source.categories()[0].durations![0].count = 100;
  assert.equal(source.categories()[0].name, 'Synthetic test tones');
  assert.deepEqual(source.categories()[0].durations, [{ seconds: 30, count: 5 }]);
  for (let index = 0; index < 5; index++) {
    const song = source.select('synthetic-test', { exclude: ids, durationSeconds: 30 });
    ids.push(song.id); titles.push(song.title);
    assert.equal(song.artist, 'Synthetic Test Generator');
    assert.equal(source.media(song.mediaKey).durationSeconds, 30);
    assert(Object.isFrozen(song));
  }
  assert.deepEqual(titles.sort(), ['Test Tone Five', 'Test Tone Four', 'Test Tone One', 'Test Tone Three', 'Test Tone Two']);
  for (const [category, duration] of [['2010s', 30], ['edm-classics', 30], ['synthetic-test', 31]] as const)
    assert.throws(() => source.select(category, { exclude: [], durationSeconds: duration }), { status: 503 });
  assert.throws(() => source.select('synthetic-test', { exclude: ids, durationSeconds: 30 }), { status: 503 });
  assert.throws(() => source.media('unknown'), { status: 503 });
});

test('synthetic media is bounded distinct audible PCM, releases no mutable cached buffers and honors cancellation', async () => {
  const source = new SyntheticGuessSource(), ids: string[] = [], hashes = new Set<string>();
  const signal = new AbortController().signal;
  let firstKey = '', firstHash = '';
  for (let index = 0; index < 5; index++) {
    const song = source.select('synthetic-test', { exclude: ids, durationSeconds: 30 }); ids.push(song.id);
    const bytes = await source.read(song.mediaKey, signal);
    assert.equal(bytes.length, GUESS_AUDIO_MAX_BYTES);
    assert.equal(guessWaveSeconds(bytes), 30);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let peak = 0, crossings = 0;
    for (let sample = 0; sample < GUESS_AUDIO_RATE; sample++) {
      const value = view.getInt16(44 + sample * 2, true);
      peak = Math.max(peak, Math.abs(value));
      if (sample && value >= 0 && view.getInt16(42 + sample * 2, true) < 0) crossings++;
    }
    assert(peak >= 5900 && peak <= 6000);
    assert(crossings >= 219 && crossings <= 661, 'audible test frequency lies in the intended range');
    const hash = createHash('sha256').update(bytes).digest('hex'); hashes.add(hash);
    if (!firstKey) { firstKey = song.mediaKey; firstHash = hash; }
    bytes.fill(0);
  }
  assert.equal(hashes.size, 5);
  assert.equal(createHash('sha256').update(await source.read(firstKey, signal)).digest('hex'), firstHash);
  await assert.rejects(source.read('https://example.test/arbitrary.wav', signal), { status: 503 });
  await assert.rejects(source.read(firstKey, AbortSignal.abort()), { status: 503 });
  const canceled = new AbortController(), pending = source.read(firstKey, canceled.signal);
  canceled.abort(); await assert.rejects(pending);
});

test('five-round default game stays answer-safe and reveals the synthetic scope and fictional answers', () => {
  let now = 100000;
  const game = new GuessGame({ catalog: new SyntheticGuessSource(), now: () => now });
  const access = { scope: 'room' as const, scopeId: 'SYNTH001', host: true, actor: randomUUID() };
  let state = game.apply(access, { action: 'join', eventId: randomUUID() });
  const mutate = (action: string, fields: Record<string, unknown> = {}): GuessResult => game.apply(access, {
    action, sessionId: state.game.sessionId, roundId: state.game.round?.roundId ?? null,
    revision: state.game.revision, eventId: randomUUID(), ...fields,
  });
  assert.equal(state.game.categoryId, 'synthetic-test');
  assert.deepEqual(state.game.settings, DEFAULT_GUESS_SETTINGS);
  state = mutate('start');
  const answers = new Set<string>();
  for (let round = 0; round < 5; round++) {
    now = state.game.round!.startsAt;
    assert.equal(state.game.phase, 'round');
    assert.equal(JSON.stringify(state).includes('Test Tone '), false);
    assert.equal(game.media(access, { sessionId: state.game.sessionId, roundId: state.game.round!.roundId }).durationSeconds, 30);
    state = mutate('reveal'); answers.add(state.game.round!.answer!.title);
    state = mutate('next');
  }
  assert.equal(answers.size, 5); assert.equal(state.game.phase, 'results');
});
