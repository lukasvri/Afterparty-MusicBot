// Controlled provider latency only. No network, account, real media or production.
// node services/core/benchmarks/search-deadline.ts > private-results.json
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { Providers, runJson } from "../src/providers.ts";
import { Store } from "../src/store.ts";
import { UserError } from "../src/types.ts";
import type { YouTubeResponses } from "../src/external-types.ts";

const rounds = 20, id = "fixture0001";
const summary = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return { samples: sorted.length, p50Ms: sorted[Math.ceil(sorted.length * .5) - 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] };
};
async function measure(fallback: boolean) {
  const store = new Store(":memory:"), providers = new Providers(store, {});
  const stages = { discovery: [] as number[], extractor: [] as number[], metadata: [] as number[] };
  const counts = { api: 0, extractor: 0 };
  const cold: number[] = [], warm: number[] = [];
  providers.youtube = async <K extends keyof YouTubeResponses>(path: K) => {
    const start = performance.now(); counts.api++;
    await sleep(path === "search" ? 12 : 8);
    stages[path === "search" ? "discovery" : "metadata"].push(performance.now() - start);
    if (path === "search") {
      if (fallback) throw new UserError("Synthetic API outage", 502);
      return { items: [{ id: { videoId: id } }] } as YouTubeResponses[K];
    }
    return { items: [{ id, snippet: { title: "Synthetic recording", channelTitle: "Fixture", categoryId: "10", liveBroadcastContent: "none" },
      contentDetails: { duration: "PT3M" }, status: { embeddable: true } }] } as YouTubeResponses[K];
  };
  providers.extract = async () => {
    const start = performance.now(); counts.extractor++; await sleep(18);
    stages.extractor.push(performance.now() - start); return { entries: [{ id }] };
  };
  try {
    for (let round = 0; round < rounds; round++) {
      store.set("metadata:v6:" + id, null);
      const query = "controlled search " + round;
      let start = performance.now(); assert.equal((await providers.search(query, 1))[0].id, id);
      cold.push(performance.now() - start);
      const before = { ...counts };
      start = performance.now(); assert.equal((await providers.search(query, 1))[0].id, id);
      warm.push(performance.now() - start); assert.deepEqual(counts, before);
    }
    assert.deepEqual(counts, { api: rounds * 2, extractor: fallback ? rounds : 0 });
    return { cold: summary(cold), warm: summary(warm), counts, timeoutRate: 0,
      stages: Object.fromEntries(Object.entries(stages).filter(([, values]) => values.length).map(([stage, values]) => [stage, summary(values)])) };
  } finally { store.close(); }
}
const api = await measure(false), fallback = await measure(true);
const store = new Store(":memory:"), providers = new Providers(store, {});
let subprocess: Promise<unknown> | undefined, sourceSignal: AbortSignal | undefined;
providers.youtube = async () => { throw new UserError("Synthetic API outage", 502); };
providers.extract = (_args, signal) => {
  sourceSignal = signal;
  const pending = runJson(process.execPath, ["-e", "setInterval(()=>{},1000)"], signal);
  subprocess = pending.catch(() => {}); return pending;
};
let timeoutMs: number;
try {
  const start = performance.now();
  await assert.rejects(providers.search("controlled hung source", 1), error => error instanceof UserError && error.status === 504);
  timeoutMs = performance.now() - start; await subprocess;
  assert.equal(sourceSignal?.aborted, true);
  assert.deepEqual(await runJson(process.execPath, ["-e", "process.stdout.write('{}')"]), {});
} finally { store.close(); }
console.log(JSON.stringify({ capturedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  scope: "Controlled synthetic adapter delays and one real hung Node subprocess; not provider/network latency or audible acceptance",
  delaysMs: { discovery: 12, extractor: 18, metadata: 8 }, api, fallback,
  hungSource: { samples: 1, timeouts: 1, timeoutMs, subprocessExited: true, subsequentAdmission: "passed" } }, null, 2));
