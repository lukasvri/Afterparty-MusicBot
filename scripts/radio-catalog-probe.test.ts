import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { main, smallMetadata, validateSeeds } from './radio-catalog-probe.ts';

afterEach(() => mock.restoreAll());

test('probe captures public parser inputs while discarding media URLs, credentials and descriptions', () => {
  const actual = smallMetadata({ id: 'Rif-RTvmmss', title: 'The Weeknd - Starboy', tags: ['Daft Punk', 'Music'],
    description: 'Unrelated description and copyrighted content.\nGenre: pop\nPrivate query: token=test',
    url: 'https://private.invalid/media?token=test', http_headers: { Cookie: 'private' }, categories: ['Music'] });
  assert.deepEqual(actual.tags, ['Daft Punk', 'Music'], 'Original evidence must survive later parser corrections');
  assert.equal(actual.description, 'Genre: pop');
  assert.equal(JSON.stringify(actual).includes('private'), false);
  assert.equal(JSON.stringify(actual).includes('copyrighted'), false);
});

test('no mode performs no provider fetch and ambiguous live/replay flags are rejected', async () => {
  mock.method(console, 'log', () => {});
  mock.method(globalThis, 'fetch', async () => { assert.fail('No default-mode network'); });
  await main([]);
  await assert.rejects(main(['--live', '--replay']), /exactly one mode/);
  await assert.rejects(main(['--live', '--ytdlp=relative.exe']), /absolute/);
});

test('probe manifest enforces ten distinct public seeds without injecting external genre evidence', () => {
  const seed = { id: 'Rif-RTvmmss', title: 'Starboy', artist: 'The Weeknd', group: 'album category only',
    sources: ['https://www.youtube.com/watch?v=Rif-RTvmmss'] };
  assert.equal(validateSeeds([seed])[0].group, 'album category only');
  assert.throws(() => validateSeeds([seed, seed]), /distinct/);
  assert.throws(() => validateSeeds(Array.from({ length: 11 }, () => seed)), /1 to 10/);
  assert.throws(() => validateSeeds([{ ...seed, sources: ['https://example.com/?token=private'] }]), /public HTTPS/);
});
