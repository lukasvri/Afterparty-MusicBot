import assert from "node:assert/strict";
import { test } from "node:test";
import captured from "./fixtures/radio-artist-credits.json" with { type: "json" };
import { Providers } from "../src/providers.ts";
import { Store } from "../src/store.ts";
import { radioArtist, sameRadioSong } from "../src/radio.ts";
import type { Track } from "../src/types.ts";

const seed: Track = { id: "TDe1DqxwJoc", title: "Oasis - Live Forever (Official HD Remastered Video)",
  artist: "Oasis", entryId: "original", duration: 278, image: "", music: true, live: false, embeddable: true };

test("captured structured Oasis credits reach the same-artist radio fallback", async () => {
  const store = new Store(":memory:");
  try {
    const providers = new Providers(store, {});
    providers.youtube = async () => { throw new Error("API capability disabled in isolated fixture"); };
    // Identity fields are the exact public capture. Duration/category/availability
    // below are controlled inputs, independently observed in the prior live capture.
    providers.extract = async () => ({ ...captured, duration: 259, categories: ["Music"],
      is_live: false, playable_in_embed: true });
    const [candidate] = await providers.video([captured.id]);
    assert.equal(candidate.artist, "Oasis, Noel Gallagher", "Preserve full displayed credits");
    assert.equal(radioArtist(candidate), "Oasis", "A named uploader confirms one structured list member");
    providers.search = async () => [candidate];
    assert.equal((await providers.radio(seed, [seed.id]))?.id, captured.id);
    assert.equal(sameRadioSong(candidate, { ...candidate, id: "other-upload" }), true);
  } finally { store.db.close(); }
});

test("a single structured artist can contain a comma without being truncated", async () => {
  const store = new Store(":memory:");
  try {
    const providers = new Providers(store, {});
    providers.youtube = async () => { throw new Error("API capability disabled in isolated fixture"); };
    // Controlled parser variations, not another live metadata capture.
    providers.extract = async () => ({ title: "EARFQUAKE", track: "EARFQUAKE", artist: "Tyler, The Creator",
      artists: ["Tyler, The Creator"], uploader: "Tyler, The Creator", duration: 210, playable_in_embed: true });
    assert.equal(radioArtist((await providers.video(["t-E2gm0a_N0"]))[0]), "Tyler, The Creator");
  } finally { store.db.close(); }
});

test("missing structured credits and an unconfirmed multi-artist list retain the full string", async () => {
  for (const artists of [undefined, ["Oasis", "Noel Gallagher"]]) {
    const store = new Store(":memory:");
    try {
      const providers = new Providers(store, {});
      providers.youtube = async () => { throw new Error("API capability disabled in isolated fixture"); };
      providers.extract = async () => ({ title: "Wonderwall", track: "Wonderwall", artist: "Oasis, Noel Gallagher",
        artists, uploader: "Unknown channel", duration: 259, playable_in_embed: true });
      assert.equal(radioArtist((await providers.video([captured.id]))[0]), "Oasis, Noel Gallagher");
    } finally { store.db.close(); }
  }
});
