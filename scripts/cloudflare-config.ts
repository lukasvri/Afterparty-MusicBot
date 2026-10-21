import { readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const cloudflareConfigPath = "wrangler.cloudflare.local.json";
export function deploymentTarget(value = process.env.AFTERPARTY_DEPLOY_TARGET) {
  if (value === undefined || value === "sites") return "sites";
  if (value === "cloudflare") return "cloudflare";
  throw new Error("AFTERPARTY_DEPLOY_TARGET must be sites or cloudflare.");
}
export function cloudflareConfig(env: Record<string, string | undefined>, root: string) {
  const name = env.CF_WORKER_NAME;
  const databaseName = env.CF_D1_DATABASE_NAME;
  const databaseId = env.CF_D1_DATABASE_ID;
  const validName = (value: string | undefined) =>
    value && /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(value) &&
    !/replace|placeholder/.test(value);
  if (!validName(name)) throw new Error("Set a valid CF_WORKER_NAME.");
  if (!validName(databaseName)) throw new Error("Set a valid CF_D1_DATABASE_NAME.");
  if (
    !databaseId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(databaseId) ||
    /^00000000-/.test(databaseId)
  ) {
    throw new Error("Set a valid non-placeholder CF_D1_DATABASE_ID.");
  }
  const template = JSON.parse(readFileSync(resolve(root, "wrangler.cloudflare.jsonc"), "utf8"));
  return {
    ...template,
    name,
    d1_databases: [{
      ...template.d1_databases[0],
      database_name: databaseName,
      database_id: databaseId,
    }],
  };
}
export function writeCloudflareConfig(env: Record<string, string | undefined>, root: string) {
  const config = cloudflareConfig(env, root);
  writeFileSync(resolve(root, cloudflareConfigPath), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  return config;
}
export function verifyCloudflareOutput(root: string, expected: ReturnType<typeof cloudflareConfig>) {
  const path = resolve(root, "dist/server/wrangler.json");
  const output = JSON.parse(readFileSync(path, "utf8"));
  if (
    output.keep_vars !== true ||
    output.name !== expected.name ||
    output.compatibility_date !== expected.compatibility_date ||
    !output.compatibility_flags?.includes("nodejs_compat") ||
    output.d1_databases?.length !== 1 ||
    output.d1_databases[0].binding !== "DB" ||
    output.d1_databases[0].database_id !== expected.d1_databases[0].database_id ||
    output.d1_databases[0].database_name !== expected.d1_databases[0].database_name
  ) {
    throw new Error("Cloudflare build identity or DB binding mismatch. Rebuild before deployment.");
  }
  if (typeof output.main !== "string" || typeof output.assets?.directory !== "string") throw new Error("Missing built worker or client assets.");
  for (const value of [output.main, output.assets.directory]) {
    const target = resolve(dirname(path), value);
    if (!target.startsWith(resolve(root, "dist") + sep)) throw new Error("Build paths must stay within dist.");
  }
  if (!statSync(resolve(dirname(path), output.main)).isFile() ||
      !statSync(resolve(dirname(path), output.assets.directory)).isDirectory()) {
    throw new Error("Built worker or client assets are missing.");
  }
  return output;
}
export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
