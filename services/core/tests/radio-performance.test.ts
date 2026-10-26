import assert from "node:assert/strict";
import test from "node:test";
import { hasPlayableRoomQueue, playableRoomQueue } from "../src/room-radio.ts";
import { needsRecommendation, prefetchDue, type RoomPlayback } from "../src/room-state.ts";
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
    assert.equal(hasPlayableRoomQueue(state), repeatedHistoryQueue(state).length > 0, `presence case ${round}`);
    assert.deepEqual(state, before, "selection does not mutate the room or leak context to another call");
  }
});

test("queue presence stops at the first safe track without inspecting later suggestions", () => {
  const state = syntheticRoom(20, 0, 100);
  let inspected = 0;
  state.queue = state.queue.map(track => ({
    ...track, get embeddable() { inspected++; return track.embeddable; },
  }));
  assert.equal(hasPlayableRoomQueue(state), true);
  const first = inspected;
  assert(first > 0);
  inspected = 0;
  assert.equal(playableRoomQueue(state).length, 20);
  assert(inspected >= first * 20, "complete enumeration still validates every recommendation");

  const manual = syntheticRoom(20, 1, 100);
  Object.defineProperty(manual, "history", { get() { throw Error("unused history"); } });
  assert.equal(hasPlayableRoomQueue(manual), true, "an explicit request needs no radio ranker");
  assert.equal(hasPlayableRoomQueue({ ...state, radio: false }), false);
  assert.equal(hasPlayableRoomQueue({ ...state, queue: [] }), false);
});

test("unrelated commands and ineligible prefetch ticks do not validate a queue", () => {
  const state: RoomPlayback = { ...syntheticRoom(20, 0, 100), playing: true, position: 0 };
  Object.defineProperty(state, "queue", { get() { throw Error("queue must not be inspected"); } });
  for (const action of ["pause", "play", "seek", "add", "vote", "remove", "clear", "unknown"])
    assert.equal(needsRecommendation(state, { action }), false, action);
  for (const input of [
    { action: "radio", enabled: false },
    { action: "skip-vote", participantHash: "invalid" },
    { action: "skip-vote", participantHash: "a".repeat(64) },
  ]) assert.equal(needsRecommendation(state, input), false);
  for (const change of [
    { playing: false }, { radio: false }, { current: null },
    { current: { ...state.current!, live: true } },
    { position: 300 }, { radioRetryAt: 30000 },
  ]) {
    // Preserve the instrumented getter instead of spreading its value.
    const candidate = Object.create(state) as RoomPlayback;
    Object.assign(candidate, change);
    assert.equal(prefetchDue(candidate, 10000, 20000), false);
  }
});

test("recommendation eligibility retains full-selection decisions for skip votes and radio enabling", () => {
  for (let round = 0; round < 40; round++) {
    const state: RoomPlayback = {
      ...syntheticRoom(round % 4, round % 3, 100), playing: true, position: 0,
      radio: round % 5 !== 0, skipVoters: ["a".repeat(64), "b".repeat(64)],
    };
    const actions = [
      { action: "next" }, { action: "radio-prefetch" },
      { action: "radio", enabled: true }, { action: "radio", enabled: false },
      { action: "skip-vote", participantHash: "c".repeat(64) },
      { action: "skip-vote", participantHash: "a".repeat(64) },
      { action: "skip-vote", participantHash: "invalid" },
    ];
    for (const input of actions) {
      const enabling = input.action === "radio" && input.enabled === true;
      const eligible = input.action === "next" || input.action === "radio-prefetch" || enabling ||
        (input.action === "skip-vote" && /^[a-f0-9]{64}$/.test(input.participantHash ?? "") &&
          !state.skipVoters!.includes(input.participantHash!));
      const expected = (state.radio !== false || enabling) && eligible && !playableRoomQueue(state).length;
      assert.equal(needsRecommendation(state, input), expected, `${round}: ${JSON.stringify(input)}`);
    }
    assert.equal(prefetchDue(state, 10000, 20000), state.radio !== false && !playableRoomQueue(state).length);
  }
});

test("a later history or exclusion change is observed by the next queue validation", () => {
  const state = syntheticRoom(2, 0, 0);
  assert.equal(playableRoomQueue(state).length, 2);
  assert.equal(hasPlayableRoomQueue(state), true);
  state.history = [state.queue[0]];
  assert.deepEqual(playableRoomQueue(state).map(track => track.id), [state.queue[1].id]);
  state.radioExcluded = [state.queue[1].id];
  assert.deepEqual(playableRoomQueue(state), []);
  assert.equal(hasPlayableRoomQueue(state), false);
  assert.equal(playableRoomQueue(syntheticRoom(2, 0, 0)).length, 2, "another room retains its own choices");
  assert.equal(hasPlayableRoomQueue(syntheticRoom(2, 0, 0)), true);
});
