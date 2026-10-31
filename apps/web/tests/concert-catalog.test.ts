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
  ...[
    [
      2022,
      'PLoSIOFPSXQoNFQ1nzaPy90MAt94vqJDb4',
      143,
      133,
      0,
      '4de17af9d18f3d1305833df9546c1295559539c3ae2b2aa2b16d854cb63b00a3',
    ],
    [
      2023,
      'PLoSIOFPSXQoOZSSYZtdmZzagDK9kNfUsu',
      99,
      96,
      0,
      '77688c05b7d800198026f5b7ecad493f9c18593d7b1f937300358c685ad6f963',
    ],
    [
      2024,
      'PLoSIOFPSXQoO6Y2EaUcVcBXQm7pkkY0n3',
      143,
      123,
      17,
      '74bb1b9bd3ce114a466900e0516bfe94203bb7f9700eeab53317e26272870d82',
    ],
    [
      2025,
      'PLoSIOFPSXQoN-uoi-Bn6R4JA8C4beRJsU',
      109,
      108,
      0,
      '29708fc5e24b63e75d2b182987466188bd42314f45a75132aacccccd9a55f2d0',
    ],
    [
      2026,
      'PLeeZgE3_zp1w',
      134,
      134,
      0,
      'f28d441384786e709d9c857fa9b2a962c4a07909012d218f843e3fb3b6eedf06',
    ],
  ].map(([year, playlist, listedCount, includedCount, duplicateCount, sha256]) => ({
    eventId: 'tomorrowland-belgium',
    year: Number(year),
    listedCount: Number(listedCount),
    includedCount: Number(includedCount),
    duplicateCount: Number(duplicateCount),
    sourceUrl: `https://www.youtube.com/playlist?list=${playlist}`,
    sha256: String(sha256),
  })),
];

test('festival indexes retain every checked matching-year source link', () => {
  for (const snapshot of snapshots) {
    const source = CONCERT_SOURCES.find(
      (item) => item.eventId === snapshot.eventId && item.year === snapshot.year,
    );
    assert(source);
    assert.equal(source.listedCount, snapshot.listedCount);
    assert.equal(source.videoIds.length, snapshot.includedCount);
    assert.equal(source.duplicateCount, 'duplicateCount' in snapshot ? snapshot.duplicateCount : 0);
    assert.equal(
      source.videoIds.length + source.excluded.length + (source.duplicateCount ?? 0),
      source.listedCount,
    );
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
  assert.equal(CONCERT_CATALOG.length, 863);
  assert.equal(CONCERT_CATALOG.find((item) => item.videoId === 'cWJV0DgMqEA')?.year, 2023);
  assert.equal(CONCERT_CATALOG.find((item) => item.videoId === 'jQLWYc2UrFY')?.artist, 'Westend');
  assert.equal(CONCERT_CATALOG.find((item) => item.videoId === 'PVh5bKxUjPo')?.artist, 'SKILAH');
  assert.equal(
    CONCERT_CATALOG.find((item) => item.videoId === 'bVF_7IiTAsI')?.uploaderName,
    'Beatport',
  );
});

test('Tomorrowland source snapshots retain outside-playlist uploads and unresolved evidence', () => {
  const years = [2022, 2023, 2024, 2025, 2026];
  const totals = [134, 97, 124, 109, 137];
  for (let index = 0; index < years.length; index++) {
    const year = years[index];
    const source = CONCERT_SOURCES.find(
      (item) => item.eventId === 'tomorrowland-belgium' && item.year === year,
    );
    assert(source);
    assert.equal(source.checkedAt, '2026-10-31');
    assert.equal(
      CONCERT_CATALOG.filter((item) => item.eventId === source.eventId && item.year === year)
        .length,
      totals[index],
    );
    for (const entry of source.excluded) assert.match(entry.reason, /unresolved|metadata/i);
  }
  for (const id of [
    '9cWsoVKpNjw',
    'raOVXUB13vw',
    '_KWuiCtWyNA',
    'RmxWqo83MO4',
    'GSnPwle4FOE',
    'Py-GG74lLU8',
    'sqxFW3RXGdo',
  ])
    assert(CONCERT_CATALOG.some((item) => item.videoId === id && item.uploaderName));
});

const originalTomorrowlandIds = new Set([
  'fhiZ1Rj9o-A',
  'NpL_bT5vgmU',
  'uMgz40hvySQ',
  'jSJEkiV3cCs',
  'GSnPwle4FOE',
  'Tj8NbfUMS-0',
  'Py-GG74lLU8',
  'KLyeLMJuIOY',
  'sqxFW3RXGdo',
  'JKM0Gy0lxYE',
  'TsyGMhx8izw',
  '2i3XOxbp54U',
  'EuqrehK1XFw',
  'aDAWctObTvI',
  'jXEtB43exs0',
  'g4vR2VlhNtk',
  'eir5Sh_gHbo',
  '5AdQy7lCbN0',
  '8-J01-hcHfA',
  '1lqmFLr-SkA',
  'QcvGuOhSVlc',
  'RmxWqo83MO4',
  '_KWuiCtWyNA',
  'dSK13X9oGi8',
  '2WJoKYs4xnk',
  '1MelBcPuHXU',
  'raOVXUB13vw',
  '9cWsoVKpNjw',
]);

test('source expansion preserves all 290 original records and their evidence exactly', () => {
  const oldIndexGroups = new Set([
    'edc-las-vegas:2026',
    'edc-las-vegas:2025',
    'edc-las-vegas:2023',
    'creamfields:2024',
  ]);
  const oldIndexed = new Set(
    CONCERT_SOURCES.filter((source) =>
      oldIndexGroups.has(`${source.eventId}:${source.year}`),
    ).flatMap((source) => source.videoIds.map((id) => `${source.eventId}:${source.year}:${id}`)),
  );
  const otherCurated = new Set([
    'i_BPdQ-FidY',
    'vBvZaydcCzc',
    'hQ6k0_Iura0',
    '3-ELBiUkUWc',
    'w3zCxh-70Ms',
    'uPhsq1msjl8',
    'fz-3arJT8fc',
    'cWJV0DgMqEA',
    'lGCo8ILvauI',
    'CwE-haZR2fc',
    'bVF_7IiTAsI',
  ]);
  const original = CONCERT_CATALOG.filter(
    (item) =>
      originalTomorrowlandIds.has(item.videoId) ||
      otherCurated.has(item.videoId) ||
      oldIndexed.has(`${item.eventId}:${item.year}:${item.videoId}`),
  ).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  assert.equal(original.length, 290);
  assert.equal(
    createHash('sha256').update(JSON.stringify(original)).digest('hex'),
    '489a8422d401c4a48cbc507962576b67b21c5973b19df6c85f6d28b4f834d1ed',
  );
});

test('all 573 added recording titles match the independent playlist capture', () => {
  const added = CONCERT_CATALOG.filter(
    (item) => item.eventId === 'tomorrowland-belgium' && !originalTomorrowlandIds.has(item.videoId),
  );
  assert.equal(added.length, 573);
  for (const entry of added) {
    assert.equal(entry.sourcePublisher, 'Tomorrowland');
    assert.equal(entry.uploaderName, undefined);
    assert.equal(entry.verifiedAt, '2026-10-31');
    assert.match(entry.title, new RegExp(`Tomorrowland ${entry.year}`));
  }
  const titles = added
    .map((entry) => [entry.videoId, entry.title])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  assert.equal(
    createHash('sha256').update(JSON.stringify(titles)).digest('hex'),
    '589f237ff8c9ff1af2183d03ccba1dbd8846ef64bd9203c1eeeafcb5efb85772',
  );
});

test('source titles keep performance qualifiers separate from artist and named stage', () => {
  const find = (id: string) => CONCERT_CATALOG.find((item) => item.videoId === id)!;
  assert.equal(find('eRJ5Msj2XkI').artist, 'Marlon Hoffstadt');
  assert.equal(find('eRJ5Msj2XkI').stage, 'CORE');
  assert.equal(find('eRJ5Msj2XkI').title, 'Marlon Hoffstadt WE2 (CORE Stage) | Tomorrowland 2024');
  assert.equal(find('4uHPAUR9bfk').artist, 'HALŌ');
  assert.equal(find('4uHPAUR9bfk').stage, 'Mainstage');
  assert.equal(find('jxTbsW1Isjw').artist, 'Charlotte de Witte');
  assert.equal(find('jxTbsW1Isjw').sourcePublisher, 'Tomorrowland');
  assert.equal(
    find('jxTbsW1Isjw').uploaderName,
    undefined,
    'A source publisher is not inferred uploader ownership',
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
