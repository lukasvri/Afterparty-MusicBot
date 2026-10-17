// Run: node services/core/benchmarks/radio-queue.ts
// Isolated synchronous queue filtering, not live provider latency or voice capacity.
import assert from "node:assert/strict";
import { cpus } from "node:os";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { playableRoomQueue } from "../src/room-radio.ts";
import { rankRadio } from "../src/radio.ts";
import { repeatedHistoryQueue, syntheticRoom } from "../tests/radio-queue-fixture.ts";

const iterations = 30, rounds = 5, warmup = 10;
// Optional exact pre-change radio implementation, loaded from a local Git object
// without writing files or switching the shared checkout. radio.ts is self-contained.
const baselineRef = process.argv.find(arg => arg.startsWith("--baseline-ref="))?.slice(15);
let baselineRank: typeof rankRadio = rankRadio;
if (baselineRef) {
  if (!/^[a-f0-9]{40}$/.test(baselineRef)) throw new Error("Use a full local commit SHA.");
  const source = execFileSync("git", ["show", `${baselineRef}:services/core/src/radio.ts`], { encoding: "utf8" });
  const baselineModule = await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`);
  baselineRank = baselineModule.rankRadio;
}
const cases = [
  { name: "empty queue", automatic: 0, manual: 0, history: 100 },
  { name: "manual queue", automatic: 0, manual: 20, history: 100 },
  { name: "usual single suggestion, no history", automatic: 1, manual: 0, history: 0 },
  { name: "usual single suggestion, full history", automatic: 1, manual: 0, history: 100 },
  { name: "manual priority with one suggestion", automatic: 1, manual: 20, history: 100 },
  { name: "stress: twenty automatic suggestions, no history", automatic: 20, manual: 0, history: 0 },
  { name: "stress: twenty automatic suggestions, full history", automatic: 20, manual: 0, history: 100 },
];
const results = [];
for (const scenario of cases) {
  const state = syntheticRoom(scenario.automatic, scenario.manual, scenario.history);
  const operations = { repeatedHistory: () => repeatedHistoryQueue(state, baselineRank), sharedHistory: () => playableRoomQueue(state) };
  const expected = operations.repeatedHistory();
  assert.deepEqual(operations.sharedHistory(), expected);
  const samples: Record<string, number[]> = { repeatedHistory: [], sharedHistory: [] };
  for (const run of Object.values(operations)) for (let n = 0; n < warmup; n++) run();
  let checksum = 0;
  for (let round = 0; round < rounds; round++) {
    // Alternate order to reduce systematic warmup and drift advantages.
    const entries = Object.entries(operations);
    if (round % 2) entries.reverse();
    for (const [name, run] of entries) {
      const started = performance.now();
      for (let n = 0; n < iterations; n++) {
        const queue = run();
        assert.equal(queue.length, expected.length);
        checksum += queue.length;
      }
      samples[name].push(performance.now() - started);
    }
  }
  results.push({ ...scenario, selected: expected.length, checksum, measurements: Object.entries(samples).map(([name, values]) => ({
    name, medianMs: values.toSorted((a, b) => a - b)[Math.floor(rounds / 2)], samplesMs: values,
  })) });
}
console.log(JSON.stringify({ scope: "Synthetic queue selection only; no network, audio or production data.",
  baseline: baselineRef ?? "Previous per-entry queue selection using current radio helpers",
  environment: { node: process.version, platform: process.platform, cpu: cpus()[0]?.model },
  workload: { iterations, rounds, warmup }, results,
}, null, 2));
