import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

// Keep local Wrangler state inside the project without using global tool state.
const runtime = fileURLToPath(new URL('../../../.sites-runtime/', import.meta.url));
process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= 'false';
process.env.WRANGLER_SEND_METRICS ??= 'false';
process.env.WRANGLER_WRITE_LOGS ??= 'false';
process.env.WRANGLER_LOG_PATH ??= `${runtime}/wrangler/logs`;
process.env.WRANGLER_REGISTRY_PATH ??= `${runtime}/wrangler/dev-registry`;
process.env.MINIFLARE_REGISTRY_PATH ??= `${runtime}/wrangler/registry`;
process.env.XDG_CONFIG_HOME ??= `${runtime}/config`;
for (const path of [
  process.env.WRANGLER_LOG_PATH,
  process.env.WRANGLER_REGISTRY_PATH,
  process.env.MINIFLARE_REGISTRY_PATH,
  process.env.XDG_CONFIG_HOME,
])
  mkdirSync(path, { recursive: true });
