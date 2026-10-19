import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {WebSocketServer} from 'ws';
import type {Sink} from '../src/audio.ts';
import {Commands} from '../src/commands.ts';
import {Engine} from '../src/engine.ts';
import {Guilds, type GuildSession} from '../src/guilds.ts';
import {Providers} from '../src/providers.ts';
import {Rooms} from '../src/rooms.ts';
import {createServers} from '../src/server.ts';
import {Store} from '../src/store.ts';

// Isolate a deliberately failed startup so the regression itself cannot leave
// leaked baseline servers or timers in the test runner.
type Failure = 'public' | 'invalid';
async function startupProbe(failed: Failure, withGuilds: boolean) {
  const blocker = http.createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  const blockedPort = (blocker.address() as {port: number}).port;
  const store = new Store(':memory:');
  const sink: Sink = {onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {}, duration: () => 0, advancing: () => false, buffering: () => false};
  const engine = new Engine(store, new Providers(store, {}), sink);
  const commands = new Commands(engine);
  engine.current = {id: 'abcdefghijk', entryId: 'private-entry', title: 'Synthetic', artist: 'Artist', image: '', duration: 100, live: false, embeddable: true, concert: false, requestedBy: 'synthetic-private'};
  const guilds = new Guilds('100000000000001');
  if (withGuilds) guilds.register({id: guilds.defaultId, name: 'Synthetic', roomCode: 'DISCORD1', engine, commands, bot: {} as GuildSession['bot']});
  const baseline = {state: engine.listenerCount('state'), clock: engine.listenerCount('clock'), added: guilds.listenerCount('added'), removed: guilds.listenerCount('removed')};
  const intervals = new Set<ReturnType<typeof setInterval>>();
  const servers: http.Server[] = [];
  const originalCreateServer = http.createServer;
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  const originalDispose = Rooms.prototype.dispose;
  const originalWsClose = WebSocketServer.prototype.close;
  const disposedTables: string[] = [];
  let disposed = 0, websocketClosed = 0;
  http.createServer = ((...args: Parameters<typeof http.createServer>) => {
    const server = originalCreateServer(...args);
    servers.push(server);
    return server;
  }) as typeof http.createServer;
  syncBuiltinESMExports();
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const timer = originalInterval(...args);
    intervals.add(timer);
    return timer;
  }) as typeof setInterval;
  globalThis.clearInterval = ((timer: Parameters<typeof clearInterval>[0]) => {
    intervals.delete(timer as ReturnType<typeof setInterval>);
    originalClear(timer);
  }) as typeof clearInterval;
  Rooms.prototype.dispose = function () { disposed++; disposedTables.push(this.table); return originalDispose.call(this); };
  WebSocketServer.prototype.close = function (...args: Parameters<typeof originalWsClose>) { websocketClosed++; return originalWsClose.apply(this, args); };
  let recovered: Awaited<ReturnType<typeof createServers>> | undefined;
  try {
    const options = {key: 'synthetic-key', origin: 'https://site.example', host: '127.0.0.1', ...(withGuilds ? {guilds} : {})};
    let errorCode = '';
    try {
      await createServers(engine, commands, {...options, publicPort: failed === 'invalid' ? -1 : blockedPort});
    } catch (error) { errorCode = (error as NodeJS.ErrnoException).code ?? ''; }
    // Rollback must complete before the rejected call returns.
    await new Promise<void>(resolve => setImmediate(resolve));
    const afterFailure = {
      errorCode, created: servers.length, intervals: intervals.size, disposed, disposedTables: [...disposedTables].sort(), websocketClosed,
      listening: servers.filter(server => server.listening).length,
      errorListeners: servers.reduce((sum, server) => sum + server.listenerCount('error'), 0),
      state: engine.listenerCount('state') - baseline.state,
      clock: engine.listenerCount('clock') - baseline.clock,
      added: guilds.listenerCount('added') - baseline.added,
      removed: guilds.listenerCount('removed') - baseline.removed,
    };
    // Release the deliberate blocker, then reuse its port for a healthy startup.
    await new Promise<void>(resolve => blocker.close(() => resolve()));
    recovered = await createServers(engine, commands, {...options, publicPort: blockedPort});
    const port = (recovered.publicServer.address() as {port: number}).port;
    const request = (path: string, headers: Record<string, string> = {}) => new Promise<{status: number | undefined; body: string}>((resolve, reject) => {
      http.get({hostname: '127.0.0.1', port, path, headers, agent: false}, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({status: response.statusCode, body}));
      }).on('error', reject);
    });
    const response = await request('/v1/clock', {Origin: options.origin});
    const denied = await request('/v1/jobs');
    const recovery = {created: servers.length, status: response.status, privateLeaked: response.body.includes('synthetic-private'), denied: denied.status};
    const firstClose = recovered.close(), secondClose = recovered.close();
    const sharedClose = firstClose === secondClose;
    await Promise.all([firstClose, secondClose]);
    return {afterFailure, recovery, afterClose: {sharedClose, intervals: intervals.size, listening: servers.filter(server => server.listening).length, state: engine.listenerCount('state') - baseline.state, clock: engine.listenerCount('clock') - baseline.clock}};
  } finally {
    await recovered?.close();
    for (const timer of intervals) originalClear(timer);
    for (const server of [...servers, blocker]) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClear;
    http.createServer = originalCreateServer;
    syncBuiltinESMExports();
    Rooms.prototype.dispose = originalDispose;
    WebSocketServer.prototype.close = originalWsClose;
    commands.close(); engine.close(); store.close();
  }
}

if (process.argv[2] === '--startup-probe') {
  try {
    const result = await startupProbe(process.argv[3] as Failure, process.argv[4] === 'guilds');
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stderr.write(String(error));
    process.exitCode = 1;
  }
} else {
  for (const failed of ['public', 'invalid'] as const) {
    for (const withGuilds of [false, true]) {
      test(`failed ${failed} bind releases owned resources and allows private recovery (${withGuilds ? 'guilds' : 'single'})`, () => {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--startup-probe', failed, withGuilds ? 'guilds' : 'single'], {encoding: 'utf8', timeout: 15000, windowsHide: true});
        assert.equal(child.status, 0, child.stderr || String(child.error ?? 'child failed'));
        const report = JSON.parse(child.stdout);
        assert.deepEqual(report.afterFailure, {errorCode: failed === 'invalid' ? 'ERR_SOCKET_BAD_PORT' : 'EADDRINUSE', created: 1, intervals: 0, disposed: 2, disposedTables: ['activity_rooms','video_rooms'], websocketClosed: 1, listening: 0, errorListeners: 0, state: 0, clock: 0, added: 0, removed: 0});
        assert.deepEqual(report.recovery, {created: 2, status: 200, privateLeaked: false, denied: 403});
        assert.deepEqual(report.afterClose, {sharedClose: true, intervals: 0, listening: 0, state: 0, clock: 0});
      });
    }
  }
}
