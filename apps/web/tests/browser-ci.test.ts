import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { browserArguments, changedPaths } from '../scripts/browser-ci.ts';

const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const command = scripts['test:browser'] as string;
const pack = 'tests/game-pack.browser.ts';
const full = command.trim().split(/\s+/).slice(1);

test('main and manual runs always retain the canonical full browser suite', () => {
  for (const event of ['push', 'workflow_dispatch', ''])
    assert.deepEqual(browserArguments(command, event, ['docs/README.md']), full);
});

test('music presentation changes omit only the extended pack, preserving game smoke and audio', () => {
  const args = browserArguments(command, 'pull_request', [
    'apps/web/src/lib/rooms/RoomAudio.svelte',
    'apps/web/src/lib/ui/AppTheme.svelte',
    'services/core/src/room-state.ts',
    'docs/UI_REVIEW.md',
  ]);
  assert.deepEqual(
    args,
    full.filter((arg) => arg !== pack),
  );
  assert(args.includes('tests/games.browser.ts'));
  assert(args.includes('tests/game-night.browser.ts'));
  assert(args.includes('tests/game-audio.browser.ts'));
  assert(args.includes('--test-concurrency=2'));
});

test('game, dependency, shared, workflow and unknown changes retain the full pack', () => {
  for (const path of [
    'apps/web/src/lib/games/game-client.ts',
    'services/core/src/guess-game.ts',
    'services/core/src/protocol.ts',
    'apps/web/tests/game-pack.browser.ts',
    'package-lock.json',
    'apps/web/package.json',
    '.github/workflows/core.yml',
    'lib/types.ts',
    'unknown.ts',
  ])
    assert.deepEqual(
      browserArguments(command, 'pull_request', ['apps/web/src/lib/rooms/RoomAudio.svelte', path]),
      full,
      path,
    );
});

test('missing, empty and invalid diffs cannot reduce browser coverage', () => {
  for (const paths of [null, []])
    assert.deepEqual(browserArguments(command, 'pull_request', paths), full);
  assert.equal(changedPaths('', ''), null);
  assert.equal(changedPaths('--help', 'a'.repeat(40)), null);
  assert.equal(changedPaths('a'.repeat(40), 'b'.repeat(40)), null);
});

test('a changed command contract cannot silently drop browser tests', () => {
  assert.throws(() => browserArguments('npm test', 'pull_request', ['docs/README.md']));
  assert.throws(() => browserArguments('node --test tests/games.browser.ts', 'pull_request', []));
});

test('renaming a game file into a playback path cannot hide its game change', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'afterparty-ci-scope-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=CI fixture',
      '-c',
      'user.email=ci@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-qm',
      'fixture',
    );
    return git('rev-parse', 'HEAD');
  };
  const before = 'apps/web/src/lib/games/game-client.ts';
  const after = 'apps/web/src/lib/rooms/RoomAudio.svelte';
  git('init', '-q');
  mkdirSync(join(repo, 'apps/web/src/lib/games'), { recursive: true });
  mkdirSync(join(repo, 'apps/web/src/lib/rooms'), { recursive: true });
  writeFileSync(join(repo, before), 'identical fixture');
  const base = commit();
  renameSync(join(repo, before), join(repo, after));
  const head = commit();
  const paths = changedPaths(base, head, repo);
  assert(paths?.includes(before));
  assert(paths?.includes(after));
  assert.deepEqual(browserArguments(command, 'pull_request', paths), full);
});
