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
      assert.equal(reads, 50, 'Only the effective one-second fade should be requested before playback');
      assert.equal(mixer.nextRead, null, 'Enough ready audio must not wait on the unused part of the configured fade');
      mixer.trackFrame = 150; mixer.frameIndex = 150;
      assert(await mixer.produce());
      assert.equal(mixer.fadeFrame, 2, 'The buffered fade starts at the consumed three-second boundary');
      assert.deepEqual(segments, [{ id: 'current-source', at: 0, offset }, { id: 'next-source', at: 150, offset: 0 }]);
    } finally { mixer.destroy(); delayed.resolve(null); }
  });

test('effective prefetch retains the twelve-second bound and the no-fade warm frame', async () => {
  for (const [duration, crossfade, expected] of [[240, 12, 600], [240, 0, 1]]) {
    let reads = 0;
    const mixer = new Mixer({ first: prepared('current', duration, async () => frame), offset: 0,
      volume: () => 100, crossfade: () => crossfade, bitrate: 96000,
      next: async () => prepared('next', 240, async () => { reads++; return frame; }), onSegment() {} });
    try { mixer.prepare(); await mixer.preparing; await mixer.nextRead; assert.equal(reads, expected); assert.equal(mixer.nextFrames.length, expected); }
    finally { mixer.destroy(); }
  }
});

test('real FFmpeg short-tail crossfade buffers only useful PCM and retains exact Opus output and segment identity', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'afterparty-effective-fade-')), abort = new AbortController();
  const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg', decoders: PcmDecoder[] = [];
  let mixer: Mixer | undefined;
  try {
    for (const [name, duration, frequency] of [['first', 4, 440], ['next', 8, 880]] as const) {
      const result = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', `sine=frequency=${frequency}:duration=${duration}`, '-threads', '1', '-ar', '48000', '-ac', '2', join(dir, name + '.wav')]);
      assert.equal(result.status, 0, String(result.stderr));
    }
    const source = (name: string, duration: number): Prepared => {
      const decoder = new PcmDecoder({ url: join(dir, name + '.wav'), headers: '' }, 0, abort.signal, ffmpeg);
      decoders.push(decoder); return { track: prepared(name, duration, async () => null).track, decoder };
    };
    const first = source('first', 4), next = source('next', 8), segments: { id: string; at: number; offset: number }[] = [];
    let supplied = false;
    mixer = new Mixer({ first, offset: 0, volume: () => 100, crossfade: () => 12, bitrate: 96000,
      next: async () => { if (supplied) return null; supplied = true; return next; },
      onSegment: (track, at, offset) => segments.push({ id: track.entryId, at, offset }) });
    mixer.prepare(); await mixer.preparing; await mixer.nextRead;
    t.diagnostic(`ready PCM=${mixer.nextFrames.length * FRAME_BYTES} bytes (${mixer.nextFrames.length} frames)`);
    assert.equal(mixer.nextFrames.length, 50, 'A four-second source uses one second of fade, not the full next recording');
    const encoded = encodeOpus(mixer, 96000), ogg: Buffer[] = [];
    encoded.process.stdout.on('data', chunk => ogg.push(Buffer.from(chunk)));
    for await (const packet of encoded.stream) assert(packet.length > 0);
    const decoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
      { input: Buffer.concat(ogg), maxBuffer: 4e6 });
    assert.equal(decoded.status, 0, String(decoded.stderr));
    assert.equal(decoded.stdout.length, 550 * FRAME_BYTES, 'Four plus eight seconds minus the one-second fade retain every consumed frame');
    assert(decoded.stdout.some(byte => byte !== 0));
    assert.deepEqual(segments, [{ id: 'first', at: 0, offset: 0 }, { id: 'next', at: 150, offset: 0 }]);
  } finally { mixer?.destroy(); abort.abort(); await Promise.all(decoders.map(decoder => decoder.closed)); rmSync(dir, { recursive: true, force: true }); }
});
