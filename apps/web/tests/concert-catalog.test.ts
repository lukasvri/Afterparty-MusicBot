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
  ...[
    [2019, 28, 22, 0, 'ed06d7bb2f617c1886b26f0680e1dd9ad872699afa9f59daa1ac6f82cdb2cc33'],
    [2023, 33, 33, 0, 'da45de32b9c23fc2964c4a55e412e49ebeb0850a65db3311f058600a7972888c'],
    [2024, 47, 46, 0, '230d1ef92a90925f1d3c4c1452e6f09a6104c57e8d8585325582de4ac506ff7b'],
    [2025, 34, 32, 2, '59d94f7b16fc2764c12098f55fddbac54b0200ed923c33770b14c94ce109bd59'],
    [2026, 48, 47, 0, 'cd0f8b2dccdf82336a2d441c48de59772281b74233abce4ab09bdab3f960ea89'],
  ].map(([year, listedCount, includedCount, duplicateCount, sha256]) => ({
    eventId: 'ultra-miami',
    year: Number(year),
    listedCount: Number(listedCount),
    includedCount: Number(includedCount),
    duplicateCount: Number(duplicateCount),
    sha256: String(sha256),
    sourceUrl: `https://ultramusicfestival.com/live-sets/season/${year}`,
  })),
  {
    eventId: 'amsterdam-rai',
    year: 2019,
    listedCount: 7,
    includedCount: 7,
    sourceUrl: 'https://www.youtube.com/playlist?list=PLOPmDfV0hAMbsTZQVTWiCNLcrErCDl_VO',
    sha256: 'ac87a8bb2c6e903e19fd9f25d71b0e1fc552e72d8142e0bb2a600cd43c699711',
  },
  {
    eventId: 'amsterdam-rai',
    year: 2023,
    listedCount: 13,
    includedCount: 7,
    sourceUrl: 'https://www.youtube.com/@STMPDRCRDS/search?query=RAI',
    sha256: 'bb9bc4a8f35745acbe840cf5b99bcc13fba03a941aeeabfcf177ed6fdf4327f4',
  },
];

test('festival indexes retain every checked matching-year source link', () => {
  assert.equal(CONCERT_SOURCES.length, snapshots.length);
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
    for (const excluded of source.excluded) {
      if (excluded.videoId) assert(!catalogIds.has(excluded.videoId));
      else {
        assert.equal(source.eventId, 'ultra-miami');
        assert.match(excluded.sourceUrl, /^https:\/\/(?:w\.)?soundcloud\.com\//);
        assert.match(excluded.reason, /not supported/);
      }
    }
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
  assert.equal(CONCERT_CATALOG.length, 1049);
  assert.equal(CONCERT_CATALOG.find((item) => item.videoId === 'cWJV0DgMqEA')?.year, 2023);
  assert.equal(CONCERT_CATALOG.find((item) => item.videoId === 'jQLWYc2UrFY')?.artist, 'Westend');
  assert.equal(CONCERT_CATALOG.find((item) => item.videoId === 'PVh5bKxUjPo')?.artist, 'SKILAH');
  assert.equal(
    CONCERT_CATALOG.find((item) => item.videoId === 'bVF_7IiTAsI')?.uploaderName,
    'Beatport',
  );
});

test('Tomorrowland source snapshots retain outside-playlist uploads and checked omissions', () => {
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
    for (const entry of source.excluded)
      assert.equal(
        entry.reason,
        entry.videoId === '6OR-4ainmUY'
          ? 'YouTube reports this video as unavailable; the cause is unspecified.'
          : 'YouTube marks this video as private.',
      );
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

const originalUltraIds = new Set([
  'i_BPdQ-FidY',
  'vBvZaydcCzc',
  'hQ6k0_Iura0',
  '3-ELBiUkUWc',
  'w3zCxh-70Ms',
  'uPhsq1msjl8',
  'fz-3arJT8fc',
]);
const originalRaiIds = new Set(['cWJV0DgMqEA', 'lGCo8ILvauI', 'CwE-haZR2fc']);
test('RAI expansion preserves all 1036 preceding catalog objects exactly', () => {
  const previous = CONCERT_CATALOG.filter(
    (entry) => entry.eventId !== 'amsterdam-rai' || originalRaiIds.has(entry.videoId),
  ).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  assert.equal(previous.length, 1036);
  assert.equal(
    createHash('sha256').update(JSON.stringify(previous)).digest('hex'),
    'cd848bbe1e92ccfee29dd2c99251b7f6f93c120be1c817ec97c0bd07024e4b90',
  );
});
test('RAI inventories retain the full captured sources without inventing separate shows', () => {
  const sources = CONCERT_SOURCES.filter((source) => source.eventId === 'amsterdam-rai');
  assert.deepEqual(sources.map((source) => source.year).sort(), [2019, 2023]);
  const source2023 = sources.find((source) => source.year === 2023)!;
  assert.equal(source2023.excluded.length, 6);
  for (const excluded of source2023.excluded) {
    assert.equal(excluded.reason, 'The source recording identifies Amsterdam RAI 2019, not 2023.');
    assert(
      CONCERT_CATALOG.some((entry) => entry.videoId === excluded.videoId && entry.year === 2019),
    );
  }
  const added = CONCERT_CATALOG.filter(
    (entry) => entry.eventId === 'amsterdam-rai' && !originalRaiIds.has(entry.videoId),
  );
  assert.equal(added.length, 13);
  const titles = added
    .map((entry) => [entry.videoId, entry.title])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map((row) => row.join('\t'))
    .join('\n');
  assert.equal(
    createHash('sha256').update(titles).digest('hex'),
    '9fa65379c07e2ad12e7ecc2ca393cc7ff756a66c458b1f8abef05d7908cffc54',
  );
  for (const entry of added) {
    assert.equal(entry.verifiedAt, '2026-10-31');
    assert.equal(entry.sourcePublisher, entry.year === 2019 ? 'Martin Garrix' : 'STMPD RCRDS');
    assert.equal(entry.uploaderName, undefined);
    assert(entry.title.includes(String(entry.year)));
  }
  assert.equal(CONCERT_CATALOG.filter((entry) => entry.eventId === 'amsterdam-rai').length, 16);
  assert.equal(CONCERT_CATALOG.find((entry) => entry.videoId === 'cWJV0DgMqEA')?.year, 2023);
});
test('Ultra expansion preserves all 863 pre-existing catalog objects and evidence', () => {
  const groups = new Set([
    'edc-las-vegas:2026',
    'edc-las-vegas:2025',
    'edc-las-vegas:2023',
    'creamfields:2024',
    ...[2022, 2023, 2024, 2025, 2026].map((year) => `tomorrowland-belgium:${year}`),
  ]);
  const indexed = new Set(
    CONCERT_SOURCES.filter((source) => groups.has(`${source.eventId}:${source.year}`)).flatMap(
      (source) => source.videoIds.map((id) => `${source.eventId}:${source.year}:${id}`),
    ),
  );
  const retained = new Set([
    ...originalTomorrowlandIds,
    ...originalUltraIds,
    'cWJV0DgMqEA',
    'lGCo8ILvauI',
    'CwE-haZR2fc',
    'bVF_7IiTAsI',
  ]);
  const previous = CONCERT_CATALOG.filter(
    (entry) =>
      retained.has(entry.videoId) || indexed.has(`${entry.eventId}:${entry.year}:${entry.videoId}`),
  ).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  assert.equal(previous.length, 863);
  assert.equal(
    createHash('sha256').update(JSON.stringify(previous)).digest('hex'),
    '64abce2f528c52d6de12329107339e0008450f83792804c3498476f22a16b78e',
  );
});
test('Ultra snapshots distinguish unsupported audio from disabled video embedding', () => {
  const sources = CONCERT_SOURCES.filter((source) => source.eventId === 'ultra-miami');
  assert.equal(sources.length, 5);
  assert.equal(sources.flatMap((source) => source.videoIds).length, 180);
  assert.equal(
    sources.flatMap((source) => source.excluded).filter((entry) => !entry.videoId).length,
    7,
  );
  const videoOmissions = sources
    .flatMap((source) => source.excluded)
    .filter((entry) => entry.videoId);
  assert.equal(videoOmissions.length, 1);
  assert.equal(videoOmissions[0].videoId, 'QuW1fTqxXwk');
  assert.equal(
    videoOmissions[0].reason,
    'YouTube identifies this recording but reports that embedding is disabled.',
  );
  assert(!/private|deleted|blocked/i.test(videoOmissions[0].reason));
  const added = CONCERT_CATALOG.filter(
    (entry) => entry.eventId === 'ultra-miami' && !originalUltraIds.has(entry.videoId),
  );
  assert.equal(added.length, 173);
  assert.equal(
    createHash('sha256')
      .update(
        added
          .map((entry) => entry.videoId)
          .sort()
          .join('\n'),
      )
      .digest('hex'),
    '6a3ef9491bc496bb178b0330ca039249613354c00aada627fd80121101895238',
  );
  const titles = added
    .map((entry) => [entry.videoId, entry.title])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map((row) => row.join('\t'))
    .join('\n');
  assert.equal(
    createHash('sha256').update(titles).digest('hex'),
    'f7bb519bb47fb3f7284d97ad4e72ace237bf07487393df39af2ca362d00e820e',
  );
  for (const entry of added) {
    assert.equal(entry.sourcePublisher, 'Ultra Music Festival');
    assert.equal(entry.uploaderName, undefined);
    assert.equal(entry.verifiedAt, '2026-10-31');
  }
  assert.equal(CONCERT_CATALOG.find((entry) => entry.videoId === '5yBSJ2Z6pjY')?.year, 2019);
  assert.equal(CONCERT_CATALOG.find((entry) => entry.videoId === 'coJzawYORs0')?.year, 2024);
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
