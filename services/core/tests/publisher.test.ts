import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { Store } from "../src/store.ts";
import { Providers } from "../src/providers.ts";
import { Engine } from "../src/engine.ts";
import { Commands } from "../src/commands.ts";
import { Publisher } from "../src/publisher.ts";
import type { Sink } from "../src/audio.ts";
import type { PublicTrack } from "../src/types.ts";
import { deferred } from "./deferred.ts";

const video: PublicTrack = {
  id: "abcdefghijk", title: "Synthetic concert", artist: "Test artist",
  image: "", duration: 100, live: false, embeddable: true, concert: true,
};

function fixture() {
  const store = new Store(":memory:");
  const sink: Sink = {
    onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {},
    duration: () => 0, advancing: () => false, buffering: () => false,
  };
  const engine = new Engine(store, new Providers(store, {}), sink);
  clearInterval(engine.timer);
  const commands = new Commands(engine);
  return {
    store, engine, commands,
    close() { commands.close(); engine.close(); store.close(); },
  };
}

test("publisher validates replies before acknowledging and keeps private music off the bridge", async (t) => {
  const f = fixture();
  let monotonic = 1000;
  t.mock.method(performance, "now", () => monotonic);
  t.mock.method(console, "warn", () => {});
  f.store.record("concert", video);
  f.store.record("private", { ...video, title: "Private song", concert: false });
  f.store.job("result", { bridge: true });
  f.store.finishJob("result", "done", "Synthetic result");
  f.engine.current = { ...video, entryId: "private-entry", title: "Private song", concert: false, requestedBy: "synthetic-private-requester" };
  f.engine.queue = [{ ...video, entryId: "concert-entry", requestedBy: "synthetic-private-requester" }];
  const requests: string[] = [];
  let reply: unknown = { commands: [] };
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(String(init.body));
    return Response.json(reply);
  });
  const publisher = new Publisher(f.engine, f.commands, "https://synthetic.invalid", "test-key", { guildId: "synthetic-guild" });
  try {
    await setImmediate();
    assert.equal(publisher.running, false);
    assert.equal(requests.length, 1);
    assert.doesNotMatch(requests[0], /Private song|private-requester/);
    const sent = JSON.parse(requests[0]);
    assert.equal(sent.state.current, null);
    assert.equal(sent.state.queue.length, 1);
    assert.deepEqual(sent.events.map((event: { id: string }) => event.id), ["concert"]);
    assert.equal(f.store.events().length, 2);
    assert.equal(f.store.bridgeResults().length, 1);
    assert.equal(publisher.offset, 0);
    reply = { serverTime: Date.now(), commands: [] };
    monotonic += 5000;
    await publisher.sync();
    assert.equal(requests.length, 2);
    assert.equal(f.store.events().length, 0);
    assert.equal(f.store.bridgeResults().length, 0);
    assert.equal(f.store.history().length, 2);
  } finally { publisher.close(); f.close(); }
});

for (const malformed of [
  { serverTime: 1000 },
  { serverTime: "1000", commands: [] },
  { serverTime: 1000, commands: [{ id: "synthetic", action: "pause" }] },
  { serverTime: 1000, commands: [null] },
]) test("malformed bridge response cannot mark history as sent: " + JSON.stringify(malformed), async (t) => {
  const f = fixture();
  f.store.record("concert", video);
  t.mock.method(console, "warn", () => {});
  t.mock.method(globalThis, "fetch", async () => Response.json(malformed));
  const execute = t.mock.method(f.commands, "execute", async () => "Unexpected");
  const publisher = new Publisher(f.engine, f.commands, "https://synthetic.invalid", "test-key");
  try {
    await setImmediate();
    assert.equal(f.store.events().length, 1);
    assert.equal(f.store.jobs().length, 0);
    assert.equal(execute.mock.callCount(), 0);
  } finally { publisher.close(); f.close(); }
});

for (const localTime of [400000, 1600000]) test(`bridge command expiry uses the website clock with host time ${localTime}`, async (t) => {
  const f = fixture();
  t.mock.method(Date, "now", () => localTime);
  t.mock.method(performance, "now", () => 1000);
  const calls: { id: unknown; scope: unknown }[] = [];
  t.mock.method(f.commands, "execute", async (input: Record<string, unknown>, scope: string) => {
    calls.push({ id: input.id, scope });
    return "Applied once";
  });
  const jobs = [
    { id: "public:valid", action: "pause", expiresAt: 1030000 },
    { id: "expired", action: "pause", expiresAt: 999999 },
  ];
  t.mock.method(globalThis, "fetch", async () => Response.json({ serverTime: 1000000, commands: jobs }));
  const publisher = new Publisher(f.engine, f.commands, "https://synthetic.invalid", "test-key");
  try {
    await setImmediate();
    assert.deepEqual(calls, [{ id: "public:valid", scope: "public" }]);
    assert.equal(f.store.jobs().find(job => job.id === "public:valid")?.status, "done");
    assert.equal(f.store.jobs().find(job => job.id === "expired")?.status, "failed");
    assert.equal(publisher.offset, 1000000 - localTime);
    await publisher.sync();
    assert.equal(calls.length, 1, "a retried bridge response must not execute the job again");
  } finally { publisher.close(); f.close(); }
});

test("publisher coalesces changes, sends one request at a time and backs off failed requests", async (t) => {
  const f = fixture();
  let monotonic = 1000;
  t.mock.method(performance, "now", () => monotonic);
  t.mock.method(console, "warn", () => {});
  const first = deferred<Response>();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++calls === 1) return first.promise;
    throw new Error("Synthetic outage");
  });
  const publisher = new Publisher(f.engine, f.commands, "https://synthetic.invalid", "test-key");
  try {
    for (let i = 0; i < 100; i++) f.engine.changed();
    await publisher.sync();
    assert.equal(calls, 1);
    first.reject(new Error("Synthetic outage"));
    await setImmediate();
    for (const delay of [5000, 10000, 20000, 30000, 30000]) {
      for (let i = 0; i < 100; i++) f.engine.changed();
      const before: number = calls;
      monotonic += delay - 1;
      await publisher.sync();
      assert.equal(calls, before, "changes must respect the retry delay");
      monotonic++;
      await publisher.sync();
      assert.equal(calls, before + 1);
    }
  } finally { publisher.close(); f.close(); }
});

test("bridge sampling recovers when the host wall clock changes during a request", async (t) => {
  const f = fixture();
  let wallClock = 1000000;
  let monotonic = 1000;
  t.mock.method(Date, "now", () => wallClock);
  t.mock.method(performance, "now", () => monotonic);
  const samples: number[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    samples.push(JSON.parse(String(init.body)).sampledAt);
    if (samples.length === 1) {
      monotonic += 200;
      wallClock += 300200;
      return Response.json({ serverTime: 1000100, commands: [] });
    }
    return Response.json({ serverTime: 1000200, commands: [] });
  });
  const publisher = new Publisher(f.engine, f.commands, "https://synthetic.invalid", "test-key");
  try {
    await setImmediate();
    assert.equal(publisher.offset, -300000);
    await publisher.sync();
    assert.deepEqual(samples, [1000000, 1000200]);
  } finally { publisher.close(); f.close(); }
});

test("closing the publisher aborts its request and ignores a late reply after the database closes", async (t) => {
  const f = fixture();
  const response = deferred<Response>();
  let signal: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", (_url: unknown, init: RequestInit) => {
    signal = init.signal;
    return response.promise;
  });
  const execute = t.mock.method(f.commands, "execute", async () => "Unexpected");
  const acknowledge = t.mock.method(f.store, "acknowledge");
  const publisher = new Publisher(f.engine, f.commands, "https://synthetic.invalid", "test-key");
  assert.equal(signal?.aborted, false);
  publisher.close();
  assert.equal(signal?.aborted, true);
  f.close();
  response.resolve(Response.json({ serverTime: Date.now(), commands: [{ id: "late", action: "pause", expiresAt: Date.now() + 30000 }] }));
  await setImmediate();
  assert.equal(execute.mock.callCount(), 0);
  assert.equal(acknowledge.mock.callCount(), 0);
  assert.equal(publisher.running, false);
});

test("a command that finishes after publisher closure does not write to a closed database", async (t) => {
  const f = fixture();
  const result = deferred<string>();
  t.mock.method(f.commands, "execute", () => result.promise);
  const finish = t.mock.method(f.store, "finishJob");
  t.mock.method(globalThis, "fetch", async () => Response.json({ serverTime: Date.now(), commands: [{ id: "pending", action: "pause", expiresAt: Date.now() + 30000 }] }));
  const publisher = new Publisher(f.engine, f.commands, "https://synthetic.invalid", "test-key");
  await setImmediate();
  assert.equal(f.store.jobs()[0]?.status, "processing");
  publisher.close();
  f.close();
  result.resolve("Finished after shutdown");
  await setImmediate();
  assert.equal(finish.mock.callCount(), 0);
});
