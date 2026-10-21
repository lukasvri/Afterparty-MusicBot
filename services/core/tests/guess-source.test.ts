import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareConfiguredGuessSource } from '../src/guess-source.ts';
import { guessWave, GUESS_AUDIO_RATE } from '../src/guess-audio-format.ts';
import { getGuessPackClips } from '../src/guess-packs.ts';

const signal = () => new AbortController().signal;
const unavailable = { status: 503, message: 'The configured game preview source is unavailable.' };
const record = () => ({ trackId: '1', categoryIds: ['2010s'], permission: {
  approved: true, reference: 'https://evidence.example.test/private-approval', expiresAt: Date.now() + 600_000,
} });
const url = 'https://cdns-preview-a.dzcdn.net/stream/c-' + 'a'.repeat(32) + '-1.mp3';
async function directory(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), 'afterparty-guess-config-'));
  t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}

test('Deezer preview startup is default-off and independent from normal playback metadata', async () => {
  const fetcher: typeof fetch = async () => { throw Error('must not fetch'); };
  for (const flag of [undefined, '0', 'true']) assert.equal(await prepareConfiguredGuessSource({
    GUESS_DEEZER_PREVIEWS: flag, GUESS_DEEZER_INVENTORY_PATH: '/does-not-exist', DEEZER_METADATA: '1',
    GUESS_YOUTUBE_CLIPS: '0',
  }, { signal: signal(), fetcher }), undefined);
  const source = await prepareConfiguredGuessSource({ GUESS_SYNTHETIC_TEST: '1' }, { signal: signal(), fetcher });
  assert.equal(source?.catalog.syntheticTest, true);
  assert.equal(source.catalog.categories()[0].count, 5); source.dispose();
});

test('bounded private startup inventory uses the approved adapter and disposes through its lifetime signal', async t => {
  const dir = await directory(t), path = join(dir, 'guess-deezer.local.json');
  await writeFile(path, JSON.stringify([record()]), { mode: 0o600 });
  const lifetime = new AbortController(); let requests = 0;
  const source = await prepareConfiguredGuessSource({ GUESS_DEEZER_PREVIEWS: '1', GUESS_DEEZER_INVENTORY_PATH: path }, {
    signal: lifetime.signal, fetcher: async input => {
      requests++;
      return String(input).startsWith('https://api.deezer.com/') ? Response.json({
        id: '1', type: 'track', readable: true, title: 'Fictional Signal', duration: 180,
        artist: { name: 'Fictional Performer' }, preview: url,
      }) : new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg' } });
    }, decode: async () => guessWave(new Uint8Array(GUESS_AUDIO_RATE * 2 * 15)),
  });
  assert(source); t.after(async () => source.dispose());
  assert.equal(requests, 2);
  const song = source.catalog.select('2010s', { exclude: [], durationSeconds: 15 });
  assert.equal(song.title, 'Fictional Signal');
  assert.equal(source.catalog.media(song.mediaKey).durationSeconds, 15);
  lifetime.abort();
  assert(source.catalog.categories().every(category => !category.available));
  await assert.rejects(source.media.read(song.mediaKey, signal()), { status: 503 });
});

test('invalid private files, flags and permissions fail closed before any provider access', async t => {
  const dir = await directory(t), path = join(dir, 'guess-deezer.local.json');
  let requests = 0;
  const fetcher: typeof fetch = async () => { requests++; throw Error('private-provider-secret'); };
  const env = { GUESS_DEEZER_PREVIEWS: '1', GUESS_DEEZER_INVENTORY_PATH: path };
  for (const config of [{ ...env, GUESS_SYNTHETIC_TEST: '1' }, { ...env, GUESS_DEEZER_INVENTORY_PATH: '' },
    { ...env, GUESS_DEEZER_INVENTORY_PATH: './relative.json' }, { ...env, GUESS_DEEZER_INVENTORY_PATH: dir },
    { ...env, GUESS_DEEZER_INVENTORY_PATH: path + '\n' }, env]) {
    await assert.rejects(prepareConfiguredGuessSource(config, { signal: signal(), fetcher }), unavailable);
  }
  for (const value of ['', ' '.repeat(32_769), 'not-json', '{}', '[]', JSON.stringify(Array.from({ length: 9 }, record)),
    JSON.stringify([{ ...record(), permission: { ...record().permission, approved: false } }]), Buffer.from([0xff])]) {
    await writeFile(path, value);
    await assert.rejects(prepareConfiguredGuessSource(env, { signal: signal(), fetcher }), unavailable);
  }
  await writeFile(path, JSON.stringify([record()]));
  const link = join(dir, 'link.json'); await symlink(path, link);
  await assert.rejects(prepareConfiguredGuessSource({ ...env, GUESS_DEEZER_INVENTORY_PATH: link }, { signal: signal(), fetcher }), unavailable);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(prepareConfiguredGuessSource(env, { signal: aborted.signal, fetcher }), unavailable);
  assert.equal(requests, 0);
  await assert.rejects(prepareConfiguredGuessSource(env, { signal: signal(), fetcher }), unavailable);
  assert.equal(requests, 1);
});

test('YouTube quiz honors explicit off flags, rejects conflicting modes and validates private files before extraction', async t => {
  const dir = await directory(t), path = join(dir, 'youtube.local.json');
  let extractions = 0;
  const options = { signal: signal(), youtube: { extract: async () => { extractions++; throw Error('private extractor details'); } } };
  for (const flag of ['0', 'true', 'false', 'AUTO']) assert.equal(await prepareConfiguredGuessSource({
    GUESS_YOUTUBE_CLIPS: flag, GUESS_YOUTUBE_INVENTORY_PATH: path,
  }, options), undefined);
  const env = { GUESS_YOUTUBE_CLIPS: '1', GUESS_YOUTUBE_INVENTORY_PATH: path };
  for (const config of [{ ...env, GUESS_SYNTHETIC_TEST: '1' }, { ...env, GUESS_DEEZER_PREVIEWS: '1' },
    { ...env, GUESS_YOUTUBE_INVENTORY_PATH: './relative.json' }, env]) {
    await assert.rejects(prepareConfiguredGuessSource(config, options), unavailable);
  }
  for (const value of ['[]', '{}', 'not-json', ' '.repeat(32769), JSON.stringify([record()])]) {
    await writeFile(path, value);
    await assert.rejects(prepareConfiguredGuessSource(env, options), unavailable);
  }
  const link = join(dir, 'youtube-link.json'); await symlink(path, link);
  await assert.rejects(prepareConfiguredGuessSource({ ...env, GUESS_YOUTUBE_INVENTORY_PATH: link }, options), unavailable);
  assert.equal(extractions, 0);
});

test('private YouTube clip configuration reaches only its adapter and expires through the source lifetime', async t => {
  const dir = await directory(t), path = join(dir, 'youtube.local.json'), lifetime = new AbortController();
  const videoId = 'abcDEF123_-', cdn = 'https://rr1---sn-synthetic.googlevideo.com/videoplayback?expire=9999999999';
  await writeFile(path, JSON.stringify([{ videoId, title: 'Fictional Signal', artist: 'Fictional Performer', categoryIds: ['2010s'],
    startSeconds: 5, durationSeconds: 15, permission: record().permission }]), { mode: 0o600 });
  let extracted = 0, fetched = 0, decoded = 0;
  const source = await prepareConfiguredGuessSource({ GUESS_YOUTUBE_INVENTORY_PATH: path }, {
    signal: lifetime.signal, fetcher: async () => { assert.fail('YouTube must not invoke the Deezer fetcher'); },
    youtube: {
      extract: async args => { extracted++; assert.equal(args.at(-1), 'https://www.youtube.com/watch?v=' + videoId);
        return { id: videoId, extractor_key: 'Youtube', is_live: false, live_status: 'not_live', duration: 60, url: cdn,
          ext: 'webm', vcodec: 'none', acodec: 'opus', protocol: 'https' }; },
      fetcher: async (input, init) => { fetched++; assert.equal(String(input), cdn); assert.equal(init?.redirect, 'manual');
        return new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/webm' } }); },
      decode: async (_input, clip, clipSignal) => { decoded++; assert.deepEqual(clip, { format: 'webm', startSeconds: 5, durationSeconds: 15 });
        assert(!clipSignal.aborted); return guessWave(new Uint8Array(GUESS_AUDIO_RATE * 2 * 15)); },
    },
  });
  assert(source); t.after(source.dispose);
  assert.deepEqual([extracted, fetched, decoded], [1, 1, 1]);
  const selected = source.catalog.select('2010s', { exclude: [], durationSeconds: 15 });
  assert.equal(selected.title, 'Fictional Signal'); assert.notEqual(selected.id, videoId);
  assert.equal(source.catalog.media(selected.mediaKey).durationSeconds, 15);
  lifetime.abort(); assert(source.catalog.categories().every(category => !category.available));
  await assert.rejects(source.media.read(selected.mediaKey, signal()), { status: 503 });
});

test('unconfigured alpha Core prepares the eight-track preset with actual FFmpeg and no private approval file', async t => {
  let clock = Date.now(); t.mock.method(Date, 'now', () => clock);
  const clips = getGuessPackClips('edm-festival-hits'), lifetime = new AbortController();
  const encoded = spawnSync(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=61', '-threads', '1', '-c:a', 'libopus', '-f', 'webm', 'pipe:1'], { maxBuffer: 8 * 1024 * 1024 });
  assert.equal(encoded.status, 0, String(encoded.stderr));
  const extracted: string[] = [], fetched: string[] = [];
  const source = await prepareConfiguredGuessSource({}, {
    signal: lifetime.signal, youtube: {
      extract: async args => {
        const id = new URL(args.at(-1)!).searchParams.get('v')!;
        assert(clips.some(clip => clip.videoId === id)); extracted.push(id);
        return { id, is_live: false, duration: 61, vcodec: 'none', acodec: 'opus', ext: 'webm',
          title: 'Untrusted alternate title', url: 'https://rr1---synthetic.googlevideo.com/videoplayback?mime=audio%2Fwebm' };
      }, fetcher: async input => { fetched.push(String(input)); return new Response(encoded.stdout, { headers: { 'content-type': 'audio/webm' } }); },
      // Deliberately use the production default decoder over generated local media.
    },
  });
  assert(source); t.after(source.dispose);
  assert.deepEqual(extracted, clips.map(clip => clip.videoId)); assert.equal(fetched.length, 8);
  assert(source.catalog.categories().every(category => category.available && category.count === 8));
  const summary = JSON.stringify(source.catalog.categories());
  for (const secret of clips.flatMap(clip => [clip.title, clip.artist, clip.videoId])) assert(!summary.includes(secret), secret);
  for (const secret of ['permission', 'approved', 'rightsCleared', 'reference', 'https:']) assert(!summary.includes(secret));
  const excluded: string[] = [];
  for (let index = 0; index < 8; index++) {
    const song = source.catalog.select('edm-festival-hits', { exclude: excluded, durationSeconds: 30 }); excluded.push(song.id);
    assert(clips.some(clip => clip.title === song.title && clip.artist === song.artist));
    assert(!clips.some(clip => clip.videoId === song.id)); assert(!('permission' in song));
    const bytes = await source.media.read(song.mediaKey, signal());
    assert.equal(source.catalog.media(song.mediaKey).durationSeconds, 30);
    assert.equal(bytes.length, 44 + 30 * GUESS_AUDIO_RATE * 2); assert(bytes.subarray(44).some(value => value !== 0));
  }
  assert.equal(new Set(excluded).size, 8);
  assert.throws(() => source.catalog.select('edm-festival-hits', { exclude: excluded, durationSeconds: 30 }), { status: 503 });
  const key = source.catalog.select('edm-festival-hits', { exclude: [], durationSeconds: 30 }).mediaKey;
  clock += 1_800_000;
  await assert.rejects(source.media.read(key, signal()), { status: 503 });
  assert(source.catalog.categories().every(category => !category.available));
  assert.deepEqual([extracted.length, fetched.length], [8, 8], 'serving and expiry never refresh a provider implicitly');
});

test('explicit off or invalid YouTube flags suppress the alpha preset, and conflicting selectors fail before I/O', async () => {
  let called = 0;
  const options = { signal: signal(), youtube: {
    extract: async () => { called++; throw Error('must not extract'); },
    fetcher: async () => { called++; throw Error('must not download'); },
  } };
  for (const flag of ['0', 'true', 'false', 'AUTO']) assert.equal(await prepareConfiguredGuessSource({
    GUESS_YOUTUBE_CLIPS: flag, GUESS_YOUTUBE_PACK: 'edm-festival-hits',
  }, options), undefined);
  for (const config of [{ GUESS_YOUTUBE_CLIPS: '1', GUESS_YOUTUBE_PACK: '../quiz-playlists.json' },
    { GUESS_YOUTUBE_CLIPS: '1', GUESS_YOUTUBE_PACK: 'edm-festival-hits', GUESS_YOUTUBE_INVENTORY_PATH: '/private/unused.json' },
    { GUESS_YOUTUBE_CLIPS: '1', GUESS_YOUTUBE_PACK: 'edm-festival-hits', GUESS_SYNTHETIC_TEST: '1' },
    { GUESS_DEEZER_PREVIEWS: '1', GUESS_YOUTUBE_PACK: 'edm-festival-hits', GUESS_DEEZER_INVENTORY_PATH: '/private/unused.json' }])
    await assert.rejects(prepareConfiguredGuessSource(config, options), unavailable);
  assert.equal(called, 0);
});

test('alpha automatic mode honors an explicitly configured private inventory and fails before provider I/O if it is invalid', async t => {
  const dir = await directory(t), path = join(dir, 'invalid-private-youtube.json');
  let calls = 0;
  const options = { signal: signal(), youtube: { extract: async () => { calls++; assert.fail('an invalid private inventory must never fall back to preset extraction'); } } };
  for (const flag of [undefined, '', 'auto', '1']) {
    for (const content of ['not-json', '[]', JSON.stringify([{ videoId: 'synthetic01', permission: { approved: false } }])]) {
      await writeFile(path, content);
      await assert.rejects(prepareConfiguredGuessSource({ GUESS_YOUTUBE_CLIPS: flag, GUESS_YOUTUBE_INVENTORY_PATH: path }, options), unavailable);
    }
  }
  assert.equal(calls, 0);
});

test('switching to the YouTube preset ignores a configured private path for disabled Deezer previews', async t => {
  let inactivePathReads = 0, extractions = 0, downloads = 0;
  const configuration = {
    GUESS_YOUTUBE_CLIPS: '1', GUESS_YOUTUBE_PACK: 'edm-festival-hits', GUESS_DEEZER_PREVIEWS: '0',
    get GUESS_DEEZER_INVENTORY_PATH() {
      inactivePathReads++;
      return '/private/unused-deezer-inventory-does-not-exist.json';
    },
  };
  const source = await prepareConfiguredGuessSource(configuration, {
    signal: signal(),
    fetcher: async () => { assert.fail('a disabled Deezer source must never fetch'); },
    decode: async () => { assert.fail('a disabled Deezer source must never decode'); },
    youtube: {
      extract: async args => {
        extractions++; const id = new URL(args.at(-1)!).searchParams.get('v');
        return { id, is_live: false, duration: 180, ext: 'webm', vcodec: 'none', acodec: 'opus',
          url: 'https://rr1---synthetic.googlevideo.com/videoplayback?mime=audio%2Fwebm' };
      },
      fetcher: async () => { downloads++; return new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/webm' } }); },
      decode: async () => guessWave(new Uint8Array(GUESS_AUDIO_RATE * 2 * 30)),
    },
  });
  assert(source); t.after(source.dispose);
  assert.deepEqual([inactivePathReads, extractions, downloads], [0, 8, 8], 'the inactive path is never consulted or opened');
  const song = source.catalog.select('edm-festival-hits', { exclude: [], durationSeconds: 30 });
  assert.equal(source.catalog.categories().find(category => category.id === 'edm-festival-hits')?.count, 8);
  assert.equal((await source.media.read(song.mediaKey, signal())).length, 44 + GUESS_AUDIO_RATE * 2 * 30);
});
