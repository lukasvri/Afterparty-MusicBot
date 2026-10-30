import { fixtureRadioContent } from './radio-content-fixture.ts';
import assert from "node:assert/strict";
import test from "node:test";
import { radioArtist, radioQuery, radioTitle, radioStyleCompatible, rankRadio } from "../src/radio.ts";
import { playableRoomQueue, roomRecommendation, type RoomRadioDiagnostic } from "../src/room-radio.ts";
import type { RoomVideo } from "../src/protocol.ts";
import type { Track } from "../src/types.ts";

const video = (id: string, title: string, genres?: string[]): RoomVideo => ({
  id, title, artist: "NoCopyrightSounds", genres, image: "", duration: 210,
  live: false, embeddable: true, music: true,
});
const track = (v: RoomVideo): Track => ({ ...v, entryId: v.id, source: "youtube" });
const seed = video("lenskoroot1", "Lensko - Let's Go! | House | NCS");
const metadata = video("lenskotag01", "Lensko - Let's Go! [Electro House]");
const suggestion = video("nextsong001", "Another Artist - New Song [Electro House]");
const diagnosticSummary = (value: unknown) => {
  const result = value as RoomRadioDiagnostic;
  assert.equal(result.version, 2);
  assert.equal(result.catalogMatches, 0);
  assert.equal(result.failedCatalogMatches, 0);
  assert.equal(result.stages.catalog, "unavailable");
  assert.equal(result.stages["artist-catalog"], "unavailable");
  const { outcome, seedGenre, artistKnown, metadata, searches, failedSearches, candidates } = result;
  return { outcome, seedGenre, artistKnown, metadata, searches, failedSearches, candidates };
};

test("Sam Waitin Aftermath discovers exact House across artists within the existing budget", async () => {
  const original = video("samwaitin01", "SAM WAITIN - AFTERMATH | House | NCS - Copyright Free Music");
  const own = video("samwaitin02", "SAM WAITIN - Another Song | House");
  const fresh = video("freshhouse1", "Another Artist - Fresh Song | House");
  const queries: string[] = [];
  assert.equal(radioArtist(track(original)), "SAM WAITIN");
  assert.equal(radioTitle(track(original)), "AFTERMATH");
  assert.equal(radioQuery(track(original)), 'house audio -"AFTERMATH"');
  const state = { current: original, radioSeed: original, queue: [], radio: true };
  const next = await roomRecommendation(state, async query => {
    queries.push(query);
    if (query === 'SAM WAITIN "AFTERMATH"') return [];
    if (query.endsWith("official music video")) return [];
    return [own,
      { ...fresh, id: "repeat00001", title: "SAM WAITIN - AFTERMATH (Official Audio) | House" },
      { ...fresh, id: "untagged001", title: "Another Artist - Untagged" },
      { ...fresh, id: "wrongstyle1", title: "Another Artist - Wrong | Tech House" },
      { ...fresh, id: "vlog0000001", title: "Another Artist - Fresh vlog | House" },
      { ...fresh, id: "recreate001", title: "Another Artist - Fresh (Recreation) | House" },
      { ...fresh, id: "aigenerated", aiGenerated: true }, fresh];
  }, undefined, fixtureRadioContent);
  assert.equal(next?.id, fresh.id);
  assert.equal(next?.radioRelatedTo, original.id);
  assert.deepEqual(queries, ['SAM WAITIN "AFTERMATH"', 'house audio -"AFTERMATH"',
    'SAM WAITIN music audio', 'Another Artist "Fresh Song" official music video']);
  assert.deepEqual(playableRoomQueue({ ...state, queue: [{ ...next!, radio: true, radioContentChecked: 1 as const }] }).map(song => song.id), [fresh.id]);
  assert.equal(state.current.id, original.id);
});

test("broad house metadata can be refined by the exact recording", async () => {
  const queries: string[] = [];
  const state = { current: seed, radioSeed: seed, queue: [], radio: true };
  const next = await roomRecommendation(state, async (q) => {
    queries.push(q);
    return q.includes('"Let\'s Go!"') && !q.includes('-"') ? [metadata] : [suggestion];
  }, undefined, fixtureRadioContent);
  assert.equal(next?.id, suggestion.id);
  assert.equal(next?.radioRelatedTo, seed.id);
  assert.ok(queries[0].includes('"Let\'s Go!"'));
  assert.equal(state.radioSeed, seed, "the caller's seed is not mutated");
  assert.equal(seed.title, "Lensko - Let's Go! | House | NCS");
  assert.deepEqual(playableRoomQueue({ ...state, queue: [{ ...next!, radio: true, radioContentChecked: 1 as const }] }).map(v => v.id), [suggestion.id]);
});

test("named House seeds admit exact House labels but require more evidence for a subgenre", () => {
  const broad = video("broadnext01", "Another Artist - Other Song | House");
  const unknown = video("unknown0001", "Unidentified Song | House");
  assert.deepEqual(rankRadio(track(seed), [track(broad), track(suggestion), track(unknown)], [], []).map(song => song.id), [broad.id]);
});

test("a house family label does not conflict with its explicitly named subgenre", () => {
  assert.equal(radioStyleCompatible(seed, metadata), true);
  assert.equal(radioStyleCompatible(metadata, seed), true);
  assert.equal(radioStyleCompatible(metadata, video("conflict001", "Lensko - New Song [Tech House]")), false);
  assert.equal(radioStyleCompatible(seed, video("conflict002", "Lensko - New Song [Hip Hop]")), false);
});

test("failed genre search falls back to the seed artist, not unrelated results", async () => {
  const specific = video("specific001", "Lensko - Let's Go! [Electro House]");
  const ownSong = video("ownsong0001", "Lensko - Other Song (Official Audio)");
  const queries: string[] = [];
  const next = await roomRecommendation({ current: specific, queue: [], radio: true }, async (q) => {
    queries.push(q);
    return q.startsWith("Lensko ") ? [ownSong] : [video("wrong000001", "Unrelated - Track [Tech House]")];
  }, undefined, fixtureRadioContent);
  assert.equal(next?.id, ownSong.id);
  assert.equal(queries.length, 3, "two discovery searches plus one format lookup");
});

test("refinement cannot use a different recording, tutorial, cover or conflicting genre", async () => {
  const unsafe = [
    video("wrongroot01", "Lensko - Different Song [Electro House]"),
    video("wrongroot02", "Other Artist - Let's Go! [Electro House]"),
    video("wrongroot03", "Lensko - Let's Go! Tutorial [Electro House]"),
    video("wrongroot04", "Lensko - Let's Go! Cover [Electro House]"),
    video("wrongroot05", "Lensko - Let's Go! [Hip Hop]"),
    { ...metadata, id: "wrongroot06", music: false },
    { ...metadata, id: "wrongroot07", duration: 500 },
    { ...metadata, id: "wrongroot08", embeddable: false },
  ];
  for (const candidate of unsafe) {
    const next = await roomRecommendation({ current: seed, queue: [], radio: true }, async (q) =>
      q.includes('"Let\'s Go!"') && !q.includes('-"') ? [candidate] : [suggestion], undefined, fixtureRadioContent
    );
    assert.equal(next, null, candidate.id);
  }
});

test("safe refinement still excludes repeated recordings and rejected suggestions", async () => {
  const original = { ...suggestion, radio: false };
  const alternate = video("alternate01", "Another Artist - New Song (Official Audio) [Electro House]");
  const state = { current: seed, queue: [], radio: true, history: [original], radioExcluded: ["excluded001"] };
  const next = await roomRecommendation(state, async (q) =>
    q.includes('"Let\'s Go!"') && !q.includes('-"') ? [metadata] : [alternate, { ...suggestion, id: "excluded001", title: "Another Artist - Different Song [Electro House]" }], undefined, fixtureRadioContent
  );
  assert.equal(next, null);
});

test("provider failure remains different from a successful empty search", async () => {
  const specific = video("specific002", "Lensko - Let's Go! [Electro House]");
  const state = { current: specific, queue: [], radio: true };
  await assert.rejects(roomRecommendation(state, async () => { throw new Error("provider unavailable"); }, undefined, fixtureRadioContent), /provider unavailable/);
  assert.equal(await roomRecommendation(state, async () => [], undefined, fixtureRadioContent), null);
});

test("artist fallback rejects irrelevant videos and repeated recordings after an empty genre search", async () => {
  const specific = video("specific003", "Lensko - Let's Go! [Electro House]");
  const previous = video("previous001", "Lensko - Previous Song");
  const unsafe = [
    video("wrongnext01", "Unrelated Artist - Untagged Song"),
    video("wrongnext02", "Lensko - Production Lesson [Electro House]"),
    video("wrongnext03", "Lensko - Let's Go! (2024 Remaster)"),
    video("wrongnext04", "Lensko - Previous Song (Official Audio)"),
    { ...video("wrongnext05", "Lensko - New Song"), music: false },
    { ...video("wrongnext06", "Lensko - New Song"), embeddable: false },
    video("wrongnext07", "Lensko - New Song [Tech House]"),
    video("excluded001", "Lensko - Removed Song"),
  ];
  const diagnostics: unknown[] = [];
  const result = await roomRecommendation({ current: specific, queue: [], radio: true,
    history: [previous], radioExcluded: ["excluded001"] },
    async query => query.startsWith("Lensko ") ? unsafe : [],
    diagnostic => diagnostics.push(diagnostic), fixtureRadioContent);
  assert.equal(result, null);
  assert.deepEqual(diagnostics.map(diagnosticSummary), [{ outcome: "filtered", seedGenre: "electro house", artistKnown: true,
    metadata: "unchanged", searches: 2, failedSearches: 0, candidates: unsafe.length }]);
  assert.deepEqual((diagnostics[0] as RoomRadioDiagnostic).rejected, {
    content: 2, visibility: 1, style: 1, relationship: 1, excluded: 1, recording: 2, "catalog-match": 0,
  });
});

test("sanitized diagnostics distinguish empty searches, provider errors and missing seed evidence", async () => {
  const specific = video("specific004", "Lensko - Let's Go! [Electro House]");
  const diagnostics: unknown[] = [];
  const diagnose = (value: unknown) => diagnostics.push(value);
  await roomRecommendation({ current: specific, queue: [] }, async () => [], diagnose, fixtureRadioContent);
  await assert.rejects(roomRecommendation({ current: specific, queue: [] }, async () => {
    throw new Error("private provider detail must never be logged");
  }, diagnose, fixtureRadioContent));
  await roomRecommendation({ current: { ...specific, title: "Unknown song", genres: ["house"] }, queue: [] }, async () => {
    assert.fail("insufficient metadata should not trigger provider searches");
  }, diagnose, fixtureRadioContent);
  assert.deepEqual(diagnostics.map(diagnosticSummary), [
    { outcome: "empty", seedGenre: "electro house", artistKnown: true, metadata: "unchanged", searches: 2, failedSearches: 0, candidates: 0 },
    { outcome: "provider-error", seedGenre: "electro house", artistKnown: true, metadata: "unchanged", searches: 2, failedSearches: 2, candidates: 0 },
    { outcome: "insufficient-metadata", seedGenre: "house", artistKnown: false, metadata: "unchanged", searches: 0, failedSearches: 0, candidates: 0 },
  ]);
  assert(!JSON.stringify(diagnostics).includes("private provider detail"));
  assert(!JSON.stringify(diagnostics).includes(specific.title));
  assert(!JSON.stringify(diagnostics).includes(specific.id));
});
