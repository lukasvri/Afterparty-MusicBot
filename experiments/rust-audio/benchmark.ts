// Offline synthetic comparison. Never starts Core, FFmpeg, or Discord.
import assert from "node:assert/strict";
import { cpus, platform, arch } from "node:os";
import { mixPcm } from "../../services/core/src/audio.ts";
import { FRAME_BYTES, RustAudioWorker } from "./worker-client.ts";

const frames = Number(process.argv[2] ?? 5000);
if (!Number.isSafeInteger(frames) || frames < 100 || frames > 1_000_000)
  throw new RangeError("Frame count must be an integer between 100 and 1000000");
const a = Buffer.alloc(FRAME_BYTES), b = Buffer.alloc(FRAME_BYTES);
for (let i = 0; i < FRAME_BYTES; i += 2) {
  a.writeInt16LE((i * 97 % 65536) - 32768, i);
  b.writeInt16LE((i * 37 % 65536) - 32768, i);
}
const input = { a, b, progress: 0.37, volume: 85 };
const reference = mixPcm(a, b, input.progress, input.volume);
function summary(samples: number[], elapsedMs: number, cpu: NodeJS.CpuUsage) {
  samples.sort((x, y) => x - y);
  const at = (p: number) => samples[Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1)];
  return { frames, elapsedMs, framesPerSecond: frames / elapsedMs * 1000,
    p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), maxMs: samples.at(-1),
    parentCpuMs: (cpu.user + cpu.system) / 1000 };
}
// Warm both implementations before sampling. Startup remains separately measured.
for (let i = 0; i < 500; i++) mixPcm(a, b, input.progress, input.volume);
const startup = performance.now();
const worker = new RustAudioWorker({ timeoutMs: 10_000 });
try {
  assert.deepEqual(await worker.mix(input), reference);
  const startupFirstReplyMs = performance.now() - startup;
  for (let i = 0; i < 500; i++) await worker.mix(input);
  const tsSamples: number[] = [], rustSamples: number[] = [];
  let cpu = process.cpuUsage(), start = performance.now();
  for (let i = 0; i < frames; i++) {
    const one = performance.now();
    const output = mixPcm(a, b, input.progress, input.volume);
    assert.equal(output.length, FRAME_BYTES);
    tsSamples.push(performance.now() - one);
  }
  const typescript = summary(tsSamples, performance.now() - start, process.cpuUsage(cpu));
  cpu = process.cpuUsage(); start = performance.now();
  for (let i = 0; i < frames; i++) {
    const one = performance.now();
    const output = await worker.mix(input);
    assert.equal(output.length, FRAME_BYTES);
    rustSamples.push(performance.now() - one);
  }
  const rustIpc = summary(rustSamples, performance.now() - start, process.cpuUsage(cpu));
  console.log(JSON.stringify({ scope: "synthetic serial 20ms stereo PCM; parent CPU excludes Rust child",
    node: process.version, os: platform(), arch: arch(), cpu: cpus()[0]?.model,
    startupFirstReplyMs, typescript, rustIpc }, null, 2));
} finally { await worker.close(); }
