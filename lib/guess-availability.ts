import type { GuessCategorySummary } from '../services/core/src/guess-catalog.ts';

/** Public capacity only. Reject malformed optional histograms rather than using legacy limits. */
export function validGuessCategory(value: unknown): value is GuessCategorySummary {
  if (!value || typeof value !== 'object') return false;
  const category = value as GuessCategorySummary;
  if (typeof category.id !== 'string' || !/^[a-z0-9-]{1,60}$/.test(category.id) ||
    typeof category.name !== 'string' || !category.name.trim() || category.name.length > 80 ||
    /[\p{Cc}\p{Cf}]/u.test(category.name) || typeof category.available !== 'boolean' ||
    !Number.isSafeInteger(category.count) || category.count < 0 || category.count > 1000 ||
    category.available !== (category.count > 0)) return false;
  if (category.durations === undefined) return true;
  if (!Array.isArray(category.durations) || category.durations.length > 76) return false;
  let total = 0, previous = 14;
  for (const bucket of category.durations) {
    if (!bucket || !Number.isInteger(bucket.seconds) || bucket.seconds <= previous || bucket.seconds > 90 ||
      !Number.isSafeInteger(bucket.count) || bucket.count < 1 || bucket.count > 1000) return false;
    previous = bucket.seconds; total += bucket.count;
  }
  return total === category.count;
}

export function validGuessCategories(value: unknown): value is GuessCategorySummary[] {
  if (!Array.isArray(value) || value.length > 32) return false;
  const ids = new Set<string>();
  for (const category of value) {
    if (!validGuessCategory(category) || ids.has(category.id)) return false;
    ids.add(category.id);
  }
  return true;
}

export function guessAvailability(category: unknown, durationSeconds: number, roundCount: number) {
  const valid = validGuessCategory(category), synthetic = valid && category.id === 'synthetic-test';
  const histogram = valid ? category.durations : undefined;
  const known = Boolean(histogram?.length);
  const maxDurationSeconds = known ? histogram![histogram!.length - 1].seconds : synthetic ? 30 : 90;
  const eligibleRounds = !valid || !category.available ? 0 : histogram
    ? histogram.reduce((count, bucket) => count + (bucket.seconds >= durationSeconds ? bucket.count : 0), 0)
    : category.count;
  // Old Core summaries keep their existing input ranges; their total still bounds Start.
  const maxRounds = known ? Math.min(20, eligibleRounds) : synthetic ? 5 : 20;
  const reason = !valid || !category.available ? 'unavailable'
    : !Number.isInteger(durationSeconds) || durationSeconds < 15 || durationSeconds > maxDurationSeconds ? 'duration'
    : !Number.isInteger(roundCount) || roundCount < 1 || roundCount > Math.min(maxRounds, eligibleRounds) ? 'rounds' : null;
  return { maxDurationSeconds, maxRounds, eligibleRounds, known, reason, canStart: reason === null };
}
