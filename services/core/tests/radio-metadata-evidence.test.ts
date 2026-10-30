import { fixtureRadioOwner } from './radio-content-fixture.ts';
import assert from "node:assert/strict";
import { test } from "node:test";
import { isRadioTitle, metadataGenres, sameRadioSong } from "../src/radio.ts";
import { Providers } from "../src/providers.ts";
import { Store } from "../src/store.ts";
import capturedCredits from "./fixtures/radio-artist-credits.json" with { type: "json" };

test("fresh and cached catalog matches preserve only the same artist's verified legacy credit", async () => {
  const store = new Store(":memory:");
  try {
    const providers = fixtureRadioOwner(new Providers(store, {}));
    providers.youtube = async () => { throw new Error("No external API capability in the isolated fixture"); };
    providers.extract = async () => ({ ...capturedCredits, duration: 259, categories: ["Music"],
      is_live: false, playable_in_embed: true });
    const [fresh] = await providers.video([capturedCredits.id]);
    const legacy = { ...fresh, id: "legacy00001", catalog: { artist: capturedCredits.artist,
      title: capturedCredits.track, duration: 259 } };
    assert.equal(sameRadioSong(legacy, fresh), true);
    providers.search = async () => [fresh];
    const song = { artist: "Oasis", title: capturedCredits.track, duration: 259 };
    for (const path of ["fresh", "cached"]) {
      const matched = await providers.matchSong(song);
      assert.equal(matched.catalog?.artistCredit, capturedCredits.artist, path);
      assert.equal(sameRadioSong(legacy, matched), true, `${path} catalog replacement must retain duplicate exclusion`);
    }
    const otherArtist = await providers.matchSong({ ...song, artist: "Noel Gallagher", artistCredit: capturedCredits.artist });
    assert.equal(otherArtist.catalog?.artistCredit, undefined, "A contradictory catalog artist cannot acquire the alias, including from input");
    assert.equal(sameRadioSong(legacy, otherArtist), false);
  } finally { store.db.close(); }
});

test("public Starboy artist tag is not explicit punk genre evidence", () => {
  // yt-dlp 2026.08.19, 2026-10-18T14:45:24Z, source
  // https://www.youtube.com/watch?v=Rif-RTvmmss . Only the triggering public
  // tag is retained. This is metadata evidence, never a listening assessment.
  assert.deepEqual(metadataGenres(undefined, ["Daft Punk"]), []);
});

test("complete genre tags and explicit genre lines retain their evidence", () => {
  for (const label of ["punk", "deep house", "electro house", "hip hop", "drum and bass"]) {
    assert.deepEqual(metadataGenres(undefined, [label]), [label]);
    assert.deepEqual(metadataGenres(undefined, [`${label} music`]), [label]);
    assert.deepEqual(metadataGenres(`Genre: ${label}`, []), [label]);
    assert.deepEqual(metadataGenres(`Style: ${label}`, []), [label]);
  }
});

test("song names and explicit live or cover upload suffixes retain distinct meanings", () => {
  for (const title of ["Live Forever", "Cover Me", "Who Wants To Live Forever", "Live Forever (Remastered)"])
    assert.equal(isRadioTitle(title), true, title);
  for (const title of ["Live Forever - Live Wembley 1986", "Cover Me - Piano Cover by Artist",
    "Live Forever | Live Wembley", "Cover Me (Guitar Cover by Artist)", "Another Live", "Another Cover"])
    assert.equal(isRadioTitle(title), false, title);
});

test("old inferred-genre metadata and search caches cannot survive the parser change", async () => {
  const store = new Store(":memory:");
  const id = "Rif-RTvmmss";
  try {
    const oldTrack = { id, entryId: "old", title: "The Weeknd - Starboy", artist: "The Weeknd",
      duration: 231, live: false, embeddable: true, image: "", genres: ["punk"] };
    store.set("metadata:v3:" + id, { at: Date.now(), track: oldTrack });
    store.set('search:v4:["starboy",5,true]', { at: Date.now(), tracks: [oldTrack] });
    const providers = fixtureRadioOwner(new Providers(store, {}));
    providers.youtube = async () => { throw new Error("API capability unavailable in isolated test"); };
    const calls: string[] = [];
    providers.extract = async args => {
      calls.push(args.at(-1)!);
      return args.at(-1)!.startsWith("ytsearch") ? { entries: [{ id }] } :
        { id, title: "The Weeknd - Starboy", uploader: "The Weeknd", duration: 231,
          tags: ["Daft Punk"], categories: ["Music"], is_live: false, playable_in_embed: true };
    };
    assert.deepEqual((await providers.video([id]))[0].genres, []);
    assert.deepEqual((await providers.search("starboy", 5, true))[0].genres, []);
    assert.equal(calls.length, 2, "Fresh metadata and fresh search are fetched, then metadata is reused");
  } finally { store.db.close(); }
});
