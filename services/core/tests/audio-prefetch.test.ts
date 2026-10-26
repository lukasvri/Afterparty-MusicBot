import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FRAME_BYTES, Mixer, PcmDecoder, encodeOpus, type Prepared } from '../src/audio.ts';
import { deferred } from './deferred.ts';

const frame = Buffer.alloc(FRAME_BYTES, 1);
function prepared(id: string, duration: number, read: () => Promise<Buffer | null>, stop = () => {}): Prepared {
  return { track: { id, entryId: id, title: id, artist: 'Synthetic Artist', image: '', duration, live: false, embeddable: true },
    decoder: { frame: read, stop } as unknown as PcmDecoder };
}

for (const [duration, offset, configuredFade] of [[4, 0, 12], [100, 96, 6]])
  test(`a ${duration - offset}s tail at offset ${offset} starts its ready crossfade without waiting for excess provider data`, async t => {
    const delayed = deferred<Buffer | null>();
    let reads = 0;
    const next = prepared('next-source', 100, async () => ++reads <= 50 ? frame : delayed.promise, () => delayed.resolve(null));
    const segments: { id: string; at: number; offset: number }[] = [];
    const mixer = new Mixer({ first: prepared('current-source', duration, async () => frame), offset,
      volume: () => 100, crossfade: () => configuredFade, bitrate: 96000, next: async () => next,
      onSegment: (track, at, initial) => segments.push({ id: track.entryId, at, offset: initial }) });
    try {
      mixer.prepare(); await mixer.preparing;
      await new Promise<void>(resolve => setImmediate(resolve));
      t.diagnostic(`prefetched=${mixer.nextFrames.length} frames, decoder reads=${reads}, prefetch pending=${mixer.nextRead !== null}`);
      assert.equal(reads, 51, 'The reservoir keeps reading beyond the ready fade');
      assert(mixer.nextRead, 'The fade must become usable even while its background reservoir is pending');
      mixer.trackFrame = 150; mixer.frameIndex = 150;
      assert(await mixer.produce());
      assert.equal(mixer.fadeFrame, 2, 'The buffered fade starts at the consumed three-second boundary');
      assert.deepEqual(segments, [{ id: 'current-source', at: 0, offset }, { id: 'next-source', at: 150, offset: 0 }]);
    } finally { mixer.destroy(); delayed.resolve(null); }
  });

test('background prefetch retains the twelve-second bound and the no-fade warm frame', async () => {
  for (const [duration, crossfade, expected] of [[240, 12, 600], [240, 0, 1]]) {
    let reads = 0;
    const mixer = new Mixer({ first: prepared('current', duration, async () => frame), offset: 0,
      volume: () => 100, crossfade: () => crossfade, bitrate: 96000,
      next: async () => prepared('next', 240, async () => { reads++; return frame; }), onSegment() {} });
    try { mixer.prepare(); await mixer.preparing; await mixer.nextRead; assert.equal(reads, expected); assert.equal(mixer.nextFrames.length, expected); }
    finally { mixer.destroy(); }
  }
});

for (const [firstSeconds, nextSeconds, configuredFade, overlap, reservoir] of [[4, 8, 12, 1, 400], [24, 24, 6, 6, 300]])
  test(`real FFmpeg ${firstSeconds}s→${nextSeconds}s preserves a ${overlap}s overlap, reservoir and source identity`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'afterparty-effective-fade-')), abort = new AbortController();
  const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg', decoders: PcmDecoder[] = [];
  let mixer: Mixer | undefined;
  try {
    for (const [name, duration, frequency] of [['first', firstSeconds, 440], ['next', nextSeconds, 880]] as const) {
      const result = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', `sine=frequency=${frequency}:duration=${duration}`, '-threads', '1', '-ar', '48000', '-ac', '2', join(dir, name + '.wav')]);
      assert.equal(result.status, 0, String(result.stderr));
    }
    const source = (name: string, duration: number): Prepared => {
      const decoder = new PcmDecoder({ url: join(dir, name + '.wav'), headers: '' }, 0, abort.signal, ffmpeg);
      decoders.push(decoder); return { track: prepared(name, duration, async () => null).track, decoder };
    };
    const first = source('first', firstSeconds), next = source('next', nextSeconds), segments: { id: string; at: number; offset: number }[] = [];
    let supplied = false;
    mixer = new Mixer({ first, offset: 0, volume: () => 100, crossfade: () => configuredFade, bitrate: 96000,
      next: async () => { if (supplied) return null; supplied = true; return next; },
      onSegment: (track, at, offset) => segments.push({ id: track.entryId, at, offset }) });
    mixer.prepare(); await mixer.preparing; await mixer.nextRead;
    t.diagnostic(`ready PCM=${mixer.nextFrames.length * FRAME_BYTES} bytes (${mixer.nextFrames.length} frames)`);
    assert.equal(mixer.nextFrames.length, reservoir, 'Keep the existing bounded source reservoir beyond the fade-readiness gate');
    const encoded = encodeOpus(mixer, 96000), ogg: Buffer[] = [];
    encoded.process.stdout.on('data', chunk => ogg.push(Buffer.from(chunk)));
    for await (const packet of encoded.stream) assert(packet.length > 0);
    const decoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
      { input: Buffer.concat(ogg), maxBuffer: 12e6, timeout: 10000 });
    assert.equal(decoded.status, 0, String(decoded.stderr));
    assert.equal(decoded.stdout.length, (firstSeconds + nextSeconds - overlap) * 50 * FRAME_BYTES, 'Decoded output retains exactly both sources minus their configured overlap');
    assert(decoded.stdout.some(byte => byte !== 0));
    assert.deepEqual(segments, [{ id: 'first', at: 0, offset: 0 }, { id: 'next', at: (firstSeconds - overlap) * 50, offset: 0 }]);
  } finally { mixer?.destroy(); abort.abort(); await Promise.all(decoders.map(decoder => decoder.closed)); rmSync(dir, { recursive: true, force: true }); }
});


function numbered(n: number) { const value = Buffer.alloc(FRAME_BYTES); value.writeInt16LE(n, 0); return value; }
async function turn() { await new Promise<void>(resolve => setImmediate(resolve)); }
function transitionMixer(next: Prepared, third?: Prepared) {
  let selected = 0;
  return new Mixer({ first: prepared('first', 4, async () => frame), offset: 0,
    volume: () => 100, crossfade: () => 12, bitrate: 96000,
    next: async () => ++selected === 1 ? next : selected === 2 ? third ?? null : null, onSegment() {} });
}
async function fade(mixer: Mixer) {
  mixer.trackFrame = mixer.frameIndex = 150;
  for (let i = 0; i < 50; i++) assert(await mixer.produce());
}

test('post-fade reservoir covers a stalled source instead of moving the wait to the handoff', async () => {
  const delayed = deferred<Buffer | null>(); let reads = 0;
  const next = prepared('second', 100, async () => ++reads <= 600 ? numbered(reads) : delayed.promise);
  const mixer = transitionMixer(next);
  try {
    mixer.prepare(); await mixer.preparing; await mixer.nextRead;
    assert.equal(reads, 600); assert.equal(mixer.nextFrames.length, 600);
    await fade(mixer);
    assert.equal(mixer.main.track.entryId, 'second');
    assert.equal(mixer.mainFrames.length, 550, 'The eleven-second post-fade reservoir is preserved');
    for (let n = 51; n <= 600; n++) {
      assert.equal((await mixer.produce())?.readInt16LE(0), n, 'Reserved audio stays ordered');
      assert.equal(reads, 600, 'A stalled provider is not needed while its reserve covers playback');
    }
    const waiting = mixer.produce(); let settled = false; void waiting.then(() => { settled = true; });
    await turn(); assert.equal(reads, 601); assert.equal(settled, false);
    delayed.resolve(numbered(601)); assert.equal((await waiting)?.readInt16LE(0), 601);
  } finally { mixer.destroy(); delayed.resolve(null); }
});

test('a promoted pending reader delivers each paced frame without concurrent reads or waiting for a whole reservoir', async () => {
  const gates = new Map<number, ReturnType<typeof deferred<Buffer | null>>>();
  let reads = 0, active = 0, maxActive = 0;
  const next = prepared('second', 100, async () => {
    const n = ++reads; active++; maxActive = Math.max(maxActive, active);
    try {
      if (n <= 50) return numbered(n);
      const gate = deferred<Buffer | null>(); gates.set(n, gate); return await gate.promise;
    } finally { active--; }
  });
  const mixer = transitionMixer(next);
  try {
    mixer.prepare(); await mixer.preparing; await turn(); assert.equal(reads, 51);
    await fade(mixer); assert.equal(mixer.mainFrames.length, 0);
    for (let n = 51; n <= 60; n++) {
      const output = mixer.produce(); let settled = false; void output.then(() => { settled = true; });
      await turn(); assert.equal(reads, n); assert.equal(settled, false);
      gates.get(n)!.resolve(numbered(n));
      assert.equal((await output)?.readInt16LE(0), n);
      await turn(); assert.equal(reads, n, 'After handoff, decoder reads follow consumer demand');
    }
    assert.equal(maxActive, 1);
  } finally { mixer.destroy(); for (const gate of gates.values()) gate.resolve(null); }
});

for (const invalidateBeforeDelivery of [false, true])
  test(`future-queue invalidation ${invalidateBeforeDelivery ? 'before' : 'after'} a promoted read cannot drop or cross-wire audio`, async () => {
    const delayed = deferred<Buffer | null>(), future = deferred<Buffer | null>();
    let reads = 0, nextStops = 0, futureStops = 0;
    const next = prepared('second', 100, async () => ++reads <= 50 ? numbered(reads) : reads === 51 ? delayed.promise : numbered(reads), () => { nextStops++; });
    const third = prepared('third', 100, () => future.promise, () => { futureStops++; });
    const mixer = transitionMixer(next, third);
    try {
      mixer.prepare(); await mixer.preparing; await turn(); const retiring = mixer.nextRead;
      await fade(mixer); const output = mixer.produce();
      mixer.prepare(); await mixer.preparing; const futureRead = mixer.nextRead; assert(futureRead);
      if (invalidateBeforeDelivery) mixer.invalidateNext();
      delayed.resolve(numbered(51)); assert.equal((await output)?.readInt16LE(0), 51); await retiring;
      if (!invalidateBeforeDelivery) {
        assert.equal(mixer.nextRead, futureRead, 'The retiring main pump cannot clear a newer future reader');
        mixer.invalidateNext();
      }
      assert.equal(nextStops, 0, 'Only the future decoder is invalidated'); assert.equal(futureStops, 1);
      future.resolve(numbered(777)); await futureRead; assert.deepEqual(mixer.nextFrames, []);
      assert.equal((await mixer.produce())?.readInt16LE(0), 52);
      assert.equal(mixer.main.track.entryId, 'second');
    } finally { mixer.destroy(); delayed.resolve(null); future.resolve(null); }
  });

test('a retiring main reader failure reaches recovery instead of becoming a clean end or a concurrent read', async () => {
  const delayed = deferred<Buffer | null>(); let reads = 0;
  const mixer = transitionMixer(prepared('second', 100, async () => ++reads <= 50 ? numbered(reads) : delayed.promise));
  try {
    mixer.prepare(); await mixer.preparing; await turn(); await fade(mixer);
    const output = mixer.produce(); const rejected = assert.rejects(output, /Audio decoding stopped/);
    delayed.reject(new Error('Audio decoding stopped (network).')); await rejected;
    assert.equal(reads, 51); assert.equal(mixer.main.track.entryId, 'second');
  } finally { mixer.destroy(); }
});

test('disposal retires a promoted in-flight reader and ignores its late frame', async () => {
  const delayed = deferred<Buffer | null>(); let reads = 0, stopped = 0;
  const mixer = transitionMixer(prepared('second', 100, async () => ++reads <= 50 ? numbered(reads) : delayed.promise, () => { stopped++; }));
  mixer.prepare(); await mixer.preparing; await turn(); const retiring = mixer.nextRead;
  await fade(mixer); mixer.destroy(); delayed.resolve(numbered(51)); await retiring;
  assert.equal(stopped, 1); assert.deepEqual(mixer.mainFrames, []); assert.deepEqual(mixer.nextFrames, []);
});


test('an eight-second seeked tail honors the configured six-second overlap', async () => {
  const segments: { id: string; at: number; offset: number }[] = [];
  let selected = false;
  const next = prepared('second', 100, async () => frame);
  const mixer = new Mixer({ first: prepared('first', 100, async () => frame), offset: 92,
    volume: () => 100, crossfade: () => 6, bitrate: 96000,
    next: async () => { if (selected) return null; selected = true; return next; },
    onSegment: (track, at, offset) => segments.push({ id: track.entryId, at, offset }) });
  try {
    mixer.prepare(); await mixer.preparing; await mixer.nextRead;
    mixer.trackFrame = mixer.frameIndex = 100;
    for (let i = 0; i < 300; i++) assert(await mixer.produce());
    assert.equal(mixer.main.track.entryId, 'second');
    assert.equal(mixer.trackFrame, 300, 'The new source has consumed six seconds at handoff');
    assert.deepEqual(segments, [{ id: 'first', at: 0, offset: 92 }, { id: 'second', at: 100, offset: 0 }]);
  } finally { mixer.destroy(); }
});

test('an early EOF hands off its first ready frame without waiting for the background reservoir', async () => {
  const delayed = deferred<Buffer | null>(); let reads = 0, supplied = false;
  const next = prepared('second', 100, async () => ++reads === 1 ? numbered(1) : reads === 2 ? delayed.promise : numbered(reads));
  const mixer = new Mixer({ first: prepared('first', 4, async () => null), offset: 0,
    volume: () => 100, crossfade: () => 12, bitrate: 96000,
    next: async () => { if (supplied) return null; supplied = true; return next; }, onSegment() {} });
  try {
    mixer.prepare(); await mixer.preparing; await turn(); assert.equal(reads, 2);
    assert.equal((await mixer.produce())?.readInt16LE(0), 1);
    const second = mixer.produce(); await turn(); assert.equal(reads, 2);
    delayed.resolve(numbered(2)); assert.equal((await second)?.readInt16LE(0), 2);
    assert.equal((await mixer.produce())?.readInt16LE(0), 3);
  } finally { mixer.destroy(); delayed.resolve(null); }
});


test('disposal while early EOF awaits a first frame cannot announce or promote a late source', async () => {
  const delayed = deferred<Buffer | null>(); const segments: string[] = [];
  const mixer = new Mixer({ first: prepared('first', 4, async () => null), offset: 0,
    volume: () => 100, crossfade: () => 12, bitrate: 96000,
    next: async () => prepared('late', 100, () => delayed.promise),
    onSegment: track => segments.push(track.entryId) });
  mixer.prepare(); await mixer.preparing; const output = mixer.produce(); await turn();
  mixer.destroy(); delayed.resolve(numbered(1));
  assert.equal(await output, null); assert.deepEqual(segments, ['first']);
  assert.equal(mixer.main.track.entryId, 'first');
});


test('early outgoing EOF during a fade preserves incoming progress and its original clock segment', async () => {
  let firstReads = 0, nextReads = 0, supplied = false;
  const segments: {id: string; at: number; offset: number}[] = [];
  const next = prepared('second', 100, async () => numbered(++nextReads));
  const mixer = new Mixer({ first: prepared('first', 4, async () => ++firstReads <= 170 ? frame : null), offset: 0,
    volume: () => 100, crossfade: () => 12, bitrate: 96000,
    next: async () => { if (supplied) return null; supplied = true; return next; },
    onSegment: (track, at, offset) => segments.push({id: track.entryId, at, offset}) });
  try {
    mixer.prepare(); await mixer.preparing; await mixer.nextRead;
    for (let i = 0; i < 170; i++) assert(await mixer.produce());
    assert.equal(mixer.fadeFrame, 21, 'Twenty incoming frames have already been heard');
    assert.equal((await mixer.produce())?.readInt16LE(0), 21);
    assert.equal(mixer.trackFrame, 21, 'Promotion does not reset the consumed incoming clock');
    assert.deepEqual(segments, [{id:'first',at:0,offset:0},{id:'second',at:150,offset:0}]);
  } finally { mixer.destroy(); }
});
