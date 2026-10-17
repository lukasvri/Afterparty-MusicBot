// Opt-in synthetic subprocess benchmark. No Core startup, accounts or network.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { cpus, platform, release, arch } from "node:os";
import { resolve } from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { mixPcm } from "../../services/core/src/audio.ts";
import { FRAME_BYTES, RustAudioWorker, defaultExecutable, type MixInput } from "./worker-client.ts";
import { measurementProcess } from "./benchmark-process.ts";

export function options(args: string[]) {
  if (args.length > 5) throw new RangeError("Usage: benchmark-suite.ts [frames=1000] [repeats=3] [guilds=1,4,16] [warmup=100] [none|copy|opus]");
  function integer(value: string | undefined, fallback: number, min: number, max: number) {
    const result = value === undefined ? fallback : Number(value);
    if (!Number.isSafeInteger(result) || result < min || result > max)
      throw new RangeError(`Expected an integer between ${min} and ${max}`);
    return result;
  }
  const frames = integer(args[0], 1000, 100, 100_000);
  const repeats = integer(args[1], 3, 1, 10);
  const guilds = (args[2] ?? "1,4,16").split(",").map((value) => integer(value, 1, 1, 16));
  if (guilds.length > 4 || new Set(guilds).size !== guilds.length) throw new RangeError("Use up to four distinct guild counts");
  const warmup = integer(args[3], 100, 1, 1000);
  const ffmpeg = args[4] ?? "none";
  if (!["none", "copy", "opus"].includes(ffmpeg)) throw new RangeError("FFmpeg stage must be none, copy or opus");
  return { frames, repeats, guilds, warmup, ffmpeg };
}

export function fixture(guild: number): MixInput {
  const a = Buffer.alloc(FRAME_BYTES), b = Buffer.alloc(FRAME_BYTES);
  for (let i = 0; i < FRAME_BYTES; i += 2) {
    a.writeInt16LE(((i * 97 + guild * 997) % 65536) - 32768, i);
    b.writeInt16LE(((i * 37 + guild * 631) % 65536) - 32768, i);
  }
  return { a, b, progress: 0.37, volume: 85 };
}

export function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) throw new RangeError("No latency samples");
  const at = (p: number) => sorted[Math.ceil(sorted.length * p) - 1];
  return { p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), maxMs: sorted.at(-1)! };
}

function childPeakRss(pids: number[]) {
  try {
    if (!pids.length) return { source: "no children", bytes: [] as number[], error: null };
    if (process.platform === "linux") return { source: "/proc/<pid>/status VmHWM", bytes: pids.map((pid) => {
      const match = readFileSync(`/proc/${pid}/status`, "utf8").match(/^VmHWM:\s+(\d+) kB$/m);
      if (!match) throw new Error("VmHWM unavailable");
      return Number(match[1]) * 1024;
    }), error: null };
    if (process.platform === "win32") {
      const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `@(Get-Process -Id ${pids.join(",")} -ErrorAction Stop | Sort-Object Id | ForEach-Object { $_.PeakWorkingSet64 }) | ConvertTo-Json -Compress`],
      { encoding: "utf8", timeout: 10_000, windowsHide: true, maxBuffer: 16_384 });
      if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr.trim());
      const parsed: unknown = JSON.parse(result.stdout);
      const peaks = Array.isArray(parsed) ? parsed : [parsed];
      if (peaks.length !== pids.length || peaks.some((value) => !Number.isFinite(value) || Number(value) <= 0))
        throw new Error("Incomplete Windows memory result");
      return { source: "Windows PeakWorkingSet64, PID order", bytes: peaks as number[], error: null };
    }
    throw new Error(`Child peak RSS unsupported on ${process.platform}`);
  } catch (error) { return { source: "unavailable", bytes: null, error: String(error) }; }
}

/** One frame per writer, continuously drained stdout, capped diagnostics and a hard deadline. */
function ffmpegStage(mode: string) {
  const child = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", ["-hide_banner", "-loglevel", "info", "-benchmark", "-nostdin",
    "-probesize", "32", "-analyzeduration", "0",
    "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "pipe:0", "-vn",
    ...(mode === "opus" ? ["-c:a", "libopus", "-b:a", "192k", "-application", "audio", "-compression_level", "10",
      "-vbr", "on", "-frame_duration", "20", "-page_duration", "20000", "-flush_packets", "1", "-f", "opus"] : ["-c:a", "copy", "-f", "s16le"]),
    "pipe:1"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let failure: Error | null = null, stderr = "", bytes = 0, closed = false;
  const fail = (error: Error) => { failure ??= error; child.kill("SIGKILL"); };
  const timer = setTimeout(() => fail(new Error("FFmpeg stage exceeded 60s")), 60_000);
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.stdout.on("error", fail);
  child.stderr.on("error", fail);
  child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4096); });
  child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; });
  const done = new Promise<void>((resolve) => child.once("close", (code, signal) => {
    closed = true; clearTimeout(timer);
    if (code !== 0 || signal) failure ??= new Error(`FFmpeg failed (${signal ?? code}): ${stderr}`);
    resolve();
  }));
  return {
    async write(frame: Buffer) {
      if (closed || failure) throw failure ?? new Error("FFmpeg already closed");
      await new Promise<void>((resolve, reject) => child.stdin.write(frame, (error) => error ? reject(error) : resolve()));
      if (failure) throw failure;
    },
    async finish() {
      child.stdin.end(); await done; if (failure) throw failure;
      const rss = stderr.match(/maxrss=(\d+)\s*Ki?B/i);
      const cpu = stderr.match(/utime=([\d.]+)s stime=([\d.]+)s/);
      return { outputBytes: bytes, peakRssBytes: rss ? Number(rss[1]) * 1024 : null,
        cpuMs: cpu ? (Number(cpu[1]) + Number(cpu[2])) * 1000 : null };
    },
    async abort() { if (!closed) child.kill("SIGKILL"); await done; },
  };
}

async function run(mode: string, config: ReturnType<typeof options>, signal: AbortSignal) {
  if (mode !== "rust" && mode !== "typescript") throw new RangeError("Unknown mixer");
  const guilds = config.guilds[0];
  const inputs = Array.from({ length: guilds }, (_, guild) => fixture(guild));
  const references = inputs.map((input) => mixPcm(input.a, input.b, input.progress, input.volume));
  const workers: RustAudioWorker[] = [], stages: ReturnType<typeof ffmpegStage>[] = [];
  const startupFirstReplyMs: number[] = [], samples: number[] = [], batchSamples: number[] = [];
  const cancel = () => {
    for (const worker of workers) void worker.close();
    for (const stage of stages) void stage.abort();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (mode === "rust") for (let guild = 0; guild < guilds; guild++) {
      signal.throwIfAborted();
      const start = performance.now();
      const worker = new RustAudioWorker({ timeoutMs: 10_000 });
      workers.push(worker);
      assert.deepEqual(await worker.mix(inputs[guild], signal), references[guild]);
      startupFirstReplyMs.push(performance.now() - start);
    }
    async function mix(guild: number) {
      const input = inputs[guild];
      signal.throwIfAborted();
      return mode === "rust" ? workers[guild].mix(input, signal) : mixPcm(input.a, input.b, input.progress, input.volume);
    }
    for (let frame = 0; frame < config.warmup; frame++) {
      await Promise.all(inputs.map(async (_, guild) => assert.deepEqual(await mix(guild), references[guild])));
      await yieldTurn();
    }
    const cpu = process.cpuUsage(), started = performance.now();
    if (config.ffmpeg !== "none") for (let guild = 0; guild < guilds; guild++) stages.push(ffmpegStage(config.ffmpeg));
    let batchesOver20Ms = 0;
    for (let frame = 0; frame < config.frames; frame++) {
      const batch = performance.now();
      await Promise.all(inputs.map(async (_, guild) => {
        const output = await mix(guild);
        assert.equal(output.length, references[guild].length);
        if (frame === 0 || frame === config.frames - 1) assert.deepEqual(output, references[guild]);
        if (stages[guild]) await stages[guild].write(output);
        samples.push(performance.now() - batch);
      }));
      const duration = performance.now() - batch;
      batchSamples.push(duration);
      if (duration > 20) batchesOver20Ms++;
      await yieldTurn();
    }
    const submittedMs = performance.now() - started;
    const ffmpeg = await Promise.all(stages.map((stage) => stage.finish()));
    const elapsedMs = performance.now() - started, usedCpu = process.cpuUsage(cpu);
    for (const stage of ffmpeg) {
      assert(stage.outputBytes > 0, "FFmpeg must emit audio bytes");
      if (config.ffmpeg === "copy") assert.equal(stage.outputBytes, config.frames * FRAME_BYTES);
    }
    // OS probes run after the full timed pipeline, while Rust workers remain alive.
    return { mode, guilds, framesPerGuild: config.frames, warmupFramesPerGuild: config.warmup, ffmpegMode: config.ffmpeg,
      elapsedMs, submittedMs, finalFlushMs: elapsedMs - submittedMs, framesPerSecond: config.frames * guilds / elapsedMs * 1000,
      parentCpuMs: (usedCpu.user + usedCpu.system) / 1000, parentLifetimePeakRssBytes: process.resourceUsage().maxRSS * 1024,
      rustChildMemory: childPeakRss(workers.flatMap((worker) => worker.pid ? [worker.pid] : [])),
      startupFirstReplyMs, latency: percentiles(samples), batchLatency: percentiles(batchSamples), batchesOver20Ms, ffmpeg };
  } finally {
    signal.removeEventListener("abort", cancel);
    await Promise.all(stages.map((stage) => stage.abort()));
    await Promise.all(workers.map((worker) => worker.close()));
  }
}

async function main(args: string[]) {
  if (args[0] === "--run") {
    const [, mode, ...rest] = args;
    const controller = new AbortController();
    const cancel = (message: unknown) => {
      if (message && typeof message === "object" && "type" in message && message.type === "afterparty-benchmark-cancel") controller.abort();
    };
    process.on("message", cancel);
    try { console.log(JSON.stringify(await run(mode, options(rest), controller.signal))); }
    finally { process.off("message", cancel); if (process.connected) process.disconnect(); }
    return;
  }
  const config = options(args), runs = [];
  for (const guilds of config.guilds) for (let repeat = 0; repeat < config.repeats; repeat++) {
    for (const mode of repeat % 2 ? ["rust", "typescript"] : ["typescript", "rust"]) {
      const report = await measurementProcess([fileURLToPath(import.meta.url), "--run", mode,
        String(config.frames), "1", String(guilds), String(config.warmup), config.ffmpeg]);
      runs.push({ repeat: repeat + 1, ...JSON.parse(report) });
    }
  }
  const ffmpegVersion = config.ffmpeg === "none" ? null : spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"],
    { encoding: "utf8", windowsHide: true, timeout: 10_000 }).stdout?.split(/\r?\n/)[0];
  const executable = process.env.RUST_AUDIO_BIN ?? defaultExecutable;
  const rustVersion = spawnSync(process.env.RUSTC_PATH ?? "rustc", ["--version"],
    { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  console.log(JSON.stringify({ scope: "offline saturated PCM batches; one pending frame per guild; no Discord",
    node: process.version, os: platform(), osRelease: release(), arch: arch(), cpu: cpus()[0]?.model,
    logicalCpus: cpus().length, rustVersion: rustVersion.status === 0 ? rustVersion.stdout.trim() : null,
    rustExecutableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"), ffmpegVersion, config, runs,
    limitations: ["Raw repeats, no performance pass/fail threshold; inspect their range, not one favorable run.",
      "Batch latency includes scheduling from common submission until mix/FFmpeg stdin acceptance, not audible output.",
      "20ms overruns describe saturation, not paced playback. No codec provider decode or network is modeled.",
      "Parent CPU excludes Rust/FFmpeg. FFmpeg reports its own CPU; Rust child CPU is unavailable here.",
      "RSS fields are process lifetime peaks, not simultaneous whole-tree peak. FFmpeg RSS can be unavailable."] }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  await main(process.argv.slice(2));
