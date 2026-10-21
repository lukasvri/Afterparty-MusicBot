import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareDeezerGuessInventory, type DeezerGuessRecord, type DeezerGuessOptions } from '../src/guess-deezer.ts';
import { guessWave, GUESS_AUDIO_RATE, GUESS_AUDIO_MAX_BYTES } from '../src/guess-audio-format.ts';
import { UserError } from '../src/types.ts';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { deferred } from './deferred.ts';

const preview = 'https://cdns-preview-a.dzcdn.net/stream/c-' + 'a'.repeat(32) + '-1.mp3';
const wav = (seconds = 30) => guessWave(new Uint8Array(seconds * GUESS_AUDIO_RATE * 2));
const record = (id = '123'): DeezerGuessRecord => ({ trackId: id, categoryIds: ['2010s'], permission: { approved: true, reference: 'https://approval.example.test/private-evidence', expiresAt: Date.now() + 600_000 } });
const metadata = (id = '123', extra: Record<string, unknown> = {}) => ({ id, type: 'track', title: 'Fictional Signal', title_version: '', duration: 200, artist: { name: 'Fictional Artist' }, readable: true, preview, ...extra });
const selection = { exclude: [], durationSeconds: 30 };
const safeError = (error: unknown) => error instanceof UserError && error.status === 503 && error.message === 'The approved Deezer game preview inventory is unavailable.';
function options(extra: Partial<DeezerGuessOptions> = {}): DeezerGuessOptions {
  return { signal: new AbortController().signal,
    fetcher: async url => String(url).startsWith('https://api.deezer.com/') ? Response.json(metadata(new URL(String(url)).pathname.split('/').at(-1))) : new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } }),
    decode: async () => wav(), ...extra };
}

test('approved private previews become copied canonical WAVs with random IDs and no URL/evidence exposure', async t => {
  const calls: { url: string; init?: RequestInit }[] = [], decoded = wav();
  const defaults = options(), inventory = await prepareDeezerGuessInventory([record()], options({
    fetcher: async (url, init) => { calls.push({ url: String(url), init }); return defaults.fetcher!(url, init); },
    decode: async (bytes, signal) => { assert.deepEqual([...bytes], [1, 2, 3]); assert(!signal.aborted); return decoded; },
  })); t.after(inventory.dispose);
  assert.deepEqual(calls.map(call => call.url), ['https://api.deezer.com/track/123', preview]);
  for (const call of calls) { assert.equal(call.init?.redirect, 'manual'); assert.equal(call.init?.credentials, 'omit'); assert.equal(call.init?.referrerPolicy, 'no-referrer'); assert(call.init?.signal instanceof AbortSignal); }
  const song = inventory.catalog.select('2010s', selection);
  assert.notEqual(song.id, '123'); assert.match(song.id, /^[a-f0-9-]{36}$/); assert.match(song.mediaKey, /^[a-f0-9]{32}$/);
  assert.equal(song.title, 'Fictional Signal'); assert.equal(song.artist, 'Fictional Artist');
  assert.equal(inventory.catalog.media(song.mediaKey).durationSeconds, 30);
  const publicSummary = JSON.stringify(inventory.catalog.categories());
  for (const secret of ['Fictional', '123', 'https:', 'private-evidence', 'dzcdn', song.mediaKey]) assert(!publicSummary.includes(secret));
  assert(!JSON.stringify(song).includes('https:'));
  decoded.fill(255); const bytes = await inventory.media.read(song.mediaKey, new AbortController().signal);
  assert.equal(bytes.byteLength, GUESS_AUDIO_MAX_BYTES); assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'RIFF');
  bytes.fill(255); assert.equal((await inventory.media.read(song.mediaKey, new AbortController().signal))[0], 82);
});

test('every track permission and category is checked before any network or decoding', async () => {
  let network = 0, decoding = 0;
  const opts = options({ fetcher: async () => { network++; throw Error('private-provider-secret'); }, decode: async () => { decoding++; return wav(); } });
  const bad = [null, { ...record(), trackId: '0' }, { ...record(), trackId: '1/../../secret' }, { ...record(), permission: undefined },
    { ...record(), categoryIds: ['unknown'] }, { ...record(), categoryIds: ['2010s', '2010s'] },
    { ...record(), permission: { ...record().permission, approved: false } },
    { ...record(), permission: { ...record().permission, expiresAt: Date.now() } },
    { ...record(), permission: { ...record().permission, reference: 'http://approval.example.test' } },
    { ...record(), permission: { ...record().permission, reference: 'https://user:password@approval.example.test' } },
    { ...record(), permission: { ...record().permission, reference: 'https://approval.example.test/\u202e' } },
  ];
  for (const item of bad) await assert.rejects(prepareDeezerGuessInventory([record('2'), item as DeezerGuessRecord], opts), safeError);
  await assert.rejects(prepareDeezerGuessInventory([record(), record()], opts), safeError);
  await assert.rejects(prepareDeezerGuessInventory(Array.from({ length: 9 }, (_, i) => record(String(i + 1))), opts), safeError);
  assert.equal(network, 0); assert.equal(decoding, 0);
});

test('caller inputs are snapshotted before yielding and no more than eight tracks are requested', async t => {
  const input = record(), defaults = options(); let calls = 0;
  const inventory = await prepareDeezerGuessInventory([input], options({ fetcher: async (url, init) => {
    calls++; input.trackId = '999'; input.categoryIds = ['unknown']; input.permission.reference = 'http://changed'; input.permission.expiresAt = 0;
    return defaults.fetcher!(url, init);
  } })); t.after(inventory.dispose);
  assert.equal(calls, 2); assert.equal(inventory.catalog.categories()[0].count, 1);
  calls = 0; const eight = await prepareDeezerGuessInventory(Array.from({ length: 8 }, (_, i) => record(String(i + 1))), options({ fetcher: async (url, init) => { calls++; return defaults.fetcher!(url, init); } })); t.after(eight.dispose);
  assert.equal(calls, 16); assert.equal(eight.catalog.categories()[0].count, 8);
});

test('unsafe preview hosts and paths fail before any media request', async () => {
  const badUrls = [preview.replace('https:', 'http:'), preview.replace('dzcdn.net', 'dzcdn.net.evil.test'), preview.replace('cdns-preview-a', 'other'),
    preview.replace('https://', 'https://user:pass@'), preview.replace('.net/', '.net:443/'), preview + '?redirect=http://127.0.0.1', preview + '#fragment',
    preview.replace('/stream/', '/private/../stream/'), preview.replace('c-', '%63-'), preview.replace('-1.mp3', '-1.exe'),
    'https://cdnt-preview.dzcdn.net/private-provider-secret', 'http://127.0.0.1/private-provider-secret'];
  for (const url of badUrls) {
    let calls = 0;
    await assert.rejects(prepareDeezerGuessInventory([record()], options({ fetcher: async () => { calls++; return Response.json(metadata('123', { preview: url })); } })), safeError);
    assert.equal(calls, 1);
  }
});

test('strict track metadata, complete version labels and canonical audio validation fail closed', async t => {
  for (const extra of [{ id: '999' }, { type: 'episode' }, { readable: false }, { readable: undefined }, { playable: false }, { duration: 0 }, { duration: '200' }, { artist: null }, { title: 'x'.repeat(121) }, { title: 'bad\u202etitle' }, { error: { message: 'private-provider-secret' } }]) {
    let calls = 0; await assert.rejects(prepareDeezerGuessInventory([record()], options({ fetcher: async () => { calls++; return Response.json(metadata('123', extra)); } })), safeError); assert.equal(calls, 1);
  }
  const defaults = options();
  const inventory = await prepareDeezerGuessInventory([record()], options({ fetcher: async (url, init) => String(url).startsWith('https://api.') ? Response.json(metadata('123', { title: 'Alive', title_version: 'Live' })) : defaults.fetcher!(url, init) })); t.after(inventory.dispose);
  assert.equal(inventory.catalog.select('2010s', selection).title, 'Alive Live');
  for (const bytes of [new Uint8Array([1, 2]), wav(14), new Uint8Array(GUESS_AUDIO_MAX_BYTES + 1)]) await assert.rejects(prepareDeezerGuessInventory([record()], options({ decode: async () => bytes })), safeError);
});

test('redirects, incorrect response URLs, HTTP errors, content types and malformed JSON remain private', async () => {
  for (const stage of ['metadata', 'media']) {
    const failures = [() => new Response('private-provider-secret', { status: 302, headers: { location: 'http://127.0.0.1' } }),
      () => new Response('private-provider-secret', { status: 429 }), () => new Response('private-provider-secret', { status: 500 }),
      () => new Response('private-provider-secret', { headers: { 'content-type': 'text/html' } }),
      () => { const response = Response.json(metadata()); Object.defineProperty(response, 'redirected', { value: true }); return response; },
      () => { const response = Response.json(metadata()); Object.defineProperty(response, 'url', { value: 'https://evil.test/private-provider-secret' }); return response; }];
    for (const failure of failures) { const defaults = options(); await assert.rejects(prepareDeezerGuessInventory([record()], options({ fetcher: async (url, init) => (stage === 'metadata') === String(url).startsWith('https://api.') ? failure() : defaults.fetcher!(url, init) })), safeError); }
  }
  await assert.rejects(prepareDeezerGuessInventory([record()], options({ fetcher: async () => new Response('{"private-provider-secret":', { headers: { 'content-type': 'application/json' } }) })), safeError);
  await assert.rejects(prepareDeezerGuessInventory([record()], options({ decode: async () => { throw new UserError('private-provider-secret'); } })), safeError);
});

test('oversized metadata and media headers and streams are bounded and cancelled', async () => {
  for (const media of [false, true]) for (const advertised of [false, true]) {
    const maximum = media ? 2 * 1024 * 1024 : 512 * 1024; let cancelled = false;
    const defaults = options();
    await assert.rejects(prepareDeezerGuessInventory([record()], options({ fetcher: async (url, init) => {
      if (media && String(url).startsWith('https://api.')) return defaults.fetcher!(url, init);
      const stream = new ReadableStream<Uint8Array>({ start(controller) { if (!advertised) controller.enqueue(new Uint8Array(maximum + 1)); }, cancel() { cancelled = true; } });
      return new Response(stream, { headers: { 'content-type': media ? 'audio/mpeg' : 'application/json', ...(advertised ? { 'content-length': String(maximum + 1) } : {}) } });
    } })), safeError); assert(cancelled);
  }
});

test('already aborted requests perform no network, and cancellation disposes ready inventories', async () => {
  const aborted = new AbortController(); aborted.abort(); let calls = 0;
  await assert.rejects(prepareDeezerGuessInventory([record()], options({ signal: aborted.signal, fetcher: async () => { calls++; throw Error(); } })), safeError); assert.equal(calls, 0);
  const controller = new AbortController(), inventory = await prepareDeezerGuessInventory([record()], options({ signal: controller.signal }));
  const song = inventory.catalog.select('2010s', selection), pending = inventory.media.read(song.mediaKey, new AbortController().signal);
  controller.abort(); await assert.rejects(pending); assert(inventory.catalog.categories().every(category => !category.available));
  await assert.rejects(inventory.media.read(song.mediaKey, new AbortController().signal)); inventory.dispose(); inventory.dispose();
});

test('cancellation promptly rejects callers whose dependencies ignore abort', async () => {
  for (const stage of ['fetch', 'stream', 'decode']) {
    const controller = new AbortController(), defaults = options(), fetched = deferred<Response>(), decoded = deferred<Uint8Array>(); let cancelled = false;
    await assert.rejects(prepareDeezerGuessInventory([record()], options({ signal: controller.signal,
      fetcher: async (url, init) => {
        if (stage === 'fetch') { queueMicrotask(() => controller.abort()); return fetched.promise; }
        if (stage === 'stream') return new Response(new ReadableStream({ pull() { queueMicrotask(() => controller.abort()); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } });
        return defaults.fetcher!(url, init);
      }, decode: async () => { queueMicrotask(() => controller.abort()); return decoded.promise; },
    })), safeError);
    if (stage === 'stream') assert(cancelled);
    fetched.resolve(Response.json(metadata())); decoded.resolve(wav()); await nextTurn();
  }
  const recovered = await prepareDeezerGuessInventory([record()], options()); recovered.dispose();
});

test('a late fetch response is cancelled after its abandoned request has already returned', async () => {
  const controller = new AbortController(); let release: (response: Response) => void = () => {}; let cancelled = false;
  const pending = prepareDeezerGuessInventory([record()], options({ signal: controller.signal, fetcher: async () => new Promise<Response>(resolve => { release = resolve; }) }));
  controller.abort(); await assert.rejects(pending, safeError);
  release(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }));
  await nextTurn(); assert(cancelled);
});

test('mutating an options object cannot replace the original cancellation signal', async () => {
  const controller = new AbortController(), opts = options({ signal: controller.signal }), fetched = deferred<Response>();
  opts.fetcher = async () => { opts.signal = new AbortController().signal; queueMicrotask(() => controller.abort()); return fetched.promise; };
  await assert.rejects(prepareDeezerGuessInventory([record()], opts), safeError);
  fetched.resolve(Response.json(metadata())); await nextTurn();
});

test('process concurrency is capped at two preparations with no queued third network call', async () => {
  const first = new AbortController(), second = new AbortController(), fetched = deferred<Response>(); let calls = 0;
  const hanging: typeof fetch = async () => { calls++; return fetched.promise; };
  const a = prepareDeezerGuessInventory([record()], options({ signal: first.signal, fetcher: hanging }));
  const b = prepareDeezerGuessInventory([record('2')], options({ signal: second.signal, fetcher: hanging }));
  await assert.rejects(prepareDeezerGuessInventory([record('3')], options({ fetcher: hanging })), safeError); assert.equal(calls, 2);
  first.abort(); second.abort(); await Promise.all([assert.rejects(a, safeError), assert.rejects(b, safeError)]);
  fetched.resolve(Response.json(metadata())); await nextTurn();
});

test('permission expiry during metadata, media and decoding cannot publish an inventory', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  for (const stage of ['metadata', 'media', 'decode']) {
    const input = record(); input.permission.expiresAt = Date.now() + 1000;
    const defaults = options(); let calls = 0;
    await assert.rejects(prepareDeezerGuessInventory([input], options({ fetcher: async (url, init) => { calls++; if ((stage === 'metadata') === String(url).startsWith('https://api.') && stage !== 'decode') t.mock.timers.tick(1000); return defaults.fetcher!(url, init); }, decode: async () => { if (stage === 'decode') t.mock.timers.tick(1000); return wav(); } })), safeError);
    assert.equal(calls, stage === 'metadata' ? 1 : 2);
  }
});

test('five-minute TTL and explicit disposal prevent stale audio after yielding', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const inventory = await prepareDeezerGuessInventory([record()], options()); t.after(inventory.dispose);
  const song = inventory.catalog.select('2010s', selection), pending = inventory.media.read(song.mediaKey, new AbortController().signal);
  t.mock.timers.tick(300_000); await assert.rejects(pending); assert(inventory.catalog.categories().every(category => !category.available));
  const fresh = await prepareDeezerGuessInventory([record()], options()), key = fresh.catalog.select('2010s', selection).mediaKey;
  const read = fresh.media.read(key, new AbortController().signal); fresh.dispose(); await assert.rejects(read);
});

test('per-operation and overall deadlines cancel hung work independently', async t => {
  const timeout = new AbortController(), fetched = deferred<Response>(); t.mock.method(AbortSignal, 'timeout', () => timeout.signal);
  await assert.rejects(prepareDeezerGuessInventory([record()], options({ fetcher: async () => { queueMicrotask(() => timeout.abort()); return fetched.promise; } })), safeError);
  fetched.resolve(Response.json(metadata())); await nextTurn();
  t.mock.restoreAll(); t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 });
  t.mock.method(AbortSignal, 'timeout', () => new AbortController().signal);
  const overall = deferred<Response>(), pending = prepareDeezerGuessInventory([record()], options({ fetcher: async () => overall.promise }));
  t.mock.timers.tick(45_000); await assert.rejects(pending, safeError);
  overall.resolve(Response.json(metadata())); await nextTurn();
});

test('timed-out fetch and decoder dependencies retain their preparation slots until they actually settle', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 });
  t.mock.method(AbortSignal, 'timeout', () => new AbortController().signal);
  const fetched = deferred<Response>(), decoded = deferred<Uint8Array>(), enteredDecoder = deferred<void>(); let thirdCalls = 0;
  const first = prepareDeezerGuessInventory([record()], options({ fetcher: async () => fetched.promise }));
  const second = prepareDeezerGuessInventory([record('2')], options({ decode: async () => { enteredDecoder.resolve(); return decoded.promise; } }));
  await enteredDecoder.promise;
  t.mock.timers.tick(45_000); await Promise.all([assert.rejects(first, safeError), assert.rejects(second, safeError)]);
  await assert.rejects(prepareDeezerGuessInventory([record('3')], options({ fetcher: async () => { thirdCalls++; return Response.json(metadata()); } })), safeError);
  assert.equal(thirdCalls, 0);
  fetched.resolve(Response.json(metadata())); decoded.resolve(wav()); await nextTurn();
  const recovered = await prepareDeezerGuessInventory([record('3')], options()); recovered.dispose();
});
