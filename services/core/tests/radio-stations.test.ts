import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectRadio, RADIO_LIMITS, type RadioInput } from '../src/radio-pipeline.ts';
import { isRadioMusic, isRadioTitle, radioArtist, radioGenre } from '../src/radio.ts';
import { matchesStationRecording, radioStation, stationRecording } from '../src/radio-stations.ts';
import { playableRoomQueue, roomRecommendation } from '../src/room-radio.ts';
import type { Track } from '../src/types.ts';

let identifier = 0;
const track = (artist: string, title: string, extra: Partial<Track> = {}): Track => ({
  id: 'ncs' + String(++identifier).padStart(8, '0'), entryId: 'station-' + identifier,
  title: `${artist} - ${title} [NCS Release]`, artist: 'NoCopyrightSounds', duration: 210,
  image: '', live: false, embeddable: true, source: 'youtube', music: true, genres: [], ...extra,
});
const janji = () => track('Janji', 'Heroes Tonight (feat. Johnning)', { radio: false });
const lost = () => track('Lost Sky', 'Dreams', { radio: false });
const defaults = (seed: Track, extra: Partial<RadioInput> = {}): RadioInput => ({ seed, recent: [], excluded: [], requireEmbeddable: true, search: async () => [], ...extra });
function discovery(seed: Track) {
  const station = radioStation(seed)!;
  const recordings = station.songs.map(song => track(song.artist, song.title));
  const unrelated = track(radioArtist(seed), 'My studio setup and daily life', { music: undefined });
  const calls: string[] = [];
  const search = async (query: string) => {
    calls.push(query);
    if (query.endsWith('official music video')) return [];
    const selected = station.songs.find(song => query === `${song.artist} "${song.title}" official audio`);
    return selected ? [unrelated, recordings[station.songs.indexOf(selected)]] : [unrelated];
  };
  return { station, recordings, unrelated, calls, search };
}

for (const [name, original] of [['Janji', janji], ['Lost Sky', lost]] as const) {
  test(`${name} with an NCS uploader and no genre gets another named artist instead of arbitrary same-artist videos`, async () => {
    const seed = original(), before = structuredClone(seed), f = discovery(seed);
    const selected = await selectRadio(defaults(seed, { search: f.search }));
    assert(selected.track); assert.equal(selected.source, 'curated');
    assert.notEqual(radioArtist(selected.track), radioArtist(seed));
    assert.equal(radioGenre(selected.track), null, 'the fixed recording relation does not invent genre metadata');
    assert(stationRecording(f.station, selected.track));
    assert.equal(selected.track.radioRelatedTo, seed.id);
    assert.deepEqual(seed, before);
    assert.equal(selected.diagnostic.curatedSearches, 3);
    assert.equal(selected.diagnostic.catalogMatches, 3);
    assert.equal(selected.diagnostic.searches, 0, 'no broad artist-video fallback for a recognized station seed');
    assert(!f.calls.some(query => query === `${name} music audio`));
    assert(f.calls.length <= 1 + RADIO_LIMITS.curatedMatches + 1, 'metadata, bounded named lookups and optional format lookup only');
    const roomState = { current: seed, queue: [], radio: true, history: [] };
    const roomBefore = structuredClone(roomState), room = await roomRecommendation(roomState, f.search, () => {});
    assert(room); assert.notEqual(radioArtist(room), name); assert.equal(room.radioRelatedTo, seed.id);
    assert.deepEqual(roomState, roomBefore);
  });
  test(`${name} remains the original room anchor after a curated song becomes current`, async () => {
    const seed = original(), f = discovery(seed), first = await selectRadio(defaults(seed, { search: f.search }));
    assert(first.track);
    const state = { current: { ...first.track, radio: true }, radioSeed: seed, queue: [], radio: true, history: [seed] };
    const before = structuredClone(state), next = await roomRecommendation(state, f.search, () => {});
    assert(next); assert.notEqual(next.id, first.track.id); assert.equal(next.radioRelatedTo, seed.id);
    assert(stationRecording(f.station, next)); assert.deepEqual(state, before);
  });
}

test('NCS channel labels and attached catalog objects cannot fabricate station membership or different featured singers', () => {
  const seed = janji(), station = radioStation(seed)!;
  assert.equal(radioStation(track('Unlisted Artist', 'Unknown Song')), undefined);
  assert.equal(radioStation(track('Janji', 'Heroes Tonight (feat. Wrong Singer)')), undefined);
  assert.equal(radioStation(track('Janji', 'Heroes Tonight (Live)')), undefined);
  assert.equal(radioStation(track('Tobu', 'Sunburst')), undefined, 'Sunburst must retain the collaborative artist credit');
  assert(radioStation(track('Tobu & Itro', 'Sunburst')));
  assert(radioStation(track('Itro & Tobu', 'Sunburst')));
  assert.equal(stationRecording(station, track('Other Artist', 'Firefly', { catalog: { artist: 'Jim Yosef', title: 'Firefly', duration: 210 } })), false);
  const trap = radioStation(lost())!;
  const seasons = trap.songs.find(song => song.title.startsWith('Seasons'))!;
  assert(matchesStationRecording(seasons, track('Rival & Cadmium', 'Seasons (feat. Harley Bird)')));
  assert.equal(matchesStationRecording(seasons, track('Rival', 'Seasons (feat. Harley Bird)')), false);
  assert.equal(matchesStationRecording(seasons, track('Rival x Cadmium', 'Seasons (feat. Wrong Singer)')), false);
});

test('failed curated searches cannot reintroduce the original arbitrary Janji-video fallback', async () => {
  const seed = janji(), f = discovery(seed);
  const selected = await selectRadio(defaults(seed, { search: async () => [f.unrelated] }));
  assert.equal(selected.track, null); assert.equal(selected.diagnostic.curatedSearches, 3);
  assert(selected.diagnostic.rejected['catalog-match'] > 0);
});

test('known recordings are removed before targeted searches, including an explicit collaborative-credit alias', async () => {
  const seed = lost(), f = discovery(seed);
  const superhero = f.recordings.find(track => track.title.includes('Superhero'))!;
  const seasons = track('Rival & Cadmium', 'Seasons (feat. Harley Bird)');
  const selected = await selectRadio(defaults(seed, { recent: [superhero, seasons], search: f.search }));
  assert(selected.track); assert(!selected.track.title.includes('Superhero')); assert(!selected.track.title.includes('Seasons'));
  assert(!f.calls.some(query => query.includes('"Superhero'))); assert(!f.calls.some(query => query.includes('"Seasons')));
});

test('curated lookups share the four-operation catalog budget rather than adding unbounded hydration', async () => {
  const seed = janji(), f = discovery(seed); let matched = 0;
  const selected = await selectRadio(defaults(seed, { search: f.search,
    similar: async () => ['First', 'Second', 'Third'].map((title, index) => ({ title, artist: 'Unrelated ' + index, duration: 210 })),
    match: async () => { matched++; throw Error('synthetic unavailable'); },
    topTracks: async () => { assert.fail('a selected curated recording needs no artist recovery'); },
  }));
  assert(selected.track); assert.equal(matched, 3);
  assert.equal(selected.diagnostic.curatedSearches, 1); assert.equal(selected.diagnostic.catalogMatches, RADIO_LIMITS.catalogMatches);
});

test('explicit matching genre outranks unknown catalog metadata and unknown curated genre without bypassing conflicts', async () => {
  const seed = track('Aster', 'Opening', { genres: ['deep house'] });
  const exact = track('Aster', 'Exact Theme', { genres: ['deep house'] });
  const selected = await selectRadio(defaults(seed, { search: async () => [exact],
    similar: async () => [{ artist: 'Beryl', title: 'Unknown Theme', duration: 210 }],
    match: async () => track('Beryl', 'Unknown Theme'), favorites: ['Beryl - Unknown Theme'],
  }));
  assert.equal(selected.track?.id, exact.id);
  const namedSeed = janji(); namedSeed.genres = ['deep house'];
  const f = discovery(namedSeed);
  for (const recording of f.recordings) if (recording.title.includes('Firefly')) recording.genres = ['tech house'];
  const hope = f.recordings.find(track => track.title.includes('Hope'))!; hope.genres = ['deep house'];
  const named = await selectRadio(defaults(namedSeed, { search: f.search }));
  assert.equal(named.track?.id, hope.id); assert(named.diagnostic.rejected.style > 0);
});

test('explicit AI metadata, titles or uploader labels reject original seeds before every provider lookup', async () => {
  for (const seed of [{ ...janji(), aiGenerated: true }, track('Janji', 'Heroes Tonight (AI Generated)'), { ...lost(), artist: 'Suno Music' }]) {
    const selected = await selectRadio(defaults(seed, { search: async () => { assert.fail('AI seed must not search'); },
      similar: async () => { assert.fail('AI seed must not discover'); }, match: async () => { assert.fail('AI seed must not hydrate'); },
    }));
    assert.equal(selected.track, null); assert.equal(selected.diagnostic.outcome, 'insufficient-metadata');
  }
});

test('AI-labelled catalog descriptors are rejected before hydration and raw AI uploads cannot hide behind clean catalog labels', async () => {
  const seed = track('Aster', 'Opening', { genres: ['deep house'] }); let hydrated = 0;
  const flagged = track('Beryl', 'Evening', { genres: ['deep house'], aiGenerated: true, catalog: { artist: 'Beryl', title: 'Evening', duration: 210 } });
  const titleFlagged = track('Beryl', 'Evening (AI generated)', { genres: ['deep house'], catalog: flagged.catalog });
  const selected = await selectRadio(defaults(seed, { search: async () => [flagged, titleFlagged],
    similar: async () => [{ artist: 'Beryl', title: 'Evening (AI generated)', duration: 210 }, { artist: 'Suno', title: 'Evening', duration: 210 }],
    match: async () => { hydrated++; return flagged; },
  }));
  assert.equal(hydrated, 0); assert.equal(selected.track, null);
  assert.equal(isRadioMusic(flagged), false); assert.equal(isRadioMusic(titleFlagged), false);
  assert.equal(isRadioTitle('Evening (AI generated)'), false);
  const queued = { ...flagged, radio: true, radioRelatedTo: seed.id };
  assert.deepEqual(playableRoomQueue({ current: seed, radioSeed: seed, queue: [queued] }), []);
  const manual = { ...queued, radio: false };
  assert.deepEqual(playableRoomQueue({ current: seed, radioSeed: seed, queue: [manual] }), [manual], 'manual selections are unaffected by radio eligibility');
});

test('an AI-labelled official-video candidate never replaces an eligible audio recording', async () => {
  const seed = track('Aster', 'Opening', { genres: ['deep house'] }), audio = track('Beryl', 'Evening', { genres: ['deep house'] });
  const video = track('Beryl', 'Evening (Official Music Video)', { genres: ['deep house'], aiGenerated: true });
  const selected = await selectRadio(defaults(seed, { search: async query => query.endsWith('official music video') ? [video] : [video, audio] }));
  assert.equal(selected.track?.id, audio.id); assert.equal(selected.diagnostic.musicVideo, 'filtered');
});

test('finite station histories and two independent station seeds keep exclusions and membership isolated', async () => {
  const a = janji(), b = lost(), fa = discovery(a), fb = discovery(b);
  const history: Track[] = [];
  for (let pass = 0; pass < fa.station.songs.length - 1; pass++) {
    const selected = await selectRadio(defaults(a, { recent: history, search: fa.search }));
    assert(selected.track); assert(!history.some(track => track.id === selected.track!.id)); history.push(selected.track);
  }
  const exhausted = await selectRadio(defaults(a, { recent: history, search: fa.search }));
  assert.equal(exhausted.track, null); assert.equal(exhausted.diagnostic.curatedSearches, 0);
  const other = await selectRadio(defaults(b, { search: fb.search }));
  assert(other.track); assert(stationRecording(fb.station, other.track));
  assert.equal(stationRecording(fa.station, other.track), false);
  const excluded = fa.recordings.filter(track => track.id !== a.id).map(track => track.id);
  assert.equal((await selectRadio(defaults(a, { excluded, search: fa.search }))).track, null);
});

test('genre and catalog results cannot replay the same station recording under reversed collaborative credits', async () => {
  const seed = janji(); seed.genres = ['progressive house'];
  const previous = track('Itro & Tobu', 'Cloud 9');
  const repeated = track('Tobu & Itro', 'Cloud 9');
  for (const source of ['genre', 'catalog']) {
    const selected = await selectRadio(defaults(seed, { recent: [previous],
      search: async query => source === 'genre' && query.startsWith('progressive house audio') ? [repeated] : [],
      ...(source === 'catalog' ? {
        similar: async () => [{ artist: 'Tobu & Itro', title: 'Cloud 9', duration: 210 }],
        match: async () => repeated,
      } : {}),
    }));
    assert.equal(selected.track, null, source);
    assert(selected.diagnostic.rejected.recording > 0, source);
  }
});
