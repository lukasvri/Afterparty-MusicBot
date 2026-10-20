import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessAvailability, validGuessCategories, validGuessCategory } from '../lib/guess-availability.ts';

const mixed = { id: '2010s', name: '2010s', available: true, count: 5,
  durations: [{ seconds: 15, count: 3 }, { seconds: 30, count: 2 }] };

test('mixed recording durations bound distinct rounds at the selected duration', () => {
  assert(validGuessCategory(mixed));
  for (const [seconds, rounds] of [[15, 5], [16, 2], [30, 2]]) {
    const availability = guessAvailability(mixed, seconds, rounds);
    assert.equal(availability.canStart, true);
    assert.equal(availability.maxDurationSeconds, 30);
    assert.equal(availability.maxRounds, rounds);
    assert.equal(availability.eligibleRounds, rounds);
    assert.equal(guessAvailability(mixed, seconds, rounds + 1).reason, 'rounds');
  }
  assert.equal(guessAvailability(mixed, 31, 1).reason, 'duration');
  assert.equal(guessAvailability(mixed, 14, 1).canStart, false);
  for (const value of [NaN, Infinity, 15.5]) assert.equal(guessAvailability(mixed, value, 1).canStart, false);
  for (const value of [0, -1, 1.5, Infinity]) assert.equal(guessAvailability(mixed, 15, value).canStart, false);
});

test('untrusted optional duration histograms fail closed, including sparse and inconsistent data', () => {
  const malformed = [null, {}, [], [{ seconds: 15, count: 5 }, { seconds: 15, count: 1 }],
    [{ seconds: 30, count: 2 }, { seconds: 15, count: 3 }], [{ seconds: 14, count: 5 }],
    [{ seconds: 91, count: 5 }], [{ seconds: 15.5, count: 5 }], [{ seconds: '30', count: 5 }],
    [{ seconds: 30, count: 0 }], [{ seconds: 30, count: -1 }], [{ seconds: 30, count: 4 }],
    [{ seconds: 30, count: 5.5 }], [{ seconds: 30, count: '5' }], [{ seconds: 30, count: Infinity }],
    Array(1), Array.from({ length: 77 }, () => ({ seconds: 30, count: 1 }))];
  for (const durations of malformed) {
    const category = { ...mixed, durations };
    assert.equal(validGuessCategory(category), false);
    assert.equal(guessAvailability(category, 15, 1).canStart, false);
  }
  assert.equal(validGuessCategories([mixed, mixed]), false);
  assert.equal(validGuessCategories(Array(1)), false);
  assert.equal(validGuessCategories([{ ...mixed, available: false }]), false);
  assert.equal(validGuessCategories([{ ...mixed, count: 1001 }]), false);
});

test('legacy ranges and synthetic fallback remain compatible, with no optimistic missing capacity', () => {
  const legacy = { id: '2010s', name: '2010s', available: true, count: 20 };
  const old = guessAvailability(legacy, 90, 20);
  assert.equal(old.maxDurationSeconds, 90); assert.equal(old.maxRounds, 20); assert(old.canStart);
  const synthetic = { ...legacy, id: 'synthetic-test', count: 5 };
  const tones = guessAvailability(synthetic, 30, 5);
  assert.equal(tones.maxDurationSeconds, 30); assert.equal(tones.maxRounds, 5); assert(tones.canStart);
  assert.equal(guessAvailability(synthetic, 31, 1).canStart, false);
  assert.equal(guessAvailability(synthetic, 30, 6).canStart, false);
  assert.equal(guessAvailability({ ...synthetic, count: 20 }, 30, 6).canStart, false);
  for (const category of [undefined, null, { ...legacy, available: false, count: 0 },
    { ...legacy, available: false, count: 0, durations: [] }]) {
    assert.equal(guessAvailability(category, 15, 1).reason, 'unavailable');
  }
  assert.equal(validGuessCategory({ ...legacy, available: false, count: 0, durations: [] }), true);
  assert.equal(guessAvailability({ ...legacy, count: 2 }, 30, 3).canStart, false);
});
