import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { options, percentiles, fixture } from "./benchmark-suite.ts";
import { BenchmarkProcessError, measurementProcess } from "./benchmark-process.ts";

test("benchmark rejects unbounded, duplicate and malformed workloads", () => {
  assert.deepEqual(options([]), { frames: 1000, repeats: 3, guilds: [1, 4, 16], warmup: 100, ffmpeg: "none" });
  for (const args of [["NaN"], ["100", "11"], ["100", "1", "17"], ["100", "1", "1,1"],
    ["100", "1", "1", "1001"], ["100", "1", "1", "1", "bad"], ["100", "1", "1", "1", "none", "extra"]])
    assert.throws(() => options(args), RangeError);
});

test("nearest-rank percentiles preserve samples and guild fixtures are isolated", () => {
  const samples = [100, 1, 5, 3];
  assert.deepEqual(percentiles(samples), { p50Ms: 3, p95Ms: 100, p99Ms: 100, maxMs: 100 });
  assert.deepEqual(samples, [100, 1, 5, 3]);
  assert.throws(() => percentiles([]), RangeError);
  assert.deepEqual(fixture(0), fixture(0));
  assert.notDeepEqual(fixture(0).a, fixture(1).a);
  assert.equal(fixture(15).a.length, 3840);
});

test("fresh-process comparison executes real mixers, alternates order and bounds guilds", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./benchmark-suite.ts", import.meta.url)),
    "100", "2", "1,4", "2"], { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.runs.length, 8);
  assert.deepEqual(report.runs.slice(0, 4).map((run: { mode: string }) => run.mode), ["typescript", "rust", "rust", "typescript"]);
  for (const run of report.runs) {
    assert(run.latency.p99Ms >= run.latency.p50Ms);
    assert(run.elapsedMs > 0);
    assert(run.parentLifetimePeakRssBytes > 0);
    assert.equal(run.startupFirstReplyMs.length, run.mode === "rust" ? run.guilds : 0);
    if (process.platform === "win32" || process.platform === "linux") assert.equal(run.rustChildMemory.error, null);
  }
});

test("missing FFmpeg fails fast and cleans up every Rust worker", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./benchmark-suite.ts", import.meta.url)),
    "--run", "rust", "100", "1", "4", "2", "opus"], {
    env: { ...process.env, FFMPEG_PATH: "/afterparty-deliberately-missing-ffmpeg" },
    encoding: "utf8", timeout: 20_000, maxBuffer: 16_384, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ENOENT/);
});

const ffmpegAvailable = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"],
  { windowsHide: true, timeout: 5000 }).status === 0;
test("real FFmpeg copy and Opus stages drain concurrent guilds through EOF", { skip: !ffmpegAvailable }, () => {
  for (const stage of ["copy", "opus"]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./benchmark-suite.ts", import.meta.url)),
      "100", "1", "4", "2", stage], { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    for (const run of JSON.parse(result.stdout).runs) {
      assert.equal(run.ffmpeg.length, 4);
      assert(run.elapsedMs >= run.submittedMs);
      for (const encoder of run.ffmpeg) {
        assert(encoder.outputBytes > 0);
        if (stage === "copy") assert.equal(encoder.outputBytes, 100 * 3840);
      }
    }
  }
});

for (const cooperative of [true, false])
test(`measurement timeout terminates descendants (cooperative: ${cooperative})`, async () => {
  const script = `
    const {spawn} = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore', windowsHide: true});
    console.log(JSON.stringify({parent: process.pid, child: child.pid}));
    ${cooperative ? `process.on('message', () => { child.once('close', () => { process.disconnect(); }); child.kill('SIGKILL'); });` : ""}
    child.on('close', () => {});
  `;
  let pids: { parent: number; child: number } | undefined;
  await assert.rejects(measurementProcess(["-e", script], 1500, 500), (error: unknown) => {
    assert(error instanceof BenchmarkProcessError);
    assert.match(error.message, /timed out/);
    pids = JSON.parse(error.stdout);
    return true;
  });
  assert(pids);
  const { parent, child } = pids;
  // close has reaped our direct child. An orphaned forced-kill descendant can
  // briefly remain a Linux zombie until init reaps it; it has already exited.
  assert.throws(() => process.kill(parent, 0), /ESRCH|not found/);
  function exited(pid: number) {
    try { process.kill(pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return true; throw error; }
    if (process.platform === "linux") {
      try { return /^State:\s+Z\b/m.test(readFileSync(`/proc/${pid}/status`, "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
    }
    return false;
  }
  const deadline = performance.now() + 2000;
  while (!exited(child) && performance.now() < deadline) await wait(25);
  assert(exited(child), "synthetic descendant must have exited after timeout cleanup");
});
