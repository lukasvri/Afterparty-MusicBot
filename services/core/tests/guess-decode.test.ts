import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { decodeGuessMp3, GUESS_MP3_MAX_BYTES } from '../src/guess-decode.ts';
import { GUESS_AUDIO_MAX_BYTES, guessWaveSeconds } from '../src/guess-audio-format.ts';

const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
function mp3(seconds: number) {
  const generated = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', `sine=frequency=440:duration=${seconds}`, '-threads', '1', '-ac', '2', '-ar', '44100',
    '-metadata', 'title=Private Fictional Answer', '-metadata', 'artist=Private Fictional Performer',
    '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', 'pipe:1'], { maxBuffer: GUESS_MP3_MAX_BYTES });
  assert.equal(generated.status, 0, String(generated.stderr));
  return new Uint8Array(generated.stdout);
}
const signal = () => new AbortController().signal;
const unavailable = { status: 503, message: 'Game preview preparation is unavailable.' };

test('real FFmpeg converts generated MP3 to canonical mono PCM without answer metadata', async () => {
  const input = mp3(16);
  assert(Buffer.from(input).includes(Buffer.from('Private Fictional Answer')));
  const wav = await decodeGuessMp3(input, signal());
  const seconds = guessWaveSeconds(wav);
  assert(seconds >= 16 && seconds < 16.2, String(seconds));
  assert(wav.subarray(44).some(byte => byte !== 0));
  for (const text of ['Private Fictional Answer', 'Private Fictional Performer', 'ID3']) assert(!Buffer.from(wav).includes(Buffer.from(text)));
});

test('decode stops at 30 seconds and copies caller-owned input before asynchronous work', async () => {
  const input = mp3(32), pending = decodeGuessMp3(input, signal());
  input.fill(0);
  const wav = await pending;
  assert.equal(guessWaveSeconds(wav), 30);
  assert.equal(wav.byteLength, GUESS_AUDIO_MAX_BYTES);
});

test('invalid, oversize, non-MP3 and short inputs fail without provider or process details', async () => {
  for (const bytes of [new Uint8Array(), new Uint8Array(GUESS_MP3_MAX_BYTES + 1),
    new TextEncoder().encode('#EXTM3U\nhttps://private.example.test/secret.mp3\n'),
    new TextEncoder().encode('not music: https://private.example.test/secret'), mp3(14)]) {
    await assert.rejects(decodeGuessMp3(bytes, signal()), unavailable);
  }
});

test('aborted work and decoder capacity fail closed, then slots recover after processes close', async () => {
  const bytes = mp3(16), first = new AbortController(), second = new AbortController();
  const a = decodeGuessMp3(bytes, first.signal), b = decodeGuessMp3(bytes, second.signal);
  const rejected = assert.rejects(decodeGuessMp3(bytes, signal()), unavailable);
  const cancelled = Promise.all([assert.rejects(a, unavailable), assert.rejects(b, unavailable)]);
  first.abort(); second.abort();
  await Promise.all([rejected, cancelled]);
  await assert.rejects(decodeGuessMp3(bytes, first.signal), unavailable);
  assert(guessWaveSeconds(await decodeGuessMp3(bytes, signal())) >= 16);
});

test('deadline kills and waits for the process before allowing another decode', async t => {
  const bytes = mp3(16);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = decodeGuessMp3(bytes, signal());
  const rejected = assert.rejects(pending, unavailable);
  t.mock.timers.tick(10_000);
  await rejected;
  t.mock.timers.reset();
  assert(guessWaveSeconds(await decodeGuessMp3(bytes, signal())) >= 16);
});

test('unavailable executable errors release the decoder slot and keep the path private', async () => {
  const previous = process.env.FFMPEG_PATH;
  try {
    process.env.FFMPEG_PATH = '/nonexistent/private-quiz-ffmpeg';
    for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(decodeGuessMp3(new Uint8Array([1]), signal()), unavailable);
  } finally {
    if (previous === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = previous;
  }
  assert(guessWaveSeconds(await decodeGuessMp3(mp3(16), signal())) >= 16);
});
