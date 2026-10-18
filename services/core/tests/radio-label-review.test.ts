import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isRadioMusic, metadataGenres, radioGenre, rankRadio, specificRadioGenre,
} from "../src/radio.ts";
import type { Track } from "../src/types.ts";

// Controlled metadata for PR review regressions, not captured uploads or
// assertions about the style of a named real artist. No providers or media.
const track = (id: string, song: string, extra: Partial<Track> = {}): Track => ({
  id, entryId: id, title: `Review Artist - ${song}`, artist: "Review Artist - Topic",
  duration: 210, image: "", live: false, music: true, embeddable: true, ...extra,
});
const seed = track("review-seed", "Opening");
const clean = track("review-clean", "Evening");

for (const suffix of ["Live Official Video", "Cover Official Audio", "Live Official Music Video",
  "Cover Music Video", "Live HD", "Cover HQ", "Live HD Official Video", "Cover Official Audio HQ"]) {
  test(`review labels: qualified ${suffix} upload stays out of automatic radio`, () => {
    const unsafe = track("review-unsafe", `New Song ${suffix}`);
    assert.equal(isRadioMusic(unsafe), false);
    assert.deepEqual(rankRadio(seed, [unsafe, clean], [], []).map(value => value.id), [clean.id]);
  });
}

test("review labels: qualified format before a genre suffix is still excluded", () => {
  const unsafe = track("review-unsafe", "New Song Live Official Video | Deep House");
  assert.equal(isRadioMusic(unsafe), false);
  assert.deepEqual(rankRadio(seed, [unsafe, clean], [], []).map(value => value.id), [clean.id]);
});

test("review labels: studio song words retain meaning beside ordinary promotional labels", () => {
  // Legitimate names independently verified in radio-real-policy.test.ts.
  // Here the appended labels are controlled parser variations.
  for (const song of ["Live Forever Official Video", "Cover Me Official Audio",
    "How To Love Official Music Video", "Who Wants To Live Forever HD"]) {
    const candidate = track("review-studio", song);
    assert.equal(isRadioMusic(candidate), true, song);
    assert.deepEqual(rankRadio(seed, [candidate], [], []).map(value => value.id), [candidate.id]);
  }
});

for (const [label, expected] of [["Hip-Hop/Rap", "hip hop"], ["R&B/Soul", "soul"],
  ["Drum&Bass/Jungle", "drum and bass"]] as const) {
  test(`review labels: compound taxonomy ${label} retains its recognized component`, () => {
    assert.equal(radioGenre(track("review-genre", "Evening", { genres: [label] })), expected);
    assert.equal(radioGenre(track("review-genre", `Evening [${label}]`)), expected);
    assert.deepEqual(metadataGenres(undefined, [label]), [expected]);
    assert.deepEqual(metadataGenres(`Genre: ${label}`, []), [expected]);
  });
}

test("review labels: compound taxonomy retains genre priority and broad-genre restrictions", () => {
  // radioGenre is a single preferred genre, not a new list-valued API.
  assert.equal(radioGenre(track("review-genre", "Evening", { genres: ["Tech House/Deep House"] })), "deep house");
  assert.equal(specificRadioGenre(track("review-genre", "Evening", { genres: ["R&B/Soul"] })), null);
});

test("review labels: free-form artists and credits do not become compound genres", () => {
  for (const label of ["Daft Punk", "Daft Punk/The Weeknd", "Daft Punk; Nile Rodgers",
    "feat. Daft Punk / The Weeknd", "feat. Daft Punk / Deep House",
    "Featuring Daft Punk; Deep House", "unrelated house credit / collaborator"]) {
    assert.equal(radioGenre(track("review-credit", `Evening (${label})`)), null, label);
    assert.equal(radioGenre(track("review-credit", "Evening", { genres: [label] })), null, label);
    assert.deepEqual(metadataGenres(undefined, [label]), [], label);
  }
  assert.deepEqual(metadataGenres(undefined, ["Punk", "House music"]), ["punk", "house"],
    "Complete declared genre labels remain usable");
});
