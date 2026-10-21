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
