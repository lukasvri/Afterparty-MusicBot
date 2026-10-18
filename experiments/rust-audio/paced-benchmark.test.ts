import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PACED_POLICIES, pacedOptions } from "./paced-benchmark.ts";
import { measurementProcess } from "./benchmark-process.ts";

const script = fileURLToPath(new URL("./paced-benchmark.ts", import.meta.url));
test("paced benchmark bounds open-loop duration, repeats and independent guilds", () => {
  assert.deepEqual(pacedOptions([]), { frames: 250, repeats: 3, guilds: [1, 4], intervalMs: 20 });
  for (const args of [["7"], ["3001"], ["8", "0"], ["8", "6"], ["8", "1", "5"],
    ["8", "1", "1,1"], ["8", "1", "1,2,3"], ["8", "1", "1", "extra"]]) assert.throws(() => pacedOptions(args), RangeError);
});

test("paced policies validate every real PCM reply and report observed calls without borrowing future frames", () => {
  const result = spawnSync(process.execPath, [script, "9", "1", "1"],
    { windowsHide: true, encoding: "utf8", timeout: 25_000, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.runs.map((run: { mode: string }) => run.mode), PACED_POLICIES.map(value => value.mode));
  assert.equal(Object.keys(report.sourceSha256).length, 13);
  for (const run of report.runs) {
    assert.equal(run.verifiedFrames, 9); assert.equal(run.intervalMs, 20);
    assert.equal(Object.entries(run.batchHistogram).reduce((n, [size, count]) => n + Number(size) * Number(count), 0), 9);
    assert(run.maxOutstandingAcrossGuilds <= 16);
    assert(run.elapsedMs >= 160, "nine inputs may not be submitted ahead of their own 20ms clock");
    for (const name of ["arrivalLateness", "queueWait", "dispatchToReply", "frameArrivalToReply", "scheduledArrivalToReply", "changedVolumeFrameToReply"]) {
      assert(run[name].maxMs >= run[name].p99Ms && run[name].p99Ms >= run[name].p50Ms && run[name].p50Ms >= 0, name);
    }
    if (run.mode === "typescript") { assert.equal(run.ipcRequests, 0); assert.equal(run.requestProtocolBytes, 0); }
    else { assert.equal(run.ipcRequests, run.logicalMixCalls); assert(run.requestProtocolBytes > 0 && run.replyProtocolBytes > 0); }
  }
});

test("paced fresh-process supervisor aborts a long run and reaps its owned worker", async () => {
  await assert.rejects(measurementProcess([script, "--run", "batch-8", "3000", "1", "1"], 1000, 2000), /timed out/);
});
