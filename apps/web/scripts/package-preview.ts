import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// Bundle an already tested build. Never publish or read deployment credentials.
const output = '.svelte-kit/v3-artifact';
const result = spawnSync(
  process.execPath,
  [
    '--import',
    './scripts/runtime.ts',
    'node_modules/wrangler/bin/wrangler.js',
    'deploy',
    '--dry-run',
    '--config',
    'wrangler.jsonc',
    '--outdir',
    output,
  ],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
mkdirSync(output, { recursive: true });
writeFileSync(
  `${output}/wrangler.jsonc`,
  JSON.stringify(
    {
      name: 'afterparty-v3-review-local',
      main: '_worker.js',
      compatibility_date: '2026-05-15',
      compatibility_flags: ['nodejs_compat'],
      assets: { directory: '../cloudflare', binding: 'ASSETS' },
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'afterparty-v3-review-local',
          database_id: '00000000-0000-4000-8000-000000000000',
        },
      ],
      workers_dev: false,
      preview_urls: false,
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  `${output}/README.md`,
  'Afterparty v3 review bundle. No publication or deployment has occurred.\n\nKeep this directory beside cloudflare/ for assets. The generated wrangler.jsonc is a local-only template with a synthetic D1 identity. Apply the existing repository migrations with --local before testing rooms. Use the reviewed operator runbook and explicit approval for deployment.\n',
);
