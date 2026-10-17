import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { processCpu, cpuDelta, linuxCpuTicks } from "./process-cpu.ts";

test("Linux stat parser handles spaces/parentheses and selects only own user/system ticks", () => {
  const fields = Array(35).fill("0"); fields[0] = "S"; fields[11] = "123"; fields[12] = "45";
  fields[13] = "99999"; fields[14] = "99999";
  assert.equal(linuxCpuTicks(`123 (name ) with spaces) ${fields.join(" ")}`), 168);
  assert.throws(() => linuxCpuTicks("invalid"));
});

test("CPU accounting refuses missing, reset or changed child counters", () => {
  const before = { source: "test", counterUnitMs: 10, values: [{ pid: 123, cpuMs: 10 }], error: null };
  assert.equal(cpuDelta(before, { ...before, values: [{ pid: 123, cpuMs: 25 }] }), 15);
  assert.equal(cpuDelta(before, { ...before, values: [{ pid: 123, cpuMs: 0 }] }), null);
  assert.equal(cpuDelta(before, { ...before, values: [{ pid: 124, cpuMs: 25 }] }), null);
  assert.equal(cpuDelta(before, { ...before, error: "unavailable" }), null);
  assert.equal(cpuDelta(processCpu([]), processCpu([])), 0);
  assert(processCpu([-1]).error);
  assert(processCpu([123, 123]).error);
});

test("owned busy subprocess produces a positive OS CPU delta", { skip: !["linux", "win32"].includes(process.platform) }, async () => {
  const child = spawn(process.execPath, ["-e", `
    console.log('ready');
    process.stdin.once('data', () => { const end=performance.now()+250; while(performance.now()<end) Math.sqrt(Math.random()); console.log('done'); });
  `], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  try {
    await once(child.stdout, "data");
    assert(child.pid);
    const before = processCpu([child.pid]);
    const done = once(child.stdout, "data"); child.stdin.write("spin"); await done;
    const after = processCpu([child.pid]);
    assert.equal(before.error, null); assert.equal(after.error, null);
    assert(cpuDelta(before, after)! > 0);
    assert(after.counterUnitMs > 0);
  } finally { child.kill("SIGKILL"); await once(child, "close"); }
});
