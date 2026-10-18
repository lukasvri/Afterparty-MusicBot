// Offline arrival-aware PCM experiment. Never connects to Core or Discord.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cpus, platform, release, arch } from "node:os";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { mixPcm } from "../../services/core/src/audio.ts";
import { PacedBatchQueue } from "./paced-client.ts";
import { RustAudioWorker, defaultExecutable, FRAME_BYTES, type MixInput } from "./worker-client.ts";
import { RustBatchWorker } from "./batch-client.ts";
import { batchFixtures } from "./batch-benchmark.ts";
import { percentiles } from "./benchmark-suite.ts";
import { measurementProcess } from "./benchmark-process.ts";
import { processCpu, cpuDelta } from "./process-cpu.ts";

export const PACED_POLICIES = [
  { mode: "typescript", batchSize: 1, maxWaitMs: 0 },
  { mode: "rust-v1", batchSize: 1, maxWaitMs: 0 },
  { mode: "batch-4", batchSize: 4, maxWaitMs: 80 },
  { mode: "batch-8", batchSize: 8, maxWaitMs: 160 },
  { mode: "batch-8-deadline-10", batchSize: 8, maxWaitMs: 10 },
] as const;
const INTERVAL_MS = 20;

export function pacedOptions(args: string[]) {
  if (args.length > 3) throw new RangeError("Usage: paced-benchmark.ts [frames=250] [repeats=3] [guilds=1,4]");
  const integer = (value: string | undefined, fallback: number, min: number, max: number) => {
    const parsed = value === undefined ? fallback : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new RangeError("Invalid bounded paced configuration");
    return parsed;
  };
  const frames = integer(args[0], 250, 8, 3000), repeats = integer(args[1], 3, 1, 5);
  const guilds = (args[2] ?? "1,4").split(",").map(value => integer(value, 1, 1, 4));
  if (guilds.length > 2 || new Set(guilds).size !== guilds.length) throw new RangeError("Use at most two distinct guild counts");
  return { frames, repeats, guilds, intervalMs: INTERVAL_MS };
}

type Sample = { arrival: number; scheduled: number; submitted: number; changed: boolean };
export async function pacedRun(mode: string, config: ReturnType<typeof pacedOptions>, signal: AbortSignal) {
  const policy = PACED_POLICIES.find(value => value.mode === mode);
  if (!policy) throw new RangeError("Unknown paced mode");
  if (config.guilds.length !== 1) throw new RangeError("A fresh process owns exactly one guild count");
  const guilds = config.guilds[0], fixtures = Array.from({ length: guilds }, (_, guild) => batchFixtures(guild));
  const expected = fixtures.map(frames => frames.map(input => mixPcm(input.a, input.b, input.progress, input.volume)));
  const workers: (RustAudioWorker | RustBatchWorker)[] = [], queues: PacedBatchQueue[] = [];
  const waiting: Sample[][] = Array.from({ length: guilds }, () => []);
  const batchHistogram: Record<string, number> = {}, firstReplyMs: number[] = [];
  const completedPerGuild = Array(guilds).fill(0) as number[], missed20MsPerGuild = Array(guilds).fill(0) as number[];
  const arrivalLateness: number[] = [], queueWait: number[] = [], service: number[] = [], completion: number[] = [], scheduledCompletion: number[] = [], controlCompletion: number[] = [];
  let requestProtocolBytes = 0, replyProtocolBytes = 0;
  let failure: unknown, verifiedFrames = 0, maxOutstanding = 0, outstanding = 0;
  const cancel = () => { for (const queue of queues) void queue.close(); for (const worker of workers) void worker.close(); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (let guild = 0; guild < guilds; guild++) {
      signal.throwIfAborted();
      const worker = mode === "typescript" ? undefined : mode === "rust-v1"
        ? new RustAudioWorker({ timeoutMs: 2000 }) : new RustBatchWorker({ timeoutMs: 2000 });
      if (worker) {
        workers.push(worker); const started = performance.now();
        const output = worker instanceof RustBatchWorker ? await worker.mixBatch([fixtures[guild][0]], signal)
          : [await worker.mix(fixtures[guild][0], signal)];
        assert.deepEqual(output, [expected[guild][0]]); firstReplyMs.push(performance.now() - started);
      }
      for (let warmup = 0; warmup < 16; warmup++) {
        const input = fixtures[guild][warmup % 8]; signal.throwIfAborted();
        const output = worker instanceof RustBatchWorker ? (await worker.mixBatch([input], signal))[0]
          : worker instanceof RustAudioWorker ? await worker.mix(input, signal) : mixPcm(input.a, input.b, input.progress, input.volume);
        assert.deepEqual(output, expected[guild][warmup % 8]);
      }
      const mix = async (inputs: MixInput[], requestSignal: AbortSignal) => {
        const samples = waiting[guild].splice(0, inputs.length), submitted = performance.now();
        assert.equal(samples.length, inputs.length);
        for (const sample of samples) { sample.submitted = submitted; queueWait.push(submitted - sample.arrival); }
        batchHistogram[inputs.length] = (batchHistogram[inputs.length] ?? 0) + 1;
        if (worker) {
          requestProtocolBytes += inputs.reduce((n, input) => n + 32 + input.a.length + (input.b?.length ?? 0), 0)
            + (worker instanceof RustBatchWorker ? 16 : 0);
          replyProtocolBytes += worker instanceof RustBatchWorker ? 16 + inputs.length * (8 + FRAME_BYTES) : 16 + FRAME_BYTES;
        }
        if (worker instanceof RustBatchWorker) return worker.mixBatch(inputs, requestSignal);
        if (worker instanceof RustAudioWorker) { assert.equal(inputs.length, 1); return [await worker.mix(inputs[0], requestSignal)]; }
        return inputs.map(input => mixPcm(input.a, input.b, input.progress, input.volume));
      };
      queues.push(new PacedBatchQueue({ ...policy, mix }));
    }
    const childPids = workers.flatMap(worker => worker.pid ? [worker.pid] : []);
    const replyEventsBefore = workers.reduce((n, worker) => n + worker.transportStats.replyChunks, 0);
    const snapshot = () => { const counters = processCpu([process.pid, ...childPids]); return { ...counters, values: counters.values.filter(value => value.pid !== process.pid) }; };
    const cpuBefore = snapshot(), parentBefore = process.cpuUsage(), started = performance.now();
    const pending: Promise<void>[] = [];
    for (let frame = 0; frame < config.frames; frame++) {
      const scheduled = started + frame * INTERVAL_MS;
      // Absolute deadlines do not silently slow the input clock after a delay.
      // No future input/control is submitted before its own scheduled arrival.
      while (performance.now() < scheduled) await sleep(Math.max(1, scheduled - performance.now()), undefined, { signal });
      signal.throwIfAborted(); if (failure) throw failure;
      for (let guild = 0; guild < guilds; guild++) {
        const input = fixtures[guild][frame % 8], arrival = performance.now();
        const sample = { arrival, scheduled, submitted: NaN, changed: frame > 0 && input.volume !== fixtures[guild][(frame - 1) % 8].volume };
        waiting[guild].push(sample); arrivalLateness.push(arrival - scheduled);
        outstanding++; maxOutstanding = Math.max(maxOutstanding, outstanding);
        pending.push(queues[guild].push(input).then(output => {
          const finished = performance.now(); assert.deepEqual(output, expected[guild][frame % 8]);
          assert(Number.isFinite(sample.submitted)); verifiedFrames++;
          service.push(finished - sample.submitted);
          completion.push(finished - arrival); scheduledCompletion.push(finished - scheduled);
          if (sample.changed) controlCompletion.push(finished - arrival);
          completedPerGuild[guild]++; if (finished - scheduled > INTERVAL_MS) missed20MsPerGuild[guild]++;
        }).catch(error => { failure ??= error; }).finally(() => { outstanding--; }));
      }
    }
    const lastArrivalMs = performance.now() - started;
    await Promise.all(queues.map(queue => queue.finish())); await Promise.all(pending);
    if (failure) throw failure;
    const elapsedMs = performance.now() - started, parent = process.cpuUsage(parentBefore), cpuAfter = snapshot();
    assert.equal(verifiedFrames, config.frames * guilds); assert(waiting.every(values => values.length === 0));
    const childCpuMs = cpuDelta(cpuBefore, cpuAfter), parentCpuMs = (parent.user + parent.system) / 1000;
    return { mode, guilds, framesPerGuild: config.frames, warmupSingleFramesPerGuild: 16, intervalMs: INTERVAL_MS, policy,
      verifiedFrames, elapsedMs, lastArrivalMs, finalDrainMs: elapsedMs - lastArrivalMs,
      parentCpuMs, childCpuMs, wholeOwnedCpuMs: childCpuMs === null ? null : parentCpuMs + childCpuMs,
      childCpuCounter: { source: cpuAfter.source, counterUnitMs: cpuAfter.counterUnitMs, error: cpuBefore.error ?? cpuAfter.error },
      parentLifetimePeakRssBytes: process.resourceUsage().maxRSS * 1024, firstSingleFrameReplyMs: firstReplyMs,
      arrivalLateness: percentiles(arrivalLateness), queueWait: percentiles(queueWait), dispatchToReply: percentiles(service),
      frameArrivalToReply: percentiles(completion), scheduledArrivalToReply: percentiles(scheduledCompletion),
      changedVolumeFrameToReply: percentiles(controlCompletion), batchHistogram,
      logicalMixCalls: Object.values(batchHistogram).reduce((a, b) => a + b, 0),
      ipcRequests: mode === "typescript" ? 0 : Object.values(batchHistogram).reduce((a, b) => a + b, 0),
      requestProtocolBytes, replyProtocolBytes,
      replyDataEvents: workers.reduce((n, worker) => n + worker.transportStats.replyChunks, 0) - replyEventsBefore,
      completedPerGuild, missed20MsPerGuild,
      queueBounds: queues.map(queue => queue.stats), maxOutstandingAcrossGuilds: maxOutstanding, maxAllowedPerGuild: 16 };
  } finally {
    signal.removeEventListener("abort", cancel);
    await Promise.all(queues.map(queue => queue.close())); await Promise.all(workers.map(worker => worker.close()));
  }
}

async function main(args: string[]) {
  if (args[0] === "--run") {
    const controller = new AbortController(), cancel = (message: unknown) => {
      if (message && typeof message === "object" && "type" in message && message.type === "afterparty-benchmark-cancel") controller.abort();
    };
    process.on("message", cancel);
    try { console.log(JSON.stringify(await pacedRun(args[1], pacedOptions(args.slice(2)), controller.signal))); }
    finally { process.off("message", cancel); if (process.connected) process.disconnect(); }
    return;
  }
  const config = pacedOptions(args), runs = [];
  for (const guilds of config.guilds) for (let repeat = 0; repeat < config.repeats; repeat++) {
    const offset = repeat % PACED_POLICIES.length;
    for (const policy of [...PACED_POLICIES.slice(offset), ...PACED_POLICIES.slice(0, offset)]) {
      const report = await measurementProcess([fileURLToPath(import.meta.url), "--run", policy.mode, String(config.frames), "1", String(guilds)]);
      runs.push({ repeat: repeat + 1, ...JSON.parse(report) });
      console.error(`[paced] ${guilds} guild(s), repeat ${repeat + 1}, ${policy.mode}: complete`);
    }
  }
  const rustVersion = spawnSync(process.env.RUSTC_PATH ?? "rustc", ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  const changes = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  const sourcePaths = ["paced-client.ts", "paced-benchmark.ts", "worker-client.ts", "batch-client.ts", "batch-benchmark.ts", "benchmark-suite.ts", "benchmark-process.ts", "process-cpu.ts", "../../services/core/src/audio.ts", "src/lib.rs", "src/stream.rs", "src/stream/batch.rs", "Cargo.lock"];
  console.log(JSON.stringify({ scope: "offline PCM arrival scheduling; no encoder, provider or Discord output", config,
    capturedAt: new Date().toISOString(), command: ["node", "experiments/rust-audio/paced-benchmark.ts", ...args],
    sourceCommit: revision.status === 0 ? revision.stdout.trim() : null, sourceDirty: changes.status === 0 ? !!changes.stdout.trim() : null,
    node: process.version, os: platform(), osRelease: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    rustVersion: rustVersion.status === 0 ? rustVersion.stdout.trim() : null,
    sourceSha256: Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex")])),
    rustExecutableSha256: createHash("sha256").update(readFileSync(process.env.RUST_AUDIO_BIN ?? defaultExecutable)).digest("hex"), runs,
    limitations: ["All paths use the same bounded offline parent queue; production Core does not import it.",
      "Input and volume controls become available per scheduled 20ms frame, not as a pre-ready block. Delayed event loops can create catch-up bursts, reported as arrival lateness.",
      "maxWait is a dispatch policy, not a hard completion guarantee: event-loop delay and an in-flight backend can add delay.",
      "Control metric measures completion of new per-frame volume snapshots; it does not undo submitted audio or measure audible/packet latency.",
      "CPU covers the timed parent and owned Rust counters, excludes startup/probes/encoding/provider/Discord; practical counter precision is not established.",
      "Fresh-process repeats and rotated order limit history bias; observed ranges are not confidence intervals or intended-host evidence."] }, null, 2));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main(process.argv.slice(2));
