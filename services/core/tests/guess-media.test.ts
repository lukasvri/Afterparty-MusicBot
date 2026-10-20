import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { guessWave, guessWaveSeconds, readGuessBytes } from '../src/guess-audio-format.ts';
import { fetchDeezerPreview, normalizeGuessAudio, PreparedGuessMedia } from '../src/guess-media.ts';
import { prepareDeezerGuess } from '../src/guess-deezer.ts';
import { seedIdentity, type DeezerSeed } from '../src/guess-deezer-metadata.ts';
const signal = () => new AbortController().signal;
const url = 'https://cdnt-preview.dzcdn.net/preview/synthetic.mp3';
const encoded = (duration = 15) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`, '-metadata', 'title=Fictional Secret Answer', '-metadata', 'artist=Private Test Artist', '-c:a', 'libmp3lame', '-f', 'mp3', 'pipe:1'], { timeout: 10000, maxBuffer: 1_500_000 });

test('real MP3 decoder produces bounded canonical PCM without title/artist metadata', async () => {
  const mp3 = encoded(); assert(mp3.includes(Buffer.from('Fictional Secret Answer')));
  const wave = await normalizeGuessAudio(mp3, signal());
  assert(guessWaveSeconds(wave) >= 15 && guessWaveSeconds(wave) < 16);
  assert.equal(Buffer.from(wave).includes(Buffer.from('Fictional Secret Answer')), false);
  assert.equal(Buffer.from(wave).includes(Buffer.from('Private Test Artist')), false);
  assert(wave.some(byte => byte !== 0), 'fixture has real decoded samples');
  const input = Buffer.from('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nfile:///etc/passwd\n');
  await assert.rejects(normalizeGuessAudio(input, signal()));
  const oversized = guessWave(new Uint8Array(16000 * 2 * 30));
  assert.equal(guessWaveSeconds(oversized), 30);
  assert.equal(guessWaveSeconds(await normalizeGuessAudio(oversized, signal(), 'wav')), 30);
  // A non-seekable MP3 includes encoder padding. The measured 30-second ceiling is deliberately strict.
  await assert.rejects(normalizeGuessAudio(encoded(30), signal()), /unavailable/);
  const corrupt = oversized.slice(); corrupt[36] = 0; assert.throws(() => guessWaveSeconds(corrupt));
});

test('preview transport rejects errors, redirects, MIME, sizes, cancellation and overlong audio without fallback', async () => {
  let calls = 0; const mp3 = encoded();
  const fetcher = async (_url: unknown, init?: RequestInit) => { calls++; assert.equal(init?.redirect, 'error'); return new Response(mp3, { headers: { 'Content-Type': 'audio/mpeg' } }); };
  const wave = await fetchDeezerPreview(url, signal(), fetcher as typeof fetch); assert(guessWaveSeconds(wave) >= 15); assert.equal(calls, 1);
  for (const response of [new Response('expired', { status: 403 }), new Response('html', { headers: { 'content-type': 'text/html' } }), new Response(mp3, { headers: { 'content-type': 'audio/mpeg', 'content-length': '1500001' } }), new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })]) {
    await assert.rejects(fetchDeezerPreview(url, signal(), (async () => response) as typeof fetch));
  }
  const long = execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=31','-f','mp3','pipe:1'], {timeout:10000,maxBuffer:1_500_000});
  await assert.rejects(normalizeGuessAudio(long, signal()), /unavailable/);
  await assert.rejects(fetchDeezerPreview('https://127.0.0.1/preview/private.mp3', signal(), fetcher as typeof fetch)); assert.equal(calls, 1);
  const abort = new AbortController(); let canceled = false;
  const response = new Response(new ReadableStream({ pull() {}, cancel() { canceled = true; return new Promise(() => {}); } }));
  const pending = readGuessBytes(response, 100, abort.signal); abort.abort(); await assert.rejects(pending); assert(canceled);
  const over = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(101)); }, cancel() { return new Promise(() => {}); } }));
  await assert.rejects(readGuessBytes(over, 100, signal()));
  const source = new PreparedGuessMedia(new Map([['synthetic', wave]]), Date.now() - 1); await assert.rejects(source.read('synthetic', signal()));
});

test('private Deezer factory requires independent permission and measures preview, never full song duration', async () => {
  const seed: DeezerSeed = { artist: 'Test Artist', title: 'Fictional Signal', originalYear: 2013, originalReleaseSource: 'https://artist.example/release', categoryIds: ['2010s'] };
  const disabled = await prepareDeezerGuess({ seeds: [seed], permission: { enabled: false, privateDevelopment: false, providerPermissionReference: '', recordings: [] }, fetcher: (async () => { throw Error('Must not fetch'); }) as typeof fetch });
  assert(disabled.catalog.categories().every(c => !c.available));
  const mp3 = encoded(), paths: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const u = new URL(String(input)); paths.push(u.hostname);
    if (u.hostname === 'cdnt-preview.dzcdn.net') return new Response(mp3, { headers: { 'content-type': 'audio/mpeg' } });
    const track = { id: 123, title: seed.title, artist: { name: seed.artist }, release_date: '2013-01-01', duration: 337, preview: url, readable: true };
    return Response.json(u.pathname === '/search' ? { data: [track] } : track);
  }) as typeof fetch;
  const built = await prepareDeezerGuess({ seeds: [seed], permission: { enabled: true, privateDevelopment: true, providerPermissionReference: 'Synthetic permission for owned test signal only', recordings: [seedIdentity(seed)] }, fetcher });
  assert.equal(built.catalog.categories()[0].count, 1);
  const song = built.catalog.select('2010s', { exclude: [], durationSeconds: 15 }), descriptor = built.catalog.media(song.mediaKey);
  assert(descriptor.durationSeconds < 16, '337-second full recording duration cannot become preview length');
  assert.throws(() => built.catalog.select('2010s', { exclude: [], durationSeconds: 30 }));
  const wave = await built.media.read(song.mediaKey, signal()); assert.equal(guessWaveSeconds(wave), descriptor.durationSeconds);
  assert.deepEqual(paths, ['api.deezer.com', 'api.deezer.com', 'cdnt-preview.dzcdn.net']);
});
