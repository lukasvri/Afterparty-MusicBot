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

test("clock estimation adapts when the old fast network sample expires", () => {
  let monotonic = 1000;
  const clock = new LiveClock(() => monotonic, 10000);
  clock.record(clock.now() - 10, 50000);
  monotonic += 1000;
  clock.record(clock.now() - 500, 90000);
  assert.equal(clock.age(50000), 1005);
  monotonic += 60000;
  clock.record(clock.now() - 500, 90000);
  assert.equal(clock.age(90000), 250);
});

test("a lease-aware age exposes an expired snapshot instead of clamping it to a fresh one", () => {
  let monotonic = 1000;
  const clock = new LiveClock(() => monotonic, 10000);
  clock.record(clock.now(), 50000);
  monotonic += 8000;
  assert.equal(clock.age(50000, 7000), 7000);
  assert.equal(clock.age(NaN, 7000), 0);
  clock.reset();
  assert.equal(clock.age(50000), 0);
  clock.record(clock.now() - 300, 90000);
  assert.equal(clock.age(90000), 150);
});

test("an in-flight sample from a prior Core epoch cannot restore its clock offset", async () => {
  const clock = new LiveClock(() => 1000, 10000);
  let release: (response: Response) => void = () => assert.fail("sample did not start");
  const request: typeof fetch = async () => new Promise<Response>((resolve) => { release = resolve; });
  const pending = clock.sample(new AbortController().signal, request);
  clock.reset();
  release(Response.json({ serverTime: 90000 }));
  assert.equal(await pending, null);
  assert.equal(clock.age(89900), 0);
  assert.equal(await clock.sample(new AbortController().signal, async () => Response.json({ serverTime: 50000 })), 0);
  assert.equal(clock.age(49900), 100);
});

test("malformed clock replies leave the last good estimate intact", async () => {
  const clock = new LiveClock(() => 1000, 10000);
  clock.record(clock.now(), 50000);
  for (const value of [null, {}, { serverTime: "60000" }]) {
    assert.equal(await clock.sample(new AbortController().signal, async (_url, options) => {
      assert.equal(options?.cache, "no-store");
      return Response.json(value);
    }), null);
    assert.equal(clock.age(49900), 100);
  }
});
