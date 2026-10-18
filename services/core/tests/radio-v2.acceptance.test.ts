import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { Store } from "../src/store.ts";
import { Providers } from "../src/providers.ts";
import { Recommendations } from "../src/recommendations.ts";
import { roomRecommendation } from "../src/room-radio.ts";
import type { Track } from "../src/types.ts";

// Exercise real selection and in-memory persistence with synthetic adapters only.
beforeEach(() => {
  mock.method(globalThis, "fetch", async () => {
    assert.fail("Radio acceptance tests must not use a live provider");
  });
});
afterEach(() => mock.restoreAll());
const track = (id: string, title: string, extra: Partial<Track> = {}): Track => ({
  id, entryId: id, title, artist: "Synthetic Publisher", duration: 210,
  image: "", live: false, embeddable: true, source: "youtube", music: true, ...extra,
});
const seed = track("seed0000001", "Aster - Opening [Deep House]");
const own = track("own00000001", "Aster - Evening");

test("radio v2: Core and room adapters share the safe original-artist fallback", async () => {
  const store = new Store(":memory:");
  try {
    const providers = new Providers(store, {}), queries: string[] = [];
    const search = async (query: string) => {
      queries.push(query);
      return query.startsWith("Aster ") ? [own] : [];
    };
    providers.search = search;
    const room = await roomRecommendation({ current: seed, radioSeed: seed, queue: [], radio: true }, search, () => {});
    assert.equal(room?.id, own.id);
    queries.length = 0;
    const core = await providers.radio(seed, []);
    assert.equal(core?.id, own.id, "Core must recover the same eligible artist after an empty genre search");
    assert.equal(queries.length, 2, "Genre and artist fallback remain bounded");
    assert.equal(core.radioRelatedTo, seed.id);
  } finally { store.close(); }
});

test("radio v2: known recent catalog songs do not consume all hydration slots", async () => {
  const store = new Store(":memory:");
  try {
    const providers = new Providers(store, { LASTFM_API_KEY: "synthetic" });
    const titles = ["Recent One", "Recent Two", "Recent Three", "Recent Four", "Fresh Evening"];
    const recent = titles.slice(0, 4).map((title, index) => track(`recent0000${index}`, `Other Artist - ${title} [Deep House]`));
    providers.radioHistory = () => recent;
    providers.recommendations.similar = async () => titles.map(title => ({ title, artist: "Other Artist", duration: 210 }));
    const matched: string[] = [];
    providers.matchSong = async song => {
      matched.push(song.title);
      return track(song.title === "Fresh Evening" ? "fresh000001" : recent[titles.indexOf(song.title)].id,
        `Other Artist - ${song.title} [Deep House]`, { catalog: song });
    };
    providers.search = async () => [];
    assert.equal((await providers.radio(seed, []))?.id, "fresh000001");
    assert.deepEqual(matched, ["Fresh Evening"], "Known history is filtered before spending the match budget");
  } finally { store.close(); }
});

test("radio v2: a successful empty catalog lookup can recover after its short negative TTL", async () => {
  const store = new Store(":memory:"), originalNow = Date.now;
  let time = originalNow(), calls = 0;
  Date.now = () => time;
  try {
    const recommendations = new Recommendations(store, "synthetic", async () => {
      calls++;
      return Response.json({ similartracks: { track: calls === 1 ? [] : [
        { name: "Evening", artist: { name: "Aster" }, match: "0.9" },
      ] } });
    });
    assert.deepEqual(await recommendations.similar(seed), []);
    time += 59_000;
    assert.deepEqual(await recommendations.similar(seed), []);
    assert.equal(calls, 1, "Short retries share the negative cache");
    time += 2_000;
    assert.equal((await recommendations.similar(seed)).length, 1);
    assert.equal(calls, 2);
  } finally { Date.now = originalNow; store.close(); }
});

test("radio v2: an eligible different artist wins across the complete catalog pool", async () => {
  const store = new Store(":memory:");
  try {
    const providers = new Providers(store, { LASTFM_API_KEY: "synthetic" });
    const original = structuredClone(seed);
    providers.recommendations.similar = async () => [
      { title: "Familiar Evening", artist: "Aster", duration: 210 },
      { title: "Fresh Evening", artist: "Other Artist", duration: 210 },
    ];
    providers.matchSong = async song => track(song.artist === "Aster" ? "familiar001" : "fresh000001",
      `${song.artist} - ${song.title} [Deep House]`, { catalog: song });
    providers.search = async () => [];
    store.favorite("synthetic-listener", "Aster - Familiar Evening", "synthetic-favorite");
    const selected = await providers.radio(seed, []);
    assert.equal(selected?.id, "fresh000001", "An early same-artist favorite must not short-circuit genre-safe diversity");
    assert.equal(selected.radioRelatedTo, seed.id);
    assert.deepEqual(seed, original, "Selection must retain the caller's original manual seed");
  } finally { store.close(); }
});

test("radio v2: adapter capabilities distinguish private Discord audio from concerts and browser video", async () => {
  const store = new Store(":memory:");
  try {
    const providers = new Providers(store, {});
    const audioOnly = { ...own, embeddable: false };
    providers.search = async () => [audioOnly];
    assert.equal((await providers.radio(seed, []))?.id, audioOnly.id,
      "Ordinary Discord audio retains its existing non-embed capability");
    assert.equal(await providers.radio({ ...seed, concert: true }, []), null);
    assert.equal(await roomRecommendation({ current: seed, queue: [] }, async () => [audioOnly], () => {}), null);
    providers.search = async () => [own];
    assert.equal((await providers.radio({ ...seed, concert: true }, []))?.id, own.id);
    assert.equal((await roomRecommendation({ current: seed, queue: [] }, async () => [own], () => {}))?.id, own.id);
  } finally { store.close(); }
});

test("radio v2: room adapter retains the manual anchor, exclusions, playback state and private diagnostics", async () => {
  const automatic = track("auto0000001", "Other Artist - Automatic Song [Deep House]", { radio: true });
  const played = track("played00001", "Other Artist - Played Song [Deep House]");
  const alternate = track("repeat00001", "Other Artist - Played Song (2024 Remaster) [Deep House]");
  const excluded = track("excluded001", "Other Artist - Removed Song [Deep House]");
  const good = track("fresh000001", "Third Artist - Fresh Song [Deep House]");
  const incompatible = track("wrong000001", "Other Artist - Wrong Song [Tech House]");
  const state = { current: automatic, radioSeed: seed, queue: [], radio: true, history: [played],
    radioExcluded: [excluded.id], position: 73, playing: true, playbackKey: "synthetic-current-playback" };
  const original = structuredClone(state), queries: string[] = [], diagnostics: unknown[] = [];
  const selected = await roomRecommendation(state, async query => {
    queries.push(query);
    return [alternate, excluded, incompatible, good];
  }, diagnostic => diagnostics.push(diagnostic));
  assert.equal(selected?.id, good.id);
  assert.equal(selected.radioRelatedTo, seed.id);
  assert(queries[0].startsWith("deep house audio"), "Discovery must remain anchored to the original manual recording");
  assert.deepEqual(state, original, "Discovery must not alter playback, queues or stored anchor");
  assert.equal(diagnostics.length, 1);
  const serialized = JSON.stringify(diagnostics);
  for (const privateValue of [seed.id, seed.title, automatic.id, played.id, excluded.id, good.id, queries[0], state.playbackKey])
    assert(!serialized.includes(privateValue), "Diagnostics must contain only fixed outcomes and aggregate counts");
  const manual = { ...own, radio: false };
  assert.equal(await roomRecommendation({ ...state, queue: [manual] }, async () => {
    assert.fail("A pending manual selection must prevent radio discovery");
  }, () => {}), null);
});
