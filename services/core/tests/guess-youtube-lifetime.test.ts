import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prepareYoutubeGuessInventory, type YoutubeGuessRecord } from '../src/guess-youtube.ts';
import { GuessGame, DEFAULT_GUESS_SETTINGS, type GuessAccess } from '../src/guess-game.ts';
import { GUESS_AUDIO_RATE, guessWave, guessWaveSeconds } from '../src/guess-audio-format.ts';

const host: GuessAccess = { scope: 'room', scopeId: 'PILOT001', host: true, actor: 'synthetic-host' };
const guest: GuessAccess = { ...host, host: false, actor: 'synthetic-guest' };
const signal = () => new AbortController().signal;
function recordings(expiresAt: number): YoutubeGuessRecord[] {
  return Array.from({ length: 8 }, (_, n) => ({ videoId: `synthetic0${n}`, title: `Fictional Signal ${n}`, artist: `Fictional Artist ${n}`,
    categoryIds: ['2010s'], permission: { approved: true, reference: 'https://approval.example.test/private-evidence', expiresAt } }));
}
function generatedWave(n: number) {
  const pcm = new Uint8Array(30 * GUESS_AUDIO_RATE * 2), samples = new DataView(pcm.buffer);
  for (let sample = 0; sample < pcm.length / 2; sample++)
    samples.setInt16(sample * 2, Math.round(4000 * Math.sin(2 * Math.PI * (220 + n * 55) * sample / GUESS_AUDIO_RATE)), true);
  return guessWave(pcm);
}
async function prepare(records: YoutubeGuessRecord[], advancePreparation = () => {}) {
  let extracts = 0, fetches = 0, decodes = 0;
  const waves = records.map((_, n) => generatedWave(n));
  const inventory = await prepareYoutubeGuessInventory(records, { signal: signal(),
    extract: async args => {
      extracts++; advancePreparation();
      const id = new URL(args.at(-1)!).searchParams.get('v');
      return { id, is_live: false, duration: 200, ext: 'webm', vcodec: 'none', acodec: 'opus',
        url: 'https://rr1---synthetic.googlevideo.com/videoplayback?mime=audio%2Fwebm' };
    },
    fetcher: async () => { fetches++; return new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/webm' } }); },
    decode: async () => waves[decodes++],
  });
  return { ...inventory, waves, calls: () => [extracts, fetches, decodes] };
}

test('eight full thirty-second rounds finish after five minutes with lobby and reveal pauses and identical audio for both players', async t => {
  const preparedAt = 1_000_000; let clock = preparedAt;
  t.mock.method(Date, 'now', () => clock);
  const records = recordings(clock + 3_600_000), inventory = await prepare(records); t.after(inventory.dispose);
  const model = new GuessGame({ catalog: inventory.catalog, now: () => clock });
  let state = model.apply(host, { action: 'join', eventId: randomUUID() }).game;
  model.apply(guest, { action: 'join', eventId: randomUUID() });
  const read = () => { state = model.apply(host, { action: 'read' }).game; return state; };
  const mutation = (action: string, fields = {}, access = host) => {
    const result = model.apply(access, { action, sessionId: state.sessionId, roundId: state.round?.roundId ?? null,
      revision: state.revision, eventId: randomUUID(), ...fields });
    state = result.game; return result;
  };
  read(); mutation('configure', { categoryId: '2010s', settings: { ...DEFAULT_GUESS_SETTINGS, roundCount: 8 } });
  clock += 90_000; mutation('start');
  const seen = new Set<number>(); let roundsPastFiveMinutes = 0;
  for (let round = 1; round <= 8; round++) {
    assert.equal(state.roundNumber, round); clock = state.round!.startsAt; read();
    if (clock - preparedAt > 300_000) roundsPastFiveMinutes++;
    const request = { sessionId: state.sessionId, roundId: state.round!.roundId };
    assert.equal(state.round!.answer, undefined);
    const audio = await Promise.all([host, guest].map(async access => {
      const descriptor = model.media(access, request);
      assert.equal(descriptor.durationSeconds, 30);
      const bytes = await inventory.media.read(descriptor.key, signal());
      assert.equal(guessWaveSeconds(bytes), 30); return bytes;
    }));
    assert.deepEqual(audio[0], audio[1]);
    const n = inventory.waves.findIndex(wav => Buffer.from(wav).equals(Buffer.from(audio[0])));
    assert(n >= 0); assert(!seen.has(n)); seen.add(n);
    for (const access of [host, guest]) {
      const answer = mutation('guess', { text: records[n].title }, access);
      assert.deepEqual(answer.self.result, { correct: true, awarded: 1000 });
    }
    clock = state.round!.deadline - 1;
    assert.equal((await inventory.media.read(model.media(guest, request).key, signal())).length, audio[0].length);
    clock++; read(); assert.equal(state.phase, 'reveal');
    assert.deepEqual(state.round!.answer, { title: records[n].title, artist: records[n].artist });
    assert.throws(() => model.media(guest, request), { status: 409 });
    assert.deepEqual(state.scoreboard.map(player => player.total), [round * 1000, round * 1000]);
    if (round < 8) clock += 15_000;
    mutation('next');
  }
  assert.equal(state.phase, 'results'); assert.equal(seen.size, 8); assert(roundsPastFiveMinutes >= 2);
  assert.equal(clock - preparedAt, 447_000); assert.deepEqual(state.scoreboard.map(player => player.total), [8000, 8000]);
  assert.equal(state.roundNumber, 8); assert.deepEqual(inventory.calls(), [8, 8, 8], 'round playback never prepares or downloads again');
});

test('YouTube inventory stops at thirty minutes from preparation start even when preparation consumes time', async t => {
  const start = 1_000_000; let clock = start;
  t.mock.method(Date, 'now', () => clock);
  const inventory = await prepare(recordings(clock + 3_600_000).slice(0, 1), () => { clock += 30_000; }); t.after(inventory.dispose);
  const key = inventory.catalog.select('2010s', { exclude: [], durationSeconds: 30 }).mediaKey;
  clock = start + 1_800_000 - 1;
  assert.equal(guessWaveSeconds(await inventory.media.read(key, signal())), 30);
  const pending = inventory.media.read(key, signal()); clock++;
  await assert.rejects(pending, { status: 503 });
  assert(inventory.catalog.categories().every(category => category.count === 0 && category.durations?.length === 0 && !category.available));
  assert.throws(() => inventory.catalog.media(key), { status: 503 });
  assert.throws(() => inventory.catalog.select('2010s', { exclude: [], durationSeconds: 30 }), { status: 503 });
  await assert.rejects(inventory.media.read(key, signal()), { status: 503 });
});

test('earlier private approval and explicit disposal still revoke all YouTube clips and pending reads', async t => {
  let clock = 1_000_000; t.mock.method(Date, 'now', () => clock);
  for (const reason of ['permission', 'dispose']) {
    const records = recordings(clock + 3_600_000).slice(0, 2); records[1].permission.expiresAt = clock + 400_000;
    const inventory = await prepare(records); t.after(inventory.dispose);
    const key = inventory.catalog.select('2010s', { exclude: [], durationSeconds: 30 }).mediaKey;
    clock += 399_999; assert.equal(guessWaveSeconds(await inventory.media.read(key, signal())), 30);
    const pending = inventory.media.read(key, signal());
    if (reason === 'permission') clock++; else { inventory.dispose(); inventory.dispose(); }
    await assert.rejects(pending, { status: 503 });
    assert(inventory.catalog.categories().every(category => !category.available && category.count === 0));
    await assert.rejects(inventory.media.read(key, signal()), { status: 503 });
  }
});
