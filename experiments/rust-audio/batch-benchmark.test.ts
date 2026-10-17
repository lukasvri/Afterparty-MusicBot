import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BATCH_MODES, batchFixtures, batchOptions } from "./batch-benchmark.ts";

const path = fileURLToPath(new URL("./batch-benchmark.ts", import.meta.url));
test("batch benchmark bounds frames, warmup, codecs and guild isolation", () => {
  assert.deepEqual(batchOptions([]), { frames: 8000, repeats: 3, guilds: [1, 4], warmup: 512, codec: "none" });
  for (const args of [["129"], ["128", "0"], ["128", "1", "17"], ["128", "1", "1,1"],
    ["128", "1", "1", "9"], ["128", "1", "1", "8", "copy"]]) assert.throws(() => batchOptions(args), RangeError);
  const frames = batchFixtures(0);
  assert.equal(frames.length, 8); assert.notDeepEqual(frames[0].a, batchFixtures(1)[0].a);
  assert(frames.some((input) => input.b === null) && frames.some((input) => input.b !== null));
  assert(new Set(frames.map((input) => input.volume)).size > 1);
});

test("all real boundaries process identical frames and report actual reduced IPC counts separately from gathering delay", () => {
  const result = spawnSync(process.execPath, [path, "128", "1", "1", "8"],
    { windowsHide: true, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout); assert.deepEqual(report.runs.map((run: { mode: string }) => run.mode), BATCH_MODES);
  for (const run of report.runs) {
    assert.equal(run.framesPerGuild, 128); assert.equal(run.framesPerReadyBlock, 8);
    assert.equal(run.logicalCalls, 128 / run.batchSize);
    assert.equal(run.directMixInvocations, run.mode === "typescript" ? 128 : 0);
    assert.equal(run.ipcRequests, run.mode === "typescript" ? 0 : run.logicalCalls);
    assert.equal(run.maxAddedLiveAccumulationMs, (run.batchSize - 1) * 20);
    assert.equal(run.accumulationBudgetMsByPosition[0], run.maxAddedLiveAccumulationMs);
    assert.equal(run.accumulationBudgetMsByPosition.at(-1), 0);
    assert(run.frameReadyLatency.p99Ms >= run.frameReadyLatency.p50Ms);
    assert(run.blockLatency.p99Ms >= run.frameReadyLatency.p50Ms);
    if (["win32", "linux"].includes(process.platform)) assert(run.wholeOwnedCpuMs !== null && run.wholeOwnedCpuMs >= run.parentCpuMs);
    if (run.mode !== "typescript") assert(run.replyDataEvents >= run.ipcRequests);
  }
});

const ffmpegAvailable = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"], { windowsHide: true, timeout: 5000 }).status === 0;
test("batch-to-Opus condition writes every bounded ready block and drains through EOF", { skip: !ffmpegAvailable }, () => {
  const result = spawnSync(process.execPath, [path, "--run", "batch-8", "128", "1", "2", "8", "opus"],
    { windowsHide: true, encoding: "utf8", timeout: 20_000, maxBuffer: 32_768 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ipcRequests, 32); assert.equal(report.ffmpeg.length, 2);
  assert(report.elapsedMs >= report.submittedMs); assert(report.ffmpeg.every((stage: { outputBytes: number }) => stage.outputBytes > 0));
});
