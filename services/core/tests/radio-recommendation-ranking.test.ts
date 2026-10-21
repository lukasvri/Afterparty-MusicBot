import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectRadio, RADIO_LIMITS, type RadioInput } from '../src/radio-pipeline.ts';
import { roomRecommendation } from '../src/room-radio.ts';
import { Recommendations } from '../src/recommendations.ts';
import { Store } from '../src/store.ts';
import { Providers } from '../src/providers.ts';
import { favoriteRecording } from '../src/recommendation-ranking.ts';
import type { CatalogSong } from '../src/matching.ts';
import type { Track } from '../src/types.ts';

const track = (id: string, artist: string, title: string, extra: Partial<Track> = {}): Track => ({
  id, entryId: id, title: `${artist} - ${title}`, artist: `${artist} - Topic`, duration: 210,
  source: 'youtube', music: true, live: false, embeddable: true, image: '', genres: ['deep house'], ...extra,
});
const seed = track('seed0000001', 'Aster', 'Opening');
const input = (extra: Partial<RadioInput> = {}): RadioInput => ({ seed, recent: [], excluded: [],
  requireEmbeddable: true, search: async () => [], ...extra });
const song = (artist: string, title: string): CatalogSong => ({ artist, title, duration: 210 });

test('radio hydrates distinct artists within the existing three-match budget instead of exhausting one artist', async () => {
  const descriptors = [song('Beryl', 'First'), song('Beryl', 'Second'), song('Beryl', 'Third'),
    song('Cedar', 'Style Conflict'), song('Drift', 'Fresh Evening')];
  const before = structuredClone(descriptors), attempted: string[] = [];
  const selected = await selectRadio(input({ similar: async () => descriptors,
    match: async descriptor => {
      attempted.push(descriptor.artist);
      if (descriptor.artist === 'Beryl') throw Error('synthetic unavailable recording');
      return track(`matched000${attempted.length}`, descriptor.artist, descriptor.title, {
        catalog: descriptor, genres: descriptor.artist === 'Cedar' ? ['tech house'] : ['deep house'],
      });
    }, topTracks: async () => { assert.fail('a usable similar recording leaves recovery unused'); },
  }));
  assert.deepEqual(attempted, ['Beryl', 'Cedar', 'Drift']);
  assert.equal(selected.track?.title, 'Drift - Fresh Evening'); assert.equal(selected.source, 'catalog');
  assert.equal(selected.diagnostic.catalogMatches, RADIO_LIMITS.similarMatches);
  assert.equal(selected.diagnostic.rejected.style, 1); assert.equal(selected.diagnostic.failedCatalogMatches, 1);
  assert.deepEqual(descriptors, before, 'ranking never reorders or changes caller metadata');
});

test('a diverse descriptor beyond an initial seed-artist run participates without adding hydration calls', async () => {
  const descriptors = [song('Aster', 'First'), song('Aster', 'Second'), song('Aster', 'Third'), song('Cedar', 'Morning')];
  const attempted: string[] = [];
  const selected = await selectRadio(input({ similar: async () => descriptors, match: async descriptor => {
    attempted.push(descriptor.artist); return track(`matched000${attempted.length}`, descriptor.artist, descriptor.title, { catalog: descriptor });
  } }));
  assert.deepEqual(attempted, ['Cedar', 'Aster', 'Aster']); assert.equal(selected.track?.title, 'Cedar - Morning');
  assert.equal(selected.diagnostic.catalogMatches, 3);
});

test('Core policy and room adapter prefer an older equal-frequency artist over the immediately previous artist', async () => {
  const history = [track('heard000001', 'Beryl', 'Earlier'), track('heard000002', 'Cedar', 'Earlier'), track('heard000003', 'Drift', 'Earlier')];
  const current = track('heard000004', 'Elm', 'Earlier', { radio: true });
  const repeated = track('repeat00001', 'Elm', 'Next'), varied = track('varied00001', 'Beryl', 'Next');
  const search = async () => [repeated, varied];
  const selected = await selectRadio(input({ recent: [...history, current], search }));
  const state = { current, radioSeed: seed, history, queue: [], radio: true }, before = structuredClone(state);
  const room = await roomRecommendation(state, search, () => {});
  assert.equal(selected.track?.id, varied.id); assert.equal(room?.id, varied.id);
  assert.deepEqual(state, before);
  const onlySafeFallback = await selectRadio(input({ recent: [...history, current], search: async () => [repeated] }));
  assert.equal(onlySafeFallback.track?.id, repeated.id, 'cooldown is a preference, never a new dead-end gate');
});

test('favorites match complete artist/title identity and cannot buy incompatible genre or recording proof', async () => {
  const short = track('short000001', 'Cedar', 'Night');
  const homonym = track('other000001', 'Drift', 'Midnight');
  const favorite = track('favor000001', 'Beryl', 'Midnight');
  const selected = await selectRadio(input({ favorites: ['BÉRYL - Midnight'], search: async () => [short, homonym, favorite] }));
  assert.equal(selected.track?.id, favorite.id);
  const unnamedArtist = { ...short, id: 'unnamed0001', title: 'Night', artist: 'Unverified Upload Channel' };
  const titleOnly = await selectRadio(input({ favorites: ['Night'], search: async () => [homonym, unnamedArtist] }));
  assert.equal(titleOnly.track?.id, homonym.id, 'a missing artist cannot turn a title-only name into favorite proof');
  const conflict = await selectRadio(input({ favorites: ['Beryl - Midnight'], search: async () => [
    { ...favorite, genres: ['tech house'], radioRelatedTo: seed.id }, short,
  ] }));
  assert.equal(conflict.track?.id, short.id); assert(conflict.diagnostic.rejected.style > 0);
  const mismatch = await selectRadio(input({ favorites: ['Beryl - Midnight'], similar: async () => [song('Beryl', 'Midnight')],
    match: async descriptor => track('spoof000001', 'Unrelated', 'Different', { catalog: descriptor }),
    search: async () => [short],
  }));
  assert.equal(mismatch.track?.id, short.id); assert.equal(mismatch.diagnostic.rejected['catalog-match'], 1);
});

test('catalog ranking ignores malformed descriptor fields and copies away untrusted nested proof before matching', async () => {
  const attempted: CatalogSong[] = [];
  const supplied = [null, { ...song('Beryl', 'Bad'), artist: 'Bad\nArtist' }, { ...song('Beryl', 'Bad'), duration: NaN },
    { ...song('Beryl', 'Bad'), title: 'x'.repeat(321) }, { ...song('Beryl', 'Production tutorial') },
    { ...song('Beryl', 'Morning'), providerUrl: 'https://secret.example', radioRelatedTo: seed.id, nested: { token: 'secret' } },
  ];
  const selected = await selectRadio(input({ similar: async () => supplied as CatalogSong[], match: async descriptor => {
    attempted.push(descriptor); return track('valid000001', descriptor.artist, descriptor.title, { catalog: descriptor });
  } }));
  assert.deepEqual(attempted, [song('Beryl', 'Morning')]); assert.equal(selected.track?.id, 'valid000001');
  assert(!JSON.stringify(selected.diagnostic).includes('secret'));
});

test('Last.fm canonicalizes bounded metadata and deduplicates artist/title identities before caching', async () => {
  const store = new Store(':memory:'); let calls = 0;
  try {
    const recommendations = new Recommendations(store, 'synthetic', async () => {
      calls++;
      return Response.json({ similartracks: { track: [
        { name: 'Morning', artist: { name: ' Beryl ' }, match: '0.8', nested: { token: 'private' } },
        { name: 'MÓRNING', artist: 'BERYL', match: 0.9 },
        { name: 'Bad\nTitle', artist: 'Beryl', match: 0.9 },
        { name: 'Oversize', artist: 'x'.repeat(201), match: 0.9 },
        { name: 'Weak', artist: 'Cedar', match: 0.19 },
      ] } });
    });
    const first = await recommendations.similar(seed);
    assert.deepEqual(first, [{ title: 'Morning', artist: 'Beryl', duration: 0 }]);
    first[0].artist = 'Changed';
    assert.deepEqual(await recommendations.similar(seed), [{ title: 'Morning', artist: 'Beryl', duration: 0 }]); assert.equal(calls, 1);
    const cacheKey = 'radio-catalog:v3:' + JSON.stringify(['track.getSimilar', 'Aster', 'Opening']);
    store.set(cacheKey, { at: Date.now(), songs: [{ ...song('Beryl', 'Cached'), nested: { token: 'private' } }] });
    assert.deepEqual(await recommendations.similar(seed), [song('Beryl', 'Cached')]); assert.equal(calls, 1);
    store.set(cacheKey, { at: Date.now(), songs: [{ ...song('Beryl', 'Cached'), artist: 'Bad\nArtist' }] });
    assert.deepEqual(await recommendations.similar(seed), [{ title: 'Morning', artist: 'Beryl', duration: 0 }]); assert.equal(calls, 2);
  } finally { store.close(); }
});

test('actual stored favorites use their recording query despite title-only or custom names, without cross-guild sharing', async t => {
  t.mock.method(console, 'info', () => {});
  const midnight = track('night000001', 'Cedar', 'Midnight'), homonym = track('other000001', 'Drift', 'Night');
  const favorite = track('favor000001', 'Beryl', 'Night');
  for (const name of ['Night', 'Custom favorite label']) {
    const store = new Store(':memory:'), otherStore = new Store(':memory:');
    try {
      store.favorite('synthetic-user', name, `https://www.youtube.com/watch?v=${favorite.id}`);
      const providers = new Providers(store, {}), other = new Providers(otherStore, {});
      providers.search = other.search = async () => [midnight, homonym, favorite];
      assert.equal((await providers.radio(seed, []))?.id, favorite.id);
      assert.equal((await other.radio(seed, []))?.id, midnight.id, 'one guild store cannot influence another');
      assert.equal((await providers.radio(seed, [favorite.id]))?.id, midnight.id, 'a favorite cannot override excluded IDs');
      providers.search = async () => [{ ...favorite, genres: ['tech house'] }, midnight];
      assert.equal((await providers.radio(seed, []))?.id, midnight.id, 'favorite recording identity cannot override genre');
      providers.search = async () => [{ ...favorite, title: 'Aster - Night', artist: 'Aster - Topic' }, midnight];
      assert.equal((await providers.radio(seed, []))?.id, midnight.id, 'genre-safe artist diversity remains ahead of favorites');
    } finally { store.close(); otherStore.close(); }
  }
});

test('favorite identities are source qualified and reject arbitrary queries, lookalike hosts and short-link expansion', async () => {
  const id = 'favor000001';
  for (const query of [`https://www.youtube.com/watch?v=${id}&t=12`, `https://youtu.be/${id}`, `https://music.youtube.com/watch?v=${id}`, id])
    assert.deepEqual(favoriteRecording(query), { source: 'youtube', id });
  assert.deepEqual(favoriteRecording('https://www.soundcloud.com/beryl/night/?si=tracking#t=5'), {
    source: 'soundcloud', url: 'https://soundcloud.com/beryl/night',
  });
  for (const query of ['Night', 'https://youtube.com.evil.test/watch?v=' + id, 'http://youtube.com/watch?v=' + id,
    'https://user:secret@youtube.com/watch?v=' + id, 'https://youtube.com:8443/watch?v=' + id,
    'https://on.soundcloud.com/unknown', 'https://soundcloud.com/beryl/sets/collection', 'https://soundcloud.com/search/sounds'])
    assert.equal(favoriteRecording(query), null);
  const youtube = track(id, 'Beryl', 'Night'), soundcloud = { ...youtube, source: 'soundcloud' as const,
    url: 'https://soundcloud.com/beryl/night' };
  const yt = await selectRadio(input({ requireEmbeddable: false, favoriteRecordings: [{ source: 'youtube', id }], search: async () => [soundcloud, youtube] }));
  assert.equal(yt.track?.source, 'youtube');
  const sc = await selectRadio(input({ requireEmbeddable: false,
    favoriteRecordings: [{ source: 'soundcloud', url: 'https://soundcloud.com/beryl/night' }], search: async () => [youtube, soundcloud] }));
  assert.equal(sc.track?.source, 'soundcloud');
});
