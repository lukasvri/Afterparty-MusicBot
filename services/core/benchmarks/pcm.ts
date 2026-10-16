// Run: node services/core/benchmarks/pcm.ts
// Matches the PCM workload in experiments/rust-audio/src/main.rs on dev.
// Compare a release Rust build on the same host with the same frame contents,
// controls and checksum. This does not measure IPC, FFmpeg or Discord playback.
import assert from "node:assert/strict";
import { cpus } from "node:os";
import { FRAME_BYTES, mixPcm } from "../src/audio.ts";

const iterations = 30_000;
const warmup = 3_000;
const rounds = 5;
const volume = 85;
const expectedChecksum = 3_780_300;
const first = Buffer.alloc(FRAME_BYTES);
const second = Buffer.alloc(FRAME_BYTES);

assert.equal(FRAME_BYTES, 3_840, "The Rust workload uses 3,840-byte PCM frames.");
for (let offset = 0; offset < FRAME_BYTES; offset += 2) {
  first.writeInt16LE(1_000, offset);
  second.writeInt16LE(-1_000, offset);
}

// Warm up the actual Core implementation before timing V8's steady state.
for (let n = 0; n < warmup; n++) {
  mixPcm(first, second, (n % 100) / 100, volume);
}

type Sample = {
  round: number;
  elapsedMs: number;
  microsecondsPerFrame: number;
  framesPerSecond: number;
  checksum: number;
};

const samples: Sample[] = [];
for (let round = 1; round <= rounds; round++) {
  let checksum = 0;
  const started = performance.now();
  for (let n = 0; n < iterations; n++) {
    const output = mixPcm(first, second, (n % 100) / 100, volume);
    // The Rust benchmark consumes this same changing byte from every result.
    checksum += output[n % FRAME_BYTES];
  }
  const elapsedMs = performance.now() - started;
  assert.equal(checksum, expectedChecksum, "PCM benchmark output changed.");
  samples.push({
    round,
    elapsedMs,
    microsecondsPerFrame: (elapsedMs * 1_000) / iterations,
    framesPerSecond: (iterations * 1_000) / elapsedMs,
    checksum,
  });
}

const median = samples.toSorted((a, b) => a.elapsedMs - b.elapsedMs)[
  Math.floor(rounds / 2)
];
const processors = cpus();
console.log(
  JSON.stringify(
    {
      scope: "Synthetic PCM mixing only, not end-to-end audio or voice capacity.",
      implementation: "Current TypeScript Core mixPcm, imported without copying.",
      comparison: {
        rust: "experiments/rust-audio/src/main.rs on dev, release build",
        checksum: expectedChecksum,
        limitations: [
          "No Rust result is measured by this script.",
          "Rust's existing benchmark reports one run; repeat it for comparable medians.",
          "Use the same host, workload and load conditions for both implementations.",
          "Microseconds per frame is a round mean, not p95/p99 scheduling latency.",
          "FFmpeg, pipes, provider I/O, buffering and Discord transport are excluded.",
          "Do not benchmark on the production host while playback is active.",
        ],
      },
      environment: {
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        cpu: processors[0]?.model ?? "unknown",
        logicalCpus: processors.length,
      },
      workload: {
        iterations,
        warmup,
        rounds,
        frameBytes: FRAME_BYTES,
        frameDurationMs: 20,
        sampleRateHz: 48_000,
        channels: 2,
        encoding: "signed 16-bit little-endian PCM",
        firstSample: 1_000,
        secondSample: -1_000,
        progress: "(n % 100) / 100",
        volume,
      },
      median: {
        elapsedMs: median.elapsedMs,
        microsecondsPerFrame: median.microsecondsPerFrame,
        framesPerSecond: median.framesPerSecond,
      },
      samples,
    },
    null,
    2,
  ),
);
