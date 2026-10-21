import { setImmediate } from 'node:timers/promises';
import { GUESS_AUDIO_MAX_BYTES, GUESS_AUDIO_MAX_SECONDS, GUESS_AUDIO_RATE, guessWave } from './guess-audio-format.ts';
import { copyGuessMedia, copyGuessSong, type GuessCatalog, type GuessCategorySummary, type GuessSong } from './guess-catalog.ts';
import type { GuessMediaSource } from './guess-media.ts';
import { UserError } from './types.ts';

const CATEGORY = Object.freeze({ id: 'synthetic-test', name: 'Synthetic test tones', available: true, count: 5 });
const TONES = Object.freeze(['One', 'Two', 'Three', 'Four', 'Five'].map((name, index) => Object.freeze({
  song: copyGuessSong({ id: `synthetic-test-${index + 1}`, title: `Test Tone ${name}`,
    artist: 'Synthetic Test Generator', aliases: [], mediaKey: `synthetic_test_tone_${index + 1}` }),
  frequency: 220 + index * 110,
})));
const unavailable = () => new UserError('Synthetic test tone is unavailable.', 503);

/** Five fictional recordings generated locally. No provider, files, network or persisted clips. */
export class SyntheticGuessSource implements GuessCatalog, GuessMediaSource {
  readonly syntheticTest = true;

  categories(): GuessCategorySummary[] {
    return [{ ...CATEGORY, durations: [{ seconds: GUESS_AUDIO_MAX_SECONDS, count: CATEGORY.count }] }];
  }

  select(categoryId: string, options: { exclude: readonly string[]; durationSeconds: number }): GuessSong {
    if (!options || !Array.isArray(options.exclude) || options.exclude.length > 20 ||
      !options.exclude.every(id => typeof id === 'string' && id.length <= 128) ||
      !Number.isInteger(options.durationSeconds) || options.durationSeconds < 15 || options.durationSeconds > 90)
      throw new UserError('Invalid catalog selection.');
    const eligible = categoryId === CATEGORY.id && options.durationSeconds <= GUESS_AUDIO_MAX_SECONDS
      ? TONES.filter(tone => !options.exclude.includes(tone.song.id)) : [];
    if (!eligible.length) throw new UserError('This category has too few eligible songs for these settings.', 503);
    return copyGuessSong(eligible[Math.floor(Math.random() * eligible.length)].song);
  }

  media(key: string) {
    if (!TONES.some(tone => tone.song.mediaKey === key)) throw unavailable();
    return copyGuessMedia({ key, mimeType: 'audio/wav', durationSeconds: GUESS_AUDIO_MAX_SECONDS });
  }

  async read(key: string, signal: AbortSignal): Promise<Uint8Array> {
    const tone = TONES.find(candidate => candidate.song.mediaKey === key);
    if (!tone || signal.aborted) throw unavailable();
    const samples = GUESS_AUDIO_RATE * GUESS_AUDIO_MAX_SECONDS;
    const pcm = new Uint8Array(samples * 2), view = new DataView(pcm.buffer);
    // Yield between bounded batches so disconnected clients stop generation promptly.
    for (let start = 0; start < samples; start += 8192) {
      await setImmediate(undefined, { signal });
      if (signal.aborted) throw unavailable();
      for (let sample = start; sample < Math.min(start + 8192, samples); sample++) {
        const fade = Math.min(1, sample / 800, (samples - sample - 1) / 800);
        view.setInt16(sample * 2, Math.round(6000 * fade * Math.sin(2 * Math.PI * tone.frequency * sample / GUESS_AUDIO_RATE)), true);
      }
    }
    if (signal.aborted || pcm.length + 44 > GUESS_AUDIO_MAX_BYTES) throw unavailable();
    return guessWave(pcm);
  }
}
