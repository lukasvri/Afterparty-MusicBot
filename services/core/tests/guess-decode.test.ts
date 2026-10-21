import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { decodeGuessMp3, decodeGuessClip, GUESS_MP3_MAX_BYTES, GUESS_CLIP_MAX_BYTES, type GuessClipOptions } from '../src/guess-decode.ts';
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


function container(format: GuessClipOptions['format'], video = false) {
  const generated = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=28',
    ...(video ? ['-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=1:d=2'] : []),
    '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]', '-map', '[a]',
    ...(video ? ['-map', '2:v:0', '-c:v', format === 'webm' ? 'libvpx' : 'mpeg4', '-threads', '1'] : []),
    '-threads', '1', '-ac', '2', '-ar', '48000', '-c:a', format === 'webm' ? 'libopus' : 'aac', '-b:a', '128k',
    '-metadata', 'title=Private Fictional Answer', '-metadata', 'artist=Private Fictional Performer',
    ...(format === 'mp4' ? ['-movflags', 'frag_keyframe+empty_moov'] : []), '-f', format, 'pipe:1',
  ], { maxBuffer: GUESS_CLIP_MAX_BYTES });
  assert.equal(generated.status, 0, String(generated.stderr));
  return new Uint8Array(generated.stdout);
}
function frequency(wav: Uint8Array) {
  const pcm = new DataView(wav.buffer, wav.byteOffset + 44, wav.byteLength - 44);
  const start = 16000, end = start + 3 * 16000;
  let crossings = 0;
  for (let sample = start + 1; sample < end; sample++)
    if (pcm.getInt16((sample - 1) * 2, true) <= 0 && pcm.getInt16(sample * 2, true) > 0) crossings++;
  return crossings / 3;
}
const clip = (format: GuessClipOptions['format'], startSeconds = 0, durationSeconds = 15): GuessClipOptions => ({ format, startSeconds, durationSeconds });

for (const format of ['webm', 'mp4'] as const) {
  test(`generated ${format} selects the requested later tone and removes tags and video`, async () => {
    const bytes = container(format, true);
    assert(Buffer.from(bytes).includes(Buffer.from('Private Fictional Answer')));
    const first = await decodeGuessClip(bytes, clip(format), signal());
    const later = await decodeGuessClip(bytes, clip(format, 9), signal());
    assert.equal(guessWaveSeconds(first), 15);
    assert.equal(guessWaveSeconds(later), 15);
    assert(Math.abs(frequency(first) - 440) < 2, String(frequency(first)));
    assert(Math.abs(frequency(later) - 880) < 2, String(frequency(later)));
    for (const wav of [first, later]) {
      assert.equal(wav.byteLength, 44 + 16000 * 2 * 15);
      assert(wav.subarray(44).some(byte => byte !== 0));
      for (const text of ['Private Fictional Answer', 'Private Fictional Performer', 'ID3']) assert(!Buffer.from(wav).includes(Buffer.from(text)));
    }
  });
  test(`${format} clips copy input and options before yielding and bound output to the requested duration`, async () => {
    const bytes = container(format), options = clip(format, 9, 20), pending = decodeGuessClip(bytes, options, signal());
    bytes.fill(0); options.startSeconds = 0; options.durationSeconds = 30; options.format = format === 'webm' ? 'mp4' : 'webm';
    const wav = await pending;
    assert.equal(guessWaveSeconds(wav), 20);
    assert(Math.abs(frequency(wav) - 880) < 2);
  });
  test(`${format} rejects truncated headers, wrong formats, end-of-input short clips and out-of-range seeks`, async () => {
    const bytes = container(format);
    for (const input of [bytes.subarray(0, 128), mp3(16), new TextEncoder().encode('#EXTM3U\nhttps://private.example.test/secret')])
      await assert.rejects(decodeGuessClip(input, clip(format), signal()), unavailable);
    await assert.rejects(decodeGuessClip(bytes, clip(format === 'webm' ? 'mp4' : 'webm'), signal()), unavailable);
    await assert.rejects(decodeGuessClip(bytes, clip(format, 24), signal()), unavailable);
    await assert.rejects(decodeGuessClip(bytes, clip(format, 3600), signal()), unavailable);
  });
  test(`${format} decoding kills timed-out processes before releasing capacity`, async t => {
    const bytes = container(format);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = decodeGuessClip(bytes, clip(format), signal()), rejected = assert.rejects(pending, unavailable);
    t.mock.timers.tick(10000); await rejected;
    t.mock.timers.reset();
    assert.equal(guessWaveSeconds(await decodeGuessClip(bytes, clip(format), signal())), 15);
  });
}

test('bounded clip validation rejects unknown formats, oversize bytes and invalid seek/duration values', async () => {
  const bytes = new Uint8Array([1]);
  for (const options of [null, [], { ...clip('webm'), format: 'mp3' }, { ...clip('webm'), format: 'https://private.example.test' },
    ...[-1, 3601, NaN, Infinity, '1'].map(startSeconds => ({ ...clip('webm'), startSeconds })),
    ...[0, 14, 31, 15.5, NaN, Infinity, '15'].map(durationSeconds => ({ ...clip('webm'), durationSeconds }))])
    await assert.rejects(decodeGuessClip(bytes, options as GuessClipOptions, signal()), unavailable);
  for (const input of [new Uint8Array(), new Uint8Array(GUESS_CLIP_MAX_BYTES + 1)])
    await assert.rejects(decodeGuessClip(input, clip('webm'), signal()), unavailable);
});

test('MP3 and container clips share two process slots, including while cancelled children are still closing', async () => {
  const encoded = container('webm'), legacy = mp3(16), first = new AbortController(), second = new AbortController();
  const a = decodeGuessClip(encoded, clip('webm'), first.signal), b = decodeGuessMp3(legacy, second.signal);
  const rejected = [assert.rejects(a, unavailable), assert.rejects(b, unavailable)];
  await assert.rejects(decodeGuessClip(encoded, clip('webm'), signal()), unavailable);
  await assert.rejects(decodeGuessMp3(legacy, signal()), unavailable);
  first.abort(); second.abort();
  const beforeClose = assert.rejects(decodeGuessClip(encoded, clip('webm'), signal()), unavailable);
  await Promise.all([...rejected, beforeClose]);
  await assert.rejects(decodeGuessClip(encoded, clip('webm'), first.signal), unavailable);
  assert.equal(guessWaveSeconds(await decodeGuessClip(encoded, clip('webm'), signal())), 15);
});

test('a valid long MP3 can finish its 30-second preview without consuming the unused encoded tail', async () => {
  const bytes = mp3(90);
  assert(bytes.byteLength < GUESS_MP3_MAX_BYTES);
  assert.equal(guessWaveSeconds(await decodeGuessMp3(bytes, signal())), 30);
});
