import { projectProgress } from "./model.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  viewState,
  frozenRequest,
  parsePanelState,
  progressSteps,
} from "./model.ts";
const commit = "a".repeat(40);
const nonce = "b".repeat(64);
test("a checked deployed version stays up to date and cannot publish again", () => {
  const v = viewState({
    stage: "ready",
    ready: true,
    available: false,
    current_commit: commit,
    commit,
    message: "Ready to publish",
  });
  assert.equal(v.updated, true);
  assert.equal(v.ready, false);
  assert.equal(v.actionTitle, "Beta er oppdatert");
  assert.doesNotMatch(v.message, /Ready to publish/);
});
test("a new tested candidate can be explicitly confirmed", () => {
  const s = {
    stage: "ready",
    ready: true,
    available: true,
    commit,
    confirmation_id: nonce,
  };
  assert.equal(viewState(s).ready, true);
  const request = frozenRequest(s);
  s.commit = "c".repeat(40);
  assert.ok(request);
  assert.equal(request.commit, commit);
  assert.equal(Object.isFrozen(request), true);
});
test("checking, running, blocked and same-version candidates cannot be submitted", () => {
  for (const patch of [
    { checking: true },
    { running: true },
    { stage: "blocked" },
    { available: false },
    { confirmation_id: "x" },
    { commit: "main" },
  ]) {
    assert.equal(
      frozenRequest({
        stage: "ready",
        ready: true,
        available: true,
        commit,
        confirmation_id: nonce,
        ...patch,
      }),
      null,
    );
  }
});
test("old errors are not shown after a successful check", () => {
  assert.equal(viewState({ stage: "ready", error: "Old failure" }).error, "");
  assert.equal(
    viewState({ stage: "failed", error: "Actual failure" }).error,
    "Actual failure",
  );
});
test("a check labels progress as not started despite a legacy last-job hint", () => {
  assert.equal(
    viewState({ stage: "ready", progress_kind: "last" }).progressLabel,
    "Neste oppdatering",
  );
});
test("quota failures retain deployment history without completed progress", () => {
  const v = viewState({
    stage: "failed",
    operation: "check",
    error: "Quota",
    last_deployment_commit: commit,
    progress_kind: "last",
    retry_after: Date.now() / 1000 + 300,
  });
  assert.equal(v.headline, "Statuskontrollen ble ikke fullført");
  assert.equal(v.current, commit);
  assert.equal(v.ready, false);
  assert.ok(v.retrySeconds > 0);
  assert.equal(v.progressLabel, "Neste oppdatering");
});

test("untrusted JSON cannot supply command readiness or arbitrary display objects", () => {
  assert.deepEqual(
    parsePanelState({
      ready: "yes",
      running: 1,
      message: { private: "value" },
      retry_after: Infinity,
      steps: [null, { status: "done", label: "Safe" }, { status: 2 }],
    }),
    { steps: [{ status: "done", label: "Safe" }] },
  );
  assert.throws(() => parsePanelState(null));
  assert.throws(() => parsePanelState([]));
  assert.equal(
    frozenRequest(
      parsePanelState({ ready: "true", commit, confirmation_id: nonce }),
    ),
    null,
  );
});

test("publishing steps reset before start despite stale completed backend steps", () => {
  for (const state of [
    { stage: "ready" },
    { stage: "checking", operation: "check" },
    { stage: "failed", operation: "check" },
    { stage: "ready", running: true },
    { stage: "done", checking: true },
  ]) {
    const steps = progressSteps({
      ...state,
      steps: [{ status: "done" }],
      progress_kind: "last",
    });
    assert.equal(steps.length, 5);
    assert.ok(steps.every((step) => step.status === "pending"));
  }
});
test("actual publish progress stays current and completed jobs move to history", () => {
  const steps = progressSteps({
    stage: "cloudflare",
    operation: "publish",
    running: true,
    steps: [
      { status: "done" },
      { status: "done" },
      { status: "running" },
      { status: "pending" },
      { status: "pending" },
    ],
  });
  assert.deepEqual(
    steps.map((step) => step.status),
    ["done", "done", "running", "pending", "pending"],
  );
  assert.ok(
    progressSteps({ stage: "done", operation: "publish" }).every(
      (step) => step.status === "pending",
    ),
  );
  assert.equal(
    viewState({ stage: "done", operation: "publish" }).progressLabel,
    "Neste oppdatering",
  );
  assert.equal(
    viewState({ stage: "ready", running: true }).progressLabel,
    "Venter på oppstart",
  );
});

const projects = ["production", "beta", "openworks"] as const;
const old = {
  stage: "done",
  progress_kind: "last",
  progress: {
    stage: "done",
    visible: true,
    steps: Array.from({ length: 6 }, () => ({ state: "done" })),
  },
  steps: Array.from({ length: 5 }, () => ({ status: "done" })),
};
for (const project of projects) {
  test(`${project}: completed history never fills a new job before start`, () => {
    for (const value of [
      old,
      { ...old, stage: "ready" },
      { ...old, checking: true },
      { ...old, stage: "failed", operation: "check" },
    ]) {
      const view = projectProgress(project, value);
      assert.ok(view.steps.length > 0);
      assert.ok(view.steps.every((step) => step.status === "pending"));
    }
  });
  test(`${project}: a dispatch waiting on old done state cannot appear completed`, () => {
    const view = projectProgress(project, { ...old, running: true });
    assert.equal(view.kind, "waiting");
    assert.ok(view.steps.every((step) => step.status === "pending"));
  });
}
test("production progress clamps old and future ticks to the current phase", () => {
  const view = projectProgress("production", {
    ...old,
    progress_kind: "current",
    running: true,
    progress: { ...old.progress, stage: "core" },
  });
  assert.deepEqual(
    view.steps.map((step) => step.status),
    ["done", "done", "running", "pending", "pending", "pending"],
  );
});
test("OpenWorks status checks do not complete publishing steps", () => {
  const check = projectProgress("openworks", {
    stage: "checking",
    checking: true,
  });
  assert.equal(check.kind, "checking");
  assert.ok(check.steps.every((step) => step.status === "pending"));
  const publish = projectProgress("openworks", {
    stage: "publishing",
    running: true,
  });
  assert.deepEqual(
    publish.steps.map((step) => step.status),
    ["done", "running"],
  );
});
test("beta failure keeps only server-recorded progress for the publishing attempt", () => {
  const value = {
    operation: "publish",
    stage: "failed",
    steps: [
      { status: "done" },
      { status: "done" },
      { status: "failed" },
      { status: "pending" },
      { status: "pending" },
    ],
  };
  assert.deepEqual(
    projectProgress("beta", value).steps.map((step) => step.status),
    ["done", "done", "failed", "pending", "pending"],
  );
  assert.ok(
    projectProgress("beta", { ...value, operation: "check" }).steps.every(
      (step) => step.status === "pending",
    ),
  );
});
test("unknown or malformed state stays pending without inventing success", () => {
  for (const value of [
    null,
    [],
    {},
    { running: true, stage: "unknown", steps: [{ status: "done" }] },
  ])
    assert.ok(
      projectProgress("beta", value).steps.every(
        (step) => step.status === "pending",
      ),
    );
});

test("a fresh server-approved production check permits retry without erasing failure history", async () => {
  const { canRetryProduction } = await import("./model.ts");
  const now = 2000000000;
  const value = {
    failed: true, running: false,
    readiness: { can_start: true },
    update: { commit, checked_at: now, fresh: true, available: true, build: { ready: true } },
    progress: { failed: true, stage: "failed", steps: [{ state: "done" }, { state: "failed" }] },
  };
  assert.equal(canRetryProduction(value, now), true);
  assert.equal(projectProgress("production", value).kind, "failed");
  for (const patch of [
    { running: true }, { busy: true }, { checking: true },
    { readiness: { can_start: false } },
    ...[{ checked_at: now - 1800 }, { checked_at: now + 1 }, { error: "blocked" },
      { fresh: false }, { available: false }, { checking: true },
      { build: { ready: false } }, { commit: "invalid" }].map(update => ({ update: { ...value.update, ...update } })),
  ]) assert.equal(canRetryProduction({ ...value, ...patch }, now), false);
});
