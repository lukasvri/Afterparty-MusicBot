import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedConfig } from "vite";
import { sites } from "../build/sites-vite-plugin.ts";

function hooks(root: string, config: string, command: "build" | "serve") {
  const plugin = sites({ hostingConfigFile: config });
  assert.equal(typeof plugin.configResolved, "function");
  assert.equal(typeof plugin.closeBundle, "function");
  if (typeof plugin.configResolved !== "function" || typeof plugin.closeBundle !== "function") throw Error("Missing build hooks");
  plugin.configResolved.call({} as never, { root, command } as ResolvedConfig);
  return () => {
    if (typeof plugin.closeBundle !== "function") throw Error("Missing build hook");
    return plugin.closeBundle.call({} as never);
  };
}

test("website build retains selected host bindings and every migration", async () => {
  const root = await mkdtemp(join(tmpdir(), "afterparty-hosting-"));
  try {
    await mkdir(join(root, "drizzle"));
    await mkdir(join(root, "private"));
    await mkdir(join(root, "dist/.openai/drizzle"), { recursive: true });
    await writeFile(join(root, "dist/.openai/drizzle/stale.sql"), "outdated");
    const configuration = JSON.stringify({ d1: "DB", r2: null });
    await writeFile(join(root, "private/hosting.local.json"), configuration);
    await writeFile(join(root, "drizzle/0000.sql"), "CREATE TABLE synthetic(id TEXT);");
    await writeFile(join(root, "drizzle/0001.sql"), "ALTER TABLE synthetic ADD COLUMN title TEXT;");
    await hooks(root, "private/hosting.local.json", "build")();
    assert.equal(await readFile(join(root, "dist/.openai/hosting.json"), "utf8"), configuration);
    for (const name of ["0000.sql", "0001.sql"]) assert.equal(
      await readFile(join(root, "dist/.openai/drizzle", name), "utf8"),
      await readFile(join(root, "drizzle", name), "utf8"),
    );
    await assert.rejects(access(join(root, "dist/.openai/drizzle/stale.sql")));
    assert.equal(await readFile(join(root, "private/hosting.local.json"), "utf8"), configuration);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("development previews leave existing deployment output untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "afterparty-preview-"));
  try {
    await mkdir(join(root, "dist/.openai"), { recursive: true });
    await writeFile(join(root, "dist/.openai/hosting.json"), "synthetic previous output");
    await hooks(root, "missing-config.json", "serve")();
    assert.equal(await readFile(join(root, "dist/.openai/hosting.json"), "utf8"), "synthetic previous output");
  } finally { await rm(root, { recursive: true, force: true }); }
});
