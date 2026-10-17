import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.ts";
import { Providers } from "../src/providers.ts";
import { Engine } from "../src/engine.ts";
import { publicTrack, type Track } from "../src/types.ts";
import type { Sink } from "../src/audio.ts";
import { isRadioMusic, metadataMusic, radioArtist, rankRadio, sameRadioSong, songIdentity } from "../src/radio.ts";
import { playableRoomQueue, roomRecommendation } from "../src/room-radio.ts";
import { changeRoom, publicPlayback } from "../src/room-state.ts";

const song = (id: string, title: string, extra: Partial<Track> = {}): Track => ({
  id, entryId: id, title, artist: "Aster - Topic", image: "", duration: 210,
  live: false, embeddable: true, source: "youtube", ...extra,
});
const seed = song("seed0000001", "Opening");
const next = song("next0000001", "Evening");
const sink = (advancing = false): Sink => ({
  onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {},
  duration: () => advancing ? 20 : 0,
  advancing: () => advancing, buffering: () => false,
});
function fixture(advancing = false) {
  const store = new Store(":memory:");
  const providers = new Providers(store, {});
  const engine = new Engine(store, providers, sink(advancing));
  clearInterval(engine.timer);
  return { store, providers, engine, close: () => { engine.close(); store.close(); } };
}

test("explicit non-music category is rejected without classifying missing metadata as non-music", () => {
  assert.equal(metadataMusic("10"), true);
  assert.equal(metadataMusic("22"), false);
  assert.equal(metadataMusic(undefined, ["Gaming"]), false);
  assert.equal(metadataMusic(undefined, ["Music"]), true);
  assert.equal(metadataMusic(undefined, []), undefined);
  assert.equal(metadataMusic(undefined), undefined);
  assert.equal(isRadioMusic({ ...next, music: false }), false);
  assert.equal(isRadioMusic(next), true, "older song metadata remains usable");
});

test("YouTube radio validates hydrated category and leaves manual playback available", async (t) => {
  const f = fixture();
  const bad = song("bad00000001", "A day in Paris");
  t.mock.method(f.providers, "youtube", async (path: string, params: Record<string, string>) => {
    if (path === "search") {
      assert.equal(params.videoCategoryId, "10");
      return { items: [bad, next].map((track) => ({ id: { videoId: track.id } })) };
    }
    return { items: [bad, next].map((track) => ({
      id: track.id,
      snippet: { title: track.title, channelTitle: track.artist, categoryId: track.id === bad.id ? "22" : "10" },
      contentDetails: { duration: "PT3M30S" }, status: { embeddable: true },
    })) };
  });
  try {
    assert.equal((await f.providers.radio(seed, []))?.id, next.id);
    const manual = await f.providers.resolve(`https://www.youtube.com/watch?v=${bad.id}`);
    assert.equal(manual[0]?.id, bad.id);
    assert.equal(manual[0]?.music, false);
  } finally { f.close(); }
});

test("yt-dlp fallback retains music categories and structured recording metadata", async () => {
  const f = fixture();
  const badId = "bad00000001";
  f.providers.youtube = async () => { throw Error("synthetic quota failure"); };
  f.providers.extract = async (args) => {
    if (args.some((arg) => arg.startsWith("ytsearch"))) return { entries: [{ id: badId }, { id: next.id }] };
    const id = new URL(args.at(-1)!).searchParams.get("v");
    return id === badId ? {
      title: "Aster - A day in Paris", uploader: "Aster - Topic", duration: 210,
      categories: ["People & Blogs"], playable_in_embed: true,
    } : {
      title: "Licensed release", uploader: "Publisher", artist: "Aster", track: "Evening",
      duration: 210, categories: ["Music"], playable_in_embed: true,
    };
  };
  try {
    const selected = await f.providers.radio(seed, []);
    assert.equal(selected?.id, next.id);
    assert.equal(selected?.music, true);
    assert.equal(radioArtist(selected!), "Aster");
    assert.equal(songIdentity(selected!), "evening");
  } finally { f.close(); }
});

test("shared Official and Topic publishers cannot manufacture an artist relationship", () => {
  for (const publisher of ["Shared Label Official", "Various Artists - Topic", "Shared Label - Topic", "SharedLabelVEVO", "New Upload Channel"]) {
    const original = song(seed.id, "Aster - Opening", { artist: publisher });
    const unrelated = song(next.id, "Another Artist - Evening", { artist: publisher });
    assert.equal(radioArtist(original), "Aster");
    assert.deepEqual(rankRadio(original, [unrelated], [], []), []);
  }
  const unknown = song(seed.id, "Unidentified song", { artist: "New Upload Channel" });
  assert.equal(radioArtist(unknown), "");
  assert.deepEqual(rankRadio(unknown, [{ ...next, artist: unknown.artist }], [], []), []);
  const remastered = song(seed.id, "Opening - 2024 Remaster");
  assert.equal(radioArtist(remastered), "Aster");
  assert.deepEqual(rankRadio(remastered, [next], [], []).map((track) => track.id), [next.id]);
  assert.equal(radioArtist(song(seed.id, "Aster–Opening", { artist: "Shared Label - Topic" })), "Aster");
});

test("song names Music and How To Love remain playable while instructional and vlog videos fail", () => {
  const original = song(seed.id, "Madonna - Frozen", { artist: "Publisher" });
  const music = song(next.id, "Madonna - Music (Official Music Video)", { artist: "Publisher" });
  assert.equal(songIdentity(music), "music");
  assert.deepEqual(rankRadio(original, [music], [], []).map((track) => track.id), [music.id]);
  const good = song(next.id, "Aster - How To Love (Official Audio)", { artist: "Publisher" });
  const bad = ["How to make Opening", "Studio tour", "A day in Paris vlog", "Opening gameplay"]
    .map((title, i) => song(`bad${i}`, `Aster - ${title}`, { artist: "Publisher" }));
  assert.deepEqual(rankRadio(seed, [...bad, good], [], []).map((track) => track.id), [good.id]);
  assert.equal(isRadioMusic(song(next.id, "How To Love", { music: true })), true, "Topic naming has the same safety rules");
  assert.equal(isRadioMusic(song(next.id, "The Trailer Park Troubadours - New Song (Official Audio)", { artist: "Publisher" })), true, "artist names are not video classifications");
});

test("remasters, alternate edits and named remixes cannot reintroduce the same radio song", () => {
  const original = song(seed.id, "Original");
  const variants = [
    "Original Remastered 2024", "Original - 2024 Remaster", "Original Radio Edit",
    "Original Instrumental", "Original Acoustic", "Original DJ Example Remix",
    "Original Tiesto Remix", "Original (Official Audio)", "Original - Extended Mix",
  ].map((title, index) => song(`variant${index}`, title));
  for (const variant of variants) assert(sameRadioSong(original, variant), variant.title);
  assert.deepEqual(rankRadio(original, [...variants, next], [], []).map((track) => track.id), [next.id]);
  assert.deepEqual(rankRadio(seed, variants, [original], []), []);
});

test("deduplication keeps the best-ranked official upload instead of the first search result", () => {
  const lyric = song("lyric000001", "Aster - Evening (Lyrics)", { artist: "Upload channel" });
  const official = song(next.id, "Aster - Evening (Official Audio)", { artist: "Upload channel" });
  assert.deepEqual(rankRadio(seed, [lyric, official], [], []).map((track) => track.id), [official.id]);
});

test("paused and not-yet-consumed current radio tracks still exclude alternate uploads", async () => {
  const f = fixture();
  try {
    f.engine.connected = true;
    f.engine.paused = true;
    f.engine.radioSeed = seed;
    f.engine.current = { ...next, radio: true };
    f.providers.radio = async () => song("copy0000001", "Evening - 2024 Remaster");
    await f.engine.ensureRadio();
    assert.equal(f.store.history().length, 0);
    assert.equal(f.engine.queue.length, 0);
    assert.equal(f.engine.current.id, next.id);
    assert.equal(f.engine.paused, true);
  } finally { f.close(); }
});

test("consumed catalog identity stays private and survives provider recreation", async () => {
  const f = fixture(true);
  const played = song("played00001", "Side B", {
    catalog: { artist: "Aster", title: "Evening", duration: 210 }, radio: true,
  });
  try {
    f.engine.settings.radio = false;
    f.engine.connected = true;
    f.engine.current = played;
    f.engine.segments = [{ track: played, startFrame: 0, offset: 0 }];
    f.engine.tick();
    assert.equal(f.store.history().length, 1);
    assert(!JSON.stringify(f.store.history()).includes("catalog"));
    assert(!JSON.stringify(f.engine.snapshot()).includes("catalog"));
    const restored = new Providers(f.store, {});
    assert.equal(songIdentity(restored.radioHistory().find((track) => track.id === played.id)!), "evening");
    restored.search = async () => [next, song("fresh000001", "Morning")];
    assert.equal((await restored.radio(seed, []))?.id, "fresh000001");
  } finally { f.close(); }
});

test("early skips retain canonical song exclusions even before audible history exists", async () => {
  const f = fixture();
  const rejected = song("reject00001", "Side B", {
    catalog: { artist: "Aster", title: "Evening", duration: 210 }, radio: true,
  });
  try {
    f.engine.current = rejected;
    await f.engine.skip();
    assert.equal(f.store.history().length, 0);
    const restarted = new Providers(f.store, {});
    restarted.search = async () => [next, song("fresh000001", "Morning")];
    assert.equal((await restarted.radio(seed, []))?.id, "fresh000001");
    assert.equal(f.engine.enqueue([rejected]), 1, "manual replay remains available");
  } finally { f.close(); }
});

test("removing a prepared suggestion excludes reuploads and permits a fresh lookup", async () => {
  const f = fixture();
  try {
    f.engine.connected = true;
    f.engine.current = seed;
    f.providers.search = async () => [next];
    await f.engine.ensureRadio();
    assert.equal(f.engine.radioRetryAt, Infinity);
    f.engine.remove(0);
    assert.equal(f.engine.radioRetryAt, 0);
    f.providers.search = async () => [song("copy0000001", "Evening Remastered 2024"), song("fresh000001", "Morning")];
    await f.engine.ensureRadio();
    assert.equal(f.engine.queue[0]?.id, "fresh000001");
  } finally { f.close(); }
});

test("numbered skip keeps the requested manual target while discarding unsafe older radio entries", async () => {
  const f = fixture();
  try {
    f.engine.connected = true;
    f.engine.current = seed;
    const manualA = song("manual00001", "First explicit choice");
    const manualB = song("manual00002", "Second explicit choice");
    f.engine.queue = [song("unsafe00001", "Aster - Gameplay", { radio: true }), manualA, manualB];
    let selected: Track | null = null;
    f.engine.startTrack = async (track) => { selected = track; };
    await f.engine.skip(2);
    assert.equal((selected as Track | null)?.id, manualA.id);
    assert.deepEqual(f.engine.queue.map((track) => track.id), [manualB.id]);
  } finally { f.close(); }
});

test("restored radio queues reject unrelated and recently played entries before decoding", async () => {
  const f = fixture();
  try {
    f.engine.connected = true;
    f.engine.current = seed;
    f.store.record("heard", publicTrack(next)!);
    f.engine.queue = [
      song("copy0000001", "Evening Remastered 2024", { radio: true }),
      song("wrong000001", "Unrelated Artist - Random", { artist: "Publisher", radio: true }),
      song("manual00001", "Manual choice", { music: false }),
    ];
    const prepared: Track[] = [];
    f.engine.prepare = async (track) => { prepared.push(track); throw Error("synthetic decoder boundary"); };
    await assert.rejects(f.engine.preparedNext(seed, new AbortController().signal), /synthetic decoder boundary/);
    assert.deepEqual(prepared.map((track) => track.id), ["manual00001"]);
  } finally { f.close(); }
});

test("the exact checkpoint remains resumable despite recent history and malformed old recovery is tolerated", async () => {
  const f = fixture();
  let restored: Engine | undefined;
  try {
    const checkpoint = { ...next, radio: true };
    f.store.record("heard", publicTrack(checkpoint)!);
    f.store.set("radio-seed", seed);
    f.store.set("recovery", { track: checkpoint, position: 43.25, paused: true });
    restored = new Engine(f.store, f.providers, sink());
    clearInterval(restored.timer);
    restored.connected = true;
    const started: { id: string; offset: number }[] = [];
    restored.startTrack = async (track, offset = 0) => { started.push({ id: track.entryId, offset }); };
    await restored.startNext();
    assert.deepEqual(started, [{ id: checkpoint.entryId, offset: 43.25 }]);
    restored.close();
    restored = undefined;
    f.store.set("recovery", { paused: true });
    const legacy = new Engine(f.store, f.providers, sink());
    legacy.close();
  } finally { restored?.close(); f.close(); }
});

test("explicit queue looping still replays the current radio song", async () => {
  const f = fixture();
  try {
    f.engine.connected = true;
    f.engine.current = { ...next, radio: true };
    f.engine.radioSeed = seed;
    f.engine.loopQueue = true;
    f.store.record("heard", publicTrack(next)!);
    const started: Track[] = [];
    f.engine.startTrack = async (track) => { started.push(track); };
    await f.engine.naturalNext();
    assert.equal(started[0]?.id, next.id);
    assert.notEqual(started[0]?.entryId, next.entryId);
  } finally { f.close(); }
});

test("looping two previously automatic tracks preserves both explicit replay entries", async () => {
  const f = fixture();
  try {
    const second = song("second00001", "Morning", { radio: true });
    f.engine.connected = true;
    f.engine.current = { ...next, radio: true };
    f.engine.radioSeed = seed;
    f.engine.queue = [second];
    f.engine.loopQueue = true;
    f.store.record("heard:next", publicTrack(next)!);
    const started: string[] = [];
    f.engine.startTrack = async (track) => { started.push(track.id); f.engine.current = track; };
    await f.engine.naturalNext();
    f.store.record("heard:second", publicTrack(second)!);
    await f.engine.naturalNext();
    assert.deepEqual(started, [second.id, next.id]);
    assert.deepEqual(f.engine.queue.map((track) => track.id), [second.id]);
  } finally { f.close(); }
});

test("room queue validation includes paused current, history, exclusions and earlier suggestions", () => {
  const recent = song("heard000001", "Morning");
  const rejected = song("reject00001", "Night");
  const good = song("fresh000001", "Afternoon", { radio: true });
  const state = {
    current: next, radioSeed: seed, playing: false, position: 0,
    history: [recent], radioExcludedSongs: [rejected],
    queue: [
      song("copy0000001", "Evening - 2024 Remaster", { radio: true }),
      song("copy0000002", "Morning Instrumental", { radio: true }),
      song("copy0000003", "Night DJ Example Remix", { radio: true }),
      good, { ...good, id: "copy0000004", title: "Afternoon (Lyrics)" },
      song("manual00001", "Explicit non-music choice", { music: false }),
    ],
  };
  assert.deepEqual(playableRoomQueue(state).map((track) => track.id), [good.id, "manual00001"]);
});

test("a learned genre survives room prefetch and restart without publishing private seed proof", async () => {
  const selected = song(next.id, "Other Artist - Evening", { artist: "Publisher", genres: ["electro house"] });
  let lookups = 0;
  const recommendation = await roomRecommendation({ current: seed, queue: [] }, async () => {
    return ++lookups === 1 ? [{ ...seed, title: "Opening [Electro House]" }] : [selected];
  });
  assert.equal(recommendation?.id, selected.id);
  let state = changeRoom({ current: seed, queue: [], position: 0, playing: true }, { action: "radio-prefetch" }, true, 0, recommendation);
  state = JSON.parse(JSON.stringify(state));
  const visible = publicPlayback(state);
  assert.deepEqual(visible.queue.map((track) => track.id), [selected.id]);
  assert(!JSON.stringify(visible).includes("radioRelatedTo"));
  state = changeRoom(state, { action: "next" }, true, 210);
  assert.equal(state.current?.id, selected.id);
  assert.equal(state.radioSeed?.id, seed.id);
  assert(!JSON.stringify(publicPlayback(state)).includes("radioRelatedTo"));
});

test("removing a room suggestion suppresses its remaster and undo restores only that rejection", async () => {
  const removed = { ...next, radio: true };
  const otherRejected = song("reject00001", "Night");
  const before = { current: seed, queue: [removed], playing: true, position: 0, radioExcludedSongs: [otherRejected] };
  const state = changeRoom(before, { action: "remove", index: 0 }, true, 0);
  const result = await roomRecommendation(state, async () => [song("copy0000001", "Evening Remastered 2024"), song("fresh000001", "Morning")]);
  assert.equal(result?.id, "fresh000001");
  const restored = changeRoom(state, { action: "undo" }, true, 0);
  assert.deepEqual(publicPlayback(restored).queue.map((track) => track.id), [removed.id]);
  assert.deepEqual(restored.radioExcludedSongs?.map((track) => track.id), [otherRejected.id]);
});

test("radio history includes the last hundred tracks and skip suppression is scoped to its store", async () => {
  const first = fixture();
  const other = fixture();
  try {
    for (let i = 0; i < 100; i++) first.store.record(`play:${i}`, publicTrack(song(`id:${i}`, `Song ${i}`))!, i);
    assert.equal(first.providers.radioHistory().length, 100);
    first.engine.rejectRadio([{ ...next, radio: true }]);
    first.providers.search = other.providers.search = async () => [next];
    assert.equal(await first.providers.radio(seed, []), null);
    assert.equal((await other.providers.radio(seed, []))?.id, next.id);
  } finally { first.close(); other.close(); }
});
