import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { Engine } from '../src/engine.ts';
import { Providers } from '../src/providers.ts';
import { Commands } from '../src/commands.ts';
import type { Sink } from '../src/audio.ts';
import { syntheticSong } from './radio-queue-fixture.ts';

function fixture() {
  const store = new Store(':memory:');
  const sink: Sink = { onIdle: null, onError: null, play() {}, stop() {}, pause() {}, resume() {}, duration: () => 0, advancing: () => false, buffering: () => false };
  const engine = new Engine(store, new Providers(store, {}), sink), commands = new Commands(engine);
  clearInterval(engine.timer); engine.connected = true;
  engine.current = syntheticSong(0, { radio: false });
  engine.queue = [1, 2, 3].map(n => syntheticSong(n, { radio: false })); engine.persist();
  return { store, engine, commands, close() { commands.close(); engine.close(); store.close(); } };
}

test('stale bulk queue actions cannot clear, reorder, replace or resume a newer selection', async () => {
  for (const action of ['pause', 'resume', 'next', 'seek-relative', 'replay', 'unskip', 'clear', 'shuffle', 'cleanup-duplicates', 'snapshot-restore', 'snapshot-load']) {
    const f = fixture();
    try {
      const revision = f.engine.revision();
      f.engine.enqueue([syntheticSong(4, { radio: false })]);
      const before = structuredClone({ current: f.engine.current, queue: f.engine.queue, paused: f.engine.paused });
      await assert.rejects(f.commands.execute({ action, queueRevision: revision, id: 'missing', seconds: 10 }), { status: 409 });
      assert.deepEqual({ current: f.engine.current, queue: f.engine.queue, paused: f.engine.paused }, before, action);
      assert.deepEqual(f.store.get('queue', []), before.queue);
    } finally { f.close(); }
  }
});

test('current queue revisions work and legacy commands remain compatible without a supplied revision', async () => {
  const f = fixture();
  try {
    await f.commands.execute({ action: 'pause', queueRevision: f.engine.revision() }); assert.equal(f.engine.paused, true);
    await f.commands.execute({ action: 'resume', queueRevision: f.engine.revision() }); assert.equal(f.engine.paused, false);
    await f.commands.execute({ action: 'clear', queueRevision: f.engine.revision() }); assert.equal(f.engine.queue.length, 0);
    f.engine.enqueue([syntheticSong(4, { radio: false })]);
    await f.commands.execute({ action: 'clear' }); assert.equal(f.engine.queue.length, 0);
  } finally { f.close(); }
});

test('invalid removal ranges do not mutate the queue, exclusions, revision or stored state', () => {
  const f = fixture();
  try {
    const before = structuredClone(f.engine.queue), revision = f.engine.revision();
    for (const count of [NaN, Infinity, -1, 0, 0.5, 4]) {
      assert.throws(() => f.engine.remove(0, count), { message: 'Invalid number of songs.' });
      assert.deepEqual(f.engine.queue, before); assert.equal(f.engine.revision(), revision);
      assert.deepEqual(f.store.get('queue', []), before);
    }
    f.engine.remove(1, 2);
    assert.deepEqual(f.engine.queue, [before[0]]);
  } finally { f.close(); }
});
