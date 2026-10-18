import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { selectRadio } from "../src/radio-pipeline.ts";
import type { Track } from "../src/types.ts";

const track = (id: string, artist: string): Track => ({ id, entryId: id,
  title: `${artist} - Evening ${id}`, artist: `${artist} - Topic`, duration: 210,
  image: "", music: true, live: false, embeddable: true, genres: ["deep house"] });
const seed = track("seed0000001", "Aster");
const input = { seed, recent: [], excluded: [], requireEmbeddable: true };

test("independent bounded discovery pools start before either provider reply", async () => {
  let release!: (tracks: Track[]) => void;
  const gate = new Promise<Track[]>(resolve => { release = resolve; });
  const queries: string[] = [];
  const pending = selectRadio({ ...input, search: async query => {
    queries.push(query);
    return queries.length === 1 ? gate : [track("later000001", "Cedar")];
  } });
  try {
    await yieldTurn();
    assert.equal(queries.length, 2, "one slow provider pool must not delay starting the other bounded pool");
    assert.equal(new Set(queries).size, 2);
  } finally { release([track("first000001", "Beryl")]); await pending; }
});

test("reverse provider completion preserves stable discovery order and private provenance", async () => {
  let release!: (tracks: Track[]) => void;
  const gate = new Promise<Track[]>(resolve => { release = resolve; });
  const before = structuredClone(seed);
  const pending = selectRadio({ ...input, search: query => query.startsWith("deep house")
    ? gate : Promise.resolve([track("later000001", "Cedar")]) });
  await yieldTurn(); release([track("first000001", "Beryl")]);
  const selected = await pending;
  assert.equal(selected.track?.id, "first000001");
  assert.equal(selected.source, "genre");
  assert.equal(selected.track?.radioRelatedTo, seed.id);
  assert.equal(selected.diagnostic.searches, 2);
  assert.equal(selected.diagnostic.candidates, 2);
  assert.deepEqual(seed, before);
});

test("one failed discovery pool cannot hide the other safe result", async () => {
  const selected = await selectRadio({ ...input, search: async query => {
    if (query.startsWith("deep house")) throw new Error("private provider diagnostic");
    return [track("later000001", "Cedar")];
  } });
  assert.equal(selected.track?.id, "later000001");
  assert.equal(selected.source, "artist");
  assert.equal(selected.diagnostic.failedSearches, 1);
  assert(!JSON.stringify(selected.diagnostic).includes("private"));
});
