// Isolated microbenchmarks, not a Discord capacity or audibility test.
// Run: node services/core/benchmarks/audio-store.ts
import assert from "node:assert/strict";
import { cpus } from "node:os";
import { mixPcm, FRAME_BYTES } from "../src/audio.ts";
import { Store } from "../src/store.ts";

const iterations = 10000,
  rounds = 5,
  warmup = 1000;
const packet = Buffer.alloc(FRAME_BYTES, 1),
  store = new Store(":memory:");
store.set("synthetic", { queue: ["synthetic"], volume: 100 });
// The former loop at unity gain, using the same packet and sample arithmetic.
function sampleLoop() {
  const out = Buffer.allocUnsafe(FRAME_BYTES);
  for (let i = 0; i < FRAME_BYTES; i += 2)
    out.writeInt16LE(
      Math.max(-32768, Math.min(32767, Math.round(packet.readInt16LE(i)))),
      i,
    );
  return out;
}
const operations = {
  pcmSampleLoop: sampleLoop,
  pcmUnity: () => mixPcm(packet, null, 0, 100),
  storeCompilePerRead: () =>
    JSON.parse(
      String(
        store.db.prepare("SELECT value FROM kv WHERE key=?").get("synthetic")!
          .value,
      ),
    ),
  storeReusedRead: () => store.get("synthetic", null),
};
try {
  assert.deepEqual(operations.pcmSampleLoop(), operations.pcmUnity());
  assert.deepEqual(
    operations.storeCompilePerRead(),
    operations.storeReusedRead(),
  );
  const samples = Object.fromEntries(
    Object.keys(operations).map((name) => [name, [] as number[]]),
  );
  for (const run of Object.values(operations))
    for (let i = 0; i < warmup; i++) run();
  let checksum = 0;
  for (let round = 0; round < rounds; round++)
    for (const [name, run] of Object.entries(operations)) {
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const value = run();
        checksum += Buffer.isBuffer(value) ? value.readInt16LE(0) : value!.volume;
      }
      samples[name].push(performance.now() - start);
    }
  console.log(
    JSON.stringify(
      {
        checksum,
      environment: {
          node: process.versions.node,
          sqlite: process.versions.sqlite,
          cpu: cpus()[0]?.model,
        },
        workload: {
          iterations,
          rounds,
          warmup,
          database: ":memory:",
          frameBytes: FRAME_BYTES,
        },
        results: Object.entries(samples).map(([name, values]) => ({
          name,
          medianMs: values.toSorted((a, b) => a - b)[Math.floor(rounds / 2)],
          samplesMs: values,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
