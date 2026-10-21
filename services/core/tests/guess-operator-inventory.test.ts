import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUESS_AUDIO_RATE, GUESS_AUDIO_MAX_BYTES, guessWave } from '../src/guess-audio-format.ts';
import { prepareOperatorGuessInventory, prepareTrustedGuessInventory, type OperatorGuessInventoryOptions, type OperatorGuessInventoryRecord } from '../src/guess-operator-inventory.ts';

function record(n = 1, seconds = 30): OperatorGuessInventoryRecord {
  return { song: { id: `owned-${n}`, title: `Fictional Signal ${n}`, artist: 'Fictional Performer', aliases: ['Invented Alias'] },
    categoryIds: ['2010s'], permission: { approved: true, reference: `https://evidence.example.test/permission/${n}`, expiresAt: Date.now() + 600_000 },
    wav: guessWave(new Uint8Array(seconds * GUESS_AUDIO_RATE * 2)) };
}
const select = { exclude: [], durationSeconds: 30 };

test('private authorized WAV inventory derives duration and keeps evidence and media out of summaries', async t => {
  const input = record(), shorter = record(2, 15);
  const inventory = prepareOperatorGuessInventory([input, shorter]); t.after(inventory.dispose);
  assert.equal(inventory.catalog.categories()[0].count, 2);
  assert.deepEqual(inventory.catalog.categories()[0].durations, [{ seconds: 15, count: 1 }, { seconds: 30, count: 1 }]);
  const song = inventory.catalog.select('2010s', select);
  assert.equal(song.id, input.song.id);
  assert.equal(inventory.catalog.media(song.mediaKey).durationSeconds, 30);
  assert.equal(inventory.catalog.media(song.mediaKey).mimeType, 'audio/wav');
  assert.match(song.mediaKey, /^[a-f0-9]{32}$/);
  assert.throws(() => inventory.catalog.select('2010s', { ...select, durationSeconds: 31 }), { status: 503 });
  assert.throws(() => inventory.catalog.select('2010s', { ...select, exclude: [song.id] }), { status: 503 });
  const next = inventory.catalog.select('2010s', { exclude: [song.id], durationSeconds: 15 });
  assert.equal(next.id, shorter.song.id);
  const summaries = JSON.stringify(inventory.catalog.categories());
  for (const secret of ['Fictional', 'evidence.example', 'permission', song.mediaKey, 'durationSeconds']) assert(!summaries.includes(secret));
  assert(!(JSON.stringify(song).includes('evidence.example')));
  const bytes = await inventory.media.read(song.mediaKey, new AbortController().signal);
  assert.equal(bytes.byteLength, GUESS_AUDIO_MAX_BYTES);
  assert.throws(() => inventory.catalog.media('unknown'), { status: 503 });
  await assert.rejects(inventory.media.read('unknown', new AbortController().signal), { status: 503 });
});

test('inventory owns copied Buffer input, private metadata and every returned audio copy', async t => {
  const input = record(); input.wav = Buffer.from(input.wav);
  const inventory = prepareOperatorGuessInventory([input]); t.after(inventory.dispose);
  const song = inventory.catalog.select('2010s', select);
  input.wav.fill(255); input.song.title = 'Mutated'; input.permission.expiresAt = 0;
  const first = await inventory.media.read(song.mediaKey, new AbortController().signal);
  assert.equal(String.fromCharCode(...first.subarray(0, 4)), 'RIFF'); first.fill(255);
  const second = await inventory.media.read(song.mediaKey, new AbortController().signal);
  assert.equal(String.fromCharCode(...second.subarray(0, 4)), 'RIFF');
  assert.equal(inventory.catalog.select('2010s', select).title, 'Fictional Signal 1');
  assert(Object.isFrozen(song));
});

test('invalid attestations, records and envelopes fail closed without exposing their evidence', () => {
  const expired = record(); expired.permission.expiresAt = Date.now();
  const malformed = record(); malformed.wav[0] = 0;
  const invalid: unknown[] = [null, { ...record(), permission: undefined }, expired, malformed,
    { ...record(), permission: { ...record().permission, approved: false } },
    { ...record(), permission: { ...record().permission, expiresAt: Infinity } },
    { ...record(), permission: { ...record().permission, reference: 'http://evidence.example.test/approval' } },
    { ...record(), permission: { ...record().permission, reference: 'https://user:secret@evidence.example.test' } },
    { ...record(), permission: { ...record().permission, reference: 'https://evidence.example.test/\nsecret' } },
    { ...record(), wav: new Uint8Array(GUESS_AUDIO_MAX_BYTES + 2) }, record(1, 14),
    { ...record(), categoryIds: ['unknown'] }, { ...record(), song: { ...record().song, aliases: ['bad\nanswer'] } },
  ];
  for (const value of invalid) assert.throws(() => prepareOperatorGuessInventory([value as OperatorGuessInventoryRecord]), { status: 503 });
  assert.throws(() => prepareOperatorGuessInventory([record(), record()]), { status: 503 });
  assert.throws(() => prepareOperatorGuessInventory(Array.from({ length: 9 }, (_, n) => record(n))), { status: 503 });
});

test('earliest permission expiration disables the whole snapshot before and after reads', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const first = record(), second = record(2); second.permission.expiresAt = Date.now() + 1000;
  const inventory = prepareOperatorGuessInventory([first, second]); t.after(inventory.dispose);
  const song = inventory.catalog.select('2010s', select);
  const pending = inventory.media.read(song.mediaKey, new AbortController().signal);
  t.mock.timers.tick(1000);
  await assert.rejects(pending, { status: 503 });
  assert(inventory.catalog.categories().every(c => c.count === 0 && !c.available));
  assert(inventory.catalog.categories().every(c => c.durations?.length === 0));
  assert.throws(() => inventory.catalog.select('2010s', select), { status: 503 });
  assert.throws(() => inventory.catalog.media(song.mediaKey), { status: 503 });
  await assert.rejects(inventory.media.read(song.mediaKey, new AbortController().signal), { status: 503 });
});

test('five-minute TTL, cancellation and explicit disposal cannot return stale audio', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const inventory = prepareOperatorGuessInventory([record()]); t.after(inventory.dispose);
  const key = inventory.catalog.select('2010s', select).mediaKey;
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(inventory.media.read(key, aborted.signal), { name: 'AbortError' });
  const lateAbort = new AbortController(), pending = inventory.media.read(key, lateAbort.signal); lateAbort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  t.mock.timers.tick(300_000);
  await assert.rejects(inventory.media.read(key, new AbortController().signal), { status: 503 });
  assert(inventory.catalog.categories().every(c => !c.available));
  assert(inventory.catalog.categories().every(c => c.durations?.length === 0));
  const fresh = prepareOperatorGuessInventory([record()]); t.after(fresh.dispose);
  const freshKey = fresh.catalog.select('2010s', select).mediaKey;
  const disposed = fresh.media.read(freshKey, new AbortController().signal); fresh.dispose(); fresh.dispose();
  await assert.rejects(disposed, { status: 503 });
  assert(fresh.catalog.categories().every(c => !c.available));
  assert(fresh.catalog.categories().every(c => c.durations?.length === 0));
});

test('empty inventory remains unavailable and eight recordings are the bounded maximum', t => {
  for (const records of [[], Array.from({ length: 8 }, (_, n) => record(n))]) {
    const inventory = prepareOperatorGuessInventory(records); t.after(inventory.dispose);
    assert.equal(inventory.catalog.categories()[0].count, records.length);
    if (!records.length) assert.throws(() => inventory.catalog.select('2010s', select), { status: 503 });
  }
});

test('trusted lifetime options are bounded integer milliseconds and cannot be changed after preparation', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const invalid: unknown[] = [null, [], '1800000', { lifetimeMs: null },
    ...[0, -1, 0.5, 1_800_001, Infinity, NaN, '1800000'].map(lifetimeMs => ({ lifetimeMs }))];
  for (const options of invalid)
    assert.throws(() => prepareOperatorGuessInventory([record()], options as OperatorGuessInventoryOptions), { status: 503 });
  for (const lifetimeMs of [1, 1_800_000]) {
    const input = record(); input.permission.expiresAt = Date.now() + 3_600_000;
    const options = { lifetimeMs }, inventory = prepareOperatorGuessInventory([input], options); t.after(inventory.dispose);
    const key = inventory.catalog.select('2010s', select).mediaKey;
    options.lifetimeMs = 1_800_000;
    t.mock.timers.tick(lifetimeMs - 1);
    assert.equal((await inventory.media.read(key, new AbortController().signal)).length, GUESS_AUDIO_MAX_BYTES);
    const pending = inventory.media.read(key, new AbortController().signal); t.mock.timers.tick(1);
    await assert.rejects(pending, { status: 503 });
    assert(inventory.catalog.categories().every(category => !category.available && category.durations?.length === 0));
  }
});

test('an extended lifetime never extends the earliest recording permission', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const records = [record(), record(2)]; records[0].permission.expiresAt = Date.now() + 3_600_000;
  records[1].permission.expiresAt = Date.now() + 450_000;
  const inventory = prepareOperatorGuessInventory(records, { lifetimeMs: 1_800_000 }); t.after(inventory.dispose);
  const key = inventory.catalog.select('2010s', select).mediaKey;
  t.mock.timers.tick(449_999);
  assert.equal((await inventory.media.read(key, new AbortController().signal)).length, GUESS_AUDIO_MAX_BYTES);
  t.mock.timers.tick(1);
  await assert.rejects(inventory.media.read(key, new AbortController().signal), { status: 503 });
  assert(inventory.catalog.categories().every(category => !category.available));
});

test('trusted prepared WAVs have an availability deadline without fabricated approvals, and still own copied bytes', async t => {
  let clock = 100_000; t.mock.method(Date, 'now', () => clock);
  const { permission: _permission, ...input } = record(); void _permission;
  const options = { expiresAt: clock + 1000, lifetimeMs: 1_800_000 };
  const source = prepareTrustedGuessInventory([input], options); t.after(source.dispose);
  const song = source.catalog.select('2010s', select); assert(!('permission' in song));
  input.wav.fill(255); options.expiresAt = clock + 1_800_000;
  const bytes = await source.media.read(song.mediaKey, new AbortController().signal);
  assert.equal(bytes[0], 82); bytes.fill(255);
  assert.equal((await source.media.read(song.mediaKey, new AbortController().signal))[0], 82);
  const pending = source.media.read(song.mediaKey, new AbortController().signal); clock += 1000;
  await assert.rejects(pending, { status: 503 }); assert(source.catalog.categories().every(category => !category.available));
  assert.throws(() => prepareOperatorGuessInventory([input as OperatorGuessInventoryRecord]), { status: 503 });
  for (const expiresAt of [clock, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => prepareTrustedGuessInventory([input], { expiresAt }), { status: 503 });
});
