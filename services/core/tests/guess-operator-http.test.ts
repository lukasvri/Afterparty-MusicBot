import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Guilds } from '../src/guilds.ts';
import { Store } from '../src/store.ts';
import { Engine } from '../src/engine.ts';
import { Commands } from '../src/commands.ts';
import { Providers } from '../src/providers.ts';
import { createServers } from '../src/server.ts';
import { prepareOperatorGuessInventory, type OperatorGuessInventoryRecord } from '../src/guess-operator-inventory.ts';
import { prepareDeezerGuessInventory } from '../src/guess-deezer.ts';
import { prepareYoutubeGuessInventory } from '../src/guess-youtube.ts';
import { buildGuessPackInventory, getGuessPack } from '../src/guess-packs.ts';
import type { GuessSong } from '../src/guess-catalog.ts';
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
async function fixture(records: OperatorGuessInventoryRecord[], inventory = prepareOperatorGuessInventory(records)) {
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
  const state = () => structuredClone(resources.map(({ engine, commands, store }) => ({
    current: engine.current, queue: engine.queue, revision: engine.revision(),
    queueRevision: commands.concertQueue.revision(), paused: engine.paused,
    position: engine.snapshot().position, playing: engine.snapshot().playing,
    connected: engine.connected, buffering: engine.snapshot().buffering, settings: store.settings(),
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
async function players(f: Awaited<ReturnType<typeof fixture>>, clock: number, durationSeconds = 30, categoryId = '2010s') {
  const scope = { scope: 'room', scopeId: 'OPERATR1', roomExpiresAt: clock + 3_600_000 };
  const host = await f.result({ ...scope, host: true, action: 'join', eventId: randomUUID(), nickname: 'Red' });
  const guest = await f.result({ ...scope, host: false, action: 'join', eventId: randomUUID(), nickname: 'Blue' });
  assert.equal(host.canManage, true); assert.equal(guest.canManage, false);
  assert.notEqual(host.token, guest.token); assert.notEqual(host.self.participantId, guest.self.participantId);
  const hostContext = { ...scope, host: true, token: host.token }, guestContext = { ...scope, host: false, token: guest.token };
  let latest = await f.result({ ...hostContext, action: 'read' });
  latest = await f.result({ ...hostContext, ...mutation(latest, 'configure', {
    categoryId, settings: { ...DEFAULT_GUESS_SETTINGS, durationSeconds, roundCount: 2 },
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

test('Deezer adapter, real MP3 decoder and private HTTP deliver generated audio to two players without leaking sources', async t => {
  let clock = Date.now(); t.mock.method(Date, 'now', () => clock);
  const encoded = spawnSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=31', '-threads', '1',
    '-metadata', 'title=Hidden Fictional Signal', '-metadata', 'artist=Hidden Fictional Performer',
    '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', 'pipe:1'], { maxBuffer: 2 * 1024 * 1024 });
  assert.equal(encoded.status, 0, String(encoded.stderr));
  let requests = 0;
  const fetcher: typeof fetch = async input => {
    requests++;
    const url = new URL(String(input));
    if (url.hostname === 'api.deezer.com') return Response.json({
      id: url.pathname.split('/').at(-1), type: 'track', readable: true, duration: 200,
      title: 'Hidden Fictional Signal', artist: { name: 'Hidden Fictional Performer' },
      preview: 'https://cdns-preview-a.dzcdn.net/stream/c-' + 'a'.repeat(32) + '-1.mp3',
    });
    assert.equal(url.hostname, 'cdns-preview-a.dzcdn.net');
    return new Response(encoded.stdout, { headers: { 'content-type': 'audio/mpeg' } });
  };
  const inventory = await prepareDeezerGuessInventory(['1', '2'].map(trackId => ({
    trackId, categoryIds: ['2010s'], permission: { approved: true,
      reference: 'https://evidence.example.test/private-approval', expiresAt: clock + 600_000 },
  })), { fetcher, signal: new AbortController().signal });
  const f = await fixture([], inventory), before = f.state();
  try {
    assert.equal(requests, 4);
    const { hostContext, guestContext, latest } = await players(f, clock);
    clock = latest.game.round!.startsAt;
    const current = await f.result({ ...guestContext, action: 'read' }); assertPrivate(current);
    const bytes = await Promise.all([hostContext, guestContext].map(async context => {
      const response = await f.call(mediaRequest(context, current));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'audio/wav');
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assertPrivate([...response.headers]);
      const wav = new Uint8Array(await response.arrayBuffer());
      assert.equal(guessWaveSeconds(wav), 30);
      assert(wav.subarray(44).some(value => value !== 0));
      assertPrivate(Buffer.from(wav).toString('utf8')); return wav;
    }));
    assert.deepEqual(bytes[0], bytes[1]);
    for (const text of ['deezer', 'dzcdn', 'ID3']) assert(!Buffer.from(bytes[0]).includes(Buffer.from(text)));
    const answered = await f.result({ ...guestContext, ...mutation(current, 'guess', { text: 'Hidden Fictional Signal' }) });
    assert.equal(answered.self.result?.correct, true); assertPrivate(answered);
    const hostRead = await f.result({ ...hostContext, action: 'read' });
    const revealed = await f.result({ ...hostContext, ...mutation(hostRead, 'reveal') });
    assert.deepEqual(revealed.game.round!.answer, { title: 'Hidden Fictional Signal', artist: 'Hidden Fictional Performer' });
    assert.equal((await f.call(mediaRequest(guestContext, revealed))).status, 409);
    assert.deepEqual(f.state(), before);
    assert.equal(requests, 4, 'serving prepared media must not fetch a provider again');
  } finally { await f.close(); }
});

test('YouTube adapter and real container decoder privately serve two players without touching ordinary playback', async t => {
  for (const format of ['webm', 'mp4'] as const) await t.test(format, async t => {
    let clock = Date.now(); t.mock.method(Date, 'now', () => clock);
    const durationSeconds = format === 'webm' ? 15 : 30, ids = ['a1B2c3D4e5F', 'f6G7h8I9j0K'];
    const encoded = spawnSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${durationSeconds + 2}`, '-threads', '1',
      '-metadata', 'title=Hidden Fictional Signal', '-metadata', 'artist=Hidden Fictional Performer',
      '-metadata', 'comment=https://www.youtube.com/watch?v=' + ids[0],
      ...(format === 'webm' ? ['-c:a', 'libopus', '-b:a', '64k', '-f', 'webm']
        : ['-c:a', 'aac', '-b:a', '64k', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4']),
      'pipe:1'], { maxBuffer: 8 * 1024 * 1024 });
    assert.equal(encoded.status, 0, String(encoded.stderr));
    assert(Buffer.from(encoded.stdout).includes(Buffer.from('Hidden Fictional Signal')), 'the encoded fixture really contains private metadata');
    let preparing = true;
    const extracted: string[] = [], fetched: string[] = [];
    const inventory = await prepareYoutubeGuessInventory(ids.map(videoId => ({
      videoId, title: 'Hidden Fictional Signal', artist: 'Hidden Fictional Performer', aliases: ['Private Alias YouTube'],
      categoryIds: ['2010s'], startSeconds: 1, durationSeconds,
      permission: { approved: true, reference: 'https://evidence.example.test/private-approval', expiresAt: clock + 600_000 },
    })), {
      signal: new AbortController().signal,
      extract: async (args, signal) => {
        assert(preparing, 'serving a prepared round must not run yt-dlp again');
        assert.equal(signal.aborted, false);
        const endpoint = args.find(value => value.startsWith('https://www.youtube.com/watch?v='));
        assert(endpoint); const videoId = new URL(endpoint).searchParams.get('v')!;
        assert(ids.includes(videoId)); extracted.push(videoId);
        return { id: videoId, is_live: false, duration: 200, ext: format === 'webm' ? 'webm' : 'm4a',
          vcodec: 'none', acodec: format === 'webm' ? 'opus' : 'mp4a.40.2',
          url: `https://rr1---synthetic.googlevideo.com/videoplayback?mime=audio%2F${format}&id=${videoId}` };
      },
      fetcher: async (input, options) => {
        assert(preparing, 'serving a prepared round must not download source audio again');
        const url = new URL(String(input));
        assert.equal(url.origin, 'https://rr1---synthetic.googlevideo.com'); assert.equal(url.pathname, '/videoplayback');
        assert(ids.includes(url.searchParams.get('id')!)); assert.equal(options?.redirect, 'manual');
        fetched.push(String(input));
        return new Response(encoded.stdout, { headers: { 'content-type': format === 'webm' ? 'audio/webm' : 'audio/mp4' } });
      },
      // Deliberately use the actual default decoder, not an injected PCM fixture.
    });
    const f = await fixture([], inventory), before = f.state();
    preparing = false;
    const privatePayload = (value: unknown) => {
      assertPrivate(value);
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      for (const secret of [...ids, 'youtube.com', 'googlevideo.com', 'videoplayback', 'startSeconds'])
        assert.equal(text.includes(secret), false, secret);
    };
    try {
      assert.deepEqual(extracted, ids); assert.equal(fetched.length, 2);
      const catalog = await (await f.call({ action: 'catalog' })).json() as { playable: boolean; categories: { count: number; durations: unknown }[] };
      assert.equal(catalog.playable, true); assert.equal(catalog.categories[0].count, 2);
      assert.deepEqual(catalog.categories[0].durations, [{ seconds: durationSeconds, count: 2 }]); privatePayload(catalog);
      const { hostContext, guestContext, latest } = await players(f, clock, durationSeconds);
      let current = latest, retiredMedia: Context | undefined;
      for (let round = 1; round <= 2; round++) {
        clock = current.game.round!.startsAt;
        current = await f.result({ ...guestContext, action: 'read' });
        assert.equal(current.canManage, false); assert.equal(current.game.roundNumber, round);
        assert.equal(current.game.round!.answer, undefined); privatePayload(current);
        if (retiredMedia) assert.equal((await f.call({ ...retiredMedia, eventId: randomUUID() })).status, 409, 'old-round media stays unavailable during the next round');
        const bytes = await Promise.all([hostContext, guestContext].map(async context => {
          const response = await f.call(mediaRequest(context, current));
          assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'audio/wav');
          assert.equal(response.headers.get('cache-control'), 'private, no-store');
          assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
          assert.equal(response.headers.get('content-disposition'), null); privatePayload([...response.headers]);
          const wav = new Uint8Array(await response.arrayBuffer());
          assert.equal(guessWaveSeconds(wav), durationSeconds);
          assert.equal(wav.length, 44 + GUESS_AUDIO_RATE * 2 * durationSeconds);
          assert(wav.subarray(44).some(value => value !== 0)); privatePayload(Buffer.from(wav).toString('utf8'));
          return wav;
        }));
        assert.deepEqual(bytes[0], bytes[1], 'independent participants receive the same canonical prepared audio');
        const shared = mutation(current, 'guess', { text: 'Private Alias YouTube' });
        const answered = await Promise.all([hostContext, guestContext].map(context => f.result({ ...context, ...shared, eventId: randomUUID() })));
        for (const answer of answered) { assert.deepEqual(answer.self.result, { correct: true, awarded: 1000 }); privatePayload(answer); }
        current = await f.result({ ...hostContext, action: 'read' });
        assert.deepEqual(current.game.scoreboard.map(player => player.total), [1000 * round, 1000 * round]);
        assert.equal((await f.call({ ...guestContext, ...mutation(current, 'reveal') })).status, 403);
        retiredMedia = mediaRequest(guestContext, current);
        current = await f.result({ ...hostContext, ...mutation(current, 'reveal') });
        assert.deepEqual(current.game.round!.answer, { title: 'Hidden Fictional Signal', artist: 'Hidden Fictional Performer' });
        assert.equal((await f.call(mediaRequest(guestContext, current))).status, 409, 'revealed audio is no longer available');
        current = await f.result({ ...hostContext, ...mutation(current, 'next') });
      }
      assert.equal(current.game.phase, 'results');
      assert.deepEqual(f.state(), before, 'both guilds retain music queues, clocks, connection state and settings');
      assert.deepEqual(extracted, ids); assert.equal(fetched.length, 2, 'private delivery never refetches the source');
    } finally { await f.close(); }
  });
});

test('the bundled festival pack serves private generated audio to two players without exposing its answers or changing music', async t => {
  let clock = Date.now(); t.mock.method(Date, 'now', () => clock);
  const pack = getGuessPack('edm-festival-hits');
  const records = buildGuessPackInventory(pack.id, pack.tracks.map(track => ({ videoId: track.videoId,
    permission: { approved: true, reference: 'https://permission.example.test/synthetic-pack-test', expiresAt: clock + 3_600_000 } })));
  const encoded = spawnSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=61', '-threads', '1', '-c:a', 'libopus', '-f', 'webm', 'pipe:1'], { maxBuffer: 8 * 1024 * 1024 });
  assert.equal(encoded.status, 0, String(encoded.stderr));
  let preparing = true, extracts = 0, fetches = 0;
  const inventory = await prepareYoutubeGuessInventory(records, { signal: new AbortController().signal,
    extract: async args => {
      assert(preparing); const videoId = new URL(args.at(-1)!).searchParams.get('v');
      assert(pack.tracks.some(track => track.videoId === videoId)); extracts++;
      return { id: videoId, is_live: false, duration: 61, ext: 'webm', vcodec: 'none', acodec: 'opus',
        url: 'https://rr1---synthetic.googlevideo.com/videoplayback?mime=audio%2Fwebm' };
    }, fetcher: async () => {
      assert(preparing); fetches++;
      return new Response(encoded.stdout, { headers: { 'content-type': 'audio/webm' } });
    },
    // Real default FFmpeg decoder cuts the requested 30..60 second clip from generated audio.
  });
  preparing = false;
  const selected: GuessSong[] = [], select = inventory.catalog.select.bind(inventory.catalog);
  inventory.catalog.select = (category, options) => { const song = select(category, options); selected.push(song); return song; };
  const f = await fixture([], inventory), before = f.state();
  const hidden = (value: unknown) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const secret of pack.tracks.flatMap(track => [track.videoId, track.title, track.artist, track.sourceUrl])) assert(!text.includes(secret), secret);
    for (const secret of ['mediaKey', 'googlevideo', 'synthetic-pack-test', 'sourceUrl', 'uploaderName']) assert(!text.includes(secret), secret);
  };
  try {
    const catalog = await (await f.call({ action: 'catalog' })).json() as { categories: { id: string; count: number }[] };
    assert.equal(catalog.categories.find(category => category.id === pack.id)?.count, 8); hidden(catalog);
    const { hostContext, guestContext, latest } = await players(f, clock, 30, pack.id);
    assert.equal(selected.length, 2); assert.notEqual(selected[0].id, selected[1].id);
    let current = latest;
    for (let round = 0; round < 2; round++) {
      clock = current.game.round!.startsAt;
      current = await f.result({ ...guestContext, action: 'read' }); hidden(current);
      const audio = await Promise.all([hostContext, guestContext].map(async context => {
        const response = await f.call(mediaRequest(context, current));
        assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'audio/wav');
        assert.equal(response.headers.get('cache-control'), 'private, no-store'); hidden([...response.headers]);
        const bytes = new Uint8Array(await response.arrayBuffer()); assert.equal(guessWaveSeconds(bytes), 30);
        assert(bytes.subarray(44).some(value => value !== 0)); hidden(Buffer.from(bytes).toString('utf8')); return bytes;
      }));
      assert.deepEqual(audio[0], audio[1]);
      const shared = mutation(current, 'guess', { text: selected[round].title });
      const answers = await Promise.all([hostContext, guestContext].map(context => f.result({ ...context, ...shared, eventId: randomUUID() })));
      for (const answer of answers) { assert.deepEqual(answer.self.result, { correct: true, awarded: 1000 }); hidden(answer); }
      current = await f.result({ ...hostContext, action: 'read' });
      current = await f.result({ ...hostContext, ...mutation(current, 'reveal') });
      assert.deepEqual(current.game.round!.answer, { title: selected[round].title, artist: selected[round].artist });
      current = await f.result({ ...hostContext, ...mutation(current, 'next') });
    }
    assert.equal(current.game.phase, 'results'); assert.deepEqual(current.game.scoreboard.map(player => player.total), [2000, 2000]);
    assert.deepEqual([extracts, fetches], [8, 8], 'the prepared pack serves all round media without provider lookups');
    assert.deepEqual(f.state(), before, 'neither guild music state changes during the private pack game');
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
