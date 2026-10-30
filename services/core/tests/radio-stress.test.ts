import { fixtureRadioContent, fixtureRadioOwner } from './radio-content-fixture.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Providers } from '../src/providers.ts';
import { Recommendations } from '../src/recommendations.ts';
import { Store } from '../src/store.ts';
import { RADIO_LIMITS, type RadioDiagnostic } from '../src/radio-pipeline.ts';
import { roomRecommendation, type RoomRadioState } from '../src/room-radio.ts';
import type { CatalogSong } from '../src/matching.ts';
import { publicTrack, type Track } from '../src/types.ts';

const id = (prefix: string, round: number) => prefix + String(round).padStart(8, '0');
const track = (videoId: string, artist: string, title: string, extra: Partial<Track> = {}): Track => ({
  id: videoId, entryId: `entry-${videoId}`, title: `${artist} - ${title}`, artist: `${artist} - Topic`,
  image: '', duration: 210, live: false, embeddable: true, source: 'youtube', music: true, genres: ['deep house'], ...extra,
});
const seed = track('anchor00001', 'Anchor', 'Opening', { concert: true, radio: false });
const cacheKey = 'radio-catalog:v3:' + JSON.stringify(['track.getSimilar', 'Anchor', 'Opening']);
function invalidCandidates(round: number, skipped: Track, excluded: Track): Track[] {
  return [
    track(id('prf', round), 'Unrelated', 'Forged relationship', { genres: ['house'], radioRelatedTo: seed.id }),
    track(id('bad', round), 'Conflicting', 'Wrong style', { genres: ['tech house'] }),
    track(id('tut', round), 'Anchor', 'Production tutorial'),
    track(id('cov', round), 'Anchor', 'Opening (Cover)'),
    track(id('liv', round), 'Anchor', 'Live stream', { live: true }),
    track(id('emb', round), 'Blocked', 'Cannot embed', { embeddable: false }),
    skipped, excluded,
    { ...skipped, id: id('skv', round), title: `${skipped.title} (Radio Edit)` },
  ];
}
function assertDiagnostic(diagnostic: RadioDiagnostic, privateValues: string[]) {
  assert.equal(diagnostic.outcome, 'selected');
  assert(diagnostic.searches <= RADIO_LIMITS.discoverySearches);
  assert(diagnostic.catalogMatches <= RADIO_LIMITS.catalogMatches);
  assert(diagnostic.candidates <= RADIO_LIMITS.candidates);
  assert(diagnostic.videoSearches <= 1); assert(diagnostic.videoCandidates <= RADIO_LIMITS.videoResults);
  for (const value of privateValues) assert(!JSON.stringify(diagnostic).includes(value), `private data in diagnostics: ${value}`);
}

test('24 guild-scoped radio rounds survive corrupted caches, partial errors, skips and forged proof within fixed budgets', async t => {
  let clock = 1_800_000_000_000, round = 0;
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Stress tests cannot contact live services'); });
  const diagnostics: RadioDiagnostic[] = [];
  t.mock.method(console, 'info', (event: unknown, value: unknown) => {
    if (event === 'core-radio') diagnostics.push(JSON.parse(String(value)) as RadioDiagnostic);
  });
  const guilds = [0, 1].map(index => {
    const store = new Store(':memory:'), providers = fixtureRadioOwner(new Providers(store, { LASTFM_API_KEY: 'synthetic-only' }));
    let searches = 0, matches = 0, requests = 0;
    const history: Track[] = [], seen = new Set<string>();
    const counters = () => ({ searches, matches, requests });
    const reset = () => { searches = 0; matches = 0; requests = 0; };
    const pair = () => [track(id('apl', round), `Apple Artist ${round}`, `Night ${round}`),
      track(id('cdr', round), `Cedar Artist ${round}`, `Night ${round}`)];
    const skipped = () => track(id('skp', round), `Skipped Artist ${round}`, `Skipped Song ${round}`);
    const excluded = () => track(id('exc', round), `Excluded Artist ${round}`, `Excluded Song ${round}`);
    providers.recommendations = new Recommendations(store, 'synthetic-only', async url => {
      requests++;
      const method = new URL(String(url)).searchParams.get('method');
      if (method === 'artist.getTopTracks') return Response.json({ toptracks: { track: [] } });
      if (round % 5 === 0) throw Error('private-provider-token simulated Last.fm failure');
      return Response.json({ similartracks: { track: [
        { name: 'Unsafe descriptor', artist: { name: 'Forged Artist' }, match: '0.99' },
        ...pair().map(value => ({ name: `Night ${round}`, artist: { name: value.title.split(' - ')[0] }, match: '0.8' })),
        { name: `Night ${round}`, artist: { name: `Apple Artist ${round}` }, match: '0.9' },
        { name: 'Bad\nDescriptor', artist: { name: 'Bad Artist' }, match: '0.9' },
      ] } });
    });
    providers.matchSong = async descriptor => {
      matches++;
      assert(!('radioRelatedTo' in descriptor)); assert(!('nested' in descriptor));
      if (descriptor.artist === 'Forged Artist' || descriptor.artist === 'Cache Forger')
        return track(id('spo', round), 'Intruder', 'Wrong Recording', { catalog: descriptor });
      const candidate = pair().find(value => value.title === `${descriptor.artist} - ${descriptor.title}`);
      assert(candidate, 'matching must only receive bounded approved synthetic descriptors');
      return { ...candidate, catalog: descriptor };
    };
    providers.search = async query => {
      searches++;
      if (query.endsWith('official music video')) {
        if (round % 4 === 0) throw Error('private-video-token optional format failure');
        const descriptor: CatalogSong = { artist: `Apple Artist ${round}`, title: `Night ${round}`, duration: 210 };
        return [track(id('vid', round), 'Intruder', 'Wrong Recording (Official Music Video)', { catalog: descriptor })];
      }
      if (query.startsWith('deep house') && round % 3 === 0) throw Error('private-query-token partial genre outage');
      const repeats = history.length ? [{ ...history.at(-1)!, id: id('rep', round),
        title: `${history.at(-1)!.title} (2024 Remaster)`, catalog: undefined }, history.at(-1)!] : [];
      return [...invalidCandidates(round, skipped(), excluded()), ...repeats, ...pair(), pair()[0]];
    };
    return { index, store, providers, history, seen, counters, reset, pair, skipped, excluded };
  });
  const choices: string[][] = [[], []];
  try {
    for (round = 0; round < 12; round++) {
      clock += 10_000;
      for (const guild of guilds) {
        guild.reset();
        const [apple, cedar] = guild.pair(), expected = guild.index === 0 ? apple : cedar;
        guild.store.favorite('synthetic-listener', 'An arbitrary favorite label', `https://www.youtube.com/watch?v=${expected.id}`);
        guild.store.set('radio-skips', { [guild.skipped().id]: clock });
        guild.store.set('radio-skipped-tracks', [{ track: guild.skipped(), at: clock }]);
        const poisoned = { artist: 'Cache Forger', title: 'Cached Phantom', duration: 0,
          radioRelatedTo: seed.id, nested: { token: 'private-cache-token' } };
        const cache = round % 4 === 0 ? { at: clock, songs: [{ ...poisoned, artist: 'Bad\nArtist' }] }
          : round % 4 === 1 ? { at: clock + 1, songs: [poisoned] }
          : round % 4 === 2 ? { at: clock - 86_400_001, songs: [poisoned] }
          : { at: clock, songs: [poisoned] };
        guild.store.set(cacheKey, cache);
        const favoriteBefore = guild.store.favorites(), historyBefore = guild.store.history();
        const selected = await guild.providers.radio(seed, [guild.excluded().id]);
        assert(selected, `guild ${guild.index}, round ${round} must recover while a safe candidate exists`);
        assert.equal(selected.id, expected.id, 'recording favorites are local and win only among comparable safe candidates');
        assert.equal(selected.live, false); assert.equal(selected.music, true); assert.equal(selected.embeddable, true);
        assert.deepEqual(selected.genres, ['deep house']); assert.equal(selected.radioRelatedTo, seed.id);
        assert(!selected.title.includes('Remaster')); assert(!selected.title.includes('Cover'));
        const composition = `${guild.index === 0 ? 'Apple' : 'Cedar'} Artist ${round}|Night ${round}`;
        assert(!guild.seen.has(composition)); guild.seen.add(composition); choices[guild.index].push(selected.id);
        const counts = guild.counters();
        assert(counts.searches <= RADIO_LIMITS.discoverySearches + 1); assert(counts.matches <= RADIO_LIMITS.catalogMatches);
        assert(counts.requests <= 2, 'only the existing similar and artist-catalog discovery stages may request metadata');
        if (round % 4 === 3) assert(counts.requests <= 1, 'the valid tainted cache is sanitized and does not trigger another similar lookup');
        else assert(counts.requests >= 1, 'malformed, future and expired caches must be replaced through the metadata boundary');
        assert.deepEqual(guild.store.favorites(), favoriteBefore); assert.deepEqual(guild.store.history(), historyBefore,
          'selection is side-effect free until the caller records an actual play');
        const diagnostic = diagnostics.at(-1)!;
        assertDiagnostic(diagnostic, [seed.id, selected.id, selected.title, 'private-provider-token', 'private-video-token', 'private-cache-token']);
        assert(diagnostic.rejected.content > 0); assert(diagnostic.rejected.style > 0);
        assert(diagnostic.rejected.relationship > 0); assert(diagnostic.rejected.excluded > 0);
        assert(diagnostic.rejected.recording > 0, 'an alternate upload of the skipped composition remains excluded');
        guild.providers.rememberRadioTrack(selected);
        guild.store.record(`synthetic-play:${round}`, publicTrack(selected)!, clock);
        guild.history.push(selected);
      }
    }
    assert.equal(diagnostics.length, 24); assert.equal(guilds[0].seen.size, 12); assert.equal(guilds[1].seen.size, 12);
    assert.equal(diagnostics.filter(value => value.failedSearches === 1).length, 8);
    assert.equal(diagnostics.filter(value => value.stages.catalog === 'failed').length, 6);
    assert.equal(diagnostics.filter(value => value.musicVideo === 'failed').length, 6);
    assert(diagnostics.filter(value => value.rejected['catalog-match'] > 0).length >= 12,
      'forged fresh and cached descriptors must actually reach and fail the recording-proof gate');
    assert(choices[0].every((choice, index) => choice !== choices[1][index]));
    assert.equal(guilds[0].store.history().length, 12); assert.equal(guilds[1].store.history().length, 12);
  } finally { for (const guild of guilds) guild.store.close(); }
});

test('12 room radio rounds keep a fixed seed, avoid composition repeats and recover from alternating discovery outages', async t => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Room stress tests cannot contact live services'); });
  const state: RoomRadioState = { current: seed, radioSeed: seed, radio: true, queue: [], radioHistory: [] };
  const seen = new Set<string>(), artists: string[] = [], diagnostics: RadioDiagnostic[] = [];
  for (let round = 0; round < 12; round++) {
    const skipped = track(id('rsk', round), 'Skipped Artist', `Skipped ${round}`);
    const excluded = track(id('rex', round), 'Excluded Artist', `Excluded ${round}`);
    state.radioExcluded = [excluded.id]; state.radioExcludedSongs = [skipped];
    const candidates = ['Beryl', 'Cedar', 'Drift'].map((artist, index) => track(id(`r${index}x`, round), artist, `Evening ${round}`));
    const byId = new Map(candidates.map(value => [value.id, value]));
    const prior = state.current && state.current.id !== seed.id ? [{ ...state.current, id: id('rpt', round),
      title: `${state.current.title} (2024 Remaster)` }] : [];
    let searches = 0;
    const before = structuredClone(state);
    const next = await roomRecommendation(state, async query => {
      searches++;
      if (query.endsWith('official music video')) return [];
      if (query.startsWith('deep house') && round % 2 === 0) throw Error('private-room-provider-error');
      return [...invalidCandidates(round, skipped, excluded), ...prior, ...candidates, candidates[0]];
    }, value => diagnostics.push(value), fixtureRadioContent);
    assert(next, `room round ${round} must find a safe nonrepeated song`);
    const expected = byId.get(next.id); assert(expected, 'only an admitted synthetic studio recording may win');
    assert.equal(next.title, expected.title); assert.equal(next.artist, expected.artist);
    assert.equal(next.radioRelatedTo, seed.id); assert.equal(next.embeddable, true);
    assert(searches <= RADIO_LIMITS.discoverySearches + 1); assert.deepEqual(state, before);
    const composition = `${expected.artist}|Evening ${round}`;
    assert(!seen.has(composition)); seen.add(composition);
    const artist = expected.artist.replace(' - Topic', '');
    if (artists.length) assert.notEqual(artist, artists.at(-1), 'an equally safe different artist must break an immediate artist repeat');
    artists.push(artist);
    assertDiagnostic(diagnostics.at(-1)!, [seed.id, next.id, next.title, 'private-room-provider-error']);
    state.radioHistory = [...(state.radioHistory ?? []), state.current!]; state.current = { ...next, radio: true, radioContentChecked: 1 as const };
  }
  assert.equal(seen.size, 12); assert.equal(new Set(artists).size, 3); assert.equal(diagnostics.length, 12);
  assert.equal(diagnostics.filter(value => value.failedSearches === 1).length, 6);
  state.queue = [{ ...track('manual00001', 'Manual Artist', 'Deliberate choice'), radio: false }];
  assert.equal(await roomRecommendation(state, async () => { assert.fail('a manual queued song must suppress automatic discovery'); }, () => {}, fixtureRadioContent), null);
});
