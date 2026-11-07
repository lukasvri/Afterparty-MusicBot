import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const action = process.argv[2] ?? "check";
if (action !== "setup" && action !== "check") {
  console.error("Usage: node scripts/cloud.ts setup|check");
  process.exit(2);
}

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 24 || (major === 24 && minor < 17)) {
  console.error("Node.js 24.17+ is required.");
  process.exit(1);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("Run npm run setup:cloud or npm run check:all.");
  process.exit(1);
}

const root = fileURLToPath(new URL("../", import.meta.url));
const python = process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

if (spawnSync(python, ["-c", "import sys; sys.exit(sys.version_info < (3, 11))"], { cwd: root, stdio: "ignore" }).status !== 0) {
  console.error("Python 3.11+ is required. Set PYTHON_PATH if it is not on PATH.");
  process.exit(1);
}
if (spawnSync(ffmpeg, ["-version"], { cwd: root, stdio: "ignore" }).status !== 0) {
  console.error("FFmpeg is required for the real audio tests. Set FFMPEG_PATH if it is not on PATH.");
  process.exit(1);
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const npm = (...args: string[]) => run(process.execPath, [npmCli, ...args]);
if (action === "setup") {
  npm("run", "install:ci");
} else {
  npm("run", "lint");
  npm("run", "audit:unused");
  run(python, ["-m", "unittest", "discover", "-s", "tests", "-v"]);
  run(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false"]);
  npm("run", "test:unit");
  npm("--prefix", "services/core", "run", "check");
  npm("--prefix", "services/core", "test");
  npm("--prefix", "apps/web", "run", "format:check");
  npm("--prefix", "apps/web", "run", "check");
  npm("--prefix", "apps/web", "test");
  npm("run", "build");
}
