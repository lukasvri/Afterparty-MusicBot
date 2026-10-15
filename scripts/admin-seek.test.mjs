import "./test-support/tsx-loader.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createElement, act } from "react";
import { create } from "react-test-renderer";
const { AdminSeek } = await import("../components/party/admin-seek.tsx");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function setup(t, playing = false) {
  let now = 0;
  const timers = new Map();
  let timerId = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.method(globalThis, "setInterval", (callback) => {
    timers.set(++timerId, callback);
    return timerId;
  });
  t.mock.method(globalThis, "clearInterval", (id) => timers.delete(id));
  const seeks = [];
  let props = { trackId: "synthetic", position: 30, duration: 300,
    playing, disabled: false, onSeek: (value) => seeks.push(value) };
  let root;
  await act(() => { root = create(createElement(AdminSeek, props)); });
  t.after(async () => { await act(() => root.unmount()); });
  return {
    seeks,
    input: () => root.root.findByType("input").props,
    async update(changes) {
      props = { ...props, ...changes };
      await act(() => root.update(createElement(AdminSeek, props)));
    },
    async advance(milliseconds) {
      now += milliseconds;
      await act(() => { for (const callback of timers.values()) callback(); });
    },
  };
}

test("resuming at the same position excludes paused time from display and keyboard seek", async (t) => {
  const view = await setup(t);
  await view.advance(60_000);
  assert.equal(view.input().value, 30);
  await view.update({ playing: true });
  await view.advance(500);
  const resumedPosition = view.input().value;
  assert.deepEqual(view.seeks, [], "clock updates must never publish seeks");
  await act(() => view.input().onChange({ target: { value: view.input().value + 1 } }));
  await act(() => view.input().onKeyUp({ key: "ArrowRight" }));
  assert.deepEqual(view.seeks, [31.5]);
  assert.equal(resumedPosition, 30.5);
});

test("repeated pause/resume transitions discard old playing and paused intervals", async (t) => {
  const view = await setup(t, true);
  await view.advance(2_000);
  assert.equal(view.input().value, 32);
  for (let i = 0; i < 2; i++) {
    await view.update({ playing: false });
    assert.equal(view.input().value, 30);
    await view.advance(60_000);
    assert.equal(view.input().value, 30);
    await view.update({ playing: true });
    await view.advance(500);
    assert.equal(view.input().value, 30.5);
  }
  await act(() => view.input().onPointerDown());
  await act(() => view.input().onPointerUp());
  assert.deepEqual(view.seeks, [30.5]);
});

test("a playback transition preserves an active pointer edit", async (t) => {
  const view = await setup(t);
  await act(() => view.input().onPointerDown());
  await act(() => view.input().onChange({ target: { value: "75" } }));
  await view.advance(60_000);
  await view.update({ playing: true });
  await view.advance(500);
  assert.equal(view.input().value, 75);
  await act(() => view.input().onPointerUp());
  await act(() => view.input().onBlur());
  assert.deepEqual(view.seeks, [75]);
});

test("new positions and tracks still reset the sample", async (t) => {
  const view = await setup(t, true);
  await view.advance(10_000);
  await view.update({ position: 100 });
  await view.advance(500);
  assert.equal(view.input().value, 100.5);
  await view.update({ trackId: "another-synthetic" });
  await view.advance(500);
  assert.equal(view.input().value, 100.5);
  assert.deepEqual(view.seeks, []);
});
