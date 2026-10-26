import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  CONCERT_CATALOG,
  CONCERT_SOURCES,
  CONCERT_PLAYLISTS,
} from '../../../lib/concert-catalog.ts';
import { normalizePlaylistUrl } from '../../../services/core/src/playlist-url.ts';

// Counts and sorted-ID digests captured from the named public festival source pages,
// independently of the runtime catalog. They detect dropped, replaced or misplaced links.
const snapshots = [
  {
    eventId: 'edc-las-vegas',
    year: 2026,
    listedCount: 116,
    includedCount: 116,
    sourceUrl: 'https://lasvegas.edc.com/2026-sets/',
    sha256: 'cd6ad2bd51a868038907c8d68c1620fe2ee1b6797048c9c1eb05c95a92cf4470',
  },
  {
    eventId: 'edc-las-vegas',
    year: 2025,
    listedCount: 86,
    includedCount: 86,
    sourceUrl: 'https://lasvegas.edc.com/2025-sets/',
    sha256: '5584893cc075db8358d16d559394d285f828e2f620b4f05fdff3049317a2fcca',
  },
  {
    eventId: 'edc-las-vegas',
    year: 2023,
    listedCount: 26,
    includedCount: 26,
    sourceUrl: 'https://lasvegas.edc.com/2023-sets/',
    sha256: '5e44e16f6c0f21f74e58bb36f50804da5105bc090adcb5e18b6ab6e8e1227f90',
  },
  {
    eventId: 'creamfields',
    year: 2024,
    listedCount: 24,
    includedCount: 23,
    sourceUrl: 'https://creamfields.com/2024_live/all-streams/',
    sha256: 'f33ac3c65275f9637ec23c39888cfa56d40256dc2bb289d4dfab19119cad2820',
  },
];

test('festival indexes retain every checked matching-year source link', () => {
  for (const snapshot of snapshots) {
    const source = CONCERT_SOURCES.find(
      (item) => item.eventId === snapshot.eventId && item.year === snapshot.year,
    );
    assert(source);
    assert.equal(source.listedCount, snapshot.listedCount);
    assert.equal(source.videoIds.length, snapshot.includedCount);
    assert.equal(source.videoIds.length + source.excluded.length, source.listedCount);
    assert.equal(
      createHash('sha256')
        .update([...source.videoIds].sort().join('\n'))
        .digest('hex'),
      snapshot.sha256,
    );
    const catalogIds = new Set(
      CONCERT_CATALOG.filter(
        (item) => item.eventId === source.eventId && item.year === source.year,
      ).map((item) => item.videoId),
    );
    for (const id of source.videoIds)
      assert(catalogIds.has(id), `${source.eventId}/${source.year} lost ${id}`);
    for (const excluded of source.excluded) assert(!catalogIds.has(excluded.videoId));
  }
});

test('festival records preserve source attribution, unique recordings and original event years', () => {
  const ids = new Set<string>();
  for (const recording of CONCERT_CATALOG) {
    const key = `${recording.eventId}:${recording.year}:${recording.videoId}`;
    assert(!ids.has(key), `Duplicate ${key}`);
    ids.add(key);
    assert.match(recording.videoId, /^[A-Za-z0-9_-]{11}$/);
    assert.equal(recording.sourceUrl, `https://www.youtube.com/watch?v=${recording.videoId}`);
    assert(recording.uploaderName || recording.sourcePublisher);
    assert(recording.evidenceUrls.includes(recording.sourceUrl));
  }
  assert.equal(CONCERT_CATALOG.length, 290);
  assert.equal(CONCERT_CATALOG.find((item) => item.videoId === 'cWJV0DgMqEA')?.year, 2023);
  assert.equal(CONCERT_CATALOG.find((item) => item.videoId === 'jQLWYc2UrFY')?.artist, 'Westend');
  assert.equal(CONCERT_CATALOG.find((item) => item.videoId === 'PVh5bKxUjPo')?.artist, 'SKILAH');
  assert.equal(
    CONCERT_CATALOG.find((item) => item.videoId === 'bVF_7IiTAsI')?.uploaderName,
    'Beatport',
  );
});

test('festival playlist references use supported canonical metadata imports without inferred inventories', () => {
  assert.equal(CONCERT_PLAYLISTS.length, 5);
  for (const source of CONCERT_PLAYLISTS) {
    assert.equal(normalizePlaylistUrl(source.url).url, source.url);
    assert.equal(source.eventId, 'tomorrowland-belgium');
    assert(
      CONCERT_CATALOG.some((item) => item.eventId === source.eventId && item.year === source.year),
    );
  }
});
