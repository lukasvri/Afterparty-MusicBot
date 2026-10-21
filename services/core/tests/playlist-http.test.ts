import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { Commands } from '../src/commands.ts';
import { Engine } from '../src/engine.ts';
import { Providers } from '../src/providers.ts';
import { createServers } from '../src/server.ts';
import { Store } from '../src/store.ts';
import type { Sink } from '../src/audio.ts';
import type { PlaylistImportResult, PlaylistMetadata } from '../src/playlist-import.ts';

test('real playlist HTTP requires bridge authentication, isolates jobs and leaves playback and queues intact', async () => {
  const store = new Store(':memory:'), providers = new Providers(store, {});
  const sink: Sink = { onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {}, duration: () => 0, advancing: () => false, buffering: () => false };
  const engine = new Engine(store, providers, sink), commands = new Commands(engine); clearInterval(engine.timer);
  let calls = 0;
  providers.key = 'synthetic-api-key';
  providers.youtube = async (path, parameters, signal) => {
    calls++; signal?.throwIfAborted(); assert.equal(path, 'playlistItems'); assert.equal(parameters.playlistId, 'PLsynthetic123456');
    const page = Number(parameters.pageToken ?? 0), start = page * 50;
    return { items: Array.from({ length: Math.min(50, 134 - start) }, (_, index) => ({ contentDetails: { videoId: String(start + index).padStart(11, '0') } })),
      pageInfo: { totalResults: 134 }, ...(page < 2 ? { nextPageToken: String(page + 1) } : {}) } as never;
  };
  providers.video = async (ids, skipUnavailable) => { assert.equal(skipUnavailable, true); return ids.map(id => ({ id, entryId: 'private', title: 'Set ' + Number(id),
    artist: 'Artist', duration: 3600, image: '', live: false, embeddable: true })); };
  const server = await createServers(engine, commands, { key: 'synthetic-playlist-key', origin: 'https://site.example', publicPort: 0, host: '127.0.0.1' });
  const base = 'http://127.0.0.1:' + (server.publicServer.address() as { port: number }).port;
  const call = (input: unknown, authorized = true, method = 'POST') => fetch(base + '/v1/playlists', { method,
    headers: { ...(authorized ? { Authorization: 'Bearer synthetic-playlist-key' } : {}), 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(input) } : {}) });
  const state = () => ({ playbackRevision: engine.revision(), current: engine.current, queue: [...engine.queue], paused: engine.paused,
    settings: store.settings(), history: store.history(100), jobs: store.jobs(), revision: commands.concertQueue.revision() });
  const before = state();
  try {
    assert.equal((await call({ action: 'start', url: 'https://www.youtube.com/playlist?list=PLsynthetic123456' }, false)).status, 403);
    assert.equal((await call({}, false, 'GET')).status, 403); assert.equal(calls, 0);
    assert.equal((await call({}, true, 'GET')).status, 405);
    assert.equal((await call({ action: 'start', url: 'https://evil.example.test/list' })).status, 400); assert.equal(calls, 0);
    const response = await call({ action: 'start', url: 'https://www.youtube.com/watch?v=abcdefghijk&list=PLsynthetic123456' });
    assert.equal(response.status, 202); assert.equal(response.headers.get('cache-control'), 'no-store');
    const start = await response.json() as PlaylistImportResult; assert.equal(start.status, 'processing'); assert(start.token);
    await setImmediate(); assert.equal(calls, 3, 'the actual provider import reads all three pages of a 134-set playlist');
    const second = await (await call({ action: 'start', url: 'https://www.youtube.com/playlist?list=PLsynthetic123456' })).json() as PlaylistImportResult;
    assert.equal((await call({ action: 'read', id: start.id, token: second.token })).status, 404);
    assert.equal((await call({ action: 'cancel', id: start.id, token: second.token })).status, 404);
    const done = await (await call({ action: 'read', id: start.id, token: start.token })).json() as PlaylistImportResult;
    assert.equal(done.status, 'done'); assert.equal(done.videos.length, 134); assert.equal(done.total, 134); assert(!done.token);
    assert.equal(done.source, 'youtube'); assert(!JSON.stringify(done).includes('entryId'));
    assert.deepEqual(state(), before);
  } finally { await server.close(); commands.close(); engine.close(); store.close(); }
});

test('HTTP cancel aborts preparation, prevents late publication and server close aborts remaining jobs', async () => {
  const store = new Store(':memory:'), providers = new Providers(store, {});
  const sink: Sink = { onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {}, duration: () => 0, advancing: () => false, buffering: () => false };
  const engine = new Engine(store, providers, sink), commands = new Commands(engine); clearInterval(engine.timer);
  const signals: AbortSignal[] = []; const settle: ((value: PlaylistMetadata) => void)[] = [];
  providers.importPlaylist = async (_url, signal) => { signals.push(signal); return new Promise(resolve => settle.push(resolve)); };
  const server = await createServers(engine, commands, { key: 'synthetic-playlist-key', origin: 'https://site.example', publicPort: 0, host: '127.0.0.1' });
  const base = 'http://127.0.0.1:' + (server.publicServer.address() as { port: number }).port;
  const call = (input: unknown) => fetch(base + '/v1/playlists', { method: 'POST', headers: { Authorization: 'Bearer synthetic-playlist-key' }, body: JSON.stringify(input) });
  try {
    const first = await (await call({ action: 'start', url: 'https://www.youtube.com/playlist?list=PLsynthetic123456' })).json() as PlaylistImportResult;
    const second = await (await call({ action: 'start', url: 'https://www.youtube.com/playlist?list=PLsynthetic123456' })).json() as PlaylistImportResult;
    assert.equal((await call({ action: 'start', url: 'https://www.youtube.com/playlist?list=PLsynthetic123456' })).status, 429);
    const cancelled = await (await call({ action: 'cancel', id: first.id, token: first.token })).json() as PlaylistImportResult;
    assert.equal(cancelled.status, 'cancelled'); assert(signals[0].aborted);
    settle[0]({ videos: [], skipped: 0, limited: false }); await setImmediate();
    assert.equal((await (await call({ action: 'read', id: first.id, token: first.token })).json() as PlaylistImportResult).status, 'cancelled');
    await server.close(); assert(signals[1].aborted); assert(second.id);
  } finally {
    settle.forEach(resolve => resolve({ videos: [], skipped: 0, limited: false }));
    await server.close(); commands.close(); engine.close(); store.close();
  }
});
