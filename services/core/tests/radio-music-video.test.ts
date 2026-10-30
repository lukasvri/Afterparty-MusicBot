import { fixtureRadioContent, fixtureRadioOwner } from './radio-content-fixture.ts';
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { selectRadio, RADIO_LIMITS, type RadioInput } from "../src/radio-pipeline.ts";
import { Providers } from "../src/providers.ts";
import { Store } from "../src/store.ts";
import { roomRecommendation } from "../src/room-radio.ts";
import type { Track } from "../src/types.ts";

beforeEach(() => mock.method(globalThis, "fetch", async () => { assert.fail("No live providers in radio format tests"); }));
afterEach(() => mock.restoreAll());
const track = (id: string, title: string, extra: Partial<Track> = {}): Track => ({
  id, entryId: id, title, artist: "Synthetic Publisher", duration: 210, image: "", live: false,
  embeddable: true, source: "youtube", music: true, genres: ["deep house"], ...extra,
});
const seed = track("seed0000001", "Aster - Opening");
const audio = track("audio000001", "Cedar - Evening (Official Audio)");
const video = track("video000001", "Cedar - Evening (Official Music Video)", { duration: 215 });
const input = (extra: Partial<RadioInput> = {}): RadioInput => ({ seed, recent: [], excluded: [],
  requireEmbeddable: true, search: async () => [audio, video], ...extra });

test("matching video replaces selected audio without another search or changing song priorities", async () => {
  const unrelated = track("other000001", "Birch - Different (Official Music Video)");
  const result = await selectRadio({ ...(input({ search: async () => [audio, unrelated, video] })), verifyContent: fixtureRadioContent });
  assert.equal(result.track?.id, video.id);
  assert.equal(result.diagnostic.videoSearches, 0);
  assert.equal(result.diagnostic.musicVideo, "selected");
  assert.equal(result.track?.radioRelatedTo, seed.id);
});

test("catalog audio resolution gets one bounded raw-identity video lookup", async () => {
  const song = { artist: "Cedar", title: "Evening", duration: 210 };
  const queries: string[] = [];
  const result = await selectRadio({ ...(input({ seed: { ...seed, genres: ["house"] },
    similar: async () => [song], match: async () => ({ ...audio, genres: ["house"], catalog: song }),
    search: async query => { queries.push(query); return query.endsWith("official music video") ? [{ ...video, genres: ["house"] }] : []; },
  })), verifyContent: fixtureRadioContent });
  assert.equal(result.track?.id, video.id);
  assert.equal(result.source, "catalog");
  assert.equal(result.diagnostic.videoSearches, 1);
  assert.equal(queries.filter(query => query.endsWith("official music video")).length, 1);
});

for (const mode of ["empty", "error", "past-budget"] as const) test(`playable audio survives ${mode} video lookup`, async () => {
  const result = await selectRadio({ ...(input({ search: async query => {
    if (!query.endsWith("official music video")) return [audio];
    if (mode === "error") throw new Error("synthetic provider failure");
    return mode === "empty" ? [] : [...Array.from({ length: RADIO_LIMITS.videoResults }, () => audio), video];
  } })), verifyContent: fixtureRadioContent });
  assert.equal(result.track?.id, audio.id);
  assert.equal(result.error, undefined);
  assert.equal(result.diagnostic.videoSearches, 1);
  assert(result.diagnostic.videoCandidates <= RADIO_LIMITS.videoResults);
});

const invalid: Record<string, Track> = {
  "wrong artist": { ...video, title: "Impostor - Evening (Official Music Video)" },
  "wrong song": { ...video, title: "Cedar - Different (Official Music Video)" },
  "live stream": { ...video, live: true },
  "live recording": { ...video, title: "Cedar - Evening (Live) (Official Music Video)" },
  remake: { ...video, title: "Cedar - Evening Remake (Official Music Video)" },
  remix: { ...video, title: "Cedar - Evening Remix (Official Music Video)" },
  "conflicting genre": { ...video, genres: ["heavy metal"] },
  "long introduction": { ...video, duration: 270 },
  "unplayable duration": { ...video, duration: 0 },
  "non-music": { ...video, music: false },
  "not embeddable": { ...video, embeddable: false },
  "spoofed catalog": { ...video, title: "Impostor - Different (Official Music Video)", catalog: { title: "Evening", artist: "Cedar", duration: 210 } },
  "lyrics": { ...video, title: "Cedar - Evening (Official Video) (Lyrics Video)" },
};
for (const [name, candidate] of Object.entries(invalid)) test(`video hint cannot override ${name}`, async () => {
  const result = await selectRadio({ ...(input({ search: async query => query.endsWith("official music video") ? [candidate] : [audio] })), verifyContent: fixtureRadioContent });
  assert.equal(result.track?.id, audio.id);
});

test("video upload exclusions and recent recordings remain authoritative", async () => {
  const excluded = await selectRadio({ ...(input({ excluded: [video.id] })), verifyContent: fixtureRadioContent });
  assert.equal(excluded.track?.id, audio.id);
  const recent = await selectRadio({ ...(input({ recent: [video] })), verifyContent: fixtureRadioContent });
  assert.equal(recent.track, null);
  assert.equal(recent.diagnostic.videoSearches, 0);
});

test("Core stores isolate video exclusions and rooms preserve manual queue priority", async () => {
  const first = new Store(":memory:"), second = new Store(":memory:");
  try {
    const a = fixtureRadioOwner(new Providers(first, {})), b = fixtureRadioOwner(new Providers(second, {}));
    a.search = b.search = async () => [audio, video];
    first.set("radio-skips", { [video.id]: Date.now() });
    assert.equal((await a.radio(seed, []))?.id, audio.id);
    assert.equal((await b.radio(seed, []))?.id, video.id);
    assert.equal(await roomRecommendation({ current: seed, queue: [{ ...audio, radio: false }], radio: true },
      async () => { assert.fail("manual queue must not trigger discovery or format lookup"); }, () => {}, fixtureRadioContent), null);
    assert.equal((await roomRecommendation({ current: seed, queue: [], radio: true }, async () => [audio, video], () => {}, fixtureRadioContent))?.id, video.id);
  } finally { first.close(); second.close(); }
});

test("an unrelated official video cannot change the selected song", async () => {
  const other = track("other000001", "Birch - Different (Official Music Video)");
  const result = await selectRadio({ ...(input({ search: async () => [audio, other] })), verifyContent: fixtureRadioContent });
  assert.equal(result.track?.id, audio.id);
});

test("SoundCloud audio retains its provider without a video search", async () => {
  const soundcloud = { ...audio, source: "soundcloud" as const, embeddable: false };
  const queries: string[] = [];
  const result = await selectRadio({ ...(input({ requireEmbeddable: false, search: async query => { queries.push(query); return [soundcloud]; } })), verifyContent: fixtureRadioContent });
  assert.equal(result.track?.id, audio.id);
  assert.equal(result.diagnostic.videoSearches, 0);
  assert.equal(queries.length, 2);
});

test("a selected video needs no format lookup", async () => {
  const result = await selectRadio({ ...(input({ search: async () => [video, audio] })), verifyContent: fixtureRadioContent });
  assert.equal(result.track?.id, video.id);
  assert.equal(result.diagnostic.videoSearches, 0);
});

test("format lookup strips an unbracketed audio label", async () => {
  const queries: string[] = [];
  const result = await selectRadio({ ...(input({ search: async query => {
    queries.push(query);
    return query === 'Cedar "Evening" official music video' ? [video] : [{ ...audio, title: "Cedar - Evening Official Audio" }];
  } })), verifyContent: fixtureRadioContent });
  assert.equal(result.track?.id, video.id);
  assert.equal(queries.at(-1), 'Cedar "Evening" official music video');
});

for (const version of ["Radio Edit", "Remix", "Acoustic", "Remastered"]) test(`matching ${version} video preserves recording identity`, async () => {
  const selected = { ...audio, title: `Cedar - Evening (${version}) (Official Audio)` };
  const alternative = { ...video, title: `Cedar - Evening (${version}) (Official Music Video)` };
  const result = await selectRadio({ ...(input({ search: async query => query.endsWith("official music video") ? [alternative] : [selected] })), verifyContent: fixtureRadioContent });
  assert.equal(result.track?.id, video.id);
});

test("unknown artist identity cannot promote a same-title video from another uploader", async () => {
  const selected = { ...audio, title: "Evening (Official Audio)", artist: "Cedar" };
  const unknown = { ...video, title: "Evening (Official Music Video)", artist: "Birch" };
  const result = await selectRadio({ ...(input({ search: async () => [selected, unknown] })), verifyContent: fixtureRadioContent });
  assert.equal(result.track?.id, audio.id);
  assert.equal(result.diagnostic.videoSearches, 0);
});
