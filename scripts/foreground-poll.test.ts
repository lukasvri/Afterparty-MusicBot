import { test } from "node:test";
import assert from "node:assert/strict";
import { startForegroundPolling } from "../lib/foreground-poll.ts";

test("foreground polling pauses hidden/offline views, resumes once and cleans up", async t => {
  const documentEvents = new EventTarget();
  const windowEvents = new EventTarget();
  const visibility = Object.assign(documentEvents, { hidden: true });
  const network = { onLine: true };
  const properties = ["document", "window", "navigator"] as const;
  const descriptors = properties.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  for (const [key, value] of [["document", visibility], ["window", windowEvents], ["navigator", network]] as const)
    Object.defineProperty(globalThis, key, { configurable: true, value });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let stop = () => {};
  t.after(() => {
    stop();
    properties.forEach((key, i) => {
      const descriptor = descriptors[i];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  });
  let calls = 0;
  let release: () => void = () => {};
  let hold = false;
  stop = startForegroundPolling(async () => {
    calls++;
    if (hold) await new Promise<void>(resolve => { release = resolve; });
  });
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  t.mock.timers.tick(30000);
  assert.equal(calls, 0);
  visibility.hidden = false;
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(calls, 2);
  visibility.hidden = true;
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  t.mock.timers.tick(30000);
  assert.equal(calls, 2);
  network.onLine = false;
  windowEvents.dispatchEvent(new Event("offline"));
  visibility.hidden = false;
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  assert.equal(calls, 2);
  hold = true;
  network.onLine = true;
  windowEvents.dispatchEvent(new Event("online"));
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  windowEvents.dispatchEvent(new Event("online"));
  t.mock.timers.tick(30000);
  assert.equal(calls, 3, "resume events cannot overlap a pending request");
  release();
  await flush();
  hold = false;
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(calls, 4);
  stop();
  t.mock.timers.tick(30000);
  windowEvents.dispatchEvent(new Event("online"));
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  assert.equal(calls, 4, "disposed views cannot restart polling");
});

test("disposing during a request prevents its completion from scheduling another", async t => {
  const properties = ["document", "window", "navigator"] as const;
  const descriptors = properties.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const visibility = Object.assign(new EventTarget(), { hidden: false });
  for (const [key, value] of [["document", visibility], ["window", new EventTarget()], ["navigator", { onLine: true }]] as const)
    Object.defineProperty(globalThis, key, { configurable: true, value });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    properties.forEach((key, i) => {
      const descriptor = descriptors[i];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  });
  let calls = 0;
  let release: () => void = () => {};
  const stop = startForegroundPolling(async () => {
    calls++;
    await new Promise<void>(resolve => { release = resolve; });
  });
  stop();
  release();
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(30000);
  assert.equal(calls, 1);
});
