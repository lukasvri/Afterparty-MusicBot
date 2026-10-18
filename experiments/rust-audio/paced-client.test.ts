import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { PacedBatchQueue } from "./paced-client.ts";
import { RustBatchWorker } from "./batch-client.ts";
import { FRAME_BYTES, type MixInput } from "./worker-client.ts";

function input(index = 0): MixInput {
  const a = Buffer.alloc(FRAME_BYTES), b = Buffer.alloc(FRAME_BYTES);
  for (let offset = 0; offset < FRAME_BYTES; offset += 2) {
    a.writeInt16LE(1001 + index, offset); b.writeInt16LE(-1000 + index, offset);
  }
  return { a, b: index % 3 === 0 ? null : b,
    progress: [-1, 0, 0.5, 1, 2][index % 5], volume: [0, 50, 85, 100, 150][index % 5] };
}
const echo = async (inputs: MixInput[]) => inputs.map(value => value.a);
function clock(t: TestContext) {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  return (ms: number) => { now += ms; t.mock.timers.tick(ms); };
}
function heldBackend() {
  const calls: { inputs: MixInput[]; signal: AbortSignal;
    resolve: (outputs: Buffer[]) => void; reject: (error: Error) => void }[] = [];
  const mix = (inputs: MixInput[], signal: AbortSignal) => new Promise<Buffer[]>((resolve, reject) => {
    calls.push({ inputs, signal, resolve, reject });
  });
  return { calls, mix };
}

test("paced controls reject invalid configuration/input without poisoning healthy work", async () => {
  for (const batchSize of [0, 2, 3, 16, NaN]) assert.throws(() =>
    new PacedBatchQueue({ batchSize: batchSize as 1, maxWaitMs: 0, mix: echo }), /Invalid/);
  for (const maxWaitMs of [-1, 1001, Infinity, NaN]) assert.throws(() =>
    new PacedBatchQueue({ batchSize: 1, maxWaitMs, mix: echo }), /Invalid/);
  const queue = new PacedBatchQueue({ batchSize: 1, maxWaitMs: 0, mix: echo });
  for (const bad of [{ ...input(), a: Buffer.alloc(1) }, { ...input(), b: Buffer.alloc(1) },
    { ...input(), progress: Infinity }, { ...input(), volume: NaN }]) await assert.rejects(queue.push(bad), /Invalid/);
  assert.deepEqual(await queue.push(input()), input().a);
  await queue.finish(); await assert.rejects(queue.push(input()), /finished/); await queue.close();
});

test("20ms arrivals cannot dispatch an eight-frame target before all eight exist", async t => {
  const advance = clock(t), backend = heldBackend();
  const queue = new PacedBatchQueue({ batchSize: 8, maxWaitMs: 200, mix: backend.mix });
  const pending: Promise<Buffer>[] = [];
  for (let index = 0; index < 8; index++) {
    if (index) advance(20);
    pending.push(queue.push(input(index))); await yieldTurn();
    assert.equal(backend.calls.length, index === 7 ? 1 : 0);
  }
  assert.deepEqual(backend.calls[0].inputs.map(value => value.a.readInt16LE()), Array.from({ length: 8 }, (_, index) => 1001 + index));
  assert.equal(queue.stats.inFlight, 8);
  backend.calls[0].resolve(backend.calls[0].inputs.map(value => value.a));
  await Promise.all(pending); await queue.finish(); await queue.close();
});

test("oldest deadlines dispatch supported partial counts and never reset on later arrivals", async t => {
  const advance = clock(t), sizes: number[] = [];
  const queue = new PacedBatchQueue({ batchSize: 8, maxWaitMs: 100,
    mix: async inputs => { sizes.push(inputs.length); return echo(inputs); } });
  const first = queue.push(input(0)); advance(20);
  const second = queue.push(input(1)); advance(20);
  const third = queue.push(input(2)); advance(59); await yieldTurn(); assert.deepEqual(sizes, []);
  advance(1); await first; assert.deepEqual(sizes, [1]);
  advance(20); await second; assert.deepEqual(sizes, [1, 1]);
  advance(20); await third; assert.deepEqual(sizes, [1, 1, 1]);
  await queue.finish(); await queue.close();
});

test("finish drains a six-frame tail as 4/1/1 without future input or collection waits", async t => {
  clock(t); const sizes: number[] = [];
  const queue = new PacedBatchQueue({ batchSize: 8, maxWaitMs: 1000,
    mix: async inputs => { sizes.push(inputs.length); return echo(inputs); } });
  const pending = Array.from({ length: 6 }, (_, index) => queue.push(input(index)));
  const finished = queue.finish(); await assert.rejects(queue.push(input()), /finished/);
  await finished; assert.deepEqual(sizes, [4, 1, 1]);
  assert.deepEqual(await Promise.all(pending), Array.from({ length: 6 }, (_, index) => input(index).a));
  assert.equal(queue.stats.queued, 0); assert.equal(queue.stats.inFlight, 0);
  assert.equal(queue.finish(), finished); await queue.close();
});

test("exactly eight queued plus eight in flight bounds overflow and preserves FIFO", async t => {
  clock(t); const backend = heldBackend();
  const queue = new PacedBatchQueue({ batchSize: 8, maxWaitMs: 1000, mix: backend.mix });
  const pending = Array.from({ length: 16 }, (_, index) => queue.push(input(index)));
  await yieldTurn(); assert.equal(backend.calls.length, 1);
  assert.deepEqual(queue.stats, { queued: 8, inFlight: 8, maxQueuedObserved: 8, maxInFlightObserved: 8 });
  await assert.rejects(queue.push(input(99)), /capacity/);
  backend.calls[0].resolve(backend.calls[0].inputs.map(value => value.a));
  await yieldTurn(); assert.equal(backend.calls.length, 2); assert.equal(queue.stats.queued, 0);
  backend.calls[1].resolve(backend.calls[1].inputs.map(value => value.a));
  assert.deepEqual((await Promise.all(pending)).map(frame => frame.readInt16LE()), Array.from({ length: 16 }, (_, index) => 1001 + index));
  await queue.finish(); await queue.close();
});

test("push snapshots independent PCM/controls and outputs never share backend storage", async () => {
  const backend = heldBackend();
  const queue = new PacedBatchQueue({ batchSize: 4, maxWaitMs: 1000, mix: backend.mix });
  const sources = Array.from({ length: 4 }, (_, index) => input(index + 1));
  const snapshots = sources.map(value => ({ ...value, a: Buffer.from(value.a), b: value.b && Buffer.from(value.b) }));
  const pending = sources.map(value => queue.push(value));
  for (const source of sources) { source.a.fill(0); source.b?.fill(0); source.volume = 0; source.progress = 0; }
  await yieldTurn(); assert.deepEqual(backend.calls[0].inputs, snapshots);
  const shared = Buffer.alloc(FRAME_BYTES, 23); backend.calls[0].resolve(Array(4).fill(shared));
  const outputs = await Promise.all(pending); shared.fill(55); outputs[0].fill(77);
  assert.deepEqual(outputs[1], Buffer.alloc(FRAME_BYTES, 23));
  assert.deepEqual(outputs[2], Buffer.alloc(FRAME_BYTES, 23));
  await queue.finish(); await queue.close();
});

test("close aborts queued and active work, rejects finish, and discards late replies", async () => {
  const backend = heldBackend();
  const queue = new PacedBatchQueue({ batchSize: 1, maxWaitMs: 0, mix: backend.mix });
  let published = 0;
  const pending = Array.from({ length: 4 }, (_, index) => queue.push(input(index)).then(value => { published++; return value; }));
  const rejected = pending.map(value => assert.rejects(value, /closed/));
  await yieldTurn(); const finished = assert.rejects(queue.finish(), /closed/);
  const closed = queue.close(); assert.equal(queue.close(), closed); assert(backend.calls[0].signal.aborted);
  await Promise.all(rejected); await finished;
  backend.calls[0].resolve([Buffer.alloc(FRAME_BYTES, 91)]); await closed; await yieldTurn();
  assert.equal(published, 0); assert.equal(backend.calls.length, 1);
  await assert.rejects(queue.push(input()), /closed/);
});

test("close before dispatch microtask never invokes a stale backend", async () => {
  let calls = 0;
  const queue = new PacedBatchQueue({ batchSize: 1, maxWaitMs: 0, mix: async inputs => { calls++; return echo(inputs); } });
  const rejected = assert.rejects(queue.push(input()), /closed/);
  await queue.close(); await rejected; assert.equal(calls, 0);
});

test("uncooperative backends cannot hold close beyond its bounded cleanup grace", async t => {
  const advance = clock(t), backend = heldBackend();
  const queue = new PacedBatchQueue({ batchSize: 1, maxWaitMs: 0, mix: backend.mix });
  const rejected = assert.rejects(queue.push(input()), /closed/); await yieldTurn();
  let done = false; const closed = queue.close().then(() => { done = true; });
  await rejected; advance(999); await yieldTurn(); assert.equal(done, false);
  advance(1); await closed; assert.equal(done, true); assert(backend.calls[0].signal.aborted);
  backend.calls[0].resolve([Buffer.alloc(FRAME_BYTES)]); await yieldTurn();
});

test("backend failures and malformed complete replies terminally reject every pending frame", async () => {
  for (const result of [new Error("backend failed"), [], [Buffer.alloc(1)]]) {
    const backend = heldBackend();
    const queue = new PacedBatchQueue({ batchSize: 1, maxWaitMs: 0, mix: backend.mix });
    const rejected = Array.from({ length: 3 }, (_, index) => assert.rejects(queue.push(input(index)), /backend|Invalid/));
    const finished = assert.rejects(queue.finish(), /backend|Invalid/); await yieldTurn();
    if (result instanceof Error) backend.calls[0].reject(result); else backend.calls[0].resolve(result);
    await Promise.all(rejected); await finished; assert(backend.calls[0].signal.aborted);
    await assert.rejects(queue.push(input()), /backend|Invalid/); await queue.close();
  }
});

test("real Rust parity survives per-frame snapshots, eight-frame batches and partial EOF", async () => {
  const worker = new RustBatchWorker();
  const sizes: number[] = [], queue = new PacedBatchQueue({ batchSize: 8, maxWaitMs: 1000,
    mix: (inputs, signal) => { sizes.push(inputs.length); return worker.mixBatch(inputs, signal); } });
  try {
    const sources = Array.from({ length: 8 }, (_, index) => input(index));
    const expected = await worker.mixBatch(sources);
    const pending = sources.map(value => queue.push(value));
    for (const source of sources) { source.a.fill(0); source.b?.fill(0); source.volume = 0; }
    assert.deepEqual(await Promise.all(pending), expected);
    const tail = Array.from({ length: 6 }, (_, index) => input(index + 2));
    const tailExpected = [...await worker.mixBatch(tail.slice(0, 4)), ...await worker.mixBatch(tail.slice(4, 5)), ...await worker.mixBatch(tail.slice(5))];
    const tailPending = tail.map(value => queue.push(value)); await queue.finish();
    assert.deepEqual(await Promise.all(tailPending), tailExpected); assert.deepEqual(sizes, [8, 4, 1, 1]);
  } finally { await queue.close(); await worker.close(); }
  assert(worker.isClosed);
});

test("closing an active signal-observing worker waits for its actual child cleanup", async () => {
  const worker = new RustBatchWorker({ executable: process.execPath,
    args: ["-e", "process.stdin.resume();setInterval(()=>{},1000)"], timeoutMs: 1000 });
  const queue = new PacedBatchQueue({ batchSize: 1, maxWaitMs: 0, mix: (inputs, signal) => worker.mixBatch(inputs, signal) });
  try {
    const rejected = assert.rejects(queue.push(input()), /closed/); await yieldTurn();
    await queue.close(); await rejected; assert(worker.isClosed);
  } finally { await worker.close(); }
});
