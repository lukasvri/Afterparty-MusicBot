import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";

export const panelSources = [
  "channel.ts",
  "model.ts",
  "channel.css",
  "panel.html",
] as const;
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

/** Compile once on the build machine; the private Python host never needs Node. */
export function buildUpdatePanel(source: string): Record<string, string> {
  const result = buildSync({
    entryPoints: [resolve(source, "channel.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    sourcemap: false,
    legalComments: "none",
    charset: "utf8",
    logLevel: "silent",
  });
  const script = result.outputFiles[0].text;
  const css = readFileSync(resolve(source, "channel.css"), "utf8");
  const scriptName = `update-channel.${digest(script).slice(0, 12)}.js`;
  const cssName = `update-channel.${digest(css).slice(0, 12)}.css`;
  const assets = { [scriptName]: script, [cssName]: css };
  const manifest = {
    version: 1,
    script: scriptName,
    css: cssName,
    sources: Object.fromEntries(
      panelSources.map((name) => [
        name,
        digest(readFileSync(resolve(source, name))),
      ]),
    ),
    assets: Object.fromEntries(
      Object.entries(assets).map(([name, bytes]) => [name, digest(bytes)]),
    ),
  };
  return {
    ...assets,
    "manifest.json": JSON.stringify(manifest, null, 2) + "\n",
  };
}
