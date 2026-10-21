// Real Workerd Request/fetch, source routes, D1 authority and temporary Core.
// Only the HTTPS network hop is bridged to a loopback Core with synthetic data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { Miniflare, Response as WorkerResponse } from 'miniflare';
import { Store } from '../services/core/src/store.ts';
import { Engine } from '../services/core/src/engine.ts';
import { Commands } from '../services/core/src/commands.ts';
import { Providers } from '../services/core/src/providers.ts';
import { createServers } from '../services/core/src/server.ts';
import { SyntheticGuessSource } from '../services/core/src/guess-synthetic.ts';
import type { Sink } from '../services/core/src/audio.ts';
import type { GuessResult } from '../services/core/src/guess-game.ts';
import { GUESS_AUDIO_MAX_BYTES, guessWaveSeconds } from '../services/core/src/guess-audio-format.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const key = 'synthetic-worker-test-key', owner = 'synthetic-room-owner';
type Result = GuessResult & { token?: string; canManage: boolean };

test('Worker media proxy serves authorized synthetic WAV and rejects redirects without following them', { timeout: 45000 }, async () => {
  const store = new Store(':memory:'), writes: string[] = [];
  const sink: Sink = { onIdle: null, onError: null, play() { writes.push('play'); }, pause() { writes.push('pause'); },
    resume() { writes.push('resume'); }, stop() { writes.push('stop'); }, duration: () => 0, advancing: () => false, buffering: () => false };
  const engine = new Engine(store, new Providers(store, { NODE_ENV: 'test' }), sink), commands = new Commands(engine);
  clearInterval(engine.timer); engine.ready = true;
  engine.current = { id: 'abcdefghijk', entryId: 'synthetic-current', title: 'Private fixture music', artist: 'Fixture artist', image: '', duration: 600, live: false, embeddable: true, concert: false };
  engine.queue = [{ ...engine.current, entryId: 'synthetic-queued' }];
  const music = () => structuredClone({ current: engine.current, queue: engine.queue, revision: engine.revision(), queueRevision: commands.concertQueue.revision(), paused: engine.paused });
  const before = music(), source = new SyntheticGuessSource();
  let server: Awaited<ReturnType<typeof createServers>> | undefined;
  let worker: Miniflare | undefined;
  let redirect = 0, mediaRequests = 0, preparations = 0;
  try {
    server = await createServers(engine, commands, { key, origin: 'https://site.example', host: '127.0.0.1', publicPort: 0, guessCatalog: source, guessMedia: source,
      prepareSource: async () => { preparations++; return true; }, sourceState: () => 'ready' });
    const core = `http://127.0.0.1:${(server.publicServer.address() as { port: number }).port}`;
    const bundle = await build({
      stdin: { contents: `import { POST as game } from './app/api/guess/route.ts';
        import { POST as media } from './app/api/guess/media/route.ts';
        export default { fetch(request) { return new URL(request.url).pathname === '/api/guess/media' ? media(request) : game(request); } };`, resolveDir: root, loader: 'ts' },
      bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'],
    });
    // Test the project's flags, and separately the optional incoming-signal flag.
    // Both must work; this regression is not fixed by enable_request_signal.
    for (const flags of [['nodejs_compat'], ['nodejs_compat', 'enable_request_signal']]) {
      worker = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-05-15', compatibilityFlags: flags,
        d1Databases: ['DB'], bindings: { GUTTA_CORE_PUBLIC_URL: 'https://core.example', ADMIN_BRIDGE_KEY: key },
        outboundService: async request => {
          assert.equal(request.url, 'https://core.example/v1/guess', 'no redirect destination or other upstream route is allowed');
          assert.equal(request.method, 'POST');
          assert.equal(request.headers.get('authorization'), 'Bearer ' + key);
          const input = await request.json() as Record<string, unknown>;
          if (input.action === 'prepare') {
            for (const field of ['providerUrl', 'inventoryPath', 'pack', 'sourceState', 'canPrepare']) assert.equal(field in input, false, field);
          }
          if (input.action === 'media') {
            mediaRequests++;
            assert.equal(input.host, false, 'guest media authority comes from D1, not supplied host:true');
            assert.equal('providerUrl' in input, false); assert.equal('mediaKey' in input, false);
            if (redirect) return new WorkerResponse(redirect === 304 ? null : 'private upstream detail', { status: redirect, headers: {
              Location: 'https://untrusted.example/private-audio', 'X-Provider-Title': 'private title',
            } });
          }
          const response = await fetch(core + '/v1/guess', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify(input), signal: request.signal, redirect: 'manual' });
          return new WorkerResponse(await response.arrayBuffer(), { status: response.status, headers: response.headers });
        },
      });
      const db = await worker.getD1Database('DB');
      for (const name of (await readdir(new URL('../drizzle/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) {
        const sql = await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8');
        for (const statement of sql.split(';').map(value => value.replaceAll('--> statement-breakpoint', '').trim()).filter(Boolean)) await db.prepare(statement).run();
      }
      const room = flags.length === 1 ? 'WORKER01' : 'WORKER02';
      await db.prepare('INSERT INTO rooms(code,name,owner_hash,state,updated_at,expires_at) VALUES(?,?,?,?,?,?)')
        .bind(room, 'Worker fixture', createHash('sha256').update(owner).digest('hex'), JSON.stringify({ current: null, queue: [], playing: false, position: 0 }), Date.now(), Date.now() + 600000).run();
      const call = (path: string, input: Record<string, unknown>, credential = '') => worker!.dispatchFetch('https://site.example' + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://site.example', ...(credential ? { Authorization: 'Bearer ' + credential } : {}) },
        body: JSON.stringify({ scope: 'room', scopeId: room, ...input }),
      });
      const action = async (input: Record<string, unknown>, credential = '') => {
        const response = await call('/api/guess', input, credential);
        assert.equal(response.status, 200, await response.clone().text()); return await response.json() as Result;
      };
      let host = await action({ action: 'join', eventId: randomUUID() }, owner);
      const guest = await action({ action: 'join', eventId: randomUUID() });
      const hostToken = host.token, guestToken = guest.token;
      host = await action({ action: 'read', token: hostToken }, owner);
      const prepare = { action: 'prepare', token: hostToken, eventId: randomUUID(), sessionId: host.game.sessionId,
        roundId: null, revision: host.game.revision, providerUrl: 'https://untrusted.example/source',
        inventoryPath: '/private/source.json', pack: 'forged', sourceState: 'ready', canPrepare: true, host: true };
      const previousPreparations = preparations;
      assert.equal((await call('/api/guess', { ...prepare, token: guestToken })).status, 403);
      assert.equal(preparations, previousPreparations, 'forged guest authority cannot prepare audio');
      host = await action(prepare, owner);
      assert.equal(preparations, previousPreparations + 1, 'the real Worker route reaches the fixed source callback');
      assert.equal((await call('/api/guess', prepare, owner)).status, 409, 'replayed preparation cannot reach the callback again');
      assert.equal(preparations, previousPreparations + 1);
      host = await action({ action: 'start', token: hostToken, eventId: randomUUID(), sessionId: host.game.sessionId, roundId: null, revision: host.game.revision }, owner);
      assert.equal(host.game.phase, 'round');
      await delay(Math.max(0, host.game.round!.startsAt - Date.now()));
      const fields = { action: 'media', token: guestToken, sessionId: host.game.sessionId, roundId: host.game.round!.roundId, host: true, providerUrl: 'https://untrusted.example/song', mediaKey: 'forged' };
      const response = await call('/api/guess/media', { ...fields, eventId: randomUUID() });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('content-type'), 'audio/wav');
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert.equal(bytes.length, GUESS_AUDIO_MAX_BYTES); assert.equal(guessWaveSeconds(bytes), 30);
      assert(bytes.subarray(44).some(byte => byte !== 0), 'generated PCM is not silent');
      for (let status = 300; status < 400; status++) {
        redirect = status;
        const previous = mediaRequests, denied = await call('/api/guess/media', { ...fields, eventId: randomUUID() });
        assert.equal(denied.status, 502, `upstream redirect ${status}`);
        assert.equal(mediaRequests, previous + 1, 'one upstream request only');
        assert.equal(denied.headers.get('location'), null); assert.equal(denied.headers.get('x-provider-title'), null);
        assert.deepEqual(await denied.json(), { error: 'Game preview is unavailable. Reconnect and try again.' });
      }
      redirect = 0;
      const forged = await call('/api/guess', { action: 'end', token: guestToken, host: true, eventId: randomUUID(), sessionId: host.game.sessionId, revision: host.game.revision });
      assert.equal(forged.status, 403);
      const stale = await call('/api/guess/media', { ...fields, roundId: randomUUID(), eventId: randomUUID() });
      assert.equal(stale.status, 409);
      const missing = await call('/api/guess/media', { ...fields, scopeId: 'ABSENT01', eventId: randomUUID() });
      assert.equal(missing.status, 404);
      assert.deepEqual(music(), before); assert.deepEqual(writes, []);
      await worker.dispose(); worker = undefined;
    }
  } finally {
    await worker?.dispose(); await server?.close(); store.db.close();
  }
});
