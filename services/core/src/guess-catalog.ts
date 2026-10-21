import { UserError } from './types.ts';

/** Optional histogram of available whole-second clip lengths, ascending and clamped to 90 seconds. */
export type GuessCategorySummary = {
  id: string; name: string; available: boolean; count: number;
  durations?: { seconds: number; count: number }[];
};
/** Private catalog metadata. Never serialize this into a live public round. */
export type GuessSong = { id: string; title: string; artist: string; aliases: readonly string[]; mediaKey: string };
/** Internal descriptor, not a browser URL or authorization to expose media. */
export type GuessMediaDescriptor = { key: string; mimeType: 'audio/mpeg' | 'audio/ogg' | 'audio/wav'; durationSeconds: number };
export interface GuessCatalog {
  readonly syntheticTest?: true;
  categories(): readonly GuessCategorySummary[];
  select(categoryId: string, options: { exclude: readonly string[]; durationSeconds: number }): GuessSong;
  media(mediaKey: string): GuessMediaDescriptor;
}
const CATEGORY_EXAMPLES = Object.freeze([
  Object.freeze({ id: '2010s', name: '2010s' }),
  Object.freeze({ id: 'edm-classics', name: 'EDM classics' }),
  Object.freeze({ id: 'edm-festival-hits', name: 'EDM festival hits' }),
]);
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const KEY = /^[a-zA-Z0-9_-]{16,128}$/;
export function normalizeGuess(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
const answerText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  value.length <= 120 && !CONTROL.test(value) && Boolean(normalizeGuess(value)) && normalizeGuess(value).length <= 120;

/** Validate/copy even trusted adapter data, so a bad adapter cannot leak arbitrary objects. */
export function copyGuessSong(song: GuessSong): GuessSong {
  if (!song || typeof song.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(song.id) ||
    !answerText(song.title) || !answerText(song.artist) || !Array.isArray(song.aliases) || song.aliases.length > 8 ||
    !song.aliases.every(answerText) || typeof song.mediaKey !== 'string' || !KEY.test(song.mediaKey))
    throw new UserError('The eligible song catalog is unavailable.', 503);
  return Object.freeze({ id: song.id, title: song.title, artist: song.artist,
    aliases: Object.freeze([...new Set(song.aliases)]), mediaKey: song.mediaKey });
}
export function copyGuessMedia(media: GuessMediaDescriptor): GuessMediaDescriptor {
  if (!media || typeof media.key !== 'string' || !KEY.test(media.key) ||
    !['audio/mpeg', 'audio/ogg', 'audio/wav'].includes(media.mimeType) ||
    !Number.isFinite(media.durationSeconds) || media.durationSeconds < 15 || media.durationSeconds > 86_400)
    throw new UserError('The eligible song media is unavailable.', 503);
  return { key: media.key, mimeType: media.mimeType, durationSeconds: media.durationSeconds };
}

/** Default production provider. These are category examples, not a music inventory. */
export class UnavailableGuessCatalog implements GuessCatalog {
  categories(): GuessCategorySummary[] { return CATEGORY_EXAMPLES.map(category => ({ ...category, available: false, count: 0 })); }
  select(_categoryId: string, _options: { exclude: readonly string[]; durationSeconds: number }): GuessSong {
    void _categoryId; void _options;
    throw new UserError('No eligible music catalog is configured for this category.', 503);
  }
  media(_mediaKey: string): GuessMediaDescriptor { void _mediaKey; throw new UserError('No eligible game media is configured.', 503); }
}

export type PreparedGuessRecord = { categoryIds: readonly string[]; song: GuessSong; media: GuessMediaDescriptor };
export type OperatorGuessRecord = PreparedGuessRecord & { rightsCleared: true };
/**
 * Trusted server-prepared metadata only, never a public request/upload constructor.
 * Validates recording/category capacity without asserting recording rights or licensing.
 */
export class PreparedGuessCatalog implements GuessCatalog {
  private records: readonly PreparedGuessRecord[];
  private summaries: readonly GuessCategorySummary[];
  private random: () => number;
  constructor(records: readonly PreparedGuessRecord[], random = Math.random) {
    if (!Array.isArray(records) || records.length > 1000) throw new UserError('Invalid operator catalog.', 503);
    const ids = new Set<string>(), keys = new Set<string>();
    this.records = records.map(record => {
      if (!record || !Array.isArray(record.categoryIds) ||
        !record.categoryIds.length || record.categoryIds.length > CATEGORY_EXAMPLES.length ||
        new Set(record.categoryIds).size !== record.categoryIds.length ||
        !record.categoryIds.every((id: unknown) => CATEGORY_EXAMPLES.some(category => category.id === id)))
        throw new UserError('Invalid operator catalog eligibility.', 503);
      const song = copyGuessSong(record.song), media = copyGuessMedia(record.media);
      if (ids.has(song.id) || keys.has(song.mediaKey) || song.mediaKey !== media.key)
        throw new UserError('Invalid duplicate operator recording.', 503);
      ids.add(song.id); keys.add(song.mediaKey);
      return Object.freeze({ categoryIds: Object.freeze([...record.categoryIds]), song, media: Object.freeze(media) });
    });
    this.summaries = CATEGORY_EXAMPLES.map(category => {
      const histogram = new Map<number, number>();
      let count = 0;
      for (const record of this.records) if (record.categoryIds.includes(category.id)) {
        const seconds = Math.min(90, Math.floor(record.media.durationSeconds));
        histogram.set(seconds, (histogram.get(seconds) ?? 0) + 1); count++;
      }
      const durations = [...histogram].sort(([a], [b]) => a - b).map(([seconds, count]) => ({ seconds, count }));
      return { ...category, count, available: count > 0, durations };
    });
    this.random = random;
  }
  categories(): GuessCategorySummary[] {
    return this.summaries.map(category => ({ ...category, durations: category.durations!.map(bin => ({ ...bin })) }));
  }
  select(categoryId: string, options: { exclude: readonly string[]; durationSeconds: number }): GuessSong {
    if (!options || !Array.isArray(options.exclude) || options.exclude.length > 20 ||
      !options.exclude.every(id => typeof id === 'string' && id.length <= 128) ||
      !Number.isInteger(options.durationSeconds) || options.durationSeconds < 15 || options.durationSeconds > 90)
      throw new UserError('Invalid catalog selection.');
    const excluded = new Set(options.exclude);
    const eligible = this.records.filter(record => record.categoryIds.includes(categoryId) &&
      !excluded.has(record.song.id) && record.media.durationSeconds >= options.durationSeconds);
    if (!eligible.length) throw new UserError('This category has too few eligible songs for these settings.', 503);
    const sample = this.random();
    const index = Math.min(eligible.length - 1, Math.max(0, Math.floor((Number.isFinite(sample) ? sample : 0) * eligible.length)));
    return copyGuessSong(eligible[index].song);
  }
  media(mediaKey: string): GuessMediaDescriptor {
    const record = this.records.find(candidate => candidate.song.mediaKey === mediaKey);
    if (!record) throw new UserError('Eligible game media not found.', 503);
    return copyGuessMedia(record.media);
  }
}

/** Legacy private operator configuration retains its explicit attestation requirement. */
export class OperatorGuessCatalog extends PreparedGuessCatalog {
  constructor(records: readonly OperatorGuessRecord[], random = Math.random) {
    if (!Array.isArray(records) || records.length > 1000) throw new UserError('Invalid operator catalog.', 503);
    if (![...records].every(record => record?.rightsCleared === true)) throw new UserError('Invalid operator catalog eligibility.', 503);
    super(records, random);
  }
}
