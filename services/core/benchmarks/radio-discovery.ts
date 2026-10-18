// Controlled IO latency only: no real providers, accounts, audio or production.
// node services/core/benchmarks/radio-discovery.ts --baseline-ref=FULL_COMMIT_SHA
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { cpus } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { selectRadio, type RadioInput } from "../src/radio-pipeline.ts";
import type { Track } from "../src/types.ts";

const baselineRef = process.argv.find(arg => arg.startsWith("--baseline-ref="))?.slice(15);
if (!baselineRef || !/^[a-f0-9]{40}$/.test(baselineRef)) throw new Error("Use a full local baseline commit SHA.");
const oldSource = execFileSync("git", ["show", `${baselineRef}:services/core/src/radio-pipeline.ts`], { encoding: "utf8" });
const absoluteImports = oldSource.replaceAll('"./matching.ts"', JSON.stringify(new URL("../src/matching.ts", import.meta.url).href))
  .replaceAll('"./radio.ts"', JSON.stringify(new URL("../src/radio.ts", import.meta.url).href));
const before = (await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(absoluteImports))}`)).selectRadio as typeof selectRadio;
const track = (id: string, artist: string): Track => ({ id, entryId: id, title: `${artist} - Evening`,
  artist: `${artist} - Topic`, duration: 210, image: "", live: false, music: true, embeddable: true, genres: ["deep house"] });
const seed = track("seed0000001", "Aster"), candidate = track("first000001", "Beryl");
const delaysMs = [25, 35], rounds = 5, warmup = 2;
async function run(select: typeof selectRadio) {
  let calls = 0, active = 0, peak = 0;
  const input: RadioInput = { seed, recent: [], excluded: [], requireEmbeddable: true,
    search: async () => {
      const slot = calls++; active++; peak = Math.max(peak, active);
      try { await sleep(delaysMs[slot]); return [candidate]; } finally { active--; }
    } };
  const started = performance.now(), result = await select(input), elapsedMs = performance.now() - started;
  assert.equal(result.track?.id, candidate.id); assert.equal(result.source, "genre");
  assert.equal(result.diagnostic.searches, 2); assert.equal(calls, 2); assert.equal(active, 0);
  return { elapsedMs, calls, maxConcurrentSearches: peak, selected: result.track.id };
}
for (let i = 0; i < warmup; i++) { await run(before); await run(selectRadio); }
const results: { round: number; mode: string; elapsedMs: number; calls: number; maxConcurrentSearches: number; selected: string }[] = [];
for (let round = 0; round < rounds; round++) {
  const order = round % 2 ? [["after", selectRadio], ["before", before]] as const : [["before", before], ["after", selectRadio]] as const;
  for (const [mode, select] of order) results.push({ round: round + 1, mode, ...await run(select) });
}
const median = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(JSON.stringify({ scope: "controlled discovery IO only, not real provider latency or audible quality",
  capturedAt: new Date().toISOString(), baselineRef, node: process.version, platform: process.platform, cpu: cpus()[0]?.model,
  baselinePipelineSha256: createHash("sha256").update(oldSource).digest("hex"),
  sourceSha256: Object.fromEntries(["../src/radio-pipeline.ts", "../src/radio.ts", "../src/matching.ts", "radio-discovery.ts"]
    .map(path => [path, createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex")])),
  workload: { delaysMs, rounds, warmup, queries: 2, catalog: "disabled", metadata: "already specific" }, results,
  summary: ["before", "after"].map(mode => ({ mode, medianMs: median(results.filter(row => row.mode === mode).map(row => row.elapsedMs)) })),
  limitations: ["Injected provider waits demonstrate critical-path overlap, not a measured speedup of live YouTube/Last.fm.",
    "Five alternating pairs on one uncontrolled development host are observations, not confidence intervals.",
    "Catalog and metadata-refinement stages are excluded; search budgets, ranking and selection are checked for parity."] }, null, 2));
