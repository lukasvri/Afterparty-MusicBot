import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveClock } from "../lib/live-clock.ts";

test("clock estimates use low-latency samples and ignore wall-clock changes", () => {
  let monotonic = 1000;
  const clock = new LiveClock(() => monotonic, 10000);
  assert.equal(clock.age(50000), 0);
  const sent = clock.now();
  monotonic += 100;
  assert.equal(clock.record(sent, 50050), 100);
  assert.equal(clock.age(50000), 100);
  monotonic += 200;
  assert.equal(clock.age(50000), 300);
  // A slow response must not replace the good estimate with a misleading offset.
  assert.equal(clock.record(clock.now() - 1000, 90000), 1000);
  assert.equal(clock.age(50000), 300);
  monotonic += 5000;
  assert.equal(clock.age(50000), 1500);
  assert.equal(clock.record(clock.now(), NaN), null);
  assert.equal(clock.record(clock.now() + 10, 50000), null);
});

test("clock sampling coalesces requests and cancels an outstanding sample on cleanup", async () => {
  const clock = new LiveClock(),
    controller = new AbortController();
  let calls = 0;
  const request: typeof fetch = async (_url, options) => {
    calls++;
    const signal = options!.signal!;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  };
  const pending = clock.sample(controller.signal, request);
  assert.equal(await clock.sample(controller.signal, request), null);
  assert.equal(calls, 1);
  controller.abort();
  assert.equal(await pending, null);
  assert.equal(await clock.sample(controller.signal, request), null);
  assert.equal(calls, 1);
});
