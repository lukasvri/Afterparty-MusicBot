import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectGuessSource } from '../src/guess-source-config.ts';

const alpha = '2.4.0-alpha.13';
const disabled = { provider: 'disabled', alphaDefault: false };
const preset = { provider: 'youtube', pack: 'edm-festival-hits', alphaDefault: true };

test('only exact alpha release versions select the bundled quiz by default', () => {
  for (const version of ['0.0.0-alpha.0', '2.4.0-alpha.13', '10.20.30-alpha.999'])
    assert.deepEqual(selectGuessSource({}, version), preset);
  for (const version of ['2.4.0', '2.4.0-beta.13', '2.4.0-rc.1', '2.4.0-alpha', '2.4.0-alpha.01',
    'v2.4.0-alpha.13', '2.4.0-alpha.13+build', '2.4.0-alpha.13-extra', '02.4.0-alpha.13',
    '2.4.0-alpha.13\n', ' 2.4.0-alpha.13', '', 'unreadable'])
    assert.deepEqual(selectGuessSource({}, version), disabled);
});

test('alpha auto/unset flags enable the preset, while explicit zero and invalid values never enable it', () => {
  for (const flag of [undefined, '', 'auto', '1'])
    assert.deepEqual(selectGuessSource({ GUESS_YOUTUBE_CLIPS: flag }, alpha), preset);
  for (const flag of ['0', 'true', 'false', 'AUTO', ' 1', '1 ', 'yes', '2']) {
    const env = { GUESS_YOUTUBE_CLIPS: flag, GUESS_YOUTUBE_PACK: 'edm-festival-hits' };
    assert.deepEqual(selectGuessSource(env, alpha), disabled);
  }
  for (const flag of [undefined, '', 'auto', '0', 'true'])
    assert.deepEqual(selectGuessSource({ GUESS_YOUTUBE_CLIPS: flag }, '2.4.0'), disabled);
});

test('explicit modes win over automatic alpha selection and conflicting exact-one flags fail closed', () => {
  for (const flag of [undefined, '', 'auto', '0', 'true']) {
    assert.deepEqual(selectGuessSource({ GUESS_YOUTUBE_CLIPS: flag, GUESS_DEEZER_PREVIEWS: '1' }, alpha), { provider: 'deezer', alphaDefault: false });
    assert.deepEqual(selectGuessSource({ GUESS_YOUTUBE_CLIPS: flag, GUESS_SYNTHETIC_TEST: '1' }, alpha), { provider: 'synthetic', alphaDefault: false });
  }
  for (const version of [alpha, '2.4.0']) for (const env of [
    { GUESS_YOUTUBE_CLIPS: '1', GUESS_DEEZER_PREVIEWS: '1' },
    { GUESS_YOUTUBE_CLIPS: '1', GUESS_SYNTHETIC_TEST: '1' },
    { GUESS_DEEZER_PREVIEWS: '1', GUESS_SYNTHETIC_TEST: '1' },
  ]) assert.throws(() => selectGuessSource(env, version), { status: 503 });
});

test('custom selectors retain their exact meaning without an automatic fallback to the bundled pack', () => {
  const path = '/private/custom.json';
  assert.deepEqual(selectGuessSource({ GUESS_YOUTUBE_INVENTORY_PATH: path }, alpha), { provider: 'youtube', alphaDefault: true });
  assert.deepEqual(selectGuessSource({ GUESS_YOUTUBE_CLIPS: '1', GUESS_YOUTUBE_INVENTORY_PATH: path }, alpha), { provider: 'youtube', alphaDefault: false });
  for (const version of [alpha, '2.4.0']) {
    assert.deepEqual(selectGuessSource({ GUESS_YOUTUBE_CLIPS: '1', GUESS_YOUTUBE_PACK: 'explicit-pack' }, version),
      { provider: 'youtube', pack: 'explicit-pack', alphaDefault: false });
    assert.deepEqual(selectGuessSource({ GUESS_YOUTUBE_CLIPS: '1', GUESS_YOUTUBE_INVENTORY_PATH: path }, version),
      { provider: 'youtube', alphaDefault: false });
    assert.throws(() => selectGuessSource({ GUESS_YOUTUBE_CLIPS: '1', GUESS_YOUTUBE_PACK: 'explicit-pack', GUESS_YOUTUBE_INVENTORY_PATH: path }, version), { status: 503 });
  }
  assert.deepEqual(selectGuessSource({ GUESS_YOUTUBE_CLIPS: '1' }, '2.4.0'), { provider: 'youtube', alphaDefault: false }, 'stable explicit enable still requires a pack or private path at preparation');
});

test('selection never consults private Deezer paths or inactive YouTube selectors', () => {
  const env: NodeJS.ProcessEnv = { get GUESS_DEEZER_INVENTORY_PATH(): string { return assert.fail('must not inspect a Deezer private path'); } };
  assert.deepEqual(selectGuessSource(env, alpha), preset);
  env.GUESS_DEEZER_PREVIEWS = '1';
  assert.deepEqual(selectGuessSource(env, alpha), { provider: 'deezer', alphaDefault: false });
  assert.deepEqual(selectGuessSource({ GUESS_YOUTUBE_CLIPS: '0',
    get GUESS_YOUTUBE_INVENTORY_PATH(): string { return assert.fail('disabled selectors must remain unread'); },
    get GUESS_YOUTUBE_PACK(): string { return assert.fail('disabled selectors must remain unread'); },
  }, alpha), disabled);
});
