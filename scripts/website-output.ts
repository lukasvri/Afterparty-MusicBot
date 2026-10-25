import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const localWebsiteConfig = {
  name: "afterparty-local",
  compatibility_date: "2026-05-15",
  compatibility_flags: ["nodejs_compat"],
  keep_vars: true,
  workers_dev: false,
  preview_urls: false,
  d1_databases: [{ binding: "DB", database_name: "afterparty-local", database_id: "00000000-0000-4000-8000-000000000000" }],
};

/** Package already-built native bytes using the signed installer's stable layout. */
export function writeWebsiteOutput(root: string, options: { config?: typeof localWebsiteConfig; hostingConfigFile?: string; updatePanelAssets?: Record<string, string> } = {}) {
  const bundle = resolve(root, "apps/web/.svelte-kit/v3-artifact"), assets = resolve(root, "apps/web/.svelte-kit/cloudflare");
  if (!existsSync(resolve(bundle, "_worker.js")) || !existsSync(assets)) throw new Error("Build and bundle the native website before packaging.");
  const hosting = options.hostingConfigFile ?? (existsSync(resolve(root, ".openai/hosting.local.json")) ? ".openai/hosting.local.json" : ".openai/hosting.json");
  const hostingBytes = readFileSync(resolve(root, hosting));
  const selected = JSON.parse(hostingBytes.toString());
  if (selected.d1 !== "DB" || selected.r2 !== null) throw new Error("The native website requires the existing DB binding template.");
  for (const name of Object.keys(options.updatePanelAssets ?? {})) {
    if (!/^(?:manifest\.json|update-channel\.[a-f0-9]{12}\.(?:js|css))$/.test(name)) throw new Error("Invalid private panel asset name.");
  }
  const output = resolve(root, "dist"), server = resolve(output, "server");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(server, { recursive: true });
  cpSync(assets, resolve(output, "client"), { recursive: true });
  // Generated Worker source is never part of the public static asset directory.
  rmSync(resolve(output, "client/_worker.js"), { recursive: true, force: true });
  for (const entry of readdirSync(bundle)) {
    if (["README.md", "wrangler.jsonc"].includes(entry)) continue;
    cpSync(resolve(bundle, entry), resolve(server, entry === "_worker.js" ? "index.js" : entry), { recursive: true });
  }
  const config = options.config ?? localWebsiteConfig;
  writeFileSync(resolve(server, "wrangler.json"), JSON.stringify({ ...config,
    main: "index.js", assets: { directory: "../client", binding: "ASSETS" },
    d1_databases: config.d1_databases.map(database => ({ ...database, migrations_dir: "../.openai/drizzle" })),
  }, null, 2) + "\n");
  mkdirSync(resolve(output, ".openai"), { recursive: true });
  writeFileSync(resolve(output, ".openai/hosting.json"), hostingBytes);
  if (options.updatePanelAssets) {
    const panel = resolve(output, ".openai/update-panel");
    mkdirSync(panel, { recursive: true });
    for (const [name, content] of Object.entries(options.updatePanelAssets)) {
      writeFileSync(resolve(panel, name), content);
    }
  }
  cpSync(resolve(root, "drizzle"), resolve(output, ".openai/drizzle"), { recursive: true });
}
