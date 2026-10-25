import { mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: { "test:unit": string } };
if (!pkg.scripts["test:unit"].startsWith("node --test ")) throw new Error("Update the coverage runner for the changed root unit-test command.");
const classicTests = pkg.scripts["test:unit"].replace(/^node --test /, "").split(" ");
mkdirSync(new URL("../coverage/", import.meta.url), { recursive: true });
for (const suite of [
  { name: "classic", include: "lib/**/*.ts", args: classicTests },
  { name: "core", include: "services/core/src/**/*.ts", args: ["--test-concurrency=1", "--test-timeout=30000", "services/core/tests/*.test.ts"] },
  { name: "v3", include: "apps/web/src/lib/**/*.ts", args: ["--test-isolation=none", "apps/web/tests/*.test.ts"] },
]) {
  const output = `coverage/${suite.name}.lcov`;
  const result = spawnSync(process.execPath, [
    "--test", "--experimental-test-coverage", `--test-coverage-include=${suite.include}`,
    "--test-reporter=spec", "--test-reporter-destination=stdout",
    "--test-reporter=lcov", `--test-reporter-destination=${output}`, ...suite.args,
  ], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (!/^SF:/m.test(readFileSync(new URL(`../${output}`, import.meta.url), "utf8")))
    throw new Error(`${suite.name} did not produce instrumented source coverage.`);
}
