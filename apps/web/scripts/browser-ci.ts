import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const web = fileURLToPath(new URL('../', import.meta.url));
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const extendedPack = 'tests/game-pack.browser.ts';
const independentPaths = new Set([
  'CHANGELOG.md',
  'lib/releases.json',
  'scripts/rooms.test.ts',
  'services/core/src/room-state.ts',
  'services/core/tests/rooms.test.ts',
  'apps/web/src/lib/concert/concert-audio.ts',
  'apps/web/src/lib/rooms/RoomAudio.svelte',
  'apps/web/src/lib/rooms/player-intent.ts',
  'apps/web/src/lib/rooms/room-client.ts',
  'apps/web/src/lib/ui/AppTheme.svelte',
  'apps/web/src/lib/ui/TheaterToggle.svelte',
  'apps/web/src/routes/+page.svelte',
  'apps/web/src/routes/discord/+page.svelte',
  'apps/web/tests/concert-audio.test.ts',
  'apps/web/tests/player-intent.test.ts',
  'apps/web/tests/room-client.test.ts',
  'apps/web/tests/discord.browser.ts',
  'apps/web/tests/player.browser.ts',
  'apps/web/tests/room-stream.browser.ts',
  'apps/web/tests/scenery.browser.ts',
  'apps/web/scripts/browser-ci.ts',
  'apps/web/tests/browser-ci.test.ts',
]);

/** Only the extended pack is optional; all other browser journeys stay enabled. */
export function browserArguments(command: string, event: string, paths: string[] | null) {
  const [node, test, ...args] = command.trim().split(/\s+/);
  if (node !== 'node' || test !== '--test' || !args.includes(extendedPack))
    throw new Error('Update the CI selector for the canonical browser test command.');
  const independent =
    event === 'pull_request' &&
    paths !== null &&
    paths.length > 0 &&
    paths.every((path) => independentPaths.has(path) || path.startsWith('docs/'));
  return ['--test', ...args.filter((arg) => !independent || arg !== extendedPack)];
}

export function changedPaths(base: string, head: string, repo = repository): string[] | null {
  if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha))) return null;
  const diff = spawnSync('git', ['diff', '--no-renames', '--name-only', '-z', base, head], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 10_000,
  });
  return diff.status === 0 && !diff.error ? diff.stdout.split('\0').filter(Boolean) : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { scripts } = JSON.parse(readFileSync(`${web}/package.json`, 'utf8'));
  const args = browserArguments(
    scripts['test:browser'],
    process.env.CI_EVENT_NAME ?? '',
    changedPaths(process.env.CI_BASE_SHA ?? '', process.env.CI_HEAD_SHA ?? ''),
  );
  console.log(
    args.includes(extendedPack)
      ? 'Browser scope: full suite, including the eight-round pack.'
      : 'Browser scope: playback and presentation; only the unrelated eight-round pack is omitted.',
  );
  const result = spawnSync(process.execPath, args, { cwd: web, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
