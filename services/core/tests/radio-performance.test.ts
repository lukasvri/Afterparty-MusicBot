import assert from "node:assert/strict";
import test from "node:test";
import { playableRoomQueue } from "../src/room-radio.ts";
import { repeatedHistoryQueue, syntheticRoom, syntheticSong } from "./radio-queue-fixture.ts";

test("room queue selection prepares each history recording once per pass", () => {
  function historyReads(automatic: number, select = playableRoomQueue) {
    const state = syntheticRoom(automatic, 0, 100);
    let reads = 0;
    state.history = state.history!.map((track, index) => ({
      // Exclude the last five tracks, whose changing artist-diversity window
      // is intentionally inspected as each accepted suggestion is remembered.
      ...track, get title() { if (index < 90) reads++; return track.title; },
    }));
    assert.equal(select(state).length, automatic);
    return reads;
  }
  const single = historyReads(1);
  assert(single > 0);
  // The previous path reprocessed history for each suggestion. A work count
  // catches that regression without flaky wall-time limits on busy CI hosts.
  assert(historyReads(20, repeatedHistoryQueue) > single * 10);
  assert.equal(historyReads(20), single);
  assert.equal(historyReads(0), 0, "manual/empty queues do not compile unused radio history");
});

test("shared queue selection matches sequential filtering across mixed unsafe and explicit choices", () => {
  for (let round = 0; round < 80; round++) {
    const state = syntheticRoom(round % 21, round % 4, round % 2 ? 100 : 0);
    const seed = state.current!;
    if (round % 3 === 0) seed.title = "Synthetic Artist 0 - Opening | House";
    if (round % 5 === 0) seed.title = "Unknown song";
    if (round % 7 === 0) state.radio = false;
    state.radioExcluded = [syntheticSong(4).id];
    state.radioExcludedSongs = [syntheticSong(5)];
    state.queue = state.queue.map((track, index) => {
      const variant = (round + index) % 9;
      return {
        ...track,
        ...(variant === 0 ? { music: false } : {}),
        ...(variant === 1 ? { embeddable: false } : {}),
        ...(variant === 2 ? { live: true } : {}),
        ...(variant === 3 ? { title: "Synthetic Artist 2 - Song 2 (2024 Remaster) [Electro House]" } : {}),
        ...(variant === 4 ? { title: "Different Artist - Production Tutorial [Electro House]" } : {}),
        ...(variant === 5 ? { title: "Another Artist - Unrelated [Tech House]" } : {}),
        ...(variant === 6 ? { radioRelatedTo: seed.id } : {}),
      };
    });
    const before = structuredClone(state);
    assert.deepEqual(playableRoomQueue(state), repeatedHistoryQueue(state), `case ${round}`);
    assert.deepEqual(state, before, "selection does not mutate the room or leak context to another call");
  }
});

test("a later history or exclusion change is observed by the next queue validation", () => {
  const state = syntheticRoom(2, 0, 0);
  assert.equal(playableRoomQueue(state).length, 2);
  state.history = [state.queue[0]];
  assert.deepEqual(playableRoomQueue(state).map(track => track.id), [state.queue[1].id]);
  state.radioExcluded = [state.queue[1].id];
  assert.deepEqual(playableRoomQueue(state), []);
  assert.equal(playableRoomQueue(syntheticRoom(2, 0, 0)).length, 2, "another room retains its own choices");
});
