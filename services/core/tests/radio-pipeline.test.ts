import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { selectRadio, RADIO_LIMITS, type RadioInput } from "../src/radio-pipeline.ts";
import { Engine } from "../src/engine.ts";
import { Providers } from "../src/providers.ts";
import { Store } from "../src/store.ts";
import { Recommendations } from "../src/recommendations.ts";
import { publicTrack, type Track } from "../src/types.ts";
import type { CatalogSong } from "../src/matching.ts";

beforeEach(() => mock.method(globalThis, "fetch", async () => { assert.fail("Synthetic radio tests cannot use a live provider"); }));
afterEach(() => mock.restoreAll());
const track = (id: string, title: string, extra: Partial<Track> = {}): Track => ({
  id, entryId: id, title, artist: "Synthetic Publisher", duration: 210, image: "", live: false,
  embeddable: true, source: "youtube", music: true, genres: ["deep house"], ...extra,
});
const seed = track("seed0000001", "Aster - Opening");
const matching = (song: CatalogSong) => track("match000001", `${song.artist} - ${song.title}`, { catalog: song });
const input = (extra: Partial<RadioInput> = {}): RadioInput => ({
  seed, recent: [], excluded: [], requireEmbeddable: true, search: async () => [], ...extra,
});

test("radio pipeline caps hydration and retains its reserved artist-catalog recovery slot", async () => {
  const titles = ["First", "Second", "Third", "Recovery"];
  const attempted: string[] = [];
  const result = await selectRadio(input({
    similar: async () => titles.map(title => ({ title, artist: "Aster", duration: 210 })),
    topTracks: async () => [{ title: titles[3], artist: "Aster", duration: 210 }],
    match: async song => {
      attempted.push(song.title);
      if (song.title !== titles[3]) throw new Error("synthetic hydration failure");
      return matching(song);
    },
  }));
  assert.deepEqual(attempted, titles, "an unattempted fourth descriptor must remain available to the fallback");
  assert.equal(result.source, "artist-catalog");
  assert.equal(result.track?.title, "Aster - Recovery");
  assert.equal(result.diagnostic.catalogMatches, RADIO_LIMITS.catalogMatches);
  assert.equal(result.diagnostic.failedCatalogMatches, 3);
  assert.equal(result.diagnostic.searches, RADIO_LIMITS.discoverySearches);
});

test("untrusted search proof cannot inherit a vetted catalog candidate's relationship", async () => {
  const broad = { ...seed, genres: ["house"] };
  const descriptor = { title: "Vetted Song", artist: "Vetted Artist", duration: 210 };
  const spoof = track("spoof000001", "Unrelated Artist - Unrelated", { genres: ["house"], radioRelatedTo: broad.id });
  const result = await selectRadio(input({ seed: broad,
    similar: async () => [descriptor], match: async song => ({ ...matching(song), genres: ["house"] }),
    search: async () => [spoof],
  }));
  assert.equal(result.track?.title, "Vetted Artist - Vetted Song");
  assert.equal(result.source, "catalog");
  assert.equal(result.track?.radioRelatedTo, seed.id);
  assert.equal(result.diagnostic.rejected.relationship, 2);
  const withoutCatalog = await selectRadio(input({ seed: broad, search: async () => [spoof] }));
  assert.equal(withoutCatalog.track, null);
});

test("catalog metadata cannot authorize a mismatched raw recording", async () => {
  const result = await selectRadio(input({
    similar: async () => [{ title: "Wanted", artist: "Vetted Artist", duration: 210 }],
    match: async song => track("wrong000001", "Unrelated Artist - Different Song", { catalog: song }),
  }));
  assert.equal(result.track, null);
  assert.equal(result.diagnostic.rejected["catalog-match"], 1);
  assert.equal(result.diagnostic.outcome, "filtered");
});

test("all media hydration and discovery failures report provider-error without private diagnostic data", async () => {
  const privateError = new Error("private title/room/query/token must not be logged");
  const result = await selectRadio(input({
    similar: async () => [{ title: "Wanted", artist: "Vetted Artist", duration: 210 }],
    match: async () => { throw privateError; }, search: async () => { throw privateError; },
  }));
  assert.equal(result.diagnostic.outcome, "provider-error");
  assert.equal(result.diagnostic.failedCatalogMatches, 1);
  assert.equal(result.diagnostic.failedSearches, 2);
  assert.equal(result.diagnostic.stages.catalog, "failed");
  assert.equal(result.error, privateError);
  assert(!JSON.stringify(result.diagnostic).includes("private"));
  assert(!JSON.stringify(result.diagnostic).includes(seed.id));
});

test("artist diagnostics retain earlier admission when the second same-source query is empty", async () => {
  const broad = { ...seed, genres: ["house"] };
  const result = await selectRadio(input({ seed: broad,
    search: async query => query.includes('audio -"') ? [track("next0000001", "Aster - Evening")] : [],
  }));
  assert.equal(result.source, "artist");
  assert.equal(result.diagnostic.stages.artist, "selected");
  assert.equal(result.diagnostic.searches, 2);
});

test("metadata and discovery pools inspect only their bounded prefixes", async () => {
  const broad = { ...seed, genres: ["house"] };
  const eligible = Array.from({ length: 100 }, (_, index) => track(`id${String(index).padStart(9, "0")}`, `Aster - Song ${index}`));
  const metadata = [...eligible.slice(0, 12), { ...seed, title: "Aster - Opening [Deep House]" }];
  const result = await selectRadio(input({ seed: broad,
    search: async query => query.includes('"Opening"') && !query.includes('-"') ? metadata : eligible,
  }));
  assert.equal(result.diagnostic.metadata, "unchanged", "the thirteenth metadata candidate is outside the budget");
  assert.equal(result.diagnostic.candidates, RADIO_LIMITS.searchResults * RADIO_LIMITS.discoverySearches);
  assert.equal(result.diagnostic.searches, 2);
  assert(result.diagnostic.candidates <= RADIO_LIMITS.candidates);
});

test("Last.fm top tracks use the requested artist only for absent metadata and reject contradictory artists", async () => {
  const store = new Store(":memory:");
  const requests: URL[] = [];
  try {
    const recommendations = new Recommendations(store, "synthetic", async url => {
      requests.push(new URL(String(url)));
      return Response.json({ toptracks: { track: [
        { name: "Evening" }, { name: "Night", artist: { name: "Aster" } },
        { name: "Wrong", artist: { name: "Other Artist" } }, { name: "Production tutorial" },
      ] } });
    });
    assert.deepEqual((await recommendations.topTracks(seed)).map(song => song.title), ["Evening", "Night"]);
    assert.equal(requests[0].searchParams.get("method"), "artist.getTopTracks");
    assert.equal(requests[0].searchParams.get("artist"), "Aster");
    await recommendations.topTracks(seed);
    assert.equal(requests.length, 1);
  } finally { store.close(); }
});

test("malformed Last.fm envelopes are provider failures and are not negative cached", async () => {
  const store = new Store(":memory:");
  let calls = 0;
  try {
    const recommendations = new Recommendations(store, "synthetic", async () => {
      calls++;
      return Response.json(calls === 1 ? {} : { similartracks: { track: [] } });
    });
    await assert.rejects(recommendations.similar(seed), /invalid response/);
    assert.deepEqual(await recommendations.similar(seed), []);
    assert.deepEqual(await recommendations.similar(seed), []);
    assert.equal(calls, 2, "only the actual empty array is cached");
  } finally { store.close(); }
});

test("Core selects past an unconsumed current recording before committing a radio winner", async () => {
  const store = new Store(":memory:"), providers = new Providers(store, {});
  const engine = new Engine(store, providers, {
    onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {},
    duration: () => 0, advancing: () => false, buffering: () => false,
  });
  clearInterval(engine.timer);
  try {
    const current = track("current0001", "Current Artist - Evening", { radio: true });
    const copy = track("copy0000001", "Current Artist - Evening (Official Audio)");
    const fresh = track("fresh000001", "Fresh Artist - Morning");
    engine.connected = true;
    engine.paused = true;
    engine.current = current;
    engine.radioSeed = seed;
    providers.search = async () => [copy, fresh];
    await engine.ensureRadio();
    assert.equal(store.history().length, 0);
    assert.deepEqual(engine.queue.map(song => song.id), [fresh.id]);
    assert.equal(engine.current.id, current.id);
    assert.equal(engine.paused, true);
  } finally { engine.close(); store.close(); }
});

for (const replay of [false, true])
test(`Core does not append an already recorded current entry to the diversity window (earlier replay: ${replay})`, async () => {
  const store = new Store(":memory:"), providers = new Providers(store, {});
  const current = track("current0001", "Artist E - Current", { radio: true });
  const artistA = track("historya001", "Artist A - Earlier");
  const history = [artistA, track("historyb001", "Artist B - Earlier"),
    replay ? artistA : track("historyc001", "Artist C - Earlier"), track("historyd001", "Artist D - Earlier")];
  const firstA = track("candidatea1", "Artist A - New Song");
  const firstB = track("candidateb1", "Artist B - New Song");
  const engine = new Engine(store, providers, {
    onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {},
    duration: () => 20, advancing: () => true, buffering: () => false,
  });
  clearInterval(engine.timer);
  try {
    history.forEach((song, index) => store.record(`historical-play:${index}`, publicTrack(song)!, index + 1));
    engine.connected = true;
    engine.current = current;
    engine.radioSeed = seed;
    engine.segments = [{ track: current, startFrame: 0, offset: 0 }];
    providers.search = async () => replay ? [firstA, firstB] : [firstB, firstA];
    engine.tick();
    await engine.radioTask;
    assert.equal(engine.lastEntry, current.entryId, "tick records the exact consumed entry before selection");
    assert.equal(store.history().length, 5);
    assert.deepEqual(engine.queue.map(song => song.id), [firstB.id]);
    assert.equal(providers.radioHistory().filter(song => song.id === artistA.id).length, replay ? 2 : 1,
      "genuine earlier plays of the same video remain in history");
  } finally { engine.close(); store.close(); }
});
