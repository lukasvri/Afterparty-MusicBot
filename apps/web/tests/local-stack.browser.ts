// Real local Workers + D1 integration. All cached metadata and browser data are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Room, Video } from '../../../lib/types.ts';
import { visitorSQL } from '../../../lib/room-visitors.ts';

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
      const wrangler = async (toolchain: 'classic' | 'native', ...args: string[]) =>
        promisify(execFile)(
          process.execPath,
          [
            '--import',
            `${root}apps/web/scripts/runtime.ts`,
            `${root}${toolchain === 'native' ? 'apps/web/' : ''}node_modules/wrangler/bin/wrangler.js`,
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
      await wrangler('classic', 'migrations', 'apply', 'DB');
      const sqlValue = (value: string) => `'${value.replaceAll("'", "''")}'`;
      const bindSQL = (query: string, ...values: (string | number)[]) => {
        let index = 0;
        const bound = query.replace(/\?/g, () => {
          const value = values[index++];
          assert.notEqual(value, undefined, 'Every fixture SQL parameter must be bound');
          return typeof value === 'string' ? sqlValue(value) : String(value);
        });
        assert.equal(index, values.length);
        return bound;
      };
      const executeSQL = async (query: string) => {
        // Native Workerd can upgrade its private SQLite metadata. Use the CLI
        // matching the active DB owner, not the older Classic CLI after upgrade.
        const { stdout } = await wrangler(
          native ? 'native' : 'classic',
          'execute',
          'DB',
          '--command',
          query,
          '--json',
        );
        return JSON.parse(stdout) as {
          results: Record<string, unknown>[];
          meta?: { rows_read?: number; rows_written?: number };
        }[];
      };
      const rows = [`videos:v4:${track.id}`, 'search:v5:user:synthetic afterparty'];
      const sql = rows
        .map(
          (key) =>
            `INSERT INTO cached(key,data,expires_at) VALUES(${sqlValue(key)},${sqlValue(JSON.stringify([track]))},${Date.now() + 3600000}) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at;`,
        )
        .join('\n');
      await writeFile(`${runtime}/metadata.sql`, sql);
      await wrangler('classic', 'execute', 'DB', '--file', `${runtime}/metadata.sql`);

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
          vars: { AFTERPARTY_BETA_ENTRY: '1', ...(native ? { AFTERPARTY_NATIVE_API: '1' } : {}) },
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

      // The real migrated Worker must count only this room's unexpired visitors
      // and retain private/guild/expired directory filtering after index creation.
      const listed = await api<{ room: Room; token: string }>('/api/rooms', undefined, {
        name: 'Listed synthetic room',
        isPublic: true,
      });
      assert.equal(listed.status, 200);
      const listedCode = listed.data.room.code;
      const presenceNow = Date.now();
      const presenceSQL = [
        `DELETE FROM visitors WHERE room=${sqlValue(listedCode)}`,
        ...[1, 2, 3].map(
          (id) =>
            `INSERT INTO visitors VALUES(${sqlValue(`synthetic-active-${id}`)},${sqlValue(listedCode)},${presenceNow + 120000})`,
        ),
        `INSERT INTO visitors VALUES('synthetic-expired',${sqlValue(listedCode)},${presenceNow - 1})`,
        `INSERT INTO visitors VALUES('synthetic-private',${sqlValue(initial.code)},${presenceNow + 120000})`,
        `INSERT INTO rooms(code,name,owner_hash,state,version,updated_at,expires_at,is_public,guild_id) VALUES('GUILD001','Hidden guild','synthetic','{}',1,${presenceNow},${presenceNow + 120000},1,'111111111111111')`,
        `INSERT INTO rooms(code,name,owner_hash,state,version,updated_at,expires_at,is_public) VALUES('EXPIRED1','Expired room','synthetic','{}',1,${presenceNow},${presenceNow - 1},1)`,
        `EXPLAIN QUERY PLAN ${bindSQL(visitorSQL.count, listedCode, presenceNow)}`,
        `EXPLAIN QUERY PLAN ${bindSQL(visitorSQL.directory, presenceNow, presenceNow)}`,
      ].join(';\n');
      const plans = await executeSQL(presenceSQL);
      const details = plans.flatMap((entry) => entry.results).filter((row) => 'detail' in row);
      assert.equal(
        details.filter((row) => String(row.detail).includes('COVERING INDEX visitors_room_until'))
          .length,
        2,
      );
      const directory = await api<{ rooms: { code: string; viewers: number }[] }>('/api/rooms');
      assert.equal(directory.status, 200);
      assert.deepEqual(
        directory.data.rooms.map((row) => [row.code, row.viewers]),
        [[listedCode, 3]],
      );
      const counted = (await api<Room>(`/api/rooms/${listedCode}`)).data;
      assert.equal(counted.viewers, 4, 'the API read adds its own visitor heartbeat');
      const renewed = await executeSQL(
        bindSQL(
          visitorSQL.heartbeat,
          'synthetic-active-1',
          listedCode,
          presenceNow + 180000,
          presenceNow + 120001,
        ),
      );
      context.diagnostic(
        `Indexed local D1 heartbeat rows_written: ${renewed[0].meta?.rows_written ?? 'not exposed by local Wrangler'}`,
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
        assert.deepEqual(external, []);
      } finally {
        await browser.close();
      }
    },
  );
