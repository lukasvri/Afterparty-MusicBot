// All inputs are already available synthetic PCM. Never starts Core or Discord.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cpus, platform, release, arch } from "node:os";
import { resolve } from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { mixPcm } from "../../services/core/src/audio.ts";
import { FRAME_BYTES, defaultExecutable, RustAudioWorker, type MixInput } from "./worker-client.ts";
import { RustBatchWorker } from "./batch-client.ts";
import { fixture, percentiles, ffmpegStage } from "./benchmark-suite.ts";
import { processCpu, cpuDelta } from "./process-cpu.ts";
import { measurementProcess } from "./benchmark-process.ts";

export const BATCH_MODES = ["typescript", "rust-v1", "batch-1", "batch-4", "batch-8"] as const;
const READY_BLOCK = 8;
export function batchOptions(args: string[]) {
  if (args.length > 5) throw new RangeError("Usage: batch-benchmark.ts [frames=8000] [repeats=3] [guilds=1,4] [warmup=512] [none|opus]");
  const integer = (value: string | undefined, fallback: number, min: number, max: number) => {
    const number = value === undefined ? fallback : Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) throw new RangeError("Invalid bounded benchmark control");
    return number;
  };
  const frames = integer(args[0], 8000, 128, 100_000), repeats = integer(args[1], 3, 1, 10);
  const guilds = (args[2] ?? "1,4").split(",").map((value) => integer(value, 1, 1, 16));
  const warmup = integer(args[3], 512, 8, 1024), codec = args[4] ?? "none";
  if (frames % 8 || warmup % 8 || guilds.length > 4 || new Set(guilds).size !== guilds.length || !["none", "opus"].includes(codec))
    throw new RangeError("Frames/warmup must divide by eight; use distinct bounded guild counts and none/opus");
  return { frames, repeats, guilds, warmup, codec };
}

export function batchFixtures(guild: number): MixInput[] {
  return Array.from({ length: READY_BLOCK }, (_, slot) => ({ ...fixture(guild * READY_BLOCK + slot),
    b: slot % 3 === 0 ? null : fixture(guild * READY_BLOCK + slot + 31).b,
    progress: [0.37, -1, 0.49999999999999994, 0.5, 0.5000000000000001, 1, 2, 0.13][slot],
    volume: [85, 100, 50, 66, 150, 0, 37, -1][slot] }));
}

async function run(mode: string, config: ReturnType<typeof batchOptions>, signal: AbortSignal) {
  if (!BATCH_MODES.some((value) => value === mode)) throw new RangeError("Unknown batch benchmark mode");
  const batchSize = mode.startsWith("batch-") ? Number(mode.slice(6)) : 1, guilds = config.guilds[0];
  const inputs = Array.from({ length: guilds }, (_, guild) => batchFixtures(guild));
  const expected = inputs.map((frames) => frames.map((input) => mixPcm(input.a, input.b, input.progress, input.volume)));
  const workers: (RustAudioWorker | RustBatchWorker)[] = [], encoders: ReturnType<typeof ffmpegStage>[] = [];
  const firstReplyMs: number[] = [], callSamples: number[] = [], readySamples: number[] = [], pipelineSamples: number[] = [], blockSamples: number[] = [];
  let logicalCalls = 0;
  const cancel = () => { for (const worker of workers) void worker.close(); for (const encoder of encoders) void encoder.abort(); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (mode !== "typescript") for (let guild = 0; guild < guilds; guild++) {
      signal.throwIfAborted(); const start = performance.now();
      const worker = mode === "rust-v1" ? new RustAudioWorker({ timeoutMs: 10_000 }) : new RustBatchWorker({ timeoutMs: 10_000 });
      workers.push(worker);
      const result = worker instanceof RustBatchWorker ? await worker.mixBatch([inputs[guild][0]], signal) : [await worker.mix(inputs[guild][0], signal)];
      assert.deepEqual(result, [expected[guild][0]]); firstReplyMs.push(performance.now() - start);
    }

    async function block(guild: number, start: number, measured: boolean, verify: boolean) {
      for (let slot = 0; slot < READY_BLOCK; slot += batchSize) {
        signal.throwIfAborted(); const submitted = performance.now(), worker = workers[guild];
        const chunk = inputs[guild].slice(slot, slot + batchSize);
        let output: Buffer[];
        if (mode === "typescript") {
          // No per-frame await/microtask on the synchronous TS control path.
          output = [mixPcm(chunk[0].a, chunk[0].b, chunk[0].progress, chunk[0].volume)];
        } else if (worker instanceof RustBatchWorker) output = await worker.mixBatch(chunk, signal);
        else if (worker instanceof RustAudioWorker) output = [await worker.mix(chunk[0], signal)];
        else throw new Error("Missing owned audio worker");
        const received = performance.now();
        if (verify) assert.deepEqual(output, expected[guild].slice(slot, slot + batchSize));
        if (measured) { logicalCalls++; callSamples.push(received - submitted); }
        for (const frame of output) {
          assert.equal(frame.length, FRAME_BYTES);
          if (encoders[guild]) await encoders[guild].write(frame);
          if (measured) { readySamples.push(received - start); pipelineSamples.push(performance.now() - start); }
        }
      }
    }
    for (let frame = 0; frame < config.warmup; frame += READY_BLOCK) {
      await Promise.all(inputs.map((_, guild) => block(guild, 0, false, true))); await yieldTurn();
    }
    const pids = workers.flatMap((worker) => worker.pid ? [worker.pid] : []);
    const snapshot = () => { const value = processCpu([process.pid, ...pids]); return { ...value, values: value.values.filter((entry) => entry.pid !== process.pid) }; };
    const cpuBefore = snapshot(), chunksBefore = workers.reduce((n, worker) => n + worker.transportStats.replyChunks, 0);
    const batchesBefore = workers.reduce((n, worker) => n + (worker instanceof RustBatchWorker ? worker.transportStats.requests : 0), 0);
    const parentBefore = process.cpuUsage(), started = performance.now();
    if (config.codec === "opus") for (let guild = 0; guild < guilds; guild++) encoders.push(ffmpegStage("opus"));
    for (let frame = 0; frame < config.frames; frame += READY_BLOCK) {
      const readyAt = performance.now();
      await Promise.all(inputs.map((_, guild) => block(guild, readyAt, true, frame === 0 || frame === config.frames - READY_BLOCK)));
      blockSamples.push(performance.now() - readyAt); await yieldTurn();
    }
    const submittedMs = performance.now() - started, ffmpeg = await Promise.all(encoders.map((encoder) => encoder.finish()));
    const elapsedMs = performance.now() - started, parentCpu = process.cpuUsage(parentBefore), cpuAfter = snapshot();
    const parentCpuMs = (parentCpu.user + parentCpu.system) / 1000, childCpuMs = cpuDelta(cpuBefore, cpuAfter);
    const codecCpuMs = ffmpeg.every((stage) => stage.cpuMs !== null) ? ffmpeg.reduce((n, stage) => n + stage.cpuMs!, 0) : null;
    const frames = config.frames * guilds, expectedCalls = frames / batchSize;
    assert.equal(logicalCalls, expectedCalls);
    if (mode.startsWith("batch-")) assert.equal(workers.reduce((n, worker) => n + (worker instanceof RustBatchWorker ? worker.transportStats.requests : 0), 0) - batchesBefore, expectedCalls);
    for (const stage of ffmpeg) assert(stage.outputBytes > 0);
    const inputPerBlock = inputs[0].reduce((n, input) => n + 32 + FRAME_BYTES * (input.b ? 2 : 1), 0);
    return { mode, guilds, framesPerGuild: config.frames, warmupFramesPerGuild: config.warmup, codec: config.codec,
      framesPerReadyBlock: READY_BLOCK, batchSize, elapsedMs, submittedMs, finalFlushMs: elapsedMs - submittedMs,
      framesPerSecond: frames / elapsedMs * 1000, parentCpuMs, childCpuMs,
      wholeOwnedCpuMs: childCpuMs !== null && codecCpuMs !== null ? parentCpuMs + childCpuMs + codecCpuMs : null,
      childCpuCounter: { source: cpuAfter.source, counterUnitMs: cpuAfter.counterUnitMs,
        practicalPrecision: "not established; scheduler accounting may be coarser", error: cpuBefore.error ?? cpuAfter.error },
      parentPeakRssBytes: process.resourceUsage().maxRSS * 1024, firstSingleFrameReplyMs: firstReplyMs,
      frameReadyLatency: percentiles(readySamples), framePipelineLatency: percentiles(pipelineSamples), callLatency: percentiles(callSamples), blockLatency: percentiles(blockSamples),
      logicalCalls, directMixInvocations: mode === "typescript" ? logicalCalls : 0,
      ipcRequests: mode === "typescript" ? 0 : expectedCalls,
      requestProtocolBytes: mode === "typescript" ? 0 : inputPerBlock * (config.frames / READY_BLOCK) * guilds + (mode.startsWith("batch-") ? 16 * expectedCalls : 0),
      replyProtocolBytes: mode === "typescript" ? 0 : mode === "rust-v1" ? frames * (16 + FRAME_BYTES) : 16 * expectedCalls + frames * (8 + FRAME_BYTES),
      replyDataEvents: workers.reduce((n, worker) => n + worker.transportStats.replyChunks, 0) - chunksBefore,
      accumulationBudgetMsByPosition: Array.from({ length: batchSize }, (_, slot) => (batchSize - 1 - slot) * 20),
      maxAddedLiveAccumulationMs: (batchSize - 1) * 20, ffmpeg };
  } finally {
    signal.removeEventListener("abort", cancel); await Promise.all(encoders.map((encoder) => encoder.abort())); await Promise.all(workers.map((worker) => worker.close()));
  }
}

async function main(args: string[]) {
  if (args[0] === "--run") {
    const controller = new AbortController(), cancel = (message: unknown) => {
      if (message && typeof message === "object" && "type" in message && message.type === "afterparty-benchmark-cancel") controller.abort();
    };
    process.on("message", cancel);
    try { console.log(JSON.stringify(await run(args[1], batchOptions(args.slice(2)), controller.signal))); }
    finally { process.off("message", cancel); if (process.connected) process.disconnect(); }
    return;
  }
  const config = batchOptions(args), runs = [];
  for (const guilds of config.guilds) for (let repeat = 0; repeat < config.repeats; repeat++) {
    const offset = repeat % BATCH_MODES.length;
    for (const mode of [...BATCH_MODES.slice(offset), ...BATCH_MODES.slice(0, offset)]) {
      const report = await measurementProcess([fileURLToPath(import.meta.url), "--run", mode, String(config.frames), "1", String(guilds), String(config.warmup), config.codec]);
      runs.push({ repeat: repeat + 1, ...JSON.parse(report) });
    }
  }
  const rustVersion = spawnSync(process.env.RUSTC_PATH ?? "rustc", ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  const ffmpegVersion = config.codec === "opus" ? spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"],
    { encoding: "utf8", windowsHide: true, timeout: 10_000 }).stdout?.split(/\r?\n/)[0] ?? null : null;
  console.log(JSON.stringify({ scope: "offline ready PCM blocks; future frame accumulation is not included in measured latency",
    node: process.version, os: platform(), osRelease: release(), arch: arch(), cpu: cpus()[0]?.model,
    logicalCpus: cpus().length, rustVersion: rustVersion.status === 0 ? rustVersion.stdout.trim() : null, ffmpegVersion,
    rustExecutableSha256: createHash("sha256").update(readFileSync(process.env.RUST_AUDIO_BIN ?? defaultExecutable)).digest("hex"), config, runs,
    limitations: ["All eight input frames are ready before a block starts. Unknown future live audio cannot be batched this way.",
      "Batch N adds up to (N-1)*20ms gathering delay for 20ms arriving frames; budget is reported separately, never added to a percentile as if measured.",
      "Frame completion is PCM ready or encoder stdin acceptance, not encoded packet/Discord/audible latency.",
      "Whole owned CPU sums parent, owned Rust counter deltas and optional FFmpeg diagnostics; units do not establish precision.",
      "Three-repeat ranges are observations, not confidence intervals; shared host scheduling and thermal state remain uncontrolled."] }, null, 2));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main(process.argv.slice(2));
