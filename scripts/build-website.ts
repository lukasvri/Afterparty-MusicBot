import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeWebsiteOutput } from "./website-output.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
if (!process.env.npm_execpath) throw new Error("Run this build with npm run build.");
for (const script of ["build", "package:preview"]) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, "--prefix", "apps/web", "run", script],
    { cwd: root, stdio: "inherit", timeout: 5 * 60_000, killSignal: "SIGTERM" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
writeWebsiteOutput(root);
