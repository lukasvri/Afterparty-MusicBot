import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudflareConfig, deploymentTarget, projectRoot, verifyCloudflareOutput, writeCloudflareConfig } from "./cloudflare-config.ts";

const env = { CF_WORKER_NAME: "afterparty-test", CF_D1_DATABASE_NAME: "afterparty-test-db", CF_D1_DATABASE_ID: "12345678-1234-4123-8123-123456789abc" };
test("deployment target defaults to Sites and rejects typos", () => {
  assert.equal(deploymentTarget("sites"), "sites");
  assert.equal(deploymentTarget("cloudflare"), "cloudflare");
  assert.throws(() => deploymentTarget("Cloudflare"));
  assert.throws(() => deploymentTarget(""));
});
test("deployment config fails closed on absent or placeholder identities", () => {
  assert.throws(() => cloudflareConfig({}, projectRoot));
  for (const key of Object.keys(env)) {
    for (const value of ["", "REPLACE_ME", "../escape", " value "]) {
      assert.throws(() => cloudflareConfig({ ...env, [key]: value }, projectRoot));
    }
  }
  assert.throws(() => cloudflareConfig({ ...env, CF_D1_DATABASE_ID: "00000000-0000-4000-8000-000000000000" }, projectRoot));
});
test("native config preserves worker, DB migration path and compatibility without Sites overrides", () => {
  const config = cloudflareConfig(env, projectRoot);
  assert.equal(config.main, "build/sites-worker.ts");
  assert.equal(config.d1_databases[0].binding, "DB");
  assert.equal(config.d1_databases[0].migrations_dir, "drizzle");
  assert.equal(config.d1_databases[0].database_id, env.CF_D1_DATABASE_ID);
  assert.deepEqual(config.compatibility_flags, ["nodejs_compat"]);
  assert.equal(config.preview_urls, false);
  assert.equal(config.keep_vars, true);
  assert.equal(config.routes, undefined);
  const vite = readFileSync(join(projectRoot, "vite.config.ts"), "utf8");
  assert.match(vite, /target === "sites" \? \[sites\(\{ hostingConfigFile \}\)\] : \[\]/);
  assert.match(vite, /target === "cloudflare"\s*\? \{ configPath: cloudflareConfigPath \}\s*: \{ config: \{ \.\.\.localBindingConfig \} \}/);
});
test("generated config and artifact verification detect stale identities and escaping paths", () => {
  const root = mkdtempSync(join(tmpdir(), "afterparty-cf-"));
  try {
    writeFileSync(join(root, "wrangler.cloudflare.jsonc"), readFileSync(join(projectRoot, "wrangler.cloudflare.jsonc")));
    const expected = writeCloudflareConfig(env, root);
    mkdirSync(join(root, "dist/server"), { recursive: true });
    mkdirSync(join(root, "dist/client"));
    writeFileSync(join(root, "dist/server/index.js"), "export default {};");
    const output = { ...expected, main: "index.js", assets: { directory: "../client" } };
    const save = (data: unknown) => writeFileSync(join(root, "dist/server/wrangler.json"), JSON.stringify(data));
    save(output);
    assert.equal(verifyCloudflareOutput(root, expected).name, env.CF_WORKER_NAME);
    save({ ...output, keep_vars: false });
    assert.throws(() => verifyCloudflareOutput(root, expected));
    save({ ...output, name: "different-worker" });
    assert.throws(() => verifyCloudflareOutput(root, expected));
    save({ ...output, main: "../../outside.js" });
    assert.throws(() => verifyCloudflareOutput(root, expected));
    save({ ...output, d1_databases: [] });
    assert.throws(() => verifyCloudflareOutput(root, expected));
    save({ ...output, assets: undefined });
    assert.throws(() => verifyCloudflareOutput(root, expected));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
