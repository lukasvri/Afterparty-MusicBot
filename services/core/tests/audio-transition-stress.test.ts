import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FRAME_BYTES, Mixer, PcmDecoder, encodeOpus, type Prepared } from '../src/audio.ts';
import { deferred } from './deferred.ts';

function fake(id: string, frame: () => Promise<Buffer | null>, stopped = () => {}): Prepared {
  return { track: { id, entryId: id, title: id, artist: 'Synthetic Artist', image: '', duration: 100, live: false, embeddable: true },
    decoder: { frame, stop: stopped } as unknown as PcmDecoder };
}
const packet = Buffer.alloc(FRAME_BYTES, 1);
function nextId(mixer: Mixer) { return mixer.nextPrepared?.track.entryId; }

test('forty invalidated next-track lookups cannot replace the current source or retain a late decoder', async () => {
  const live = new Set<string>(); let currentReads = 0;
  for (let round = 0; round < 40; round++) {
    const old = deferred<Prepared | null>();
    const discarded = fake('discarded-' + round, async () => packet, () => live.delete('discarded-' + round));
    live.add(discarded.track.entryId);
    const wanted = fake('wanted-' + round, async () => packet, () => live.delete('wanted-' + round));
    live.add(wanted.track.entryId);
    let calls = 0;
    const mixer = new Mixer({ first: fake('current-' + round, async () => { currentReads++; return packet; }), offset: 0,
      volume: () => 100, crossfade: () => 1, bitrate: 96000,
      next: async () => ++calls === 1 ? old.promise : wanted, onSegment() {} });
    try {
      mixer.prepare(); const pending = mixer.preparing;
      mixer.invalidateNext(); mixer.invalidateNext();
      assert.equal(await mixer.produce(), packet, 'current audio must flow while old prefetch is pending');
      old.resolve(discarded); await pending;
      assert(!live.has(discarded.track.entryId)); assert.equal(mixer.nextPrepared, null);
      mixer.prepare(); await mixer.preparing; await mixer.nextRead;
      assert.equal(nextId(mixer), wanted.track.entryId);
      assert.equal(calls, 2);
    } finally { mixer.destroy(); }
    assert.equal(live.size, 0, 'both invalidated and prepared decoders must be released');
  }
  assert.equal(currentReads, 40);
});

test('a decoder arriving after mixer disposal is stopped without becoming a playable next track', async () => {
  const next = deferred<Prepared | null>(); let stops = 0;
  const mixer = new Mixer({ first: fake('current', async () => packet), offset: 0, volume: () => 100,
    crossfade: () => 0, bitrate: 96000, next: async () => next.promise, onSegment() {} });
  mixer.prepare(); const pending = mixer.preparing; mixer.destroy();
  next.resolve(fake('late', async () => packet, () => stops++)); await pending;
  assert.equal(stops, 1); assert.equal(mixer.nextPrepared, null); assert.deepEqual(mixer.nextFrames, []);
});

test('real FFmpeg transition after seek and queue replacement plays only the intended sources at their offsets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'afterparty-transition-')), abort = new AbortController();
  const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg', decoders: PcmDecoder[] = [];
  let mixer: Mixer | undefined;
  try {
    for (const [id, frequency] of [['first', 440], ['discarded', 880], ['wanted', 1320]] as const) {
      const generated = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', `sine=frequency=${frequency}:duration=4`, '-threads', '1', '-ac', '2', '-ar', '48000', join(dir, id + '.wav')]);
      assert.equal(generated.status, 0, String(generated.stderr));
    }
    const source = (id: string, offset: number): Prepared => {
      const decoder = new PcmDecoder({ url: join(dir, id + '.wav'), headers: '' }, offset, abort.signal, ffmpeg);
      decoders.push(decoder);
      return { track: { ...fake(id, async () => null).track, duration: 4, offset }, decoder };
    };
    const first = source('first', 1.2), discarded = source('discarded', 0), wanted = source('wanted', 0.6);
    const segments: { id: string; offset: number }[] = []; let lookups = 0;
    mixer = new Mixer({ first, offset: 1.2, volume: () => 100, crossfade: () => 1, bitrate: 96000,
      next: async () => ++lookups === 1 ? discarded : lookups === 2 ? wanted : null,
      onSegment: (track, _frame, offset) => segments.push({ id: track.id, offset }) });
    mixer.prepare(); await mixer.preparing; await mixer.nextRead;
    mixer.invalidateNext(); assert.equal(discarded.decoder.disposed, true);
    mixer.prepare(); await mixer.preparing; await mixer.nextRead;
    const encoded = encodeOpus(mixer, 96000), chunks: Buffer[] = [];
    encoded.process.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)));
    for await (const chunk of encoded.stream) assert(chunk.length > 0);
    const decoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
      '-ac', '2', '-ar', '48000', '-f', 's16le', 'pipe:1'], { input: Buffer.concat(chunks), maxBuffer: 2 * 1024 * 1024 });
    assert.equal(decoded.status, 0, String(decoded.stderr));
    // Remaining tails 2.8s + 3.4s honor the saved 1s overlap: 5.2s, or 260 frames.
    assert.equal(decoded.stdout.length, 260 * FRAME_BYTES);
    assert.deepEqual(segments, [{ id: 'first', offset: 1.2 }, { id: 'wanted', offset: 0.6 }]);
    assert(decoded.stdout.some(byte => byte !== 0));
  } finally { mixer?.destroy(); abort.abort(); await Promise.all(decoders.map(decoder => decoder.closed)); rmSync(dir, { recursive: true, force: true }); }
});
