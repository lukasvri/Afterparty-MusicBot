import assert from "node:assert/strict";
import { test } from "node:test";
import { createRadioRanker, isRadioMusic, isRadioTitle, radioArtist, rankRadio, sameRadioRecording, sameRadioSong } from "../src/radio.ts";
import { selectRadio } from "../src/radio-pipeline.ts";
import { publicTrack, type Track } from "../src/types.ts";

// Controlled parser and history fixtures only. No provider or Discord requests.
const track = (id: string, song: string, artist = "The Beatles"): Track => ({
  id, entryId: id, title: `${artist} - ${song}`, artist: `${artist} - Topic`,
  duration: 210, image: "", live: false, music: true, embeddable: true,
});
const seed = track("seed", "Opening");
const clean = track("clean", "Another Song");
const publicHistory = (value: Track) => {
  const result = publicTrack(value);
  assert.ok(result);
  return result;
};

for (const suffix of ["Live Wembley", "Live Glastonbury", "Live BBC Radio 1", "Live BBC Radio1",
  "Live Wembley Stadium HD", "Live Glastonbury Festival Official Video", "Live BBC Radio 1 Official Audio"]) {
  test(`review venues: bare ${suffix} suffix is excluded from automatic radio`, () => {
    const candidate = track("live", `New Song ${suffix}`);
    assert.equal(isRadioTitle(`New Song ${suffix}`), false);
    assert.equal(isRadioMusic(candidate), false);
    assert.deepEqual(rankRadio(seed, [candidate, clean], [], []).map(value => value.id), [clean.id]);
    assert.deepEqual(rankRadio(seed, [{ ...candidate, catalog: {
      artist: "The Beatles", title: "New Song", duration: 210,
    } }, clean], [], []).map(value => value.id), [clean.id], "A clean catalog title must not hide the upload's live suffix");
  });
}

test("review venues: ordinary studio title words retain their meaning", () => {
  for (const song of ["Live Forever", "Live and Let Die", "Who Wants To Live Forever", "Live To Tell",
    "I Live For You", "Wembley", "Glastonbury", "BBC Radio 1", "Live Forever Official Video",
    "Live Glastonbury Dreams", "Live Wembley Memories", "Live BBC Radio 10"]) {
    const candidate = track("studio", song);
    assert.equal(isRadioTitle(song), true, song);
    assert.equal(isRadioMusic(candidate), true, song);
    assert.deepEqual(rankRadio(seed, [candidate], [], []).map(value => value.id), [candidate.id], song);
  }
});

test("review aliases: Beatles and The Beatles cannot replay the same song across upload metadata", () => {
  const previous = track("previous", "Yesterday", "The Beatles");
  const candidate = track("candidate", "Yesterday", "Beatles");
  assert.equal(sameRadioSong(previous, candidate), true);
  assert.equal(sameRadioSong(candidate, previous), true);
  assert.equal(sameRadioRecording(previous, candidate), false, "A spelling alias alone does not prove metadata enrichment is safe");
  assert.deepEqual(rankRadio(seed, [candidate], [publicHistory(previous)], [], true), []);
  assert.deepEqual(rankRadio(previous, [candidate], [], [], true), []);
  assert.equal(radioArtist(candidate), "Beatles", "Identity comparison must preserve displayed artist spelling");
});

test("review aliases: verified catalog and public history use the same Beatles identity", () => {
  const previous = track("previous", "Yesterday", "Beatles");
  const candidate = { ...track("candidate", "Yesterday"), catalog: {
    artist: "The Beatles", title: "Yesterday", duration: 210,
  } };
  assert.equal(sameRadioSong(publicHistory(previous), candidate), true);
  const ranker = createRadioRanker(seed, [], []);
  ranker.remember(publicHistory(previous));
  assert.deepEqual(ranker.rank([candidate], true), []);
});

test("review aliases: the alternate spelling does not block a different song or create relationship proof", () => {
  const candidate = track("candidate", "Another Song", "Beatles");
  assert.equal(sameRadioSong(seed, candidate), false);
  assert.deepEqual(rankRadio(seed, [candidate], [], [], true).map(value => value.id), [candidate.id]);
  assert.deepEqual(rankRadio(seed, [candidate], [], []), [], "Duplicate exclusion must not broaden recommendation evidence");
});

for (const requireEmbeddable of [false, true]) {
  test(`review shared pipeline: live venues and artist-alias repeats are excluded (embeddable=${requireEmbeddable})`, async () => {
    const previous = track("previous", "Yesterday", "The Beatles");
    const candidate = { ...track("candidate", "Yesterday", "Beatles"), genres: ["deep house"] };
    const live = { ...track("live", "New Song Live Wembley"), genres: ["deep house"] };
    const allowed = { ...clean, genres: ["deep house"] };
    const result = await selectRadio({ seed: { ...seed, genres: ["deep house"] },
      recent: [publicHistory(previous)], excluded: [], requireEmbeddable,
      search: async () => [candidate, live, allowed],
    });
    assert.equal(result.track?.id, allowed.id);
    assert.ok(result.diagnostic.rejected.content > 0, "The venue recording is rejected as content");
    assert.ok(result.diagnostic.rejected.recording > 0, "The artist alias is rejected as a repeat");
  });
}

test("review aliases: catalog descriptors exclude the repeated spelling before hydration", async () => {
  const previous = track("previous", "Hey Jude", "The Beatles");
  const attempted: string[] = [];
  const result = await selectRadio({ seed, recent: [publicHistory(previous)], excluded: [], requireEmbeddable: true,
    search: async () => [],
    similar: async () => [
      { artist: "Beatles", title: "Hey Jude", duration: 210 },
      { artist: "The Beatles", title: "Another Song", duration: 210 },
    ],
    match: async song => {
      attempted.push(song.title);
      return { ...track("catalog-match", song.title, song.artist), catalog: song };
    },
  });
  assert.deepEqual(attempted, ["Another Song"]);
  assert.equal(result.track?.id, "catalog-match");
});

test("review aliases: same-title recordings by distinct artist names stay distinct", () => {
  for (const [left, right] of [["The The", "The"], ["The Who", "Who"], ["The Band", "Band"],
    ["The Beatles", "Beatles Revival"], ["The Beatles", "Another Artist"]]) {
    const previous = track("previous", "Same Song", left);
    const candidate = track("candidate", "Same Song", right);
    assert.equal(sameRadioSong(previous, candidate), false, `${left} / ${right}`);
    assert.equal(sameRadioRecording(previous, candidate), false, `${left} / ${right}`);
    assert.deepEqual(rankRadio(previous, [candidate], [], [], true).map(value => value.id), [candidate.id], `${left} / ${right}`);
  }
});
