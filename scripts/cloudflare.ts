import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { cloudflareConfig, projectRoot, verifyCloudflareOutput, writeCloudflareConfig } from "./cloudflare-config.ts";

import { writeWebsiteConfig } from "./website-output.ts";

const command = process.argv[2];
if (!["build", "deploy", "verify"].includes(command) || process.argv.length !== 3) throw new Error("Expected build, verify or deploy without extra arguments.");
const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_WRITE_LOGS: "false",
  WRANGLER_LOG_PATH: ".wrangler/logs",
  CLOUDFLARE_CF_FETCH_ENABLED: "false",
};
const config = command === "build" ? writeCloudflareConfig(env, projectRoot) : cloudflareConfig(env, projectRoot);
function run(script: string, args: string[]) {
  const result = spawnSync(process.execPath, [resolve(projectRoot, script), ...args], { cwd: projectRoot, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (command === "build") {
  run("scripts/build-website.ts", []);
  writeWebsiteConfig(projectRoot, config);
}
verifyCloudflareOutput(projectRoot, config);
if (command === "deploy") run("apps/web/node_modules/wrangler/bin/wrangler.js", ["deploy", "--config", "dist/server/wrangler.json"]);
