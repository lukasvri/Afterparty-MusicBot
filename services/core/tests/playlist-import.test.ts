import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { PlaylistImports, type PlaylistMetadata } from '../src/playlist-import.ts';
import type { Track } from '../src/types.ts';

const url = 'https://www.youtube.com/watch?v=abcdefghijk&list=PLsynthetic123456';
const track = (index: number): Track => ({ id: String(index).padStart(11, '0'), entryId: 'private-entry',
  title: 'Synthetic set ' + index, artist: 'Synthetic artist', image: 'https://private.example.test/secret', duration: 3600,
  live: false, embeddable: true, requestedBy: 'private-user', catalog: { title: 'Private proof', artist: 'Secret', duration: 3600 } });
const ready = (videos: Track[] = [track(1)]): PlaylistMetadata => ({ videos, skipped: 0, limited: false });
async function flush() { await setImmediate(); await setImmediate(); }
function deferred() {
  let resolve!: (value: PlaylistMetadata) => void;
  const promise = new Promise<PlaylistMetadata>(done => { resolve = done; }); return { promise, resolve };
}

test('jobs publish 134 ordered public videos, isolate capabilities and copy every response', async t => {
  const raw = ready(Array.from({ length: 134 }, (_, index) => track(index))); raw.total = 134;
  const jobs = new PlaylistImports(async (canonical, signal) => {
    assert.equal(canonical, 'https://www.youtube.com/playlist?list=PLsynthetic123456'); assert(!signal.aborted); return raw;
  }); t.after(() => jobs.close());
  const first = jobs.start(url), second = jobs.start(url);
  assert.equal(first.status, 'processing'); assert.notEqual(first.id, second.id); assert.notEqual(first.token, second.token);
  assert.equal(first.videos.length, 0);
  assert.throws(() => jobs.read(first.id, second.token), { status: 404 });
  await flush();
  const done = jobs.read(first.id, first.token);
  assert.equal(done.status, 'done'); assert.equal(done.total, 134); assert.equal(done.videos.length, 134);
  assert.deepEqual(done.videos.map(video => video.id), raw.videos.map(video => video.id));
  assert(!('token' in done));
  const text = JSON.stringify(done);
  for (const secret of ['private-entry', 'private-user', 'Private proof', 'private.example', 'requestedBy', 'catalog']) assert(!text.includes(secret), secret);
  done.videos[0].title = 'Mutated client'; raw.videos[1].title = 'Mutated source';
  assert.equal(jobs.read(first.id, first.token).videos[0].title, 'Synthetic set 0');
  assert.equal(jobs.read(first.id, first.token).videos[1].title, 'Synthetic set 1');
});

test('duplicate and unavailable records are counted without leaking untrusted metadata fields', async t => {
  const good = { ...track(1), genres: ['House'], aiGenerated: true };
  const jobs = new PlaylistImports(async () => ({ videos: [good, good, { ...track(2), embeddable: false }, { ...track(3), id: 12345678901 as never }], skipped: 2, total: 6, limited: true }));
  t.after(() => jobs.close()); const start = jobs.start(url); await flush();
  const done = jobs.read(start.id, start.token); assert.equal(done.status, 'done'); assert.equal(done.videos.length, 1);
  assert.equal(done.skipped, 5); assert.equal(done.limited, true); assert.equal(done.videos[0].aiGenerated, true);
  done.videos[0].genres!.push('Mutated'); assert.deepEqual(jobs.read(start.id, start.token).videos[0].genres, ['House']);
});

test('cancellation retains occupied slots until raw abort-ignoring dependencies settle and never publishes late', async t => {
  const pending = [deferred(), deferred()]; let calls = 0; const signals: AbortSignal[] = [];
  const jobs = new PlaylistImports(async (_url, signal) => { signals.push(signal); return pending[calls++].promise; });
  t.after(() => jobs.close()); const first = jobs.start(url), second = jobs.start(url); await flush();
  assert.equal(jobs.read(first.id, first.token, true).status, 'cancelled'); assert(signals[0].aborted);
  assert.throws(() => jobs.start(url), { status: 429 });
  pending[0].resolve(ready()); await flush();
  assert.equal(jobs.read(first.id, first.token).status, 'cancelled'); assert.deepEqual(jobs.read(first.id, first.token).videos, []);
  jobs.read(second.id, second.token, true); pending[1].resolve(ready()); await flush();
  assert.equal(jobs.read(second.id, second.token).status, 'cancelled');
});

test('deadline aborts work after 180s and TTL removes capabilities after ten minutes', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
  const pending = deferred(); let signal!: AbortSignal;
  const jobs = new PlaylistImports(async (_url, current) => { signal = current; return pending.promise; });
  t.after(() => jobs.close()); const start = jobs.start(url); await flush();
  t.mock.timers.tick(179_999); assert.equal(jobs.read(start.id, start.token).status, 'processing');
  t.mock.timers.tick(1); assert(signal.aborted); assert.equal(jobs.read(start.id, start.token).status, 'failed');
  pending.resolve(ready()); await flush(); assert.equal(jobs.read(start.id, start.token).status, 'failed');
  t.mock.timers.tick(420_000); assert.throws(() => jobs.read(start.id, start.token), { status: 404 });
});

test('32 retained jobs are bounded and expiry restores capacity without unbounded retained metadata', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 10_000 });
  const jobs = new PlaylistImports(async () => ready()); t.after(() => jobs.close());
  let first: ReturnType<typeof jobs.start> | undefined;
  for (let index = 0; index < 32; index++) { const job = jobs.start(url); first ??= job; await flush(); }
  assert.throws(() => jobs.start(url), { status: 429 });
  t.mock.timers.tick(600_000); assert.throws(() => jobs.read(first!.id, first!.token), { status: 404 });
  assert.equal(jobs.start(url).status, 'processing');
});

test('invalid input fails before resolver work; failed sources expose only generic errors', async t => {
  let calls = 0; const jobs = new PlaylistImports(async () => { calls++; throw new Error('secret API key and private provider URL'); });
  t.after(() => jobs.close());
  for (const value of [null, {}, 'https://evil.example/playlist', 'https://www.youtube.com:443/playlist?list=PLsynthetic123456'])
    assert.throws(() => jobs.start(value), { status: 400 });
  assert.equal(calls, 0); const start = jobs.start(url); await flush();
  const result = jobs.read(start.id, start.token); assert.equal(result.status, 'failed'); assert(!JSON.stringify(result).includes('secret API'));
});

test('close aborts pending work and rejects late results and new jobs', async () => {
  const pending = deferred(); let signal!: AbortSignal;
  const jobs = new PlaylistImports(async (_url, current) => { signal = current; return pending.promise; });
  const start = jobs.start(url); await flush(); jobs.close(); assert(signal.aborted);
  pending.resolve(ready()); await flush(); assert.throws(() => jobs.read(start.id, start.token), { status: 404 });
  assert.throws(() => jobs.start(url), { status: 503 });
});
