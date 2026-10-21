import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guessAbort } from './guess-audio-format.ts';
import { UnavailableGuessCatalog } from './guess-catalog.ts';
import { prepareConfiguredGuessSource, type GuessSourceOptions } from './guess-source.ts';
import { selectGuessSource, type GuessSourceProvider } from './guess-source-config.ts';

type Provider = GuessSourceProvider;
type Source = Exclude<Awaited<ReturnType<typeof prepareConfiguredGuessSource>>, undefined>;
export type GuessCheckFactory = (env: NodeJS.ProcessEnv, options: GuessSourceOptions) => Source | undefined | Promise<Source | undefined>;
export type GuessCheckCategory = { id: string; count: number; durations: { seconds: number; count: number }[] };
export type GuessCheckResult = {
  provider: Provider; status: 'disabled' | 'ready' | 'unavailable'; categories: GuessCheckCategory[];
  error?: 'The configured game preview source is unavailable.';
};
const unavailable = (provider: Provider): GuessCheckResult => ({ provider, status: 'unavailable', categories: [], error: 'The configured game preview source is unavailable.' });

/** Copy only known public category identities and bounded capacity, never adapter names or arbitrary fields. */
function categories(value: unknown, provider: Provider): GuessCheckCategory[] {
  const allowed = provider === 'synthetic' ? ['synthetic-test'] : new UnavailableGuessCatalog().categories().map(category => category.id);
  const maximum = provider === 'synthetic' ? 5 : 8, seen = new Set<string>();
  if (!Array.isArray(value) || !value.length || value.length > allowed.length) throw Error();
  const summaries: GuessCheckCategory[] = [];
  const length = value.length;
  for (let index = 0; index < length; index++) {
    const category = value[index];
    if (!category || typeof category !== 'object') throw Error();
    const { id, count, available, durations: bins } = category;
    if (!allowed.includes(id) || seen.has(id) || !Number.isInteger(count) || count < 0 || count > maximum ||
      available !== (count > 0) || !Array.isArray(bins) || bins.length > 16) throw Error();
    seen.add(id);
    let total = 0, previous = 14;
    const durations: GuessCheckCategory['durations'] = [];
    const binLength = bins.length;
    for (let index = 0; index < binLength; index++) {
      const bin = bins[index];
      if (!bin || typeof bin !== 'object') throw Error();
      const { seconds, count: binCount } = bin;
      if (!Number.isInteger(seconds) || seconds <= previous || seconds > 30 ||
        !Number.isInteger(binCount) || binCount < 1 || binCount > maximum) throw Error();
      previous = seconds; total += binCount;
      durations.push({ seconds, count: binCount });
    }
    if (total !== count) throw Error();
    summaries.push({ id, count, durations });
  }
  return summaries;
}

/** Private preflight only. Never starts Core, logs source details, retains audio or refreshes the inventory. */
export async function checkConfiguredGuessSource(env: NodeJS.ProcessEnv, options: GuessSourceOptions,
  prepare: GuessCheckFactory = prepareConfiguredGuessSource): Promise<GuessCheckResult> {
  let provider: Provider;
  try { provider = selectGuessSource(env).provider; } catch { return unavailable('disabled'); }
  if (provider === 'disabled') return { provider, status: 'disabled', categories: [] };
  const config = { GUESS_DEEZER_PREVIEWS: env.GUESS_DEEZER_PREVIEWS, GUESS_SYNTHETIC_TEST: env.GUESS_SYNTHETIC_TEST,
    GUESS_YOUTUBE_CLIPS: env.GUESS_YOUTUBE_CLIPS,
    GUESS_YOUTUBE_PACK: env.GUESS_YOUTUBE_PACK,
    ...(provider === 'deezer' ? { GUESS_DEEZER_INVENTORY_PATH: env.GUESS_DEEZER_INVENTORY_PATH } : {}),
    ...(provider === 'youtube' ? { GUESS_YOUTUBE_INVENTORY_PATH: env.GUESS_YOUTUBE_INVENTORY_PATH } : {}) };
  const lifetime = new AbortController();
  let source: Source | undefined, result = unavailable(provider);
  const released = new WeakSet<object>();
  const release = (prepared: Source | undefined) => {
    if (prepared === undefined) return true;
    try {
      if (prepared === null || typeof prepared !== 'object') return false;
      if (released.has(prepared)) return true;
      released.add(prepared); prepared.dispose(); return true;
    } catch { return false; }
  };
  try {
    const signal = AbortSignal.any([options.signal, lifetime.signal]);
    signal.throwIfAborted();
    const pending = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return prepare(config, { ...options, signal });
    }).then(prepared => {
      source = prepared;
      // An injected factory can ignore cancellation and finish after the check has returned.
      if (signal.aborted) { release(prepared); throw Error(); }
      return prepared;
    });
    source = await guessAbort(pending, signal);
    signal.throwIfAborted();
    if (!source) throw Error();
    const summary = categories(source.catalog.categories(), provider);
    signal.throwIfAborted();
    if (!summary.some(category => category.count > 0)) throw Error();
    result = { provider, status: 'ready', categories: summary };
  } catch { result = unavailable(provider); }
  finally {
    lifetime.abort();
    if (!release(source)) result = unavailable(provider);
  }
  return result;
}

async function main() {
  const lifetime = new AbortController(), cancel = () => lifetime.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const result = await checkConfiguredGuessSource(process.env, {
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(60_000)]),
    });
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = result.status === 'unavailable' ? 1 : 0;
  } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
