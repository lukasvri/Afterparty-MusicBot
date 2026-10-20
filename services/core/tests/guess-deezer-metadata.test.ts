import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeezerSeeds, seedIdentity, validateDeezerPreviewUrl,
  type DeezerSeed, type DeezerPermission } from '../src/guess-deezer-metadata.ts';

// Fictional operator inputs and in-memory HTTP responses only. No live provider access.
const preview = 'https://cdnt-preview.dzcdn.net/api/1/2/fictional_recording.mp3?hdnea=exp=9999999999~hmac=synthetic';
const seed = (): DeezerSeed => ({ artist: 'Sample Artist', title: 'Fictional Signal', originalYear: 2014,
  originalReleaseSource: 'https://operator.example/evidence/fictional-signal', categoryIds: ['2010s'] });
const permission = (seeds = [seed()]): DeezerPermission => ({ enabled: true, privateDevelopment: true,
  providerPermissionReference: 'Synthetic operator permission record', recordings: seeds.map(seedIdentity) });
const candidate = (overrides: Record<string, unknown> = {}) => ({ id: 123, title: seed().title,
  artist: { name: seed().artist }, ...overrides });
const track = (overrides: Record<string, unknown> = {}) => ({ ...candidate(), readable: true,
  release_date: '2014-05-12', preview, duration: 219, ...overrides });
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  ...init, headers: { 'content-type': 'application/json', ...init.headers } });
function fixture(responses: (Response | Error)[] = [json({ data: [candidate()] }), json(track())]) {
  const calls: { url: string; options?: RequestInit }[] = [];
  const fetcher = (async (input: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(input), options });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    assert(response, 'Unexpected extra provider request');
    return response;
  }) as typeof fetch;
  return { calls, fetcher };
}
const unavailable = { status: 503 };

test('metadata is disabled by default and explicit disable never touches the fetcher', async () => {
  const f = fixture([]);
  assert.deepEqual(await resolveDeezerSeeds({ seeds: [seed()], fetcher: f.fetcher }), []);
  assert.deepEqual(await resolveDeezerSeeds({ seeds: [null as unknown as DeezerSeed],
    permission: { ...permission(), enabled: false }, fetcher: f.fetcher }), []);
  assert.equal(f.calls.length, 0);
});

test('all permission and recording gates fail closed before any request', async () => {
  for (const override of [
    { enabled: undefined }, { enabled: 'true' }, { privateDevelopment: false },
    { privateDevelopment: undefined }, { providerPermissionReference: '' },
    { providerPermissionReference: '  ' }, { providerPermissionReference: 'bad\nreference' },
    { recordings: [] }, { recordings: ['other artist|fictional signal'] },
    { recordings: ['Sample Artist|Fictional Signal'] }, { recordings: null },
  ]) {
    const f = fixture([]);
    await assert.rejects(resolveDeezerSeeds({ seeds: [seed()],
      permission: { ...permission(), ...override } as DeezerPermission, fetcher: f.fetcher }), unavailable);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture([]), second = { ...seed(), title: 'Another Fictional Signal' };
  await assert.rejects(resolveDeezerSeeds({ seeds: [seed(), second], permission: permission(), fetcher: f.fetcher }), unavailable);
  assert.equal(f.calls.length, 0);
});

test('curatorial evidence, categories, metadata and batch size are checked before fetching', async () => {
  const variants = [
    { originalYear: 2009 }, { originalYear: 2020 }, { originalYear: 2014.5 },
    { originalReleaseSource: '' }, { originalReleaseSource: 'http://operator.example/evidence' },
    { originalReleaseSource: 'https://user:password@operator.example/evidence' },
    { artist: 'bad\nartist' }, { title: '' }, { categoryIds: [] },
    { categoryIds: ['unknown'] }, { categoryIds: ['2010s', '2010s'] },
  ];
  for (const override of variants) {
    const value = { ...seed(), ...override } as DeezerSeed, f = fixture([]);
    await assert.rejects(resolveDeezerSeeds({ seeds: [value], permission: permission([value]), fetcher: f.fetcher }), unavailable);
    assert.equal(f.calls.length, 0);
  }
  const many = Array.from({ length: 9 }, seed), f = fixture([]);
  await assert.rejects(resolveDeezerSeeds({ seeds: many, permission: permission(many), fetcher: f.fetcher }), unavailable);
  assert.equal(f.calls.length, 0);
});

test('serial exact search and track lookup return private metadata without inferring rights or preview duration', async () => {
  const original = seed(), f = fixture();
  const resolved = await resolveDeezerSeeds({ seeds: [original], permission: permission(), fetcher: f.fetcher });
  assert.deepEqual(resolved, [{ ...original, previewUrl: preview, providerTrackId: '123', fullDurationSeconds: 219 }]);
  assert.equal('rightsCleared' in resolved[0], false);
  assert.equal('durationSeconds' in resolved[0], false);
  assert.equal('previewDurationSeconds' in resolved[0], false);
  assert.equal(f.calls.length, 2);
  const search = new URL(f.calls[0].url);
  assert.equal(search.origin, 'https://api.deezer.com');
  assert.equal(search.pathname, '/search');
  assert.equal(search.searchParams.get('limit'), '5');
  assert.equal(search.searchParams.get('q'), 'artist:"Sample Artist" track:"Fictional Signal"');
  assert.equal(f.calls[1].url, 'https://api.deezer.com/track/123');
  for (const call of f.calls) {
    assert.equal(call.options?.redirect, 'error');
    assert.deepEqual(call.options?.headers, { Accept: 'application/json' });
    assert(call.options?.signal instanceof AbortSignal);
  }
  resolved[0].categoryIds.push('edm-classics');
  assert.deepEqual(original.categoryIds, ['2010s']);
});

test('normalized exact duplicates and repeated search IDs produce one recording', async () => {
  const first = seed(), duplicate: DeezerSeed = { ...seed(), artist: '  SÁMPLE Artist ',
    title: 'Fictional---Signal', categoryIds: ['edm-classics'] };
  assert.equal(seedIdentity(first), seedIdentity(duplicate));
  const f = fixture([json({ data: [candidate(), candidate({ id: '123' })] }), json(track())]);
  const resolved = await resolveDeezerSeeds({ seeds: [first, duplicate], permission: permission([first]), fetcher: f.fetcher });
  assert.equal(resolved.length, 1);
  assert.deepEqual(resolved[0].categoryIds, ['2010s', 'edm-classics']);
  assert.equal(f.calls.length, 2);
  const conflict = { ...duplicate, originalYear: 2015 }, noFetch = fixture([]);
  await assert.rejects(resolveDeezerSeeds({ seeds: [first, conflict], permission: permission([first]), fetcher: noFetch.fetcher }), unavailable);
  assert.equal(noFetch.calls.length, 0);
});

test('search requires exactly one exact recording and bounds the result count', async () => {
  for (const data of [[], [candidate({ title: 'Fictional Signal (Remix)' })],
    [candidate({ artist: { name: 'Different Artist' } })],
    [candidate(), candidate({ id: 456 })], Array.from({ length: 6 }, () => candidate()),
    [candidate({ id: '../private' })], [candidate({ id: 'https://evil.example/track' })],
    [candidate({ id: Number.MAX_SAFE_INTEGER + 1 })],
  ]) {
    const f = fixture([json({ data })]);
    await assert.rejects(resolveDeezerSeeds({ seeds: [seed()], permission: permission(), fetcher: f.fetcher }), unavailable);
    assert.equal(f.calls.length, 1);
  }
});

test('exact track lookup rejects mismatched identity, date, unreadability and missing preview', async () => {
  for (const override of [
    { id: 456 }, { artist: { name: 'Other Artist' } }, { title: 'Fictional Signal (Radio Edit)' },
    { release_date: '2015-05-12' }, { release_date: '2014' }, { release_date: null },
    { release_date: '2014-02-30' }, { release_date: '2014-99-99' },
    { readable: false }, { readable: undefined }, { preview: '' }, { preview: undefined },
    { preview: 'https://evil.example/api/track.mp3' }, { duration: 0 }, { duration: '219' },
    { duration: 100_000 }, { error: { code: 800 } },
  ]) {
    const f = fixture([json({ data: [candidate()] }), json(track(override))]);
    await assert.rejects(resolveDeezerSeeds({ seeds: [seed()], permission: permission(), fetcher: f.fetcher }), unavailable);
    assert.equal(f.calls.length, 2);
  }
});

test('provider errors and expired preview HTTP-style error metadata never return partial batches', async () => {
  const second: DeezerSeed = { ...seed(), title: 'Second Fictional Signal' };
  const f = fixture([json({ data: [candidate()] }), json(track()), json({ error: { code: 800 } })]);
  await assert.rejects(resolveDeezerSeeds({ seeds: [seed(), second], permission: permission([seed(), second]), fetcher: f.fetcher }), unavailable);
  assert.equal(f.calls.length, 3);
  for (const response of [new Error('synthetic connection error'), json({ data: [] }, { status: 403 }),
    json({ data: [] }, { status: 429 }), json({ data: [] }, { status: 500 })]) {
    const failed = fixture([response]);
    await assert.rejects(resolveDeezerSeeds({ seeds: [seed()], permission: permission(), fetcher: failed.fetcher }), unavailable);
    assert.equal(failed.calls.length, 1);
  }
});

test('preview validation rejects SSRF targets and URL parsing ambiguities', () => {
  assert.equal(validateDeezerPreviewUrl(preview), preview);
  assert.equal(validateDeezerPreviewUrl('https://cdnt-preview.dzcdn.net/preview/fictional.mp3'),
    'https://cdnt-preview.dzcdn.net/preview/fictional.mp3');
  for (const invalid of [
    'http://cdnt-preview.dzcdn.net/preview/track.mp3', 'https://api.deezer.com/preview/track.mp3',
    'https://cdnt-preview.dzcdn.net.evil.example/preview/track.mp3', 'https://127.0.0.1/preview/track.mp3',
    'https://[::1]/preview/track.mp3', 'https://user@cdnt-preview.dzcdn.net/preview/track.mp3',
    'https://cdnt-preview.dzcdn.net:443/preview/track.mp3', 'https://cdnt-preview.dzcdn.net:444/preview/track.mp3',
    'https://cdnt-preview.dzcdn.net/preview/track.mp3#fragment', 'https://cdnt-preview.dzcdn.net/preview/%74rack.mp3',
    'https://cdnt-preview.dzcdn.net/preview/../api/track.mp3', 'https://cdnt-preview.dzcdn.net/preview/%2e%2e/track.mp3',
    'https://cdnt-preview.dzcdn.net/preview/track.mp3?redirect=%2fprivate',
    'https://cdnt-preview.dzcdn.net/preview\\track.mp3', 'https://cdnt-preview.dzcdn.net/preview//track.mp3',
    'https://cdnt-preview.dzcdn.net/other/track.mp3', 'https://cdnt-preview.dzcdn.net/preview/track.wav',
    ' https://cdnt-preview.dzcdn.net/preview/track.mp3', 'https://cdnt-preview.dzcdn.net/preview/track.mp3\n',
  ]) assert.throws(() => validateDeezerPreviewUrl(invalid), unavailable, invalid);
});

test('metadata rejects redirects, unexpected response origins, MIME and malformed JSON', async () => {
  const redirected = json({ data: [candidate()] });
  Object.defineProperty(redirected, 'redirected', { value: true });
  const wrongOrigin = json({ data: [candidate()] });
  Object.defineProperty(wrongOrigin, 'url', { value: 'https://evil.example/search' });
  for (const response of [redirected, wrongOrigin, json({}, { status: 302, headers: { location: 'https://evil.example' } }),
    json({}, { headers: { 'content-type': 'text/html' } }), json({}, { headers: { 'content-type': 'audio/mpeg' } }),
    new Response('{invalid', { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
    json({ error: { code: 4 } }), json({ data: 'invalid' }), json(null),
  ]) {
    const f = fixture([response]);
    await assert.rejects(resolveDeezerSeeds({ seeds: [seed()], permission: permission(), fetcher: f.fetcher }), unavailable);
  }
});

test('metadata bounds declared, streamed and header bytes', async () => {
  let canceled = false;
  const oversized = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(40_000)); controller.enqueue(new Uint8Array(40_000)); },
    cancel() { canceled = true; },
  }), { headers: { 'content-type': 'application/json' } });
  for (const response of [json({}, { headers: { 'content-length': '65537' } }),
    json({}, { headers: { 'content-length': 'invalid' } }),
    json({}, { headers: { 'x-oversized': 'x'.repeat(65_536) } }), oversized]) {
    const f = fixture([response]);
    await assert.rejects(resolveDeezerSeeds({ seeds: [seed()], permission: permission(), fetcher: f.fetcher }), unavailable);
  }
  assert.equal(canceled, true);
});

test('abort is checked before fetching and interrupts in-flight headers even with an uncooperative fetcher', async () => {
  const before = new AbortController(); before.abort();
  const f = fixture([]);
  await assert.rejects(resolveDeezerSeeds({ seeds: [seed()], permission: permission(), signal: before.signal, fetcher: f.fetcher }), unavailable);
  assert.equal(f.calls.length, 0);
  const during = new AbortController();
  let requestSignal: AbortSignal | undefined;
  const pending = resolveDeezerSeeds({ seeds: [seed()], permission: permission(), signal: during.signal,
    fetcher: ((_input, init) => { requestSignal = init?.signal ?? undefined; return new Promise<Response>(() => {}); }) as typeof fetch });
  const rejection = assert.rejects(pending, unavailable);
  during.abort();
  await rejection;
  assert.equal(requestSignal?.aborted, true);
});

test('request timeout includes fetching headers and stalled body reads', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const stalledBody of [false, true]) {
    let requestSignal: AbortSignal | undefined, started!: () => void;
    const bodyStarted = new Promise<void>(resolve => { started = resolve; });
    const response = new Response(new ReadableStream<Uint8Array>({ pull() { started(); return new Promise(() => {}); } }),
      { headers: { 'content-type': 'application/json' } });
    const pending = resolveDeezerSeeds({ seeds: [seed()], permission: permission(),
      fetcher: ((_input, init) => { requestSignal = init?.signal ?? undefined;
        return stalledBody ? Promise.resolve(response) : new Promise<Response>(() => {}); }) as typeof fetch });
    const rejection = assert.rejects(pending, unavailable);
    if (stalledBody) await bodyStarted;
    t.mock.timers.tick(5_000);
    await rejection;
    assert.equal(requestSignal?.aborted, true);
  }
});

test('total timeout bounds the complete serial batch', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const seeds = Array.from({ length: 8 }, (_, index) => ({ ...seed(), title: `Fictional Signal ${index}` }));
  const requests: { resolve: (response: Response) => void; signal?: AbortSignal }[] = [];
  const pending = resolveDeezerSeeds({ seeds, permission: permission(seeds), fetcher: ((_input, init) =>
    new Promise<Response>(resolve => { requests.push({ resolve, signal: init?.signal ?? undefined }); })) as typeof fetch });
  const rejection = assert.rejects(pending, unavailable);
  for (let request = 0; request < 11; request++) {
    // Each completed request uses 4.5 seconds, under its own five-second deadline.
    assert.equal(requests.length, request + 1);
    t.mock.timers.tick(4_500);
    const index = Math.floor(request / 2), value = seeds[index];
    requests[request].resolve(json(request % 2 === 0
      ? { data: [candidate({ id: 100 + index, title: value.title })] }
      : track({ id: 100 + index, title: value.title })));
    // Drain the finite fetch/read/JSON promise chain without advancing timers.
    for (let drain = 0; drain < 30; drain++) await Promise.resolve();
  }
  assert.equal(requests.length, 12);
  t.mock.timers.tick(500);
  await rejection;
  assert.equal(requests[11].signal?.aborted, true);
});
