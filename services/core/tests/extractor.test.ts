import { test } from "node:test";
import assert from "node:assert/strict";
import { runJson } from "../src/extractor.ts";

test("extractor preserves UTF-8 characters split between stdout chunks", async () => {
  const result = await runJson(process.execPath, [
    "-e",
    `
    const data = Buffer.from(JSON.stringify({ title: 'Blå kveld 🎵' }));
    const split = data.indexOf(Buffer.from('å')) + 1;
    process.stdout.write(data.subarray(0, split));
    setTimeout(() => process.stdout.write(data.subarray(split)), 20);
  `,
  ]);
  assert.deepEqual(result, { title: "Blå kveld 🎵" });
});

test("oversized extractor output is rejected and releases admission for the next job", async () => {
  await assert.rejects(
    runJson(process.execPath, [
      "-e",
      `
    process.stdout.write('x'.repeat(8_100_000));
    setInterval(() => {}, 1000);
  `,
    ]),
    /for stort svar/,
  );
  assert.deepEqual(
    await runJson(process.execPath, ["-e", "process.stdout.write('{}')"]),
    {},
  );
});

test("deadline kills a hung extractor before its slot becomes available again", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const job = runJson(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    const rejected = assert.rejects(job, /innen fristen/);
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(30000);
    await rejected;
  } finally {
    t.mock.timers.reset();
  }
  assert.deepEqual(
    await runJson(process.execPath, ["-e", "process.stdout.write('{}')"]),
    {},
  );
});

test("running extractor cancellation and spawn failure do not exhaust the pool", async () => {
  for (let i = 0; i < 6; i++) {
    const controller = new AbortController();
    const job = runJson(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      controller.signal,
    );
    const rejected = assert.rejects(job, /avbrutt/);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await rejected;
  }
  await assert.rejects(runJson("/synthetic-missing-extractor", []));
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      runJson(process.execPath, ["-e", "process.stdout.write('{}')"]),
    ),
  );
  assert.deepEqual(results, [{}, {}, {}, {}]);
});
