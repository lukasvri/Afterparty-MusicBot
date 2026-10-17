import assert from "node:assert/strict";
import { test } from "node:test";
import { mixPcm } from "../../services/core/src/audio.ts";
import { FRAME_BYTES, RustAudioWorker } from "./worker-client.ts";

const input = { a: Buffer.alloc(FRAME_BYTES, 15), b: Buffer.alloc(FRAME_BYTES, 2), progress: 0.3, volume: 70 };
function fake(script: string, timeoutMs = 1000) {
  return new RustAudioWorker({ executable: process.execPath, args: ["-e", script], timeoutMs });
}

test("persistent real Rust process matches Core and closes all pipes", async () => {
  const worker = new RustAudioWorker();
  try {
    assert(worker.pid);
    for (let i = 0; i < 100; i++)
      assert.deepEqual(await worker.mix(input), mixPcm(input.a, input.b, input.progress, input.volume));
    // Rejected local input does not poison the worker.
    await assert.rejects(worker.mix({ ...input, a: Buffer.alloc(1) }), /Invalid PCM/);
    assert.deepEqual(await worker.mix(input), mixPcm(input.a, input.b, input.progress, input.volume));
  } finally { await worker.close(); }
  assert(worker.isClosed);
  await worker.close();
  await assert.rejects(worker.mix(input), /closed/);
});

test("deadline kills and reaps a worker that never reads stdin", async () => {
  const worker = fake("setInterval(() => {}, 1000)", 150);
  const start = performance.now();
  await assert.rejects(worker.mix(input), /timed out/);
  assert(worker.isClosed, "mix rejection must wait for child and pipe cleanup");
  assert(performance.now() - start < 5000);
  await worker.close();
});

test("one outstanding request is the queue bound and abort reaps the child", async () => {
  const worker = fake("process.stdin.resume(); setInterval(() => {}, 1000)");
  const controller = new AbortController();
  const pending = worker.mix(input, controller.signal);
  const rejected = assert.rejects(pending, /cancelled/);
  await assert.rejects(worker.mix(input), /outstanding/);
  controller.abort();
  await rejected;
  assert(worker.isClosed);
  await worker.close();
});

test("pre-aborted requests do not kill a healthy worker", async () => {
  const worker = new RustAudioWorker();
  try {
    await assert.rejects(worker.mix(input, AbortSignal.abort()), /cancelled/);
    assert.equal((await worker.mix(input)).length, FRAME_BYTES);
  } finally { await worker.close(); }
});

test("spawn failure, crashes and truncated output reject after cleanup", async () => {
  for (const worker of [
    new RustAudioWorker({ executable: "/afterparty-deliberately-missing-worker" }),
    fake("process.stdin.once('data', () => process.exit(7))"),
    fake("process.stdin.once('data', () => { process.stdout.write(Buffer.alloc(10)); process.exitCode = 1; process.stdin.destroy(); })"),
  ]) {
    await assert.rejects(worker.mix(input));
    assert(worker.isClosed);
    await worker.close();
  }
});

test("invalid headers, wrong IDs and excessive output are terminal", async () => {
  for (const script of [
    "process.stdout.write(Buffer.alloc(3856))",
    "const b = Buffer.alloc(3856); b.write('APCM'); b[4]=1; b[5]=129; b.writeUInt32LE(9,8); b.writeUInt32LE(3840,12); process.stdout.write(b)",
    "process.stdout.write(Buffer.alloc(65536))",
  ]) {
    const worker = fake(`process.stdin.once('data', () => { ${script}; }); setInterval(() => {}, 1000)`);
    await assert.rejects(worker.mix(input), /Invalid|oversized/);
    assert(worker.isClosed);
  }
});

test("fragmented valid replies resolve and stderr storage stays bounded", async () => {
  const worker = fake(`process.stdin.once('data', (request) => {
    process.stderr.write(Buffer.alloc(128 * 1024, 120));
    const reply = Buffer.alloc(3856); reply.write('APCM'); reply[4]=1; reply[5]=129;
    reply.writeUInt32LE(request.readUInt32LE(8),8); reply.writeUInt32LE(3840,12);
    process.stdout.write(reply.subarray(0,5));
    setTimeout(() => process.stdout.write(reply.subarray(5)),10);
  }); process.stdin.resume();`);
  try {
    assert.equal((await worker.mix(input)).length, FRAME_BYTES);
    assert(worker.diagnostics.length <= 4096);
    assert(worker.diagnostics.length > 0);
  } finally { await worker.close(); }
  assert(worker.isClosed);
});

test("shutdown reaps children with an incomplete request or ignored EOF", async () => {
  const pendingWorker = fake("process.stdin.resume(); setInterval(() => {}, 1000)");
  const pending = assert.rejects(pendingWorker.mix(input), /closed during/);
  await pendingWorker.close();
  await pending;
  assert(pendingWorker.isClosed);
  const idleWorker = fake("process.stdin.resume(); setInterval(() => {}, 1000)", 150);
  await idleWorker.close();
  assert(idleWorker.isClosed);
});
