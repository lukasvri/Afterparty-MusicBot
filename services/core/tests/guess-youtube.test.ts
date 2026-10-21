import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { prepareYoutubeGuessInventory, type YoutubeGuessRecord, type YoutubeGuessOptions } from '../src/guess-youtube.ts';
import { guessWave, GUESS_AUDIO_RATE, GUESS_AUDIO_MAX_BYTES } from '../src/guess-audio-format.ts';
import { UserError } from '../src/types.ts';
import { deferred } from './deferred.ts';

const videoId = 'synthetic01', cdn = 'https://rr1---synthetic.googlevideo.com/videoplayback?mime=audio%2Fwebm&sig=private-provider-secret';
const wave = (seconds = 30) => guessWave(new Uint8Array(seconds * GUESS_AUDIO_RATE * 2));
const record = (id = videoId): YoutubeGuessRecord => ({ videoId: id, title: 'Fictional Signal', artist: 'Fictional Artist', aliases: ['Invented Alias'], categoryIds: ['2010s'],
  permission: { approved: true, reference: 'https://approval.example.test/private-evidence', expiresAt: Date.now() + 600_000 } });
const metadata = (id = videoId, extra: Record<string, unknown> = {}) => ({ id, is_live: false, live_status: 'not_live', duration: 200, ext: 'webm', vcodec: 'none', acodec: 'opus', url: cdn,
  title: 'Untrusted provider title', http_headers: { Authorization: 'private-provider-secret', Cookie: 'private-provider-secret' }, ...extra });
const selection = { exclude: [], durationSeconds: 30 };
const safeError = (error: unknown) => error instanceof UserError && error.status === 503 && error.message === 'The approved YouTube game audio inventory is unavailable.';
function options(extra: Partial<YoutubeGuessOptions> = {}): YoutubeGuessOptions {
  return { signal: new AbortController().signal, extract: async args => metadata(args.at(-1)!.split('v=')[1]),
    fetcher: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/webm' } }),
    decode: async (_bytes, clip) => wave(clip.durationSeconds), ...extra };
}

test('approved audio extraction uses only the fixed watch URL and passes no provider headers or credentials', async t => {
  const input = record(), wav = wave(); let extracts = 0, fetches = 0, decodes = 0;
  const inventory = await prepareYoutubeGuessInventory([input], options({ extract: async (args, signal) => {
    extracts++; assert(!signal.aborted); assert.deepEqual(args, ['--ignore-config', '--no-cache-dir', '--no-playlist', '--dump-single-json', '--skip-download', '--js-runtimes', 'node',
      '--socket-timeout', '8', '--retries', '0', '--extractor-retries', '0', '-f', 'bestaudio[ext=webm]/bestaudio[ext=m4a]', '--', 'https://www.youtube.com/watch?v='+videoId]);
    return metadata();
  }, fetcher: async (url, init) => {
    fetches++; assert.equal(String(url), cdn); assert.equal(init?.redirect, 'manual'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.referrerPolicy, 'no-referrer');
    assert.deepEqual(init?.headers, { Accept: 'audio/webm' }); assert(init?.signal instanceof AbortSignal);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/webm; codecs=opus' } });
  }, decode: async (bytes, clip, signal) => {
    decodes++; assert.deepEqual([...bytes], [1, 2, 3]); assert.deepEqual(clip, { format: 'webm', startSeconds: 0, durationSeconds: 30 }); assert(!signal.aborted); return wav;
  } })); t.after(inventory.dispose);
  assert.equal(extracts, 1); assert.equal(fetches, 1); assert.equal(decodes, 1);
  const song = inventory.catalog.select('2010s', selection); assert.match(song.id, /^[a-f0-9-]{36}$/); assert.match(song.mediaKey, /^[a-f0-9]{32}$/); assert.notEqual(song.id, videoId);
  assert.equal(song.title, input.title); assert.equal(song.artist, input.artist); assert.deepEqual(song.aliases, ['Invented Alias']);
  const summaries = JSON.stringify(inventory.catalog.categories());
  for (const secret of [videoId, 'Fictional', 'Invented', 'private-provider-secret', 'approval.example', 'googlevideo', song.mediaKey]) assert(!summaries.includes(secret));
  assert(!JSON.stringify(song).includes('https:')); assert(!JSON.stringify(song).includes('Untrusted'));
  wav.fill(255); const first = await inventory.media.read(song.mediaKey, new AbortController().signal); assert.equal(first.byteLength, GUESS_AUDIO_MAX_BYTES); assert.equal(first[0], 82);
  first.fill(255); assert.equal((await inventory.media.read(song.mediaKey, new AbortController().signal))[0], 82);
  assert.equal(extracts, 1, 'serving prepared audio never extracts again'); assert.equal(fetches, 1);
});

test('M4A metadata maps to MP4 decoding and preserves a curated fractional start and clip duration', async t => {
  const input = { ...record(), startSeconds: 12.5, durationSeconds: 15 }; let decoded = false;
  const inventory = await prepareYoutubeGuessInventory([input], options({ extract: async () => metadata(videoId, { ext: 'm4a', acodec: 'mp4a.40.2', url: cdn.replace('webm', 'mp4') }),
    fetcher: async (_url, init) => { assert.deepEqual(init?.headers, { Accept: 'audio/mp4' }); return new Response(new Uint8Array([4]), { headers: { 'content-type': 'audio/x-m4a' } }); },
    decode: async (_bytes, clip) => { decoded = true; assert.deepEqual(clip, { format: 'mp4', startSeconds: 12.5, durationSeconds: 15 }); return wave(15); } })); t.after(inventory.dispose);
  assert(decoded); assert.equal(inventory.catalog.media(inventory.catalog.select('2010s', { exclude: [], durationSeconds: 15 }).mediaKey).durationSeconds, 15);
});

test('all approvals, IDs, answer fields, aliases, categories and clip settings are validated before I/O', async () => {
  let calls = 0; const opts = options({ extract: async () => { calls++; throw Error(); } });
  const invalid = [null, { ...record(), videoId: 'https://youtube.com/watch?v='+videoId }, { ...record(), videoId: '../secretxx' },
    { ...record(), title: '' }, { ...record(), title: 'x'.repeat(121) }, { ...record(), artist: 'Bad\u202eArtist' }, { ...record(), aliases: Array(9).fill('Alias') },
    { ...record(), aliases: ['bad\nanswer'] }, { ...record(), categoryIds: [] }, { ...record(), categoryIds: ['unknown'] }, { ...record(), categoryIds: ['2010s', '2010s'] },
    { ...record(), aliases: null }, { ...record(), startSeconds: null }, { ...record(), durationSeconds: null },
    ...[-1, 3601, Infinity, NaN].map(startSeconds => ({ ...record(), startSeconds })), ...[14, 31, 15.5, NaN].map(durationSeconds => ({ ...record(), durationSeconds })),
    { ...record(), permission: undefined }, { ...record(), permission: { ...record().permission, approved: false } },
    { ...record(), permission: { ...record().permission, expiresAt: Date.now() } }, { ...record(), permission: { ...record().permission, expiresAt: Infinity } },
    { ...record(), permission: { ...record().permission, reference: 'http://approval.example.test' } }, { ...record(), permission: { ...record().permission, reference: 'https://user:secret@approval.example.test' } },
    { ...record(), permission: { ...record().permission, reference: 'https://approval.example.test/\n' } }];
  for (const value of invalid) await assert.rejects(prepareYoutubeGuessInventory([record('synthetic02'), value as YoutubeGuessRecord], opts), safeError);
  await assert.rejects(prepareYoutubeGuessInventory([], opts), safeError);
  await assert.rejects(prepareYoutubeGuessInventory([record(), record()], opts), safeError);
  await assert.rejects(prepareYoutubeGuessInventory(Array.from({ length: 9 }, (_, n) => record('synthetic0'+n)), opts), safeError); assert.equal(calls, 0);
});

test('input records are copied before yielding and eight sequential recordings are the maximum inventory', async t => {
  const input = record(), defaults = options();
  const inventory = await prepareYoutubeGuessInventory([input], options({ extract: async (args, signal) => {
    input.title = 'Changed'; input.artist = 'Changed'; input.aliases = ['Changed']; input.categoryIds = ['unknown']; input.startSeconds = 999; input.durationSeconds = 15; input.permission.expiresAt = 0;
    return defaults.extract!(args, signal);
  } })); t.after(inventory.dispose);
  const song = inventory.catalog.select('2010s', selection); assert.equal(song.title, 'Fictional Signal'); assert.equal(song.artist, 'Fictional Artist'); assert.deepEqual(song.aliases, ['Invented Alias']);
  let extracts = 0, fetches = 0;
  const eight = await prepareYoutubeGuessInventory(Array.from({ length: 8 }, (_, n) => record('synthetic0'+n)), options({ extract: async (args, signal) => { extracts++; return defaults.extract!(args, signal); }, fetcher: async (url, init) => { fetches++; return defaults.fetcher!(url, init); } })); t.after(eight.dispose);
  assert.equal(extracts, 8); assert.equal(fetches, 8); assert.equal(eight.catalog.categories()[0].count, 8);
});

test('wrong recordings, live streams, short sources, playlists and non-audio formats cannot reach the CDN', async () => {
  let fetches = 0;
  const invalid = [{ id: 'synthetic02' }, { _type: 'playlist' }, { is_live: true }, { is_live: undefined }, { live_status: 'is_live' }, { live_status: 'is_upcoming' },
    { live_status: 'post_live' }, { live_status: 'unknown' }, { live_status: null }, { is_preview: true }, { is_preview: null },
    ...['private', 'premium_only', 'subscriber_only', 'needs_auth', null].map(availability => ({ availability })),
    { duration: 14 }, { duration: '200' }, { duration: Infinity }, { duration: 86401 }, { vcodec: 'h264' }, { acodec: 'none' }, { acodec: 'NONE' }, { acodec: ' ' }, { acodec: '' }, { ext: 'mp3' }];
  for (const extra of invalid) await assert.rejects(prepareYoutubeGuessInventory([record()], options({ extract: async () => metadata(videoId, extra), fetcher: async () => { fetches++; throw Error(); } })), safeError);
  await assert.rejects(prepareYoutubeGuessInventory([{ ...record(), startSeconds: 190 }], options({ fetcher: async () => { fetches++; throw Error(); } })), safeError); assert.equal(fetches, 0);
  for (const availability of ['public', 'unlisted']) { const inventory = await prepareYoutubeGuessInventory([record()], options({ extract: async () => metadata(videoId, { availability, is_preview: false }) })); inventory.dispose(); }
});

test('only raw HTTPS googlevideo subdomains and the exact videoplayback path can be fetched', async () => {
  const bad = ['http://rr1.googlevideo.com/videoplayback', 'https://googlevideo.com/videoplayback', 'https://rr1.googlevideo.com.evil.test/videoplayback',
    'https://127.0.0.1/videoplayback', 'https://[::1]/videoplayback', 'https://user:password@rr1.googlevideo.com/videoplayback', 'https://rr1.googlevideo.com:443/videoplayback',
    'https://rr1.googlevideo.com./videoplayback', 'https://rr1.googlevideo.com/other/../videoplayback', 'https://rr1.googlevideo.com/%76ideoplayback',
    'https://rr1.googlevideo.com/videoplayback#secret', 'https://rr1.googlevideo.com/videoplayback/extra', 'https://rr1.googlevideo.com/videoplayback?mime=video%2Fwebm',
    'https://rr1.googlevideo.com/videoplayback?sig=%0d%0asecret', 'https://rr1.googlevideo.com/videoplayback?sig=%xx', cdn+'x'.repeat(16384)];
  for (const url of bad) { let calls = 0; await assert.rejects(prepareYoutubeGuessInventory([record()], options({ extract: async () => metadata(videoId, { url }), fetcher: async () => { calls++; throw Error(); } })), safeError); assert.equal(calls, 0, url.slice(0, 100)); }
});

test('redirects, HTTP errors, wrong response origins and incompatible MIME types close bodies safely', async () => {
  for (const status of [200, 206, 302, 403, 429, 500]) {
    let cancelled = false;
    await assert.rejects(prepareYoutubeGuessInventory([record()], options({ fetcher: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }),
      { status, headers: { 'content-type': status === 200 ? 'video/webm' : 'audio/webm', location: 'https://evil.test/private-provider-secret' } }) })), safeError); assert(cancelled);
  }
  for (const property of ['redirected', 'url']) {
    const response = new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/webm' } }); Object.defineProperty(response, property, { value: property === 'redirected' ? true : 'https://evil.test/private-provider-secret' });
    await assert.rejects(prepareYoutubeGuessInventory([record()], options({ fetcher: async () => response })), safeError);
  }
});

test('encoded audio is capped at eight MiB for advertised and streamed lengths and cancelled on rejection', async () => {
  for (const advertised of [true, false]) {
    let cancelled = false;
    await assert.rejects(prepareYoutubeGuessInventory([record()], options({ fetcher: async () => new Response(new ReadableStream({ start(controller) { if (!advertised) controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } }),
      { headers: { 'content-type': 'audio/webm', ...(advertised ? { 'content-length': String(8 * 1024 * 1024 + 1) } : {}) } }) })), safeError); assert(cancelled);
  }
});

test('decoded output must be canonical answer-safe WAV with the requested duration', async () => {
  for (const bytes of [new Uint8Array([1, 2]), wave(14), wave(15), new Uint8Array(GUESS_AUDIO_MAX_BYTES + 1)]) await assert.rejects(prepareYoutubeGuessInventory([record()], options({ decode: async () => bytes })), safeError);
  for (const stage of ['extract', 'fetch', 'decode']) {
    const opts = options();
    if (stage === 'extract') opts.extract = async () => { throw new UserError('private-provider-secret'); };
    if (stage === 'fetch') opts.fetcher = async () => { throw Error('private-provider-secret'); };
    if (stage === 'decode') opts.decode = async () => { throw Error('private-provider-secret'); };
    await assert.rejects(prepareYoutubeGuessInventory([record()], opts), safeError);
  }
});

test('aborted signals perform no I/O and remain bound even if the caller mutates options', async () => {
  const aborted = new AbortController(); aborted.abort(); let calls = 0;
  await assert.rejects(prepareYoutubeGuessInventory([record()], options({ signal: aborted.signal, extract: async () => { calls++; throw Error(); } })), safeError); assert.equal(calls, 0);
  const controller = new AbortController(), gate = deferred<unknown>(), opts = options({ signal: controller.signal });
  opts.extract = async () => { opts.signal = new AbortController().signal; queueMicrotask(() => controller.abort()); return gate.promise; };
  await assert.rejects(prepareYoutubeGuessInventory([record()], opts), safeError); gate.resolve(metadata()); await nextTurn();
});

test('cancellation rejects hanging extractors, fetches, streams and decoders, then recovers after they settle', async () => {
  for (const stage of ['extract', 'fetch', 'stream', 'decode']) {
    const controller = new AbortController(), extracted = deferred<unknown>(), fetched = deferred<Response>(), decoded = deferred<Uint8Array>(), defaults = options(); let cancelled = false;
    const opts = options({ signal: controller.signal,
      extract: async (...args) => { if (stage === 'extract') { queueMicrotask(() => controller.abort()); return extracted.promise; } return defaults.extract!(...args); },
      fetcher: async (...args) => { if (stage === 'fetch') { queueMicrotask(() => controller.abort()); return fetched.promise; }
        if (stage === 'stream') return new Response(new ReadableStream({ pull() { queueMicrotask(() => controller.abort()); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'audio/webm' } }); return defaults.fetcher!(...args); },
      decode: async (...args) => { if (stage === 'decode') { queueMicrotask(() => controller.abort()); return decoded.promise; } return defaults.decode!(...args); },
    });
    await assert.rejects(prepareYoutubeGuessInventory([record()], opts), safeError);
    extracted.resolve(metadata()); fetched.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'audio/webm' } })); decoded.resolve(wave());
    await nextTurn(); if (stage === 'fetch' || stage === 'stream') assert(cancelled);
  }
  const recovered = await prepareYoutubeGuessInventory([record()], options()); recovered.dispose();
});

test('permission expiry before and after each preparation step cannot publish stale audio', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  for (const stage of ['extract', 'fetch', 'decode']) {
    const input = record(); input.permission.expiresAt = Date.now() + 1000; const defaults = options();
    await assert.rejects(prepareYoutubeGuessInventory([input], options({ extract: async (...args) => { if (stage === 'extract') t.mock.timers.tick(1000); return defaults.extract!(...args); },
      fetcher: async (...args) => { if (stage === 'fetch') t.mock.timers.tick(1000); return defaults.fetcher!(...args); },
      decode: async (...args) => { if (stage === 'decode') t.mock.timers.tick(1000); return defaults.decode!(...args); } })), safeError);
  }
});

test('earliest approval expiry, five-minute TTL, lifetime cancellation and explicit disposal stop pending reads', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  for (const reason of ['expiry', 'ttl', 'abort', 'dispose']) {
    const controller = new AbortController(), first = record(), second = record('synthetic02'); if (reason === 'expiry') second.permission.expiresAt = Date.now() + 1000;
    const inventory = await prepareYoutubeGuessInventory([first, second], options({ signal: controller.signal })); t.after(inventory.dispose);
    const song = inventory.catalog.select('2010s', selection), pending = inventory.media.read(song.mediaKey, new AbortController().signal);
    if (reason === 'expiry') t.mock.timers.tick(1000); if (reason === 'ttl') t.mock.timers.tick(300_000); if (reason === 'abort') controller.abort(); if (reason === 'dispose') inventory.dispose();
    await assert.rejects(pending); assert(inventory.catalog.categories().every(category => !category.available && category.count === 0)); await assert.rejects(inventory.media.read(song.mediaKey, new AbortController().signal)); inventory.dispose();
  }
});

test('per-step and total deadlines reject promptly but occupied capacity stays held until raw dependencies settle', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 });
  const timeout = new AbortController(); t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => { assert.equal(milliseconds, 10_000); return timeout.signal; });
  const extracted = deferred<unknown>(), timed = prepareYoutubeGuessInventory([record()], options({ extract: async () => extracted.promise }));
  timeout.abort(); await assert.rejects(timed, safeError); extracted.resolve(metadata()); await nextTurn(); t.mock.restoreAll();
  t.mock.method(AbortSignal, 'timeout', () => new AbortController().signal);
  const fetched = deferred<Response>(), decoded = deferred<Uint8Array>(), enteredFetch = deferred<void>(), enteredDecode = deferred<void>();
  const a = prepareYoutubeGuessInventory([record()], options({ fetcher: async () => { enteredFetch.resolve(); return fetched.promise; } }));
  const b = prepareYoutubeGuessInventory([record('synthetic02')], options({ decode: async () => { enteredDecode.resolve(); return decoded.promise; } }));
  await Promise.all([enteredFetch.promise, enteredDecode.promise]); t.mock.timers.tick(60_000); await Promise.all([assert.rejects(a, safeError), assert.rejects(b, safeError)]);
  let calls = 0; await assert.rejects(prepareYoutubeGuessInventory([record('synthetic03')], options({ extract: async () => { calls++; return metadata(); } })), safeError); assert.equal(calls, 0);
  fetched.resolve(new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/webm' } })); decoded.resolve(wave()); await nextTurn();
  const recovered = await prepareYoutubeGuessInventory([record()], options()); recovered.dispose();
});
