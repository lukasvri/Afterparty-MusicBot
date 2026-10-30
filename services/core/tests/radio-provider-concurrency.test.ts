import { fixtureRadioOwner } from './radio-content-fixture.ts';
import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { Providers } from "../src/providers.ts";
import { Store } from "../src/store.ts";
import type { YouTubeResponses } from "../src/external-types.ts";
import { deferred } from "./deferred.ts";
import { UserError, publicTrack, type Track } from "../src/types.ts";

const ids = ["first000001", "shared00001", "third000001"];
function apiVideo(id: string) {
  return { id, snippet: { title: `Artist - Song ${id}`, channelTitle: "Artist - Topic",
    tags: ["deep house"], categoryId: "10", liveBroadcastContent: "none" },
    contentDetails: { duration: "PT3M30S" }, status: { embeddable: true } };
}
function extracted(id: string) {
  return { id, title: `Artist - Song ${id}`, uploader: "Artist", artist: "Artist", artists: ["Artist"],
    track: `Song ${id}`, duration: 210, categories: ["Music"], tags: ["deep house"], playable_in_embed: true };
}

test("overlapping cold metadata calls hydrate each video once and isolate caller results", async () => {
  const store = new Store(":memory:"), gate = deferred<void>();
  try {
    const providers = fixtureRadioOwner(new Providers(store, {})), requested: string[] = [];
    providers.youtube = async <K extends keyof YouTubeResponses>(path: K, params: Record<string, string>) => {
      assert.equal(path, "videos"); const batch = params.id.split(","); requested.push(...batch);
      await gate.promise; return { items: batch.map(apiVideo) } as YouTubeResponses[K];
    };
    const first = providers.video(ids.slice(0, 2)), second = providers.video(ids.slice(1));
    await yieldTurn(); gate.resolve(); const [a, b] = await Promise.all([first, second]);
    assert.equal(requested.filter(id => id === ids[1]).length, 1);
    assert.deepEqual(a.map(track => track.id), ids.slice(0, 2));
    assert.deepEqual(b.map(track => track.id), ids.slice(1));
    assert.notEqual(a[1].entryId, b[0].entryId);
    a[1].genres!.push("changed by another caller"); assert.deepEqual(b[0].genres, ["deep house"]);
  } finally { gate.resolve(); store.close(); }
});

test("distinct discovery searches share overlapping metadata hydration", async () => {
  const store = new Store(":memory:"), gate = deferred<void>();
  try {
    const providers = fixtureRadioOwner(new Providers(store, {})); let metadataCalls = 0;
    providers.youtube = async <K extends keyof YouTubeResponses>(path: K) => {
      if (path === "search") return { items: [{ id: { videoId: ids[1] } }] } as YouTubeResponses[K];
      metadataCalls++; await gate.promise; return { items: [apiVideo(ids[1])] } as YouTubeResponses[K];
    };
    const pending = [providers.search("deep house audio", 20, true), providers.search("Artist music audio", 20, true)];
    await yieldTurn(); gate.resolve(); const results = await Promise.all(pending);
    assert.equal(metadataCalls, 1, "Different query keys must not race identical cold video metadata");
    assert(results.every(tracks => tracks[0].id === ids[1]));
    assert.notEqual(results[0][0].entryId, results[1][0].entryId);
  } finally { gate.resolve(); store.close(); }
});

test("shared fallback failures retain each caller's strictness and can recover", async () => {
  for (const tolerantFirst of [false, true]) {
    const store = new Store(":memory:"), gate = deferred<void>();
    try {
      const providers = fixtureRadioOwner(new Providers(store, {})); let extractions = 0;
      providers.youtube = async () => { throw new Error("Controlled unavailable API"); };
      providers.extract = async () => { extractions++; await gate.promise; throw new Error("Controlled missing metadata"); };
      const first = providers.video([ids[1]], tolerantFirst), second = providers.video([ids[1]], !tolerantFirst);
      const strict = assert.rejects(tolerantFirst ? second : first, /Controlled missing metadata/);
      await yieldTurn(); gate.resolve(); await strict;
      assert.deepEqual(await (tolerantFirst ? first : second), []);
      assert.equal(extractions, 1, "Only one fallback may run for the shared ID");
      providers.extract = async () => { extractions++; return extracted(ids[1]); };
      assert.equal((await providers.video([ids[1]]))[0].id, ids[1]);
      assert.equal(extractions, 2, "A rejected promise must not remain cached");
    } finally { gate.resolve(); store.close(); }
  }
});

test("a fast shared fallback is not blocked by another ID's slow hydration", async () => {
  const store = new Store(":memory:"), gate = deferred<void>();
  const pending: Promise<unknown>[] = [];
  try {
    const providers = fixtureRadioOwner(new Providers(store, {}));
    providers.youtube = async () => { throw new Error("Controlled unavailable API"); };
    providers.extract = async args => {
      const id = args.at(-1)!.split("=").at(-1)!;
      if (id === ids[0]) await gate.promise;
      return extracted(id);
    };
    pending.push(providers.video(ids.slice(0, 2)));
    let ready = false;
    pending.push(providers.video([ids[1]]).then(tracks => { ready = true; return tracks; }));
    await yieldTurn(); assert.equal(ready, true, "Per-ID sharing must publish the completed ID independently");
  } finally { gate.resolve(); await Promise.allSettled(pending); store.close(); }
});

const idAt = (index: number) => `v${String(index).padStart(10, "0")}`;

test("large single video calls keep sequential 50-ID batches instead of a 128-input cap", async () => {
  const store = new Store(":memory:");
  try {
    const providers = fixtureRadioOwner(new Providers(store, {})), requested: string[][] = [];
    providers.youtube = async <K extends keyof YouTubeResponses>(path: K, params: Record<string, string>) => {
      assert.equal(path, "videos"); const batch = params.id.split(","); requested.push(batch);
      return { items: batch.map(apiVideo) } as YouTubeResponses[K];
    };
    const wanted = Array.from({ length: 131 }, (_, index) => idAt(index));
    assert.deepEqual((await providers.video(wanted)).map(track => track.id), wanted);
    assert.deepEqual(requested.map(batch => batch.length), [50, 50, 31]);
  } finally { store.close(); }
});

test("128 pending IDs bound saturation while cached/pending joins survive and capacity recovers", async () => {
  const store = new Store(":memory:"), gate = deferred<void>();
  const pending: Promise<unknown>[] = [];
  try {
    const providers = fixtureRadioOwner(new Providers(store, {})), requested: string[][] = [];
    const cachedId = "cache000001";
    store.set("metadata:v6:" + cachedId, { at: Date.now(), track: { id: cachedId, title: "Artist - Cached", artist: "Artist",
      entryId: "old-entry", duration: 210, image: "", live: false, embeddable: true } });
    providers.youtube = async <K extends keyof YouTubeResponses>(path: K, params: Record<string, string>) => {
      assert.equal(path, "videos"); const batch = params.id.split(","); requested.push(batch);
      await gate.promise; return { items: batch.map(apiVideo) } as YouTubeResponses[K];
    };
    pending.push(providers.video(Array.from({ length: 50 }, (_, index) => idAt(index))));
    pending.push(providers.video(Array.from({ length: 50 }, (_, index) => idAt(index + 50))));
    pending.push(providers.video(Array.from({ length: 28 }, (_, index) => idAt(index + 100))));
    await yieldTurn(); assert.equal(requested.flat().length, 128);
    await assert.rejects(providers.video([idAt(0), idAt(128)]), error => error instanceof UserError && error.status === 503);
    const tolerant = providers.video([cachedId, idAt(0), idAt(128)], true); pending.push(tolerant);
    assert.equal(requested.length, 3, "Joining cached/pending IDs needs no extra request even at capacity");
    gate.resolve(); await Promise.all(pending);
    assert.deepEqual((await tolerant).map(track => track.id), [cachedId, idAt(0)]);
    assert.equal((await providers.video([idAt(128)]))[0].id, idAt(128));
    assert.equal(requested.length, 4, "Settled IDs must release admission capacity");
  } finally { gate.resolve(); await Promise.allSettled(pending); store.close(); }
});

test("shared fallback retains three workers and independent nested catalog/genre ownership", async () => {
  const store = new Store(":memory:"), gate = deferred<void>();
  const pending: Promise<unknown>[] = [];
  try {
    const providers = fixtureRadioOwner(new Providers(store, {})); let active = 0, maximum = 0;
    const counts = new Map<string, number>(), wanted = Array.from({ length: 8 }, (_, index) => idAt(index));
    providers.youtube = async () => { throw new Error("Controlled unavailable API"); };
    providers.extract = async args => {
      const id = args.at(-1)!.split("=").at(-1)!; counts.set(id, (counts.get(id) ?? 0) + 1);
      active++; maximum = Math.max(maximum, active);
      try { await gate.promise; return extracted(id); } finally { active--; }
    };
    const owner = providers.video(wanted), joined = providers.video(wanted.slice(0, 3)); pending.push(owner, joined);
    await yieldTurn(); assert.equal(active, 3); assert.equal(maximum, 3);
    gate.resolve(); const [all, shared] = await Promise.all([owner, joined]);
    assert.equal(maximum, 3); assert([...counts.values()].every(count => count === 1));
    all[0].catalog!.artist = "Modified by another caller"; all[0].genres!.push("modified");
    assert.equal(shared[0].catalog!.artist, "Artist"); assert.deepEqual(shared[0].genres, ["deep house"]);
    assert.notEqual(all[0].entryId, shared[0].entryId);
    const cached = (await providers.video([wanted[0]]))[0];
    assert.equal(cached.catalog!.artist, "Artist"); assert.deepEqual(cached.genres, ["deep house"]);
  } finally { gate.resolve(); await Promise.allSettled(pending); store.close(); }
});

test("successful API omissions settle all waiters without poisoning a later retry", async () => {
  const store = new Store(":memory:"), gate = deferred<void>();
  try {
    const providers = fixtureRadioOwner(new Providers(store, {})); let calls = 0;
    providers.youtube = async <K extends keyof YouTubeResponses>() => {
      calls++; await gate.promise; return { items: calls === 1 ? [] : [apiVideo(ids[1])] } as YouTubeResponses[K];
    };
    const pending = [providers.video([ids[1]]), providers.video([ids[1]], true)];
    gate.resolve(); assert.deepEqual(await Promise.all(pending), [[], []]); assert.equal(calls, 1);
    const repeated = await providers.video([ids[1], ids[1]]);
    assert.equal(calls, 2); assert.equal(repeated.length, 2); assert.notEqual(repeated[0].entryId, repeated[1].entryId);
  } finally { gate.resolve(); store.close(); }
});

test("actual parallel radio discovery hydrates its shared candidate once and preserves private context", async () => {
  const store = new Store(":memory:"), bothSearches = deferred<void>(), metadataGate = deferred<void>();
  const providers = fixtureRadioOwner(new Providers(store, {})), searches: string[] = []; let metadataCalls = 0;
  const seed: Track = { id: "seed0000001", entryId: "seed-entry", title: "Seed Artist - Opening", artist: "Seed Artist - Topic",
    genres: ["deep house"], duration: 210, live: false, embeddable: true, image: "", music: true };
  const history = [{ ...seed, id: "history0001", entryId: "old-entry", title: "Earlier Artist - Earlier" }];
  const originalSeed = structuredClone(seed), originalHistory = structuredClone(history);
  store.set("radio-history", history);
  providers.youtube = async <K extends keyof YouTubeResponses>(path: K, params: Record<string, string>) => {
    if (path === "search") {
      searches.push(params.q); if (searches.length === 2) bothSearches.resolve();
      return { items: [{ id: { videoId: ids[1] } }] } as YouTubeResponses[K];
    }
    metadataCalls++; await metadataGate.promise;
    return { items: [apiVideo(ids[1])] } as YouTubeResponses[K];
  };
  const pending = providers.radio(seed, [seed.id]);
  try {
    await bothSearches.promise; await yieldTurn();
    assert.equal(new Set(searches).size, 2); assert.equal(metadataCalls, 1);
    metadataGate.resolve(); const selected = await pending;
    assert.equal(selected?.id, ids[1]); assert.equal(selected.radioRelatedTo, seed.id);
    assert(!("radioRelatedTo" in publicTrack(selected)!));
    const cached = await providers.radio(seed, [seed.id]);
    assert.equal(cached?.id, selected.id); assert.notEqual(cached.entryId, selected.entryId);
    assert.equal(metadataCalls, 1); assert.equal(searches.length, 3, "two discovery searches plus one cached format lookup");
    assert.deepEqual(seed, originalSeed); assert.deepEqual(store.get("radio-history", []), originalHistory);
  } finally { metadataGate.resolve(); await pending; store.close(); }
});
