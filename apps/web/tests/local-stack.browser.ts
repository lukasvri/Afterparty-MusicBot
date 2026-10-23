// Real local Workers + D1 integration. All cached metadata and browser data are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Room, Video } from '../../../lib/types.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const origin = new URL(process.env.PREVIEW_URL ?? 'http://127.0.0.1:5175').origin;
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const visitor = 'c'.repeat(32);
const track: Video = {
  id: 'synthetic01',
  title: 'Local D1 soundtrack',
  artist: 'Synthetic Artist',
  duration: 240,
  image: '',
  live: false,
  embeddable: true,
};

test(
  'Cloudflare service binding preserves D1 rooms, host guards, CSRF, revisions and UI readback',
  { timeout: 60000 },
  async (context) => {
    await mkdir(`${root}.sites-runtime`, { recursive: true });
    const runtime = await mkdtemp(`${root}.sites-runtime/svelte-test-`);
    const config = `${runtime}/d1.json`;
    const builtApi = JSON.parse(await readFile(`${root}dist/server/wrangler.json`, 'utf8'));
    await writeFile(
      config,
      JSON.stringify({
        name: 'afterparty-api-test',
        main: `${root}dist/server/index.js`,
        no_bundle: true,
        rules: builtApi.rules,
        compatibility_flags: builtApi.compatibility_flags,
        assets: { directory: `${root}dist/client` },
        compatibility_date: '2026-05-15',
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'site-creator-d1',
            database_id: '00000000-0000-4000-8000-000000000000',
            migrations_dir: `${root}drizzle`,
          },
        ],
      }),
    );
    const wrangler = async (...args: string[]) =>
      promisify(execFile)(
        process.execPath,
        [
          '--import',
          `${root}apps/web/scripts/runtime.ts`,
          `${root}node_modules/wrangler/bin/wrangler.js`,
          'd1',
          ...args,
          '--local',
          '--config',
          config,
          '--persist-to',
          `${runtime}/state`,
        ],
        { cwd: root, env: { ...process.env, XDG_CONFIG_HOME: `${root}.sites-runtime/config` } },
      );
    await wrangler('migrations', 'apply', 'DB');
    const sqlValue = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const rows = [`videos:v4:${track.id}`, 'search:v5:user:synthetic afterparty'];
    const sql = rows
      .map(
        (key) =>
          `INSERT INTO cached(key,data,expires_at) VALUES(${sqlValue(key)},${sqlValue(JSON.stringify([track]))},${Date.now() + 3600000}) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at;`,
      )
      .join('\n');
    await writeFile(`${runtime}/metadata.sql`, sql);
    await wrangler('execute', 'DB', '--file', `${runtime}/metadata.sql`);

    const webConfig = `${runtime}/web.json`;
    await writeFile(
      webConfig,
      JSON.stringify({
        name: 'afterparty-web-test',
        main: `${root}apps/web/.svelte-kit/cloudflare/_worker.js`,
        compatibility_date: '2026-05-15',
        compatibility_flags: ['nodejs_compat'],
        assets: { directory: `${root}apps/web/.svelte-kit/cloudflare`, binding: 'ASSETS' },
        services: [{ binding: 'AFTERPARTY_API', service: 'afterparty-api-test' }],
      }),
    );
    let output = '';
    const workers: { process: ReturnType<typeof spawn>; closed: Promise<void> }[] = [];
    context.after(async () => {
      for (const { process: child, closed } of workers.reverse()) {
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          process.kill(-child.pid, 'SIGTERM');
          const force = setTimeout(() => {
            try {
              process.kill(-child.pid!, 'SIGKILL');
            } catch {
              /* already stopped */
            }
          }, 3000);
          await closed;
          clearTimeout(force);
        }
      }
      await rm(runtime, { recursive: true, force: true });
    });
    const startWorker = (cli: string, workerConfig: string, port: number) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          `${root}apps/web/scripts/runtime.ts`,
          cli,
          'dev',
          '--config',
          workerConfig,
          '--local',
          '--persist-to',
          `${runtime}/state`,
          '--ip',
          new URL(origin).hostname,
          '--port',
          String(port),
          '--inspector-port',
          '0',
        ],
        { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const collect = (chunk: Buffer) => {
        output = (output + chunk).slice(-8000);
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      workers.push({
        process: child,
        closed: new Promise<void>((resolve) => child.once('exit', () => resolve())),
      });
      return child;
    };
    const waitForWorker = async (url: string, child: ReturnType<typeof spawn>) => {
      for (let attempt = 0; attempt < 60; attempt++) {
        if (child.exitCode !== null || child.signalCode !== null) break;
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
          await response.text();
          if (response.ok) return;
        } catch {
          /* starting */
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.fail(`Local Worker did not start: ${output}`);
    };
    // Each application retains its tested Wrangler version. The shared local
    // registry connects the same service binding used by the preview topology.
    const apiPort = Number(new URL(origin).port) + 1;
    const apiWorker = startWorker(`${root}node_modules/wrangler/bin/wrangler.js`, config, apiPort);
    await waitForWorker(`http://${new URL(origin).hostname}:${apiPort}/api/me`, apiWorker);
    const webWorker = startWorker(
      `${root}apps/web/node_modules/wrangler/bin/wrangler.js`,
      webConfig,
      Number(new URL(origin).port),
    );
    await waitForWorker(`${origin}/api/me`, webWorker);

    async function api<T>(path: string, token?: string, input?: unknown, sourceOrigin = origin) {
      const response = await fetch(origin + path, {
        method: input === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Afterparty-Visitor': visitor,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(input === undefined ? {} : { Origin: sourceOrigin }),
        },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      });
      const text = await response.text();
      try {
        return { status: response.status, data: JSON.parse(text) as T };
      } catch {
        throw new Error(`Local stack ${path}: ${response.status} ${text.slice(0, 500)}\n${output}`);
      }
    }
    const created = await api<{ room: Room; token: string }>('/api/rooms', undefined, {
      name: 'Synthetic D1 room',
      isPublic: false,
    });
    assert.equal(created.status, 200);
    const { token, room: initial } = created.data;
    assert.match(token, /^[a-f0-9]{64}$/);
    const path = `/api/rooms/${initial.code}`;
    let room = (await api<Room>(path, token)).data;
    assert.equal(room.isHost, true);
    assert.equal((await api<Room>(path)).data.isHost, false);
    assert.equal(
      (await api(path, undefined, { action: 'pause', version: room.version })).status,
      403,
    );
    assert.equal(
      (
        await api(
          path,
          token,
          { action: 'pause', version: room.version },
          'https://foreign.invalid',
        )
      ).status,
      403,
    );
    // Avoid any recommendation/provider work. No production Core or API keys are configured.
    let result = await api<{ room: Room }>(path, token, {
      action: 'radio',
      enabled: false,
      version: room.version,
    });
    assert.equal(result.status, 200);
    room = result.data.room;
    const search = await api<{ videos: Video[] }>('/api/search?q=synthetic%20afterparty');
    assert.equal(search.status, 200);
    assert.equal(search.data.videos[0].id, track.id);
    result = await api(path, token, { action: 'add', version: room.version, videoId: track.id });
    assert.equal(result.status, 200);
    room = result.data.room;
    assert.equal(room.current?.title, track.title);
    assert.equal(
      (await api(path, token, { action: 'play', version: room.version - 1 })).status,
      409,
    );
    for (const command of [
      { action: 'play' },
      { action: 'seek', position: 42 },
      { action: 'pause' },
    ]) {
      result = await api(path, token, { ...command, version: room.version });
      assert.equal(result.status, 200);
      room = result.data.room;
    }
    const persisted = (await api<Room>(path, token)).data;
    assert.equal(persisted.playing, false);
    assert(persisted.position >= 42 && persisted.position < 44);
    const another = await api<{ room: Room; token: string }>('/api/rooms', undefined, {
      name: 'Separate synthetic room',
      isPublic: false,
    });
    assert.equal(another.status, 200);
    assert.equal(
      (await api<Room>(path, another.data.token)).data.isHost,
      false,
      'another room token cannot gain host access',
    );
    assert.equal(
      (await api<Room>(`/api/rooms/${another.data.room.code}`, another.data.token)).data.current,
      null,
    );

    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH,
      args: ['--no-sandbox'],
    });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.addInitScript(
        ({ code, token, visitor }) => {
          localStorage.setItem(`afterparty-host:${code}`, token);
          localStorage.setItem('afterparty-visitor', visitor);
        },
        { code: room.code, token, visitor },
      );
      const external: string[] = [];
      await page.route('**/*', (route) => {
        if (new URL(route.request().url()).origin !== origin) {
          external.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(`${origin}/v3?room=${room.code}`);
      await page.getByRole('heading', { name: track.title, exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Resume playback' }).isEnabled(), true);
      await page
        .getByRole('textbox', { name: 'Search songs or artists' })
        .fill('synthetic afterparty');
      await page.getByRole('button', { name: 'Find music' }).click();
      await page.getByRole('button', { name: `Add ${track.title} to queue` }).waitFor();
      assert.deepEqual(external, []);
    } finally {
      await browser.close();
    }
  },
);
