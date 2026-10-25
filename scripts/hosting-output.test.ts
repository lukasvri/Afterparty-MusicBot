import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeWebsiteOutput, writeWebsiteConfig, localWebsiteConfig } from "./website-output.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "afterparty-native-output-"));
  for (const path of ["drizzle", "private", "apps/web/.svelte-kit/v3-artifact", "apps/web/.svelte-kit/cloudflare", "dist/client"])
    mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, "apps/web/.svelte-kit/v3-artifact/_worker.js"), "export default {fetch(){return new Response('native')}};");
  writeFileSync(join(root, "apps/web/.svelte-kit/v3-artifact/README.md"), "review metadata");
  writeFileSync(join(root, "apps/web/.svelte-kit/cloudflare/_worker.js"), "unbundled private Worker source");
  writeFileSync(join(root, "apps/web/.svelte-kit/cloudflare/app.js"), "native client fixture");
  writeFileSync(join(root, "dist/client/stale.js"), "retired UI");
  writeFileSync(join(root, "private/hosting.local.json"), JSON.stringify({ d1: "DB", r2: null, project_id: "synthetic-private-project" }));
  for (const name of ["0000.sql", "0001.sql"]) writeFileSync(join(root, "drizzle", name), "-- synthetic migration\n");
  return root;
}

test("native packaging preserves selected host identity, migrations and compiled bytes", () => {
  const root = fixture();
  try {
    const selected = readFileSync(join(root, "private/hosting.local.json"), "utf8");
    const panelAssets = {"manifest.json": '{"version":1}', "update-channel.0123456789ab.js": 'private panel fixture'};
    writeWebsiteOutput(root, { hostingConfigFile: "private/hosting.local.json", updatePanelAssets: panelAssets });
    for (const [name, bytes] of Object.entries(panelAssets)) {
      assert.equal(readFileSync(join(root, "dist/.openai/update-panel", name), "utf8"), bytes);
      assert.equal(existsSync(join(root, "dist/client", name)), false);
    }
    assert.equal(existsSync(join(root, "dist/client/.openai")), false);
    assert.equal(readFileSync(join(root, "dist/server/index.js"), "utf8"), readFileSync(join(root, "apps/web/.svelte-kit/v3-artifact/_worker.js"), "utf8"));
    assert.equal(readFileSync(join(root, "dist/client/app.js"), "utf8"), "native client fixture");
    assert.equal(existsSync(join(root, "dist/client/_worker.js")), false);
    assert.equal(existsSync(join(root, "dist/client/stale.js")), false);
    assert.equal(existsSync(join(root, "dist/server/README.md")), false);
    assert.equal(readFileSync(join(root, "dist/.openai/hosting.json"), "utf8"), selected);
    assert.equal(readFileSync(join(root, "private/hosting.local.json"), "utf8"), selected);
    for (const name of ["0000.sql", "0001.sql"]) assert.equal(readFileSync(join(root, "dist/.openai/drizzle", name), "utf8"), readFileSync(join(root, "drizzle", name), "utf8"));
    const config = JSON.parse(readFileSync(join(root, "dist/server/wrangler.json"), "utf8"));
    assert.equal(config.main, "index.js");
    assert.equal(config.assets.directory, "../client");
    assert.equal(config.assets.run_worker_first, false);
    assert.equal(config.d1_databases[0].migrations_dir, "../.openai/drizzle");
    assert.equal(config.keep_vars, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an incomplete native bundle leaves existing deployment output intact", () => {
  const root = fixture();
  try {
    rmSync(join(root, "apps/web/.svelte-kit/v3-artifact/_worker.js"));
    assert.throws(() => writeWebsiteOutput(root));
    assert.equal(readFileSync(join(root, "dist/client/stale.js"), "utf8"), "retired UI");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("binding Cloudflare configuration preserves compiled panel, Worker, identity and migrations", () => {
  const root = fixture();
  try {
    const panel = {"manifest.json": '{"version":1}', "update-channel.0123456789ab.js": "private panel fixture"};
    writeWebsiteOutput(root, { hostingConfigFile: "private/hosting.local.json", updatePanelAssets: panel });
    const paths = ["server/index.js", "client/app.js", ".openai/hosting.json", ".openai/drizzle/0000.sql", ...Object.keys(panel).map(name => ".openai/update-panel/" + name)];
    const before = paths.map(path => readFileSync(join(root, "dist", path), "utf8"));
    writeWebsiteConfig(root, {...localWebsiteConfig, name: "synthetic-cloudflare-target"});
    assert.deepEqual(paths.map(path => readFileSync(join(root, "dist", path), "utf8")), before);
    const config = JSON.parse(readFileSync(join(root, "dist/server/wrangler.json"), "utf8"));
    assert.equal(config.name, "synthetic-cloudflare-target");
    assert.equal(config.assets.directory, "../client");
    assert.equal(config.assets.run_worker_first, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
