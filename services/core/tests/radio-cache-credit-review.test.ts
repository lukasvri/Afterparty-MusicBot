import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import captured from "./fixtures/radio-artist-credits.json" with { type: "json" };
import { Providers } from "../src/providers.ts";
import { Store } from "../src/store.ts";
import { publicTrack, type Track } from "../src/types.ts";
import type { YouTubeVideo } from "../src/external-types.ts";

const DAY = 86400000;
const song = { artist: "Oasis", title: captured.track, duration: 259 };
const cacheKey = "match:v2:" + JSON.stringify(["", song.artist, song.title, song.duration]);

beforeEach(() => mock.method(globalThis, "fetch", async () => { assert.fail("The cache regression must not access a live provider"); }));
afterEach(() => mock.restoreAll());

async function fixture(duration = song.duration) {
  let now = Date.UTC(2026, 9, 18);
  mock.method(Date, "now", () => now);
  const store = new Store(":memory:");
  const counts = { extractor: 0, api: 0 };
  const initial = new Providers(store, {});
  initial.youtube = async () => { throw new Error("Controlled initial API outage"); };
  initial.extract = async () => {
    counts.extractor++;
    return { ...captured, duration: 259, categories: ["Music"], is_live: false, playable_in_embed: true };
  };
  initial.search = () => initial.video([captured.id]);
  const request = { ...song, duration };
  const verified = await initial.matchSong(request);
  assert.equal(verified.catalog?.artistCredit, captured.artist);
  const legacy: Track = { ...verified, id: "legacy00001", catalog: { ...song, artist: captured.artist } };
  initial.rememberRadioTrack(legacy);
  now += DAY + 1;
  const api: YouTubeVideo = { id: captured.id,
    snippet: { title: captured.title, channelTitle: "Oasis", categoryId: "10", liveBroadcastContent: "none" },
    contentDetails: { duration: "PT4M19S" }, status: { embeddable: true } };
  const renewed = new Providers(store, {});
  renewed.youtube = (async () => { counts.api++; return { items: [api] }; }) as Providers["youtube"];
  renewed.extract = async () => { assert.fail("A successful API refresh must not use the extractor"); };
  renewed.search = () => renewed.video([api.id]);
  return { store, verified, renewed, api, counts, request, age: (days: number) => { now += DAY * days; } };
}

test("a seven-day verified match retains credit across an actual 24-hour API metadata refresh", async () => {
  const f = await fixture();
  try {
    const result = await f.renewed.matchSong({ ...song, artistCredit: "Untrusted input alias" });
    assert.equal(f.counts.extractor, 1);
    assert.equal(f.counts.api, 1, "Expired metadata must be parsed again through the successful API branch");
    assert.equal(result.catalog?.artistCredit, captured.artist);
    assert.notEqual(result.entryId, f.verified.entryId);
    assert.equal(JSON.stringify(publicTrack(result)).includes("artistCredit"), false);
  } finally { f.store.db.close(); }
});

test("an API-refreshed match still excludes an older combined-credit history entry", async () => {
  const f = await fixture();
  try {
    const result = await f.renewed.matchSong(song);
    f.renewed.search = async () => [result];
    const seed: Track = { ...result, id: "TDe1DqxwJoc", title: "Oasis - Live Forever", artist: "Oasis",
      catalog: { artist: "Oasis", title: "Live Forever", duration: 278 }, duration: 278 };
    assert.equal(await f.renewed.radio(seed, [seed.id]), null);
  } finally { f.store.db.close(); }
});

for (const [name, change] of [
  ["another video ID", (f: Awaited<ReturnType<typeof fixture>>) => { f.api.id = "another0001"; }],
  ["an unexpected refreshed ID", (f: Awaited<ReturnType<typeof fixture>>) => {
    const video = f.renewed.video.bind(f.renewed);
    f.renewed.video = async (...args) => (await video(...args)).map(track => ({ ...track, id: "another0001" }));
  }],
  ["another title with a high token match", (f: Awaited<ReturnType<typeof fixture>>) => { f.api.snippet.title = "Wonderwall Returns (Remastered)"; }],
  ["another artist containing the expected name", (f: Awaited<ReturnType<typeof fixture>>) => { f.api.snippet.channelTitle = "Oasis Revival"; }],
  ["another featured recording", (f: Awaited<ReturnType<typeof fixture>>) => { f.api.snippet.title = "Wonderwall Featuring Guest (Remastered)"; }],
  ["another source", (f: Awaited<ReturnType<typeof fixture>>) => {
    const video = f.renewed.video.bind(f.renewed);
    f.renewed.video = async (...args) => (await video(...args)).map(track => ({ ...track, source: "soundcloud" }));
  }],
  ["a contradictory cached canonical artist", (f: Awaited<ReturnType<typeof fixture>>) => {
    const cached = f.store.get<{ at: number; track: Track }>(cacheKey, { at: 0, track: f.verified });
    f.store.set(cacheKey, { ...cached, track: { ...cached.track, catalog: { ...cached.track.catalog!, artist: "Noel Gallagher" } } });
  }],
  ["an expired seven-day match", (f: Awaited<ReturnType<typeof fixture>>) => { f.age(7); }],
] as const) {
  test(`cached credit cannot transfer to ${name}`, async () => {
    const f = await fixture();
    try {
      change(f);
      const result = await f.renewed.matchSong({ ...song, artistCredit: captured.artist });
      assert.equal(result.catalog?.artistCredit, undefined);
    } finally { f.store.db.close(); }
  });
}

test("unknown catalog duration cannot transfer cached proof to a materially different recording length", async () => {
  const f = await fixture(0);
  try {
    f.api.contentDetails.duration = "PT8M";
    const result = await f.renewed.matchSong({ ...f.request, artistCredit: captured.artist });
    assert.equal(result.catalog?.artistCredit, undefined);
  } finally { f.store.db.close(); }
});

for (const [name, change] of [
  ["another artist", (api: YouTubeVideo) => { api.snippet.channelTitle = "Another Artist"; }],
  ["a live recording version", (api: YouTubeVideo) => { api.snippet.title = "Wonderwall (Live)"; }],
  ["a conflicting duration", (api: YouTubeVideo) => { api.contentDetails.duration = "PT10M"; }],
] as const) {
  test(`a cached match cannot bypass fresh verification for ${name}`, async () => {
    const f = await fixture();
    try {
      change(f.api);
      await assert.rejects(f.renewed.matchSong({ ...song, artistCredit: captured.artist }), /reliable audio match/);
    } finally { f.store.db.close(); }
  });
}
