import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  presetSettings,
  rankPlayers,
  validGameSettings,
  sameGameConfiguration,
} from '../src/lib/games/game-experience.ts';
const settings = {
  durationSeconds: 30,
  roundCount: 5,
  maxPoints: 1000,
  minPoints: 100,
  hints: true,
  answerMode: 'artist' as const,
};
test('game presets fit actual distinct recording lengths and retain the chosen answer mode', () => {
  const category = {
    id: 'party',
    name: 'Party',
    available: true,
    count: 8,
    durations: [
      { seconds: 15, count: 5 },
      { seconds: 30, count: 3 },
    ],
  };
  assert.equal(presetSettings('quick', category, settings)?.roundCount, 5);
  assert.deepEqual(presetSettings('party', category, settings), { ...settings, roundCount: 3 });
  assert.equal(presetSettings('encore', category, settings), null);
  assert.equal(
    presetSettings('quick', { ...category, available: false, count: 0, durations: [] }, settings),
    null,
  );
});
test('final standings handle ties without claiming a sole winner and preserve server input', () => {
  const players = [
    { id: 'b', nickname: 'Blair', total: 950, hasAnswered: true },
    { id: 'c', nickname: 'Casey', total: 200, hasAnswered: true },
    { id: 'a', nickname: 'Alex', total: 950, hasAnswered: true },
  ];
  assert.deepEqual(
    rankPlayers(players).map((player) => [player.nickname, player.rank]),
    [
      ['Alex', 1],
      ['Blair', 1],
      ['Casey', 3],
    ],
  );
  assert.deepEqual(
    players.map((player) => player.id),
    ['b', 'c', 'a'],
  );
});
test('one-click start rejects incomplete scoring inputs before it can save or start a game', () => {
  assert(validGameSettings(settings));
  for (const change of [
    { maxPoints: NaN },
    { minPoints: 1001 },
    { minPoints: -1 },
    { durationSeconds: 14 },
    { roundCount: 2.5 },
    { roundCount: 21 },
    { maxPoints: undefined },
  ])
    assert.equal(validGameSettings({ ...settings, ...change } as typeof settings), false);
});
test('unsaved host settings may follow unrelated revisions but never another session or configuration', () => {
  const previous = { sessionId: 'session-one', categoryId: 'party', settings };
  assert(sameGameConfiguration(previous, structuredClone(previous)));
  for (const change of [
    { durationSeconds: 15 },
    { roundCount: 8 },
    { maxPoints: 1500 },
    { minPoints: 50 },
    { hints: false },
    { answerMode: 'title' as const },
  ])
    assert.equal(
      sameGameConfiguration(previous, { ...previous, settings: { ...settings, ...change } }),
      false,
    );
  assert.equal(sameGameConfiguration(previous, { ...previous, categoryId: 'other' }), false);
  assert.equal(sameGameConfiguration(previous, { ...previous, sessionId: 'session-two' }), false);
  assert(
    sameGameConfiguration(
      { ...previous, settings: { ...settings, answerMode: undefined } },
      { ...previous, settings: { ...settings, answerMode: 'title' } },
    ),
  );
});
