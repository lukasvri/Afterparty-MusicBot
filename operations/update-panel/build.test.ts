import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUpdatePanel, buildProgressModel, panelSources } from "./build.ts";

const source = fileURLToPath(new URL("./", import.meta.url));
const digest = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

test("private TypeScript panel compiles into standalone browser bytes with source and asset hashes", () => {
  const assets = buildUpdatePanel(source);
  const manifest = JSON.parse(assets["manifest.json"]);
  assert.equal(manifest.version, 1);
  assert.equal(Object.keys(assets).length, 3);
  const script = assets[manifest.script];
  assert.match(script, /afterparty-update\/api\/beta/);
  assert.doesNotMatch(
    script,
    /(?:from|import)\s*["']\.\/model\.(?:ts|mjs)["']/,
  );
  for (const name of panelSources)
    assert.equal(
      manifest.sources[name],
      digest(readFileSync(resolve(source, name))),
    );
  for (const name of [manifest.script, manifest.css]) {
    assert.equal(manifest.assets[name], digest(assets[name]));
    assert.ok(name.includes(digest(assets[name]).slice(0, 12)));
  }
  assert.deepEqual(buildUpdatePanel(source), assets);
});

test("changing reviewed panel input invalidates compiler source freshness", () => {
  const directory = mkdtempSync(join(tmpdir(), "afterparty-panel-input-"));
  try {
    for (const name of panelSources)
      writeFileSync(join(directory, name), readFileSync(join(source, name)));
    const before = JSON.parse(buildUpdatePanel(directory)["manifest.json"]);
    writeFileSync(
      join(directory, "panel.html"),
      '<section id="afterparty-beta-panel">Synthetic changed panel</section>',
    );
    const after = JSON.parse(buildUpdatePanel(directory)["manifest.json"]);
    assert.notEqual(after.sources["panel.html"], before.sources["panel.html"]);
    assert.equal(after.script, before.script);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Python-only installer accepts the real compiled asset contract", () => {
  const directory = mkdtempSync(join(tmpdir(), "afterparty-panel-compiled-"));
  try {
    const assets = buildUpdatePanel(source);
    for (const [name, bytes] of Object.entries(assets))
      writeFileSync(join(directory, name), bytes);
    const result = spawnSync(
      "python3",
      [
        "-c",
        [
          "import sys",
          "from pathlib import Path",
          "sys.path.insert(0, sys.argv[1])",
          "from update_panel import compiled_assets",
          "assets, script, css = compiled_assets(Path(sys.argv[1]), Path(sys.argv[2]))",
          "assert len(assets) == 2 and script in assets and css in assets",
        ].join("\n"),
        source,
        directory,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("standalone multi-project model uses the same lifecycle rules as the channel UI", async () => {
  const model = await import(
    "data:text/javascript;base64," +
      Buffer.from(buildProgressModel(source)).toString("base64")
  );
  for (const project of ["production", "beta", "openworks"]) {
    const state = {
      running: false,
      stage: "done",
      progress: { stage: "done", steps: [{ state: "done" }] },
      steps: [{ status: "done" }],
      progress_kind: "last",
    };
    const view = model.projectProgress(project, state);
    assert.equal(view.kind, "planned");
    assert.ok(
      view.steps.every((step: { status: string }) => step.status === "pending"),
    );
  }
});
