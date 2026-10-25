import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.env.npm_execpath) throw new Error("Run this installer with npm run install:ci.");
const root = fileURLToPath(new URL("../", import.meta.url));
// Install the tooling, sole native website and independent Core from their locks.
for (const [directory, extra] of [[root, []], [`${root}/apps/web`, []], [`${root}/services/core`, ["--omit=peer", "--ignore-scripts"]]] as const) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, "ci", "--prefix", directory,
    "--include=dev", "--include=optional", "--no-audit", "--no-fund", ...extra],
    { cwd: root, stdio: "inherit", timeout: 8 * 60_000, killSignal: "SIGTERM" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
