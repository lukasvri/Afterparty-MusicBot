import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, mock, test } from "node:test";
import {
  isRadioMusic, metadataGenres, radioArtist, radioGenre, radioRelated, radioStyleCompatible, radioTitle,
  rankRadio, sameRadioRecording, sameRadioSong, specificRadioGenre,
} from "../src/radio.ts";
import { selectRadio } from "../src/radio-pipeline.ts";
import type { Track } from "../src/types.ts";

// Artist/song/version names verified against these primary sources on 2026-10-18.
// IDs, uploader forms, category flags, genre spelling variants and (unless noted)
// durations are controlled policy inputs, not a captured provider response or an
// assertion about a specific upload. These tests never fetch metadata or media.
const sources = {
  oasis: "https://oasisinet.com/music/live-forever/",
  remaster: "https://shop.oasisinet.com/definitely-maybe?lang=en_US",
  live: "https://oasisinet.com/video-category/live/",
  springsteen: "https://brucespringsteen.net/albums/born-in-the-u-s-a/",
  queen: "https://store-au.queenonline.com/products/queen-a-kind-of-magic-cd",
  oasisHello: "https://oasisinet.com/lyrics/",
  adele: "https://www.adele.com/?language=en-us",
  tyler: "https://www.youtube.com/watch?v=t-E2gm0a_N0",
  madonna: "https://www.madonna.com/products/music",
  wayne: "https://www.youtube.com/watch?v=dgwHNccpYNc",
};
const recording = (id: string, artist: string, song: string, extra: Partial<Track> = {}): Track => ({
  id, entryId: id, title: `${artist} - ${song}`, artist: `${artist} - Topic`,
  duration: 210, image: "", source: "youtube", live: false, music: true,
  embeddable: true, ...extra,
});
const oasis = recording("real-policy-oasis", "Oasis", "Live Forever", { duration: 276 });
const oasisHello = recording("real-policy-oasis-hello", "Oasis", "Hello");
const adeleHello = recording("real-policy-adele-hello", "Adele", "Hello");
const tyler = recording("real-policy-tyler", "Tyler, The Creator", "EARFQUAKE");

beforeEach(() => {
  mock.method(globalThis, "fetch", async () => {
    assert.fail("Real-name policy regressions must not access live providers");
  });
});
afterEach(() => mock.restoreAll());

for (const [track, source] of [
  [oasis, sources.oasis],
  [recording("real-policy-cover", "Bruce Springsteen", "Cover Me"), sources.springsteen],
  [recording("real-policy-queen", "Queen", "Who Wants To Live Forever"), sources.queen],
] as const) {
  test(`real catalog policy: studio song ${track.title} is not a format warning`, () => {
    assert.equal(isRadioMusic(track), true, source);
    assert.equal(isRadioMusic({ ...track, title: radioTitle(track) }), true,
      "A specific Topic artist with a song-only title retains the same decision");
  });
}

test("real catalog policy: ordinary Music and How To Love titles remain admissible", () => {
  for (const track of [recording("real-policy-music", "Madonna", "Music"),
    recording("real-policy-wayne", "Lil Wayne", "How To Love")]) {
    assert.equal(isRadioMusic(track), true, `${sources.madonna}; ${sources.wayne}`);
  }
});

test("real catalog policy: legitimate studio names do not bypass unsafe upload labels", () => {
  for (const title of ["Live Forever (Live, Gleneagles, Scotland, 1994)",
    "Live Forever (Piano Cover)", "Live Forever - Guitar Tutorial",
    "Live Forever Reaction", "How To Play Live Forever", "Live Forever - Full Album"]) {
    assert.equal(isRadioMusic({ ...oasis, title: `Oasis - ${title}` }), false, title);
  }
  assert.equal(isRadioMusic({ ...oasis, live: true }), false, sources.live);
  assert.equal(isRadioMusic({ ...oasis, music: false }), false);
  assert.equal(isRadioMusic({ ...oasis, concert: true, live: true }), false);
});

test("real catalog policy: quality qualifiers cannot conceal a live or cover upload suffix", () => {
  // Controlled upload suffixes on verified song names, not claims that these
  // particular uploads exist. The same metadata-only safety rule must apply.
  for (const title of ["Oasis - Live Forever - HD LIVE WEMBLEY 1986",
    "Bruce Springsteen - Cover Me - 4K Piano Cover by X",
    "Bruce Springsteen - Cover Me | HQ Guitar Cover by X"]) {
    assert.equal(isRadioMusic({ ...oasis, title }), false, title);
  }
});

test("real catalog policy: remasters are admissible but excluded as an already heard song", () => {
  const remaster = { ...oasis, id: "real-policy-remaster", title: "Oasis - Live Forever (Remastered)" };
  assert.equal(isRadioMusic(remaster), true, sources.remaster);
  assert.equal(sameRadioSong(oasis, remaster), true);
  assert.deepEqual(rankRadio(oasis, [remaster], [], []), []);
  assert.equal(sameRadioRecording(oasis, remaster), false,
    "A different recording version must not teach seed metadata");
});

test("real catalog policy: automatic duration bounds stay intentional", () => {
  const song = recording("real-policy-duration", "Madonna", "Music");
  for (const duration of [89, 601, Infinity, NaN]) assert.equal(isRadioMusic({ ...song, duration }), false);
  for (const duration of [90, 600]) assert.equal(isRadioMusic({ ...song, duration }), true);
});

test("real catalog policy: verified short songs and long movements retain intentional exclusions", () => {
  const catalog = JSON.parse(readFileSync(new URL("./fixtures/radio-real-tracks.json", import.meta.url), "utf8")) as {
    tracks: { key: string; artist: string; title: string; durationEvidence?: { seconds: number };
      expected: { case: string } }[];
  };
  const bounded = catalog.tracks.filter(track => track.expected.case === "intentional-long-duration-exclusion" ||
    track.expected.case === "intentional-short-duration-exclusion");
  assert.equal(bounded.length, 3);
  for (const entry of bounded) {
    assert(entry.durationEvidence, "This test uses a cited catalog duration, never an inferred video length");
    const track = recording(`real-policy-${entry.key}`, entry.artist, entry.title,
      { duration: entry.durationEvidence.seconds });
    assert.equal(isRadioMusic(track), false, entry.key);
    assert.equal(isRadioMusic({ ...track, duration: 210 }), true,
      `${entry.key}: controlled duration change proves the length restriction is load-bearing`);
  }
});

test("real catalog policy: a comma inside one artist name is retained", () => {
  for (const value of [tyler, { ...tyler, title: "EARFQUAKE" },
    { ...tyler, catalog: { artist: "Tyler, The Creator", title: "EARFQUAKE", duration: 210 } }]) {
    assert.equal(radioArtist(value), "Tyler, The Creator", sources.tyler);
    assert.equal(radioTitle(value), "EARFQUAKE");
  }
});

test("real catalog policy: distinct artists' Hello recordings are not duplicates", () => {
  assert.equal(sameRadioSong(oasisHello, adeleHello), false, `${sources.oasisHello}; ${sources.adele}`);
  assert.equal(sameRadioSong(oasisHello, { ...oasisHello, id: "alternate-upload" }), true);
  assert.equal(sameRadioRecording(oasisHello, adeleHello), false);
  assert.equal(radioRelated(oasisHello, adeleHello), false,
    "A shared song title alone does not grant a relationship");
  assert.deepEqual(rankRadio(oasisHello, [adeleHello], [], [], true).map(track => track.id), [adeleHello.id],
    "An independently vetted relationship may admit a different artist's different recording");
});

test("real catalog policy: another artist's homonym in history does not consume catalog recovery", async () => {
  let matches = 0;
  const seed = recording("real-policy-supersonic", "Oasis", "Supersonic");
  const result = await selectRadio({ seed, recent: [oasisHello], excluded: [], requireEmbeddable: true,
    search: async () => [], similar: async () => [{ artist: "Adele", title: "Hello", duration: 210 }],
    match: async song => { matches++; return { ...adeleHello, catalog: song }; } });
  assert.equal(matches, 1, "A different artist's known title must reach bounded playback matching");
  assert.equal(result.track?.id, adeleHello.id);
});

// Spelling controls on a verified real recording; no claim that all these
// genres describe EARFQUAKE, and no inference from the artist/channel name.
// Real provider spelling: https://music.apple.com/us/album/after-hours/1499378108
// BBC uses Drum & Bass / DNB for the same show:
// https://downloads.bbc.co.uk/radio/commissioning/Radio_1_Drum_and_Bass_Show_Comm_Brief.pdf
for (const [label, expected] of [["hip-hop", "hip hop"], ["hip hop", "hip hop"],
  ["R&B", "rnb"], ["rnb", "rnb"], ["drum & bass", "drum and bass"],
  ["drum and bass", "drum and bass"], ["DnB", "drum and bass"]] as const) {
  test(`real catalog policy: genre spelling ${label} preserves explicit evidence`, () => {
    assert.equal(radioGenre({ ...tyler, genres: [label] }), expected, label);
    assert.deepEqual(metadataGenres(`Genre: ${label}`, []), [expected], label);
    assert.equal(radioStyleCompatible({ ...tyler, genres: [label] }, { ...tyler, genres: [expected] }), true);
  });
}

test("real catalog policy: broad genre aliases and channel labels cannot grant specific proof", () => {
  assert.equal(specificRadioGenre({ ...tyler, genres: ["R&B"] }), null,
    "Canonical broad R&B must not become cross-artist relationship proof");
  assert.equal(radioRelated({ ...oasisHello, genres: ["R&B"] }, { ...adeleHello, genres: ["rnb"] }), false);
  assert.equal(radioGenre({ ...tyler, genres: [], artist: "drum & bass Topic" }), null,
    "The channel is not a genre label");
});

test("real catalog policy: a featured artist's name cannot become the song's genre", () => {
  // Primary catalog verifies this title/credit, not a punk genre:
  // https://music.apple.com/us/music-video/starboy-feat-daft-punk/1552374084
  const starboy = recording("real-policy-starboy", "The Weeknd", "Starboy (feat. Daft Punk)");
  assert.equal(radioGenre(starboy), null);
  assert.equal(radioGenre({ ...starboy, title: "The Weeknd - Starboy | Daft Punk" }), null,
    "A controlled credit annotation is still not a complete genre label");
  assert.equal(radioGenre({ ...starboy, genres: ["Daft Punk"] }), null);
  assert.equal(radioGenre({ ...starboy, title: "The Weeknd - Starboy [Punk]" }), "punk",
    "A controlled explicit label remains usable without attributing this style to the real recording");
});
