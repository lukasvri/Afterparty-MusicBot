import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareConfiguredGuessSource } from '../src/guess-source.ts';
import { guessWave, GUESS_AUDIO_RATE } from '../src/guess-audio-format.ts';

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

test('YouTube quiz mode is opt-in, rejects conflicting modes and validates private files before extraction', async t => {
  const dir = await directory(t), path = join(dir, 'youtube.local.json');
  let extractions = 0;
  const options = { signal: signal(), youtube: { extract: async () => { extractions++; throw Error('private extractor details'); } } };
  for (const flag of [undefined, '0', 'true']) assert.equal(await prepareConfiguredGuessSource({
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
  const source = await prepareConfiguredGuessSource({ GUESS_YOUTUBE_CLIPS: '1', GUESS_YOUTUBE_INVENTORY_PATH: path }, {
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
