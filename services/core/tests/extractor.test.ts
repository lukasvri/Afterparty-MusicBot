import { test } from "node:test";
import assert from "node:assert/strict";
import { runJson } from "../src/extractor.ts";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

test("formats-only failures are classified across stderr chunks without exposing source errors", async () => {
  await assert.rejects(runJson(process.execPath, ["-e", `
    process.stderr.write('ERROR: Requested for');
    setImmediate(() => {
      process.stderr.write('mat is not available. synthetic-private-source');
      process.exitCode = 1;
    });
  `]), error => error instanceof Error && error.name === "ExtractorFormatError" &&
    !error.message.includes("synthetic-private-source"));
});

test("a warning or earlier format error cannot reclassify a final private/source failure", async () => {
  for (const prefix of ["WARNING: No video formats found!", "ERROR: Requested format is not available"]) {
    await assert.rejects(runJson(process.execPath, ["-e", `
      process.stderr.write(process.argv[1] + '\\n');
      setImmediate(() => {
        process.stderr.write('ERROR: Video unavailable. Private source');
        process.exitCode = 1;
      });
    `, prefix]), error => error instanceof Error && error.name !== "ExtractorFormatError" &&
      !error.message.includes("Private source"));
  }
});

test("lightweight metadata shares the memory budget without bypassing queued playback", async (t) => {
  const memory = t.mock.method(process, "constrainedMemory", () => 1024 ** 3);
  const { runJson: bounded }: typeof import("../src/extractor.ts") = await import(`../src/extractor.ts?weighted=${randomUUID()}`);
  memory.mock.restore();
  const dir = await mkdtemp(join(tmpdir(), "extractor-weighted-"));
  const jobs: Promise<unknown>[] = [];
  const start = (name: string, metadata: boolean, priority = false, signal?: AbortSignal) => {
    const job = bounded(process.execPath, ["-e", `
      const fs = require('node:fs'), path = require('node:path');
      const dir = process.argv[1], name = process.argv[2];
      fs.writeFileSync(path.join(dir, name + '.started'), '');
      const timer = setInterval(() => {
        if (fs.existsSync(path.join(dir, name + '.release'))) {
          clearInterval(timer); process.stdout.write('{}');
        }
      }, 10);
    `, dir, name], signal, priority, metadata ? "metadata" : "media");
    jobs.push(job);
    return job;
  };
  const waitFor = async (name: string) => {
    for (let n = 0; n < 250; n++) {
      if ((await readdir(dir)).includes(name + ".started")) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail("Extractor did not start: " + name);
  };
  try {
    start("media", false); start("metadata", true);
    await Promise.all([waitFor("media"),waitFor("metadata")]);
    const controller = new AbortController();
    const cancelled = start("cancelled-playback", false, true, controller.signal);
    const rejected = assert.rejects(cancelled, /cancelled/);
    start("later-metadata", true);
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal((await readdir(dir)).includes("later-metadata.started"),false);
    controller.abort();await rejected;
    await waitFor("later-metadata");
    assert.equal((await readdir(dir)).includes("cancelled-playback.started"),false);
    start("playback", false, true);
    await writeFile(join(dir,"media.release"),"");
    await Promise.all([waitFor("playback"),waitFor("later-metadata")]);
  } finally {
    for (const name of ["media","metadata","playback","cancelled-playback","later-metadata"])
      await writeFile(join(dir,name+".release"),"");
    await Promise.allSettled(jobs);await rm(dir,{recursive:true,force:true});
  }
});

test("a 1 GiB container admits two extractor trees and keeps playback ahead of queued searches", async (t) => {
  const memory = t.mock.method(process, "constrainedMemory", () => 1024 ** 3);
  const { runJson: bounded }: typeof import("../src/extractor.ts") = await import(`../src/extractor.ts?memory=${randomUUID()}`);
  memory.mock.restore();
  const dir = await mkdtemp(join(tmpdir(), "extractor-admission-"));
  const jobs: Promise<unknown>[] = [];
  const start = (name: string, priority = false) => {
    const job = bounded(process.execPath, ["-e", `
      const fs = require('node:fs');
      const path = require('node:path');
      const dir = process.argv[1], name = process.argv[2];
      fs.writeFileSync(path.join(dir, name + '.started'), '');
      const timer = setInterval(() => {
        if (fs.existsSync(path.join(dir, name + '.release'))) {
          clearInterval(timer); process.stdout.write('{}');
        }
      }, 10);
    `, dir, name], undefined, priority);
    jobs.push(job);
    return job;
  };
  const waitFor = async (name: string) => {
    for (let n = 0; n < 200; n++) {
      if ((await readdir(dir)).includes(name + ".started")) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("Extractor did not start: " + name);
  };
  try {
    start("first"); start("second");
    await Promise.all([waitFor("first"), waitFor("second")]);
    start("search"); start("playback", true);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.deepEqual((await readdir(dir)).sort(), ["first.started", "second.started"]);
    await writeFile(join(dir, "first.release"), "");
    await waitFor("playback");
    assert.equal((await readdir(dir)).includes("search.started"), false);
    await writeFile(join(dir, "playback.release"), "");
    await waitFor("search");
  } finally {
    for (const name of ["first", "second", "search", "playback"])
      await writeFile(join(dir, name + ".release"), "");
    await Promise.allSettled(jobs);
    await rm(dir, { recursive: true, force: true });
  }
});

for (const [label, limit, expected] of [
  ["small container", 256 * 1024 ** 2, 1],
  ["2 GiB container", 2 * 1024 ** 3, 4],
  ["unknown memory limit", 0, 4],
] as const) {
  test(`extractor admission retains a usable bounded pool with ${label}`, async (t) => {
    const memory = t.mock.method(process, "constrainedMemory", () => limit);
    const { runJson: bounded }: typeof import("../src/extractor.ts") = await import(`../src/extractor.ts?memory=${randomUUID()}`);
    memory.mock.restore();
    const dir = await mkdtemp(join(tmpdir(), "extractor-slots-"));
    const jobs = Array.from({ length: expected }, (_, index) =>
      bounded(process.execPath, ["-e", `
        const fs = require('node:fs'), path = require('node:path');
        fs.writeFileSync(path.join(process.argv[1], process.argv[2]), '');
        const timer = setInterval(() => {
          if (fs.existsSync(path.join(process.argv[1], 'release'))) {
            clearInterval(timer); process.stdout.write('{}');
          }
        }, 10);
      `, dir, String(index)]),
    );
    try {
      let started = 0;
      for (let n = 0; n < 250; n++) {
        started = (await readdir(dir)).length;
        if (started === expected) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(started, expected);
    } finally {
      await writeFile(join(dir, "release"), "");
      await Promise.allSettled(jobs);
      await rm(dir, { recursive: true, force: true });
    }
  });
}

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
    /response was too large/,
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
    const rejected = assert.rejects(job, /did not respond in time/);
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
    const rejected = assert.rejects(job, /cancelled/);
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
