import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankMusicSearch } from '../src/music-search.ts';

const track = (id: string, title: string, artist = 'Janji', extra = {}) => ({
  id, title, artist, embeddable: true, live: false, ...extra,
});

test('search ranks complete title/artist matches ahead of provider-position noise without changing its pool', () => {
  const tracks = [
    track('unrelated01', 'Heroes of the Night'),
    track('remix000001', 'Janji - Heroes Tonight (Remix)'),
    track('correct0001', 'Janji - Heroes Tonight (Official Audio)', 'Janji - Topic'),
    track('tutorial001', 'How to make Janji Heroes Tonight tutorial', 'Producer', { music: false }),
  ];
  const before = structuredClone(tracks);
  const ranked = rankMusicSearch('Janji Heroes Tonight', tracks);
  assert.equal(ranked[0].id, 'correct0001');
  assert.equal(ranked.length, tracks.length);
  assert.deepEqual(tracks, before);
});

test('explicit remix, cover and live requests remain available and gain the requested format preference', () => {
  for (const format of ['remix', 'cover', 'live']) {
    const original = track('original001', 'Janji - Heroes Tonight (Official Audio)');
    const version = track('version0001', `Janji - Heroes Tonight (${format})`);
    assert.equal(rankMusicSearch(`Janji Heroes Tonight ${format}`, [original, version])[0].id, version.id);
  }
});

test('diacritics and punctuation normalize locally while negative provider terms are never desired words', () => {
  const tracks = [track('cover000001', 'Tiësto - Éclair cover'), track('original001', 'Tiësto - Éclair')];
  assert.equal(rankMusicSearch('Tiesto Eclair -"cover"', tracks)[0].id, 'original001');
});

test('search deduplicates IDs only, preserves alternate uploads and stable ties, and bounds work to fifty results', () => {
  const tracks = Array.from({ length: 70 }, (_, i) => track(`track${String(i).padStart(6, '0')}`, 'Same song'));
  const ranked = rankMusicSearch('same song', [tracks[0], tracks[0], ...tracks.slice(1)]);
  assert.equal(ranked.length, 49);
  assert.deepEqual(ranked.map(item => item.id), tracks.slice(0, 49).map(item => item.id));
  assert.equal(rankMusicSearch('same song', [tracks[0], { ...tracks[1], embeddable: false }])[0].id, tracks[0].id);
});

test('declared AI is a default preference rather than a manual playback ban', () => {
  const generated = track('generated01', 'A song', 'Artist', { aiGenerated: true });
  const ordinary = track('ordinary001', 'A song', 'Artist');
  assert.equal(rankMusicSearch('a song', [generated, ordinary])[0].id, ordinary.id);
  assert.equal(rankMusicSearch('ai a song', [generated, ordinary])[0].id, generated.id);
});

test('a song named Live Forever remains the exact recording rather than a live-format request', () => {
  const original = track('original001', 'Oasis - Live Forever (Official Video)', 'Oasis');
  const live = track('live0000001', 'Oasis - Live Forever (Live at Wembley)', 'Oasis');
  assert.equal(rankMusicSearch('Live Forever', [live, original])[0].id, original.id);
  assert.equal(rankMusicSearch('Oasis', [original, track('other000001', 'Oasis - Another Song', 'Oasis')])[0].id, original.id);
});

test('festival queries favor relevant full live sets without hiding ordinary tracks', () => {
  const interview = track('interview01', 'Garrix Ultra Interview', 'Martin Garrix', { music: false });
  const set = track('fullset0001', 'Martin Garrix Live at Ultra (Full DJ Set)', 'Martin Garrix');
  assert.equal(rankMusicSearch('Martin Garrix Ultra', [interview, set])[0].id, set.id);
});

test('promotional brackets cannot erase a semantic remix or tutorial qualifier', () => {
  const original = track('original001', 'Janji - Heroes Tonight (feat. Johnning) [NCS Release]');
  for (const format of ['Official Remix', 'Official Audio Remix', 'Official Tutorial']) {
    const version = track('version0001', `Janji - Heroes Tonight (${format})`);
    assert.equal(rankMusicSearch('Janji Heroes Tonight', [version, original])[0].id, original.id);
  }
});
