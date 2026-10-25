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

for (const authority of [false, true])
  test(
    authority
      ? 'Native Core authority checkpoints presence, returns offline fallback and rejects stale restoration'
      : 'the native website preserves D1 rooms, host guards, CSRF, revisions and UI readback',
    { timeout: 60000 },
    async (context) => {
      await mkdir(`${root}.sites-runtime`, { recursive: true });
      const runtime = await mkdtemp(`${root}.sites-runtime/native-test-`),
        config = `${runtime}/worker.json`;
      const cli = `${root}apps/web/node_modules/wrangler/bin/wrangler.js`;
      const coreOrigin = 'https://synthetic-core.invalid';
      const coreConfig = `${runtime}/core.json`;
      const apiEntry = `${root}dist/server/checkpoint-fixture.js`;
      const fixtureOrigin = `http://${new URL(origin).hostname}:${Number(new URL(origin).port) + 1}`;
      if (authority) {
        // Test-only fixed-origin fetch routing. Production HTTPS validation and
        // the actual Core/Worker protocol remain intact; no real host is contacted.
        const wrapper = (
          entry: string,
        ) => `import worker from '${entry}';import {env} from 'cloudflare:workers';
          const original=globalThis.fetch.bind(globalThis);
          globalThis.fetch=(input,init)=>new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url).origin===${JSON.stringify(coreOrigin)}?env.CORE_FIXTURE.fetch(new Request(input,init)):original(input,init);
          export default {fetch(request,bindings,context){
            if(new URL(request.url).pathname==='/__fixture/checkpoint'){
              if(request.headers.get('authorization')!=='Bearer '+${JSON.stringify(bridgeKey)})return new Response('Forbidden',{status:403});
              return Promise.all([bindings.DB.prepare("SELECT key,state,updated_at FROM bot_state ORDER BY key").all(),bindings.DB.prepare("SELECT code,guild_id,state,version,updated_at FROM rooms ORDER BY code").all()]).then(([bots,rooms])=>Response.json({bots:bots.results,rooms:rooms.results}));
            }
            return worker.fetch(request,bindings,context);
          }};`;
        await writeFile(apiEntry, wrapper('./index.js'));
        await writeFile(
          `${runtime}/core.js`,
          `let state=null,available=true;export default{async fetch(request){
          const url=new URL(request.url);if(url.pathname==='/health')return new Response('ok');
          if(request.headers.get('authorization')!=='Bearer '+${JSON.stringify(bridgeKey)})return new Response('Forbidden',{status:403});
          if(url.pathname==='/fixture'&&request.method==='POST'){const input=await request.json();state=input.state??state;available=input.available!==false;return Response.json({ok:true});}
          if(!available)return new Response('Offline',{status:503});
          if(!state||url.searchParams.has('guildId')&&url.searchParams.get('guildId')!==state.guildId||url.searchParams.has('room')&&url.searchParams.get('room')!==state.roomCode)return new Response('Wrong guild',{status:404});
          return Response.json({state:{...state,online:true,serverTime:Date.now()}});
        }};`,
        );
        await writeFile(
          coreConfig,
          JSON.stringify({
            name: 'afterparty-core-fixture',
            main: `${runtime}/core.js`,
            compatibility_date: '2026-05-15',
          }),
        );
      }

      await writeFile(
        config,
        JSON.stringify({
          name: 'afterparty-native-test',
          main: authority ? apiEntry : `${root}dist/server/index.js`,
          no_bundle: true,
          compatibility_date: '2026-05-15',
          compatibility_flags: ['nodejs_compat'],
          assets: { directory: `${root}dist/client`, binding: 'ASSETS' },
          vars: {
            ADMIN_BRIDGE_KEY: bridgeKey,
            ...(authority ? { GUTTA_CORE_PUBLIC_URL: coreOrigin } : {}),
          },
          ...(authority
            ? { services: [{ binding: 'CORE_FIXTURE', service: 'afterparty-core-fixture' }] }
            : {}),
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
        for (const { process: child, closed } of workers.reverse())
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
        if (authority) await rm(apiEntry, { force: true });
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
      if (authority) {
        const coreWorker = spawn(
          process.execPath,
          [
            '--import',
            `${root}apps/web/scripts/runtime.ts`,
            cli,
            'dev',
            '--config',
            coreConfig,
            '--local',
            '--ip',
            new URL(origin).hostname,
            '--port',
            String(Number(new URL(origin).port) + 1),
            '--inspector-port',
            '0',
          ],
          { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        const collect = (chunk: Buffer) => {
          output = (output + chunk).slice(-8000);
        };
        coreWorker.stdout.on('data', collect);
        coreWorker.stderr.on('data', collect);
        workers.push({
          process: coreWorker,
          closed: new Promise<void>((resolve) => coreWorker.once('exit', () => resolve())),
        });
        let ready = false;
        for (let attempt = 0; attempt < 60; attempt++) {
          if (coreWorker.exitCode !== null || coreWorker.signalCode !== null) break;
          try {
            const response = await fetch(fixtureOrigin + '/health', {
              signal: AbortSignal.timeout(1000),
            });
            await response.text();
            if (response.ok) {
              ready = true;
              break;
            }
          } catch {
            /* Retry within the bounded synthetic Core startup window. */
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        assert(ready, `Synthetic Core fixture did not start: ${output}`);
      }
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
        const response = await fetch(
          `${origin}/?room=${code}&view=concert&guildId=333333333333333`,
          {
            redirect: 'manual',
          },
        );
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
          throw new Error(
            `Local stack ${path}: ${response.status} ${text.slice(0, 500)}\n${output}`,
          );
        }
      }
      if (authority) {
        const guildId = '111111111111111',
          roomCode = 'D0C0FFEE',
          path = '/api/rooms/' + roomCode;
        let current = {
          ready: true,
          connected: true,
          playing: true,
          position: 5,
          volume: 50,
          current: { ...track, concert: true },
          queue: [{ ...track, concert: false }],
          queueRevision: 'queue',
          playbackKey: 'core:entry',
          epoch: 'epoch-current',
          sequence: 1,
          buffering: false,
          guildId,
          roomCode,
          engine: 'gutta-krutt-core',
        };
        const core = async (available = true) => {
          const result = await fetch(fixtureOrigin + '/fixture', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + bridgeKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: current, available }),
          });
          assert.equal(result.status, 200);
        };
        const publish = (bridgeRevision: number, checkpointRevision: number, state = current) =>
          api('/api/bridge', bridgeKey, {
            guildId,
            roomCode,
            presenceCapability: 'core-authority-v1',
            bridgeRevision,
            checkpointRevision,
            state,
          });
        await core();
        assert.equal((await publish(10, 10)).status, 200);
        const stored = async () => (await api('/__fixture/checkpoint', bridgeKey)).data;
        const initial = await stored();
        for (const incomingGuild of ['222222222222222', undefined]) {
          for (const ordered of [false, true]) {
            const rejected = await api('/api/bridge', bridgeKey, {
              ...(incomingGuild ? { guildId: incomingGuild } : {}),
              roomCode,
              state: current,
              ...(ordered ? { bridgeRevision: 100, checkpointRevision: 100 } : {}),
            });
            assert.equal(rejected.status, 200);
            assert.deepEqual((rejected.data as { commands: unknown[] }).commands, []);
            assert.deepEqual(
              await stored(),
              initial,
              'a legacy guild or unscoped frame cannot replace another authority room or heartbeat',
            );
          }
        }

        current = { ...current, position: 65 };
        await core();
        await publish(11, 10);
        assert.deepEqual(await stored(), initial, 'advancing Core presence does not touch D1');
        const live = (await api<Room>(path)).data;
        assert.equal(live.position, 65);
        assert.equal(live.playing, true);
        assert.equal(live.queue.length, 0);
        assert.equal(live.syncSource, 'live');
        current = { ...current, playing: false, position: 42, sequence: 2 };
        await core();
        await publish(12, 12);
        const paused = (await api<Room>(path)).data;
        assert.equal(paused.playing, false);
        assert.equal(paused.position, 42);
        await core(false);
        const before = await stored();
        await publish(13, 12);
        assert.deepEqual(await stored(), before);
        const offline = (await api<Room>(path)).data;
        assert.equal(offline.discordOnline, false);
        assert.equal(offline.playing, false);
        assert.equal(offline.position, 42);
        assert.equal(offline.syncValidForMs, 0);
        const control = await api('/api/discord', undefined, {
          action: 'resume',
          guildId,
          playbackKey: 'core:entry',
          commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        });
        assert.equal(control.status, 503);
        await core();
        assert.equal((await api<Room>(path)).data.playing, false);
        current = { ...current, epoch: 'restored-backup', sequence: 0 };
        await core();
        const restored = await publish(2, 2);
        assert.equal(restored.status, 409);
        assert.equal((restored.data as { code: string }).code, 'bridge_reconciliation_required');
        const browser = await chromium.launch({
          headless: true,
          executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
          args: ['--no-sandbox'],
        });
        try {
          const page = await browser.newPage();
          await page.goto(origin + '/');
          const result = await page.evaluate(async (path) => {
            const first = (await (await fetch(path)).json()) as Room;
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { first, second: (await (await fetch(path)).json()) as Room };
          }, path);
          assert.equal(result.first.playing, false);
          assert.equal(result.second.playing, false);
          assert.equal(result.second.isHost, false);
        } finally {
          await browser.close();
        }
        return;
      }
      // Exercise the real bridge SQL in the native Worker. These are public
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
        assert.equal(page.url(), `${origin}/?room=${room.code}`);
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

        await page.goto(`${origin}/?room=D0ABC123&view=concert#bookmark`);
        const concertURL = new URL(page.url());
        assert.equal(concertURL.pathname, '/discord');
        assert.equal(concertURL.searchParams.get('guildId'), '222222222222222');
        assert.equal(concertURL.searchParams.get('view'), 'concert');
        assert.equal(concertURL.hash, '#bookmark');
        await page.goto(`${origin}/patch-notes`);
        for (const width of [390, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        }
        assert.deepEqual(external, []);
      } finally {
        await browser.close();
      }
    },
  );
