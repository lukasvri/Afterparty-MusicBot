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
const bridgeKey = 'synthetic-local-checkpoint-key';
const track: Video = {
  id: 'synthetic01',
  title: 'Local D1 soundtrack',
  artist: 'Synthetic Artist',
  duration: 240,
  image: '',
  live: false,
  embeddable: true,
};

for (const native of [false, true])
  test(
    `${native ? 'Native Svelte API' : 'Cloudflare service binding'} preserves D1 rooms, host guards, CSRF, revisions and UI readback`,
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
          vars: { ADMIN_BRIDGE_KEY: bridgeKey },
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
          main: native
            ? `${root}apps/web/.svelte-kit/v3-artifact/_worker.js`
            : `${root}apps/web/.svelte-kit/cloudflare/_worker.js`,
          compatibility_date: '2026-05-15',
          compatibility_flags: ['nodejs_compat'],
          assets: { directory: `${root}apps/web/.svelte-kit/cloudflare`, binding: 'ASSETS' },
          services: [{ binding: 'AFTERPARTY_API', service: 'afterparty-api-test' }],
          ...(native
            ? {
                d1_databases: [
                  {
                    binding: 'DB',
                    database_name: 'site-creator-d1',
                    database_id: '00000000-0000-4000-8000-000000000000',
                    migrations_dir: `${root}drizzle`,
                  },
                ],
              }
            : {}),
          vars: {
            AFTERPARTY_BETA_ENTRY: '1',
            ADMIN_BRIDGE_KEY: bridgeKey,
            ...(native ? { AFTERPARTY_NATIVE_API: '1' } : {}),
          },
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
      const apiWorker = startWorker(
        `${root}node_modules/wrangler/bin/wrangler.js`,
        config,
        apiPort,
      );
      await waitForWorker(`http://${new URL(origin).hostname}:${apiPort}/api/me`, apiWorker);
      const webWorker = startWorker(
        `${root}apps/web/node_modules/wrangler/bin/wrangler.js`,
        webConfig,
        Number(new URL(origin).port),
      );
      await waitForWorker(`${origin}/api/me`, webWorker);

      const landing = await fetch(`${origin}/?room=TESTROOM`, { redirect: 'manual' });
      assert.equal(landing.status, 307);
      assert.equal(landing.headers.get('Location'), `${origin}/v3?room=TESTROOM`);
      const classic = await fetch(`${origin}/?classic=1`, { redirect: 'manual' });
      assert.equal(classic.status, 200);
      assert.match(classic.headers.get('Content-Type') ?? '', /text\/html/);
      await classic.text();
      if (native) {
        // Stop the API Worker after proving rollback. Every following API/D1 and
        // browser operation must succeed in the standalone Svelte Worker.
        process.kill(-apiWorker.pid!, 'SIGTERM');
        await workers[0].closed;
      }

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
          throw new Error(
            `Local stack ${path}: ${response.status} ${text.slice(0, 500)}\n${output}`,
          );
        }
      }
      // Exercise the real bridge SQL in both Worker topologies. These are public
      // concert snapshots only; no Core, Discord or provider is contacted.
      const concertPath = '/api/rooms/D0C0FFEE';
      const concertState = {
        ready: true,
        connected: true,
        playing: true,
        position: 5,
        volume: 50,
        current: { ...track, concert: true },
        queue: [{ ...track, concert: false, title: 'Private Discord music' }],
        queueRevision: 'synthetic-checkpoint-queue',
        playbackKey: 'core:synthetic-entry',
      };
      const publishCheckpoint = (
        bridgeRevision: number,
        checkpointRevision: number,
        state = concertState,
      ) =>
        api('/api/bridge', bridgeKey, {
          guildId: '111111111111111',
          guildName: 'Synthetic checkpoint guild',
          roomCode: 'D0C0FFEE',
          bridgeRevision,
          checkpointRevision,
          state,
        });
      assert.equal((await publishCheckpoint(1, 1)).status, 200);
      const firstCheckpoint = (await api<Room>(concertPath)).data;
      assert.equal((await publishCheckpoint(2, 1, { ...concertState, position: 60 })).status, 200);
      const advancing = (await api<Room>(concertPath)).data;
      assert.equal(
        advancing.version,
        firstCheckpoint.version,
        'advancing heartbeat does not rewrite the D1 room',
      );
      assert(advancing.position >= 60 && advancing.position < 65);
      assert.deepEqual(
        advancing.queue,
        [],
        'ordinary Discord music is absent from public fallback',
      );
      assert.equal(advancing.isHost, false);
      await publishCheckpoint(3, 3, { ...concertState, playing: false, position: 60 });
      await publishCheckpoint(4, 4, { ...concertState, playing: false, position: 42 });
      const replacement = {
        ...concertState,
        playing: false,
        position: 0,
        current: {
          ...track,
          id: 'checkpoint1',
          title: 'Replacement checkpoint concert',
          concert: true,
        },
      };
      await publishCheckpoint(5, 5, replacement);
      const replaced = (await api<Room>(concertPath)).data;
      assert.equal(replaced.current?.id, 'checkpoint1');
      assert.equal(replaced.playing, false);
      await publishCheckpoint(2, 1, concertState);
      const afterReplay = (await api<Room>(concertPath)).data;
      assert.equal(afterReplay.version, replaced.version);
      assert.equal(afterReplay.current?.id, 'checkpoint1');
      assert.equal(afterReplay.playing, false);
      assert.equal(
        (await api('/api/bridge', 'wrong-synthetic-key', { state: concertState })).status,
        403,
      );

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
        await page.goto(`${origin}/?room=${room.code}`);
        assert.equal(page.url(), `${origin}/v3?room=${room.code}`);
        await page.getByRole('heading', { name: track.title, exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Resume playback' }).isEnabled(), true);
        await page
          .getByRole('textbox', { name: 'Search songs or artists' })
          .fill('synthetic afterparty');
        await page.getByRole('button', { name: 'Find music' }).click();
        await page.getByRole('button', { name: `Add ${track.title} to queue` }).waitFor();
        const browserCheckpoint = await page.evaluate(async (path) => {
          const response = await fetch(path, { cache: 'no-store' });
          return response.json() as Promise<{
            playing: boolean;
            current: { id: string };
            isHost: boolean;
          }>;
        }, concertPath);
        assert.equal(browserCheckpoint.current.id, 'checkpoint1');
        assert.equal(browserCheckpoint.playing, false);
        assert.equal(browserCheckpoint.isHost, false);
        await page.reload();
        await page.getByRole('heading', { name: track.title, exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Resume playback' }).isEnabled(), true);
        if (native) {
          await page.goto(`${origin}/patch-notes`);
          await page
            .getByText(
              'Core saves pause and resume choices immediately for restart recovery, closing the gap before the next playback clock tick.',
              { exact: true },
            )
            .waitFor();
          for (const width of [390, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await page
              .locator('article')
              .first()
              .screenshot({ path: `${root}.sites-runtime/checkpoint-notes-${width}.png` });
          }
        }
        assert.deepEqual(external, []);
      } finally {
        await browser.close();
      }
    },
  );
