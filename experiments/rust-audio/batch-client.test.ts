import assert from "node:assert/strict";
import { test } from "node:test";
import { mixPcm } from "../../services/core/src/audio.ts";
import { fixture } from "./benchmark-suite.ts";
import { RustBatchWorker, MAX_BATCH_REQUEST_BYTES, MAX_BATCH_REPLY_BYTES } from "./batch-client.ts";
import { FRAME_BYTES, type MixInput } from "./worker-client.ts";

function inputs(count: number): MixInput[] {
  return Array.from({ length: count }, (_, index) => ({ ...fixture(index), b: index % 3 === 0 ? null : fixture(index + 9).b,
    progress: [-1, 0, 0.49999999999999994, 0.5, 0.5000000000000001, 1, 2, 0.37][index % 8],
    volume: [-1, 0, 49.99999999999999, 50, 50.00000000000001, 85, 100, 150][index % 8] }));
}
const reference = (input: MixInput) => mixPcm(input.a, input.b, input.progress, input.volume);
function fake(script: string, timeoutMs = 1000) {
  return new RustBatchWorker({ executable: process.execPath, args: ["-e", script], timeoutMs });
}
function responder(action: string) {
  return `let request=Buffer.alloc(0); process.stdin.on('data', chunk => {
    request=Buffer.concat([request,chunk]); if(request.length<16||request.length<16+request.readUInt32LE(12))return;
    const count=request[6], reply=Buffer.alloc(16+count*(8+3840));
    reply.write('APBT');reply[4]=1;reply[5]=129;reply[6]=count;reply.writeUInt32LE(request.readUInt32LE(8),8);reply.writeUInt32LE(reply.length-16,12);
    let cursor=16;for(let i=0;i<count;i++){const at=16+i*(8+3840);reply.writeUInt32LE(request.readUInt32LE(cursor+8),at);reply.writeUInt32LE(3840,at+4);reply.fill(23,at+8,at+8+3840);cursor+=32+request.readUInt32LE(cursor+12);}
    ${action}
  });`;
}

test("real bounded batches 1/4/8 preserve every frame's controls, exact PCM and ownership", async () => {
  assert.equal(MAX_BATCH_REQUEST_BYTES, 61712); assert.equal(MAX_BATCH_REPLY_BYTES, 30800);
  const worker = new RustBatchWorker();
  try {
    for (const count of [1, 4, 8]) {
      const batch = count === 1 ? [inputs(8)[5]] : inputs(count), expected = batch.map(reference);
      for (let repeat = 0; repeat < 20; repeat++) assert.deepEqual(await worker.mixBatch(batch), expected);
    }
    const batch = inputs(8), expected = batch.map(reference), pending = worker.mixBatch(batch);
    batch[7].a.fill(0); const result = await pending; assert.deepEqual(result, expected);
    await worker.mixBatch(inputs(8)); assert.deepEqual(result, expected, "later replies must not reuse returned storage");
    for (const bad of [[], inputs(2), inputs(9), [{ ...inputs(1)[0], a: Buffer.alloc(1) }], [{ ...inputs(1)[0], volume: NaN }]])
      await assert.rejects(worker.mixBatch(bad), /Invalid/);
    await assert.rejects(worker.mixBatch(inputs(1), AbortSignal.abort()), /cancelled/);
    assert.deepEqual(await worker.mixBatch(inputs(4)), inputs(4).map(reference));
  } finally { await worker.close(); }
  assert(worker.isClosed); await worker.close(); await assert.rejects(worker.mixBatch(inputs(1)), /closed/);
});

test("one pending maximum batch bounds backpressure and timeout reaps blocked input", async () => {
  const worker = fake("setInterval(()=>{},1000)", 150);
  const pending = worker.mixBatch(inputs(8)); const rejected = assert.rejects(pending, /timed out/);
  await assert.rejects(worker.mixBatch(inputs(8)), /outstanding/);
  await rejected; assert(worker.isClosed); assert.equal(worker.transportStats.requests, 1); await worker.close();
});

test("abort and closing a partial batch reject only after child and pipes close", async () => {
  for (const cancel of [true, false]) {
    const worker = fake("process.stdin.resume();setInterval(()=>{},1000)"); const controller = new AbortController();
    const rejected = assert.rejects(worker.mixBatch(inputs(8), controller.signal), /cancelled|closed during/);
    if (cancel) controller.abort(); else await worker.close();
    await rejected; assert(worker.isClosed); await worker.close();
  }
});

test("fragmented replies remain private until all frames validate; stderr stays bounded", async () => {
  const worker = fake(responder("process.stderr.write(Buffer.alloc(128*1024,120));process.stdout.write(reply.subarray(0,5));setTimeout(()=>process.stdout.write(reply.subarray(5)),10);"));
  try {
    assert.deepEqual(await worker.mixBatch(inputs(8)), Array.from({ length: 8 }, () => Buffer.alloc(FRAME_BYTES, 23)));
    assert(worker.diagnostics.length <= 4096);
  } finally { await worker.close(); }
});

test("invalid outer/last-frame IDs, lengths and oversized output never publish partial results", async () => {
  for (const action of [
    "reply.writeUInt32LE(99,8);process.stdout.write(reply);",
    "reply.writeUInt32LE(99,16+(count-1)*(8+3840));process.stdout.write(reply);",
    "reply.writeUInt32LE(1,20);process.stdout.write(reply);",
    "reply[6]=4;process.stdout.write(reply);",
    "process.stdout.write(Buffer.alloc(65536));",
  ]) {
    const worker = fake(responder(action)); await assert.rejects(worker.mixBatch(inputs(8)), /Invalid|oversized/);
    assert(worker.isClosed); await assert.rejects(worker.mixBatch(inputs(1))); await worker.close();
  }
  const fresh = new RustBatchWorker();
  try { assert.deepEqual(await fresh.mixBatch(inputs(8)), inputs(8).map(reference)); } finally { await fresh.close(); }
});

test("spawn failure, crash and truncated replies discard the entire batch", async () => {
  for (const worker of [
    new RustBatchWorker({ executable: "/afterparty-deliberately-missing-batch-worker" }),
    fake("process.stdin.once('data',()=>process.exit(7))"),
    fake(responder("process.stdout.write(reply.subarray(0,reply.length-1));process.stdin.destroy();")),
  ]) {
    await assert.rejects(worker.mixBatch(inputs(8))); assert(worker.isClosed); await worker.close();
  }
});

test("idle worker ignoring EOF is forcibly reaped and shutdown is repeatable", async () => {
  const worker = fake("process.stdin.resume();setInterval(()=>{},1000)", 150);
  await worker.close(); assert(worker.isClosed); await worker.close();
});
