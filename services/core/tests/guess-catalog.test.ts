import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OperatorGuessCatalog, UnavailableGuessCatalog, normalizeGuess, type OperatorGuessRecord } from '../src/guess-catalog.ts';

function record(n: number): OperatorGuessRecord {
  const key = `synthetic_media_${String(n).padStart(4, '0')}`;
  return { rightsCleared: true, categoryIds: ['2010s'],
    song: { id: `synthetic-${n}`, title: `Fictional Signal ${n}`, artist: `Sample Artist ${n}`, aliases: [`Invented Alias ${n}`], mediaKey: key },
    media: { key, mimeType: 'audio/wav', durationSeconds: 120 } };
}
test('production catalog shows unavailable example categories and contains no invented inventory or playable URL', () => {
  const catalog = new UnavailableGuessCatalog();
  assert.deepEqual(catalog.categories(), [
    { id: '2010s', name: '2010s', available: false, count: 0 },
    { id: 'edm-classics', name: 'EDM classics', available: false, count: 0 },
  ]);
  assert.throws(() => catalog.select('2010s', { exclude: [], durationSeconds: 30 }), { status: 503 });
  assert.throws(() => catalog.media('anything'), { status: 503 });
  const changed = catalog.categories(); changed[0].count = 99;
  assert.equal(catalog.categories()[0].count, 0);
});
test('trusted operator assignments drive summaries and eligible selection without repeats or genre inference', () => {
  const short = record(1); short.media.durationSeconds = 20;
  const first = record(2), second = record(3); second.categoryIds = ['2010s', 'edm-classics'];
  const catalog = new OperatorGuessCatalog([short, first, second], () => 0);
  assert.equal(catalog.categories()[0].count, 3);
  assert.equal(catalog.categories()[1].count, 1);
  assert.equal(catalog.select('2010s', { exclude: [], durationSeconds: 30 }).id, first.song.id);
  assert.equal(catalog.select('2010s', { exclude: [first.song.id], durationSeconds: 30 }).id, second.song.id);
  assert.throws(() => catalog.select('2010s', { exclude: [first.song.id, second.song.id], durationSeconds: 30 }), { status: 503 });
  assert.throws(() => catalog.select('unknown-category', { exclude: [], durationSeconds: 30 }), { status: 503 });
  assert.deepEqual(catalog.media(first.song.mediaKey), first.media);
  const summaries = JSON.stringify(catalog.categories());
  for (const secret of ['Fictional', 'Sample Artist', 'synthetic_media', 'Invented Alias', 'durationSeconds']) assert.equal(summaries.includes(secret), false);
});
test('operator catalog rejects absent eligibility, unknown categories, duplicate IDs, URLs and malformed metadata', () => {
  const invalid: unknown[] = [
    { ...record(1), rightsCleared: false }, { ...record(1), rightsCleared: undefined },
    { ...record(1), categoryIds: [] }, { ...record(1), categoryIds: ['genres-guessed-by-client'] },
    { ...record(1), categoryIds: ['2010s', '2010s'] },
    { ...record(1), media: { ...record(1).media, key: 'different_media_key' } },
    { ...record(1), media: { ...record(1).media, durationSeconds: NaN } },
    { ...record(1), media: { ...record(1).media, mimeType: 'text/html' } },
    { ...record(1), song: { ...record(1).song, mediaKey: 'https://example.test/source.mp3' } },
    { ...record(1), song: { ...record(1).song, title: 'bad\nmetadata' } },
    { ...record(1), song: { ...record(1).song, aliases: Array(9).fill('Alias') } },
  ];
  for (const value of invalid) assert.throws(() => new OperatorGuessCatalog([value as OperatorGuessRecord]), { status: 503 });
  assert.throws(() => new OperatorGuessCatalog([record(1), record(1)]), /duplicate/);
  assert.throws(() => new OperatorGuessCatalog(Array.from({ length: 1001 }, (_, n) => record(n))), /operator catalog/);
});
test('catalog copies and freezes private metadata and normalizes only exact spelling variants', () => {
  const input = record(1), catalog = new OperatorGuessCatalog([input], () => 0);
  input.song.title = 'Changed input'; input.media.durationSeconds = 20;
  const selected = catalog.select('2010s', { exclude: [], durationSeconds: 30 });
  assert.equal(selected.title, 'Fictional Signal 1');
  assert(Object.isFrozen(selected)); assert(Object.isFrozen(selected.aliases));
  assert.throws(() => { selected.title = 'Changed output'; }, TypeError);
  const media = catalog.media(selected.mediaKey); media.durationSeconds = 15;
  assert.equal(catalog.media(selected.mediaKey).durationSeconds, 120);
  assert.equal(normalizeGuess('  DÉJÀ---VU!! '), 'deja vu');
  assert.notEqual(normalizeGuess('Fictional Signal'), normalizeGuess('Fictional Signal 1'));
  for (const durationSeconds of [14, 91, 30.5, '30' as unknown as number]) {
    assert.throws(() => catalog.select('2010s', { exclude: [], durationSeconds }), /selection/);
  }
});
