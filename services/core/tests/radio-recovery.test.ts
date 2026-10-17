import assert from "node:assert/strict";
import test from "node:test";
import { radioStyleCompatible, rankRadio } from "../src/radio.ts";
import { playableRoomQueue, roomRecommendation } from "../src/room-radio.ts";
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

test("broad house metadata can be refined by the exact recording", async () => {
  const queries: string[] = [];
  const state = { current: seed, radioSeed: seed, queue: [], radio: true };
  const next = await roomRecommendation(state, async (q) => {
    queries.push(q);
    return q.includes('"Let\'s Go!"') && !q.includes('-"') ? [metadata] : [suggestion];
  });
  assert.equal(next?.id, suggestion.id);
  assert.equal(next?.radioRelatedTo, seed.id);
  assert.ok(queries[0].includes('"Let\'s Go!"'));
  assert.equal(state.radioSeed, seed, "the caller's seed is not mutated");
  assert.equal(seed.title, "Lensko - Let's Go! | House | NCS");
  assert.deepEqual(playableRoomQueue({ ...state, queue: [{ ...next!, radio: true }] }).map(v => v.id), [suggestion.id]);
});

test("broad house labels are not evidence for another artist by themselves", () => {
  const broad = video("broadnext01", "Another Artist - Other Song | House");
  assert.deepEqual(rankRadio(track(seed), [track(broad), track(suggestion)], [], []), []);
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
  });
  assert.equal(next?.id, ownSong.id);
  assert.equal(queries.length, 2);
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
      q.includes('"Let\'s Go!"') && !q.includes('-"') ? [candidate] : [suggestion],
    );
    assert.equal(next, null, candidate.id);
  }
});

test("safe refinement still excludes repeated recordings and rejected suggestions", async () => {
  const original = { ...suggestion, radio: false };
  const alternate = video("alternate01", "Another Artist - New Song (Official Audio) [Electro House]");
  const state = { current: seed, queue: [], radio: true, history: [original], radioExcluded: ["excluded001"] };
  const next = await roomRecommendation(state, async (q) =>
    q.includes('"Let\'s Go!"') && !q.includes('-"') ? [metadata] : [alternate, { ...suggestion, id: "excluded001", title: "Another Artist - Different Song [Electro House]" }],
  );
  assert.equal(next, null);
});

test("provider failure remains different from a successful empty search", async () => {
  const specific = video("specific002", "Lensko - Let's Go! [Electro House]");
  const state = { current: specific, queue: [], radio: true };
  await assert.rejects(roomRecommendation(state, async () => { throw new Error("provider unavailable"); }), /provider unavailable/);
  assert.equal(await roomRecommendation(state, async () => []), null);
});
