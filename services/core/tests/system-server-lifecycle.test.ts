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
type Failure = 'public' | 'admin' | 'both' | 'invalid';
async function startupProbe(failed: Failure, withGuilds: boolean) {
  const blocker = http.createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  const blockedPort = (blocker.address() as {port: number}).port;
  const store = new Store(':memory:');
  const sink: Sink = {onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {}, duration: () => 0, advancing: () => false, buffering: () => false};
  const engine = new Engine(store, new Providers(store, {}), sink);
  const commands = new Commands(engine);
  const guilds = new Guilds('100000000000001');
  if (withGuilds) guilds.register({id: guilds.defaultId, name: 'Synthetic', roomCode: 'DISCORD1', engine, commands, bot: {} as GuildSession['bot']});
  const baseline = {state: engine.listenerCount('state'), clock: engine.listenerCount('clock'), added: guilds.listenerCount('added'), removed: guilds.listenerCount('removed')};
  const intervals = new Set<ReturnType<typeof setInterval>>();
  const servers: http.Server[] = [];
  const boundPorts = new Map<http.Server, number>();
  const originalCreateServer = http.createServer;
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  const originalDispose = Rooms.prototype.dispose;
  const originalWsClose = WebSocketServer.prototype.close;
  let disposed = 0, websocketClosed = 0;
  http.createServer = ((...args: Parameters<typeof http.createServer>) => {
    const server = originalCreateServer(...args);
    servers.push(server);
    server.once('listening', () => boundPorts.set(server, (server.address() as {port: number}).port));
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
  Rooms.prototype.dispose = function () { disposed++; return originalDispose.call(this); };
  WebSocketServer.prototype.close = function (...args: Parameters<typeof originalWsClose>) { websocketClosed++; return originalWsClose.apply(this, args); };
  let recovered: Awaited<ReturnType<typeof createServers>> | undefined;
  try {
    const options = {key: 'synthetic-key', origin: 'https://site.example', passwordHash: '', hosts: ['127.0.0.1'], host: '127.0.0.1', privateState: () => ({private: 'synthetic-private'}), ...(withGuilds ? {guilds} : {})};
    let errorCode = '';
    try {
      await createServers(engine, commands, {...options, publicPort: failed === 'invalid' ? -1 : failed === 'public' || failed === 'both' ? blockedPort : 0, adminPort: failed === 'admin' || failed === 'both' ? blockedPort : 0});
    } catch (error) { errorCode = (error as NodeJS.ErrnoException).code ?? ''; }
    // Both listen attempts must have settled before the rejected call returns.
    await new Promise<void>(resolve => setImmediate(resolve));
    const afterFailure = {
      errorCode, intervals: intervals.size, disposed, websocketClosed,
      listening: servers.filter(server => server.listening).length,
      errorListeners: servers.reduce((sum, server) => sum + server.listenerCount('error'), 0),
      state: engine.listenerCount('state') - baseline.state,
      clock: engine.listenerCount('clock') - baseline.clock,
      added: guilds.listenerCount('added') - baseline.added,
      removed: guilds.listenerCount('removed') - baseline.removed,
    };
    // Reuse the sibling's exact port to verify the OS binding was released.
    recovered = await createServers(engine, commands, {...options, publicPort: [...boundPorts.values()][0] ?? 0, adminPort: false});
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
    const recovery = {status: response.status, privateLeaked: response.body.includes('synthetic-private'), denied: denied.status};
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
  for (const failed of ['public', 'admin', 'both', 'invalid'] as const) {
    for (const withGuilds of [false, true]) {
      test(`failed ${failed} bind releases owned resources and allows private recovery (${withGuilds ? 'guilds' : 'single'})`, () => {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--startup-probe', failed, withGuilds ? 'guilds' : 'single'], {encoding: 'utf8', timeout: 15000, windowsHide: true});
        assert.equal(child.status, 0, child.stderr || String(child.error ?? 'child failed'));
        const report = JSON.parse(child.stdout);
        assert.deepEqual(report.afterFailure, {errorCode: failed === 'invalid' ? 'ERR_SOCKET_BAD_PORT' : 'EADDRINUSE', intervals: 0, disposed: 1, websocketClosed: 1, listening: 0, errorListeners: 0, state: 0, clock: 0, added: 0, removed: 0});
        assert.deepEqual(report.recovery, {status: 200, privateLeaked: false, denied: 403});
        assert.deepEqual(report.afterClose, {sharedClose: true, intervals: 0, listening: 0, state: 0, clock: 0});
      });
    }
  }
}
