// Real local Workers + D1 integration. All cached metadata and browser data are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  'the native website preserves D1 rooms, host guards, CSRF, revisions and UI readback',
  { timeout: 60000 },
  async (context) => {
    await mkdir(`${root}.sites-runtime`, { recursive: true });
    const runtime = await mkdtemp(`${root}.sites-runtime/native-test-`),
      config = `${runtime}/worker.json`;
    const cli = `${root}apps/web/node_modules/wrangler/bin/wrangler.js`;
    await writeFile(
      config,
      JSON.stringify({
        name: 'afterparty-native-test',
        main: `${root}dist/server/index.js`,
        no_bundle: true,
        compatibility_date: '2026-05-15',
        compatibility_flags: ['nodejs_compat'],
        assets: { directory: `${root}dist/client`, binding: 'ASSETS' },
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'afterparty-native-test',
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
          cli,
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
    let output = '';
    const workers: { process: ReturnType<typeof spawn>; closed: Promise<void> }[] = [];
    context.after(async () => {
      for (const { process: child, closed } of workers)
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          process.kill(-child.pid, 'SIGTERM');
          const force = setTimeout(() => {
            try {
              process.kill(-child.pid!, 'SIGKILL');
            } catch {
              /* The child may already have exited after SIGTERM. */
            }
          }, 3000);
          await closed;
          clearTimeout(force);
        }
      await rm(runtime, { recursive: true, force: true });
    });
    await wrangler('migrations', 'apply', 'DB');
    const sqlValue = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const rows = [`videos:v4:${track.id}`, 'search:v5:user:synthetic afterparty'];
    const sql = rows
      .map(
        (key) =>
          `INSERT INTO cached(key,data,expires_at) VALUES(${sqlValue(key)},${sqlValue(JSON.stringify([track]))},${Date.now() + 3600000}) ON CONFLICT(key) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at;`,
      )
      .join('\n');
    const legacyRooms = [
      ['DISCORD1', '111111111111111'],
      ['D0ABC123', '222222222222222'],
    ]
      .map(
        ([code, guild]) =>
          `INSERT INTO rooms(code,name,owner_hash,state,version,updated_at,expires_at,guild_id) VALUES(${sqlValue(code)},'Synthetic concert','synthetic',${sqlValue(JSON.stringify({ current: null, queue: [], playing: false, position: 0 }))},1,${Date.now()},${Date.now() + 60000},${sqlValue(guild)});`,
      )
      .join('\n');
    await writeFile(`${runtime}/metadata.sql`, sql + '\n' + legacyRooms);
    await wrangler('execute', 'DB', '--file', `${runtime}/metadata.sql`);
    const child = spawn(
      process.execPath,
      [
        '--import',
        `${root}apps/web/scripts/runtime.ts`,
        cli,
        'dev',
        '--config',
        config,
        '--local',
        '--persist-to',
        `${runtime}/state`,
        '--ip',
        new URL(origin).hostname,
        '--port',
        String(new URL(origin).port),
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
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      try {
        const response = await fetch(`${origin}/api/me`, { signal: AbortSignal.timeout(1000) });
        await response.text();
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Retry only within the bounded local startup window. */
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert(ready, `Local native Worker did not start: ${output}`);
    const landing = await fetch(`${origin}/?room=TESTROOM`, { redirect: 'manual' });
    assert.equal(landing.status, 200);
    assert.match(landing.headers.get('content-type') ?? '', /text\/html/);
    await landing.text();
    for (const [from, to] of [
      ['/v3?room=TESTROOM', '/?room=TESTROOM'],
      ['/v3/discord?guildId=111111111111111', '/discord?guildId=111111111111111'],
    ]) {
      const legacy = await fetch(origin + from, { redirect: 'manual' });
      assert.equal(legacy.status, 307);
      assert.equal(new URL(legacy.headers.get('location')!, origin).href, origin + to);
    }
    const retiredSelector = await fetch(`${origin}/?classic=1`, { redirect: 'manual' });
    assert.equal(retiredSelector.status, 200);
    assert.match(await retiredSelector.text(), /Create private room/);
    assert.equal((await fetch(`${origin}/unported-classic-page`)).status, 404);
    for (const [code, guild] of [
      ['DISCORD1', '111111111111111'],
      ['D0ABC123', '222222222222222'],
    ]) {
      const response = await fetch(`${origin}/?room=${code}&view=concert&guildId=333333333333333`, {
        redirect: 'manual',
      });
      assert.equal(response.status, 307);
      const target = new URL(response.headers.get('location')!, origin);
      assert.equal(target.pathname, '/discord');
      assert.equal(target.searchParams.get('guildId'), guild);
      assert.equal(target.searchParams.get('view'), 'concert');
      assert.equal(target.searchParams.has('room'), false);
    }
    assert.equal((await fetch(`${origin}/?room=D0BAD123`, { redirect: 'manual' })).status, 404);

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
      await page.goto(`${origin}/?room=${room.code}`);
      assert.equal(page.url(), `${origin}/?room=${room.code}`);
      await page.getByRole('heading', { name: track.title, exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Resume playback' }).isEnabled(), true);
      await page
        .getByRole('textbox', { name: 'Search songs or artists' })
        .fill('synthetic afterparty');
      await page.getByRole('button', { name: 'Find music' }).click();
      await page.getByRole('button', { name: `Add ${track.title} to queue` }).waitFor();
      await page.goto(`${origin}/?room=D0ABC123&view=concert#bookmark`);
      const concertURL = new URL(page.url());
      assert.equal(concertURL.pathname, '/discord');
      assert.equal(concertURL.searchParams.get('guildId'), '222222222222222');
      assert.equal(concertURL.searchParams.get('view'), 'concert');
      assert.equal(concertURL.hash, '#bookmark');
      assert.deepEqual(external, []);
    } finally {
      await browser.close();
    }
  },
);
