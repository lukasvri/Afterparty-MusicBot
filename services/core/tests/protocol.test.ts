import { test } from "node:test";
import assert from "node:assert/strict";
import { readRoomTimeline, ROOM_LEASE_MS, type RoomTimeline } from "../src/protocol.ts";

const room: RoomTimeline = {
  code: "TESTROOM", name: "Synthetic room", current: null, queue: [],
  playing: false, position: 0, version: 1, serverTime: 1000,
  viewers: 0, isHost: false, expiresAt: 60000,
  syncSource: "live", syncEpoch: "synthetic-epoch", syncValidForMs: ROOM_LEASE_MS,
};

test("room sync leases must be finite, bounded and attached to a valid clock identity", () => {
  assert.equal(readRoomTimeline(room), room);
  assert(readRoomTimeline({ ...room, syncValidForMs: 0 }));
  for (const syncValidForMs of [undefined, null, NaN, Infinity, -1, ROOM_LEASE_MS + 1, "5000"])
    assert.equal(readRoomTimeline({ ...room, syncValidForMs }), null);
  for (const syncEpoch of [undefined, "", 42, "x".repeat(161)])
    assert.equal(readRoomTimeline({ ...room, syncEpoch }), null);
  for (const syncSource of [undefined, "fallback", null])
    assert.equal(readRoomTimeline({ ...room, syncSource }), null);
});

test("room clock metadata rejects malformed expiry, viewer counts and host flags", () => {
  for (const expiresAt of [undefined, NaN, Infinity, "60000"])
    assert.equal(readRoomTimeline({ ...room, expiresAt }), null);
  for (const viewers of [undefined, NaN, -1, 0.5, "1"])
    assert.equal(readRoomTimeline({ ...room, viewers }), null);
  for (const isHost of [undefined, null, 1])
    assert.equal(readRoomTimeline({ ...room, isHost }), null);
  assert(readRoomTimeline({ ...room, serverTime: 100000, startsAt: 101500, isHost: true }));
});

test("room capacity reserves pending requests and fails closed for invalid counts", async () => {
  const { ROOM_QUEUE_LIMIT, roomQueueCapacity } = await import("../src/protocol.ts");
  assert.equal(roomQueueCapacity(0), ROOM_QUEUE_LIMIT);
  assert.equal(roomQueueCapacity(48, 1), 1);
  assert.equal(roomQueueCapacity(49, 1), 0);
  assert.equal(roomQueueCapacity(50, 1), 0);
  for (const count of [-1, 0.5, NaN, Infinity]) {
    assert.equal(roomQueueCapacity(count), 0);
    assert.equal(roomQueueCapacity(0, count), 0);
  }
});
