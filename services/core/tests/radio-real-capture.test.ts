import assert from "node:assert/strict";
import { test } from "node:test";
import capture from "./fixtures/radio-provider-regressions.json" with { type: "json" };
import { isRadioMusic, radioArtist, radioTitle, rankRadio, sameRadioRecording, sameRadioSong } from "../src/radio.ts";
import { selectRadio } from "../src/radio-pipeline.ts";
import type { Track } from "../src/types.ts";

// Exact public parsed metadata from the dated capture. Synthetic variations
// below isolate one policy condition and are never described as live results.
const metallicaSeed = capture.tracks.find(item => item.seed.id === "CD-E-LDc384")!.seed;
const dua = capture.tracks.find(item => item.seed.id === "N000qglmmY0")!;
const oasis = capture.tracks.find(item => item.seed.id === "TDe1DqxwJoc")!;
type CapturedTrack = Pick<Track, "id" | "title" | "artist" | "duration" | "genres" | "music" | "live" | "embeddable">;
const track = (value: CapturedTrack): Track => ({ ...value, source: "youtube", image: "", entryId: value.id });

test("captured official Metallica colon prefix identifies the artist and song", () => {
  assert.equal(radioArtist(track(metallicaSeed)), "Metallica");
  assert.equal(radioTitle(track(metallicaSeed)), "Enter Sandman");
});

test("captured colon seed reaches bounded selection instead of insufficient metadata", async () => {
  let calls = 0;
  const candidate = { ...track(metallicaSeed), id: "synthetic01", title: "Metallica - Synthetic next song" };
  const result = await selectRadio({ seed: track(metallicaSeed), recent: [], excluded: [], requireEmbeddable: true,
    search: async () => { calls++; return [candidate]; } });
  assert.equal(result.track?.id, candidate.id);
  assert(calls > 0 && calls <= 4);
});

test("a colon inside a song and a generic publisher cannot invent an artist", () => {
  const base = track(metallicaSeed);
  assert.equal(radioArtist({ ...base, title: "Song: Part Two", artist: "Metallica - Topic" }), "Metallica");
  assert.equal(radioTitle({ ...base, title: "Song: Part Two", artist: "Metallica - Topic" }), "Song: Part Two");
  assert.equal(radioArtist({ ...base, title: "NCS: New song", artist: "NCS" }), "");
  assert.equal(radioArtist({ ...base, title: "Unknown: New song", artist: "Other channel" }), "");
});

test("captured Featuring credit does not turn the seed into a new radio song", () => {
  const seed = track(dua.seed);
  assert(dua.selected);
  const featured = track(dua.selected);
  assert.equal(sameRadioSong(seed, featured), true);
  assert.deepEqual(rankRadio(seed, [featured], [], []), []);
  assert.equal(sameRadioRecording(seed, featured), false, "A featured version cannot refine the solo recording");
});

test("a controlled equal duration cannot make a featured version the exact solo recording", () => {
  assert(dua.selected);
  const seed = track(dua.seed);
  assert.equal(sameRadioRecording(seed, { ...track(dua.selected), duration: seed.duration }), false);
});

test("dated live-performance suffixes stay unsafe while Live Forever remains a song", () => {
  for (const title of ["Metallica - Enter Sandman Live Moscow 1991", "Metallica - Enter Sandman live 2024"])
    assert.equal(isRadioMusic({ ...track(metallicaSeed), title }), false, title);
  assert.equal(isRadioMusic({ ...track(metallicaSeed), title: "Oasis - Live Forever", artist: "Oasis" }), true);
});

test("captured Oasis demo and promo annotation is not a new automatic song", () => {
  assert(oasis.selected);
  const seed = track(oasis.seed), demo = track(oasis.selected);
  assert.equal(isRadioMusic(demo), false, "A demo-labelled upload is not an automatic studio replacement");
  assert.equal(sameRadioSong(seed, demo), true, "Demo/promo labels must not invent another composition");
  assert.deepEqual(rankRadio(seed, [demo], [], []), []);
});

test("a demo suffix is an upload warning without banning the word in a song name", () => {
  const seed = track(oasis.seed);
  assert.equal(isRadioMusic({ ...seed, title: "Oasis - Synthetic Song - Demo Version" }), false);
  assert.equal(isRadioMusic({ ...seed, title: "Oasis - Synthetic Song (Demo)" }), false);
  assert.equal(isRadioMusic({ ...seed, title: "Oasis - Demo of Tomorrow" }), true);
});
