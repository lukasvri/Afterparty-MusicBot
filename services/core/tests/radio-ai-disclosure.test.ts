import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { Providers } from '../src/providers.ts';
import { Store } from '../src/store.ts';
import type { Track } from '../src/types.ts';
import { selectRadio, RADIO_LIMITS } from '../src/radio-pipeline.ts';
import { roomRecommendation } from '../src/room-radio.ts';
import { YouTubeContent, youtubeDisclosure } from '../src/youtube-content.ts';
import { Engine } from '../src/engine.ts';
import { Rooms } from '../src/rooms.ts';
import { publicPlayback } from '../src/room-state.ts';
import { watchData, watchPage } from './youtube-watch-fixture.ts';

afterEach(() => mock.restoreAll());
const sadrican: Track = {
  id: '1eS1gFpPHfs', entryId: 'fixture',
  title: 'Sadrican - By The Way (Official Audio) | Progressive House',
  artist: 'Sadrican', duration: 297, image: '', live: false,
  music: true, embeddable: true, source: 'youtube', genres: ['progressive house'],
};
const seed: Track = { ...sadrican, id: '3nQNiWdeH2Q', entryId: 'seed',
  title: 'Janji - Heroes Tonight', artist: 'Janji' };

function editPage(edit: (data: Partial<ReturnType<typeof watchData>> & { engagementPanels?: unknown[]; description?: string; recommendations?: unknown }) => void) {
  const html = watchPage(sadrican.id);
  const data = JSON.parse(html.slice(html.indexOf(' = ') + 3, html.lastIndexOf(';</script>')));
  edit(data);
  return `<html lang="en"><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;
}

test('only the requested recording primary badge or actual disclosure section count as AI evidence', () => {
  assert.equal(youtubeDisclosure(watchPage(sadrican.id, true), sadrican.id), 'disclosed');
  for (const header of ['Made with AI', 'Altered or synthetic content', 'Captured with a camera', 'New unknown disclosure']) {
    const html = editPage(data => { data.engagementPanels = [{ engagementPanelSectionListRenderer: {
      content: { structuredDescriptionContentRenderer: { items: [{ howThisWasMadeSectionViewModel: {
        bodyHeader: { content: header }, bodyText: { content: 'Provider disclosure' },
      } }] } },
    } }]; });
    assert.equal(youtubeDisclosure(html, sadrican.id), header === 'Captured with a camera' ? 'not-observed'
      : header === 'New unknown disclosure' ? 'unknown' : 'disclosed');
  }
  const clean = editPage(data => {
    data.description = 'Made with AI; howThisWasMadeSectionViewModel; {escaped brace}';
    data.recommendations = { videoPrimaryInfoRenderer: { badges: [{ metadataBadgeRenderer: { label: 'AI' } }] } };
    data.contents!.twoColumnWatchNextResults.results.results.contents[0].videoPrimaryInfoRenderer.badges = [
      { metadataBadgeRenderer: { icon: { iconType: 'INFO' }, style: 'BADGE_STYLE_TYPE_SIMPLE', label: 'Other provider notice', accessibilityData: { label: 'Other notice' } } },
    ];
  });
  assert.equal(youtubeDisclosure(clean, sadrican.id), 'not-observed');
});

test('foreign IDs, unsupported language, incomplete structures and malformed data never approve radio', () => {
  const cases = [watchPage(seed.id), watchPage(sadrican.id).replace('lang="en"', 'lang="nb"'),
    '<html lang="en"><script>var ytInitialData = {bad}</script>',
    editPage(data => { delete data.contents; }),
    editPage(data => { data.contents!.twoColumnWatchNextResults.results.results.contents = []; }),
    watchPage(sadrican.id, true).replace('AI: Content was made with AI', 'Unrecognized localized label'),
    '<html lang="en">Consent required</html>'];
  for (const html of cases) assert.equal(youtubeDisclosure(html, sadrican.id), 'unknown');
});

test('content checks share in-flight work, bound concurrency and cache complete observations only', async () => {
  let release!: () => void, requests = 0, clock = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const verifier = new YouTubeContent(async (url, options) => {
    requests++; assert.equal(options?.redirect, 'error'); await gate;
    const id = new URL(String(url)).searchParams.get('v')!;
    return new Response(watchPage(id, id === sadrican.id));
  }, () => clock);
  const a = verifier.check(sadrican), same = verifier.check(sadrican), b = verifier.check(seed);
  const queued = verifier.check({ id: 'extra000001' });
  await Promise.resolve();
  assert.equal(requests, 2);
  release();
  assert.deepEqual(await Promise.all([a, same, b]), ['disclosed', 'disclosed', 'not-observed']);
  assert.equal(await queued, 'not-observed'); assert.equal(requests, 3);
  assert.equal(await verifier.check(seed), 'not-observed'); assert.equal(requests, 3);
  clock = 3600001;
  assert.equal(await verifier.check(seed), 'not-observed'); assert.equal(requests, 4);
  assert.equal(await verifier.check(sadrican), 'disclosed'); assert.equal(requests, 4);
  clock = 86400001;
  assert.equal(await verifier.check(sadrican), 'disclosed'); assert.equal(requests, 5);
});

test('failed and oversized public checks stay retryable and a stalled body has a five-second deadline', async () => {
  let requests = 0;
  const verifier = new YouTubeContent(async () => {
    requests++;
    return requests === 1 ? new Response('unavailable', { status: 503 }) : requests === 2
      ? new Response('x'.repeat(4 * 1024 * 1024 + 1)) : new Response(watchPage(seed.id));
  });
  assert.equal(await verifier.check(seed), 'unknown');
  assert.equal(await verifier.check(seed), 'unknown');
  assert.equal(await verifier.check(seed), 'not-observed'); assert.equal(requests, 3);
  mock.timers.enable({ apis: ['setTimeout'] });
  const stalled = new YouTubeContent(async (_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => reject(new Error('fixture aborted')));
  }));
  const result = stalled.check(seed); await Promise.resolve(); mock.timers.tick(5001);
  assert.equal(await result, 'unknown');
});

test('ranked radio skips disclosed and unavailable uploads and keeps its four-check budget', async () => {
  for (const mode of ['disclosed', 'unknown'] as const) {
    let probes = 0;
    const result = await selectRadio({ seed, recent: [], excluded: [], requireEmbeddable: true,
      search: async () => Array.from({ length: 20 }, (_, i) => ({ ...sadrican, id: `fixture${String(i).padStart(4, '0')}`, title: `Artist ${i} - Song ${i}` })),
      verifyContent: async () => { probes++; return mode; },
    });
    assert.equal(result.track, null); assert.equal(probes, RADIO_LIMITS.contentChecks);
    assert.equal(result.diagnostic.contentUnavailable, mode === 'unknown' ? RADIO_LIMITS.contentChecks : 0);
  }
});

test('an AI-marked preferred music video cannot replace a checked audio upload', async () => {
  const audio = { ...sadrican, id: 'audio000001', title: 'Cedar - Evening (Official Audio)' };
  const video = { ...audio, id: 'video000001', title: 'Cedar - Evening (Official Music Video)' };
  const result = await selectRadio({ seed: { ...seed, title: 'Aster - Opening' }, recent: [], excluded: [], requireEmbeddable: true,
    search: async () => [audio, video], verifyContent: async track => track.id === video.id ? 'disclosed' : 'not-observed',
  });
  assert.equal(result.track?.id, audio.id); assert.equal(result.diagnostic.musicVideo, 'filtered');
});

test('browser-room radio uses the same real disclosure guard without changing manual metadata ingestion', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(watchPage(sadrican.id, true)));
  assert.equal(await roomRecommendation({ current: seed, queue: [], radio: true }, async () => [sadrican], () => {}), null);
  const store = new Store(':memory:'), providers = new Providers(store, {});
  providers.youtube = async () => { throw new Error('fixture API unavailable'); };
  providers.extract = async () => ({ id: sadrican.id, title: sadrican.title, uploader: sadrican.artist, duration: 297, playable_in_embed: true });
  try { assert.equal((await providers.resolve('https://www.youtube.com/watch?v=' + sadrican.id))[0].id, sadrican.id); }
  finally { store.close(); }
});

test('a saved room cannot promote a legacy unchecked radio suggestion, while manual queued choices survive', () => {
  const store = new Store(':memory:'), rooms = new Rooms(store, () => 10000);
  const manual = { ...seed, id: 'manual00001', radio: false };
  try {
    const snapshot = rooms.import({ code: 'TESTROOM', name: 'Test', owner_hash: 'a'.repeat(64),
      state: JSON.stringify({ current: seed, radioSeed: seed, queue: [{ ...sadrican, radio: true }, manual], playing: false, position: 0, radio: true }),
      version: 1, updated_at: 10000, expires_at: 100000 });
    assert.deepEqual(snapshot.queue.map(track => track.id), [manual.id]);
    const next = rooms.mutate('TESTROOM', { action: 'next', version: 1, actorHash: 'a'.repeat(64) });
    assert.equal(next.current?.id, manual.id);
    const visible = publicPlayback({ current: { ...seed, radioContentChecked: 1 }, queue: [], playing: false, position: 0 });
    assert.equal(visible.current?.radioContentChecked, undefined, 'private verification metadata is not a public capability');
  } finally { rooms.dispose(); store.close(); }
});

for (const recovery of [false, true]) test(`Core restart skips unchecked pending radio but preserves exact already-started recovery (${recovery})`, async () => {
  const store = new Store(':memory:'), providers = new Providers(store, {});
  const pending = { ...sadrican, radio: true }, manual = { ...seed, id: 'manual00001', entryId: 'manual', radio: false };
  store.set('queue', [pending, manual]); store.set('radio-seed', seed);
  if (recovery) store.set('recovery', { track: pending, position: 32, paused: true });
  const engine = new Engine(store, providers, { onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {},
    duration: () => 0, advancing: () => false, buffering: () => false });
  clearInterval(engine.timer); engine.connected = true;
  const started: string[] = [];
  engine.startTrack = async track => { started.push(track.id); };
  try {
    await engine.startNext(true);
    assert.deepEqual(started, [recovery ? sadrican.id : manual.id]);
    if (recovery) assert.equal(engine.queue[0]?.id, manual.id, 'recovery never consumes the explicit pending choice');
  } finally { engine.close(); store.close(); }
});

test('automatic Core radio rejects the real unmarked-metadata recording when its own watch page discloses AI', async () => {
  const store = new Store(':memory:'), providers = new Providers(store, {});
  providers.search = async () => [sadrican];
  mock.method(globalThis, 'fetch', async () => new Response(watchPage(sadrican.id, true)));
  try {
    assert.equal(sadrican.aiGenerated, undefined, 'the observed ingestion gap is part of this regression');
    assert.equal(await providers.radio(seed, []), null, 'a clean title cannot override YouTube disclosure');
  } finally { store.close(); }
});
