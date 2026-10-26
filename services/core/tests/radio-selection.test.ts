import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.ts";
import { Providers } from "../src/providers.ts";
import { Recommendations } from "../src/recommendations.ts";
import { rankRadio, radioArtist, canPlayRadioTrack } from "../src/radio.ts";
import type { Track } from "../src/types.ts";

const track = (id: string, title: string, genres = ["electro house"]): Track => ({
  id, entryId: id, title, genres, artist: "NCS", duration: 210,
  image: "", live: false, embeddable: true, source: "youtube",
});
const seed = track("seed0000001", "Unidentified song");
const positive = track("next0000001", "Related Artist - Next song");

test("specific genre fallback reaches an eligible result without inventing an artist", async () => {
  const store = new Store(":memory:");
  const p = new Providers(store, {});
  const queries: string[] = [];
  p.search = async (query) => { queries.push(query); return [positive]; };
  try {
    assert.equal(radioArtist(seed), "");
    assert.deepEqual(rankRadio(seed, [positive], [], []), [positive]);
    assert.equal(canPlayRadioTrack(seed, positive), true);
    assert.equal((await p.radio(seed, []))?.id, positive.id);
    assert.deepEqual(queries, ['electro house audio -"Unidentified song"', 'Related Artist "Next song" official music video']);
  } finally { store.close(); }
});

test("unknown artist with broad or absent genre still does not search", async () => {
  const store = new Store(":memory:");
  const p = new Providers(store, {});
  p.search = async () => { assert.fail("No relationship evidence"); };
  try {
    for (const genres of [[], ["pop"], ["house"]]) {
      assert.equal(await p.radio({ ...seed, genres }, []), null);
    }
  } finally { store.close(); }
});

test("genre fallback preserves style, title, duration, embedding and skip exclusions", async () => {
  const store = new Store(":memory:");
  const p = new Providers(store, {});
  const concert = { ...seed, concert: true };
  const rejected = [
    track("wrong000001", "Other Artist - Wrong style", ["synth pop"]),
    track("lesson00001", "Other Artist - Production lesson"),
    { ...positive, id: "short000001", duration: 20 },
    { ...positive, id: "embed000001", embeddable: false },
    { ...positive, id: "skip0000001" },
  ];
  store.set("radio-skips", { skip0000001: Date.now() });
  try {
    for (const candidate of rejected) {
      p.search = async () => [candidate];
      assert.equal(await p.radio(concert, []), null, candidate.id);
    }
    p.search = async () => [positive];
    assert.equal(await p.radio(concert, [positive.id]), null);
    assert.equal((await p.radio(concert, []))?.id, positive.id);
  } finally { store.close(); }
});

test("HTTP 200 can yield no catalog songs; an eligible fallback still succeeds", async () => {
  const store = new Store(":memory:");
  const p = new Providers(store, {});
  const named = { ...seed, title: "Seed Artist - Seed song" };
  let requests = 0;
  p.recommendations = new Recommendations(store, "synthetic", async () => {
    requests++;
    return Response.json({ similartracks: { track: [
      { name: "Weak song", artist: { name: "Other Artist" }, match: "0.01" },
      { name: "Tutorial", artist: { name: "Other Artist" }, match: "0.9" },
    ] } });
  });
  p.recommendations.topTracks = async () => [];
  try {
    assert.deepEqual(await p.recommendations.similar(named), []);
    p.search = async () => [];
    assert.equal(await p.radio(named, []), null);
    p.search = async () => [positive];
    assert.equal((await p.radio(named, []))?.id, positive.id);
    assert.equal(requests, 1, "empty catalog response is cached for 24 hours");
  } finally { store.close(); }
});

test("catalog matches can all fail style checks before a positive fallback", async () => {
  const store = new Store(":memory:");
  const p = new Providers(store, { LASTFM_API_KEY: "synthetic" });
  p.recommendations.topTracks = async () => [];
  const named = { ...seed, title: "Seed Artist - Seed song" };
  const matched: string[] = [];
  p.recommendations.similar = async () => [1, 2, 3].map((n) => ({
    artist: "Other Artist", title: `Song ${n}`, duration: 210,
  }));
  // Keep the real catalog matcher; only the external search boundary is stubbed.
  p.search = async (query) => {
    if (query.endsWith("official audio")) {
      matched.push(query);
      return [track("wrong000001", query, ["synth pop"])];
    }
    return [positive];
  };
  try {
    assert.equal((await p.radio(named, []))?.id, positive.id);
    assert.equal(matched.length, 3);
    assert.equal(p.recommendationStatus, "artist");
  } finally { store.close(); }
});

test("an in-flight lookup can exceed 45 seconds and is shared with naturalNext", async (t) => {
  const { Engine } = await import("../src/engine.ts");
  const store = new Store(":memory:");
  const p = new Providers(store, {});
  const engine = new Engine(store, p, {
    onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {},
    duration: () => 0, advancing: () => false, buffering: () => false,
  });
  clearInterval(engine.timer);
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  let release!: (value: Track) => void;
  let calls = 0;
  p.radio = async () => {
    calls++;
    return new Promise<Track>((resolve) => { release = resolve; });
  };
  const started: string[] = [];
  engine.startTrack = async (value) => { started.push(value.id); };
  try {
    engine.connected = true;
    engine.current = seed;
    const pending = engine.ensureRadio();
    now += 45_000;
    assert.equal(engine.ensureRadio(), pending);
    assert.equal(engine.queue.length, 0);
    const transition = engine.naturalNext();
    release(positive);
    await transition;
    assert.equal(calls, 1);
    assert.deepEqual(started, [positive.id]);
    assert.equal(engine.queue.length, 0);
  } finally { engine.close(); store.close(); }
});

test("empty selections retry after 15 seconds and stop after three attempts", async (t) => {
  const { Engine } = await import("../src/engine.ts");
  const store = new Store(":memory:");
  const p = new Providers(store, {});
  const engine = new Engine(store, p, {
    onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {},
    duration: () => 0, advancing: () => false, buffering: () => false,
  });
  clearInterval(engine.timer);
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  let calls = 0;
  p.radio = async () => { calls++; return null; };
  try {
    engine.connected = true;
    engine.current = seed;
    await engine.ensureRadio();
    now += 14_999;
    await engine.ensureRadio();
    assert.equal(calls, 1);
    now++;
    await engine.ensureRadio();
    now += 15_000;
    await engine.ensureRadio();
    now += 15_000;
    await engine.ensureRadio();
    assert.equal(calls, 3);
    assert.equal(engine.queue.length, 0);
    assert(engine.radioError.length > 0);
  } finally { engine.close(); store.close(); }
});

test("Discord discovers during source startup before audible frames and preserves a later pause", async () => {
  const { Engine } = await import("../src/engine.ts");
  const store = new Store(":memory:"), providers = new Providers(store, {});
  let resumes = 0, calls = 0;
  const engine = new Engine(store, providers, {
    onIdle: null, onError: null, play() {}, pause() {}, resume() { resumes++; }, stop() {},
    duration: () => 0, advancing: () => false, buffering: () => true,
  });
  clearInterval(engine.timer);
  let release!: (track: Track) => void;
  providers.radio = async () => { calls++; return new Promise(resolve => { release = resolve; }); };
  try {
    engine.connected = true;
    engine.current = seed;
    engine.loading = true;
    engine.paused = true;
    engine.tick();
    assert.equal(calls, 0, "automatic discovery respects explicit pause");
    engine.paused = false;
    engine.tick();
    assert.equal(calls, 1, "discovery starts before the sink advances");
    const pending = engine.ensureRadio();
    engine.tick();
    assert.equal(calls, 1, "buffering ticks share the same lookup");
    engine.pause();
    release(positive);
    await pending;
    assert.deepEqual(engine.queue.map(track => track.id), [positive.id]);
    assert.equal(engine.current.id, seed.id);
    assert.equal(engine.paused, true);
    assert.equal(resumes, 0);
  } finally { engine.close(); store.close(); }
});

test("successful YouTube search can lose unavailable IDs at metadata hydration", async (t) => {
  const store = new Store(":memory:");
  const p = new Providers(store, {});
  const stages: string[] = [];
  t.mock.method(p, "youtube", async (path: string) => {
    stages.push(path);
    if (path === "search") return { items: [
      { id: { videoId: "missing0001" } }, { id: { videoId: positive.id } },
    ] };
    return { items: [{
      id: positive.id,
      snippet: { title: positive.title, channelTitle: "NCS", tags: ["electro house"], liveBroadcastContent: "none" },
      contentDetails: { duration: "PT3M30S" }, status: { embeddable: true },
    }] };
  });
  p.extract = async () => { assert.fail("Successful metadata response does not invoke extraction"); };
  try {
    const candidates = await p.search("synthetic metadata fixture", 20, true);
    assert.deepEqual(stages, ["search", "videos"]);
    assert.deepEqual(candidates.map((value) => value.id), [positive.id]);
    assert.deepEqual(candidates[0].genres, ["electro house"]);
    assert.equal(rankRadio(seed, candidates, [], [])[0]?.id, positive.id);
  } finally { store.close(); }
});
