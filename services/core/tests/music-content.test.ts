import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metadataAiGenerated } from '../src/music-content.ts';
import { soundcloudTrack } from '../src/soundcloud.ts';
import { publicTrack } from '../src/types.ts';

test('explicit generated music and synthetic-media declarations remain negative evidence wherever supplied', () => {
  for (const label of ['AI-generated', '#AIgenerated', 'AI cover', 'A.I. vocals', 'AI_music', 'Music created using Suno', 'made with Udio', 'AI\u200b-generated music', 'KI-generert musikk', 'synthetic vocals']) {
    assert.equal(metadataAiGenerated(label, ''), true, label);
    assert.equal(metadataAiGenerated('', label), true, label);
    assert.equal(metadataAiGenerated('', '', label), true, label);
    assert.equal(metadataAiGenerated('', '', '', [label]), true, label);
  }
  assert.equal(metadataAiGenerated('Original song', 'Original artist', '', [], true), true);
});

test('ordinary names and unlabelled metadata do not claim either AI or human provenance', () => {
  for (const label of ['Janji - Heroes Tonight (feat. Johnning) [NCS Release]', 'OneRepublic - A.I.', 'Air - All I Need', 'Ailee - Heaven', 'The Human League - Human', 'Synthetic Dreams', 'Official Audio', 'No AI music, only real instruments', 'Not AI generated'])
    assert.equal(metadataAiGenerated(label, 'Artist'), undefined, label);
  assert.equal(metadataAiGenerated(null, 123, {}, [null, false], false), undefined);
});

test('SoundCloud metadata and public recording copies retain only explicit negative evidence', () => {
  const data = { id: 'synthetic', title: 'Artist - Song', uploader: 'Artist', webpage_url: 'https://soundcloud.com/artist/song', duration: 200 };
  assert.equal(soundcloudTrack(data).aiGenerated, undefined);
  const track = soundcloudTrack({ ...data, description: 'Created using Suno' });
  assert.equal(track.aiGenerated, true);
  assert.equal(publicTrack(track)?.aiGenerated, true);
});
