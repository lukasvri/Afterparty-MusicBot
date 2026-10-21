import { guessAbort } from './guess-audio-format.ts';
import { UnavailableGuessCatalog, type GuessCatalog, type GuessCategorySummary } from './guess-catalog.ts';
import type { GuessMediaSource } from './guess-media.ts';
import { prepareConfiguredGuessSource, type GuessSourceOptions } from './guess-source.ts';
import { selectGuessSource } from './guess-source-config.ts';
import { UserError } from './types.ts';

type Source = Exclude<Awaited<ReturnType<typeof prepareConfiguredGuessSource>>, undefined>;
export type GuessSourceFactory = (env: NodeJS.ProcessEnv, options: GuessSourceOptions) => Source | undefined | Promise<Source | undefined>;
export type GuessSourceState = 'disabled' | 'unavailable' | 'loading' | 'ready';
type ActiveSource = { source: Source; lifetime: AbortController };
const unavailable = () => new UserError('The configured game preview source is unavailable.', 503);

/** Copy only bounded public category data, never arbitrary properties supplied by an adapter. */
function summaries(catalog: GuessCatalog): GuessCategorySummary[] {
  const input = catalog.categories(), seen = new Set<string>();
  if (!Array.isArray(input) || !input.length || input.length > 20) throw unavailable();
  return input.map(category => {
    if (!category || typeof category.id !== 'string' || !/^[a-z0-9-]{1,60}$/.test(category.id) || seen.has(category.id) ||
      typeof category.name !== 'string' || !category.name.trim() || category.name.length > 60 || /[\p{Cc}\p{Cf}]/u.test(category.name) ||
      !Number.isInteger(category.count) || category.count < 0 || category.count > 1000 || category.available !== (category.count > 0)) throw unavailable();
    seen.add(category.id);
    let durations: GuessCategorySummary['durations'];
    if (category.durations !== undefined) {
      if (!Array.isArray(category.durations) || category.durations.length > 76) throw unavailable();
      let previous = 14, total = 0;
      durations = category.durations.map((bin: { seconds: number; count: number }) => {
        if (!bin || !Number.isInteger(bin.seconds) || bin.seconds <= previous || bin.seconds > 90 ||
          !Number.isInteger(bin.count) || bin.count < 1 || bin.count > 1000) throw unavailable();
        previous = bin.seconds; total += bin.count; return { seconds: bin.seconds, count: bin.count };
      });
      if (total !== category.count) throw unavailable();
    }
    return { id: category.id, name: category.name, available: category.available, count: category.count,
      ...(durations === undefined ? {} : { durations }) };
  });
}

/** Stable transport dependencies with explicit local reload only. Healthy snapshots are never replaced. */
export class GuessSourceManager {
  readonly catalog: GuessCatalog;
  readonly media: GuessMediaSource;
  readonly configured: boolean;
  private readonly env: NodeJS.ProcessEnv;
  private readonly prepare: GuessSourceFactory;
  private readonly externalSignal: AbortSignal;
  private readonly fallback = new UnavailableGuessCatalog();
  private readonly released = new WeakSet<object>();
  private current?: ActiveSource;
  private pending?: AbortController;
  private flight?: Promise<boolean>;
  private closed = false;
  constructor(options: { env: NodeJS.ProcessEnv; signal: AbortSignal; prepare?: GuessSourceFactory }) {
    this.env = { ...options.env }; this.prepare = options.prepare ?? prepareConfiguredGuessSource;
    this.externalSignal = options.signal;
    let configured = false;
    try { configured = selectGuessSource(this.env).provider !== 'disabled'; } catch { /* Conflicting configuration stays disabled. */ }
    this.configured = configured;
    const syntheticTest = () => this.current?.source.catalog.syntheticTest;
    this.catalog = {
      get syntheticTest() { return syntheticTest(); },
      categories: () => this.categories(),
      select: (categoryId, selection) => this.active().source.catalog.select(categoryId, selection),
      media: key => this.active().source.catalog.media(key),
    };
    this.media = { read: async (key, signal) => {
      const active = this.active(), combined = AbortSignal.any([signal, active.lifetime.signal]);
      combined.throwIfAborted();
      const bytes = await guessAbort(Promise.resolve().then(() => {
        combined.throwIfAborted(); return active.source.media.read(key, combined);
      }), combined);
      combined.throwIfAborted();
      if (this.closed || this.current !== active) throw unavailable();
      return bytes;
    } };
    this.externalSignal.addEventListener('abort', this.dispose, { once: true });
    if (this.externalSignal.aborted) this.dispose();
  }
  private categories(): GuessCategorySummary[] {
    try { if (!this.closed && this.current) return summaries(this.current.source.catalog); } catch { /* Fail closed. */ }
    return this.fallback.categories();
  }
  private healthy() { return this.categories().some(category => category.available); }
  get status(): GuessSourceState {
    if (!this.configured) return 'disabled';
    if (this.closed) return 'unavailable';
    if (this.healthy()) return 'ready';
    return this.pending && !this.pending.signal.aborted ? 'loading' : 'unavailable';
  }
  private active(): ActiveSource {
    if (this.closed || !this.current) throw unavailable();
    return this.current;
  }
  private release(source: Source | undefined) {
    if (!source || typeof source !== 'object' || this.released.has(source)) return;
    this.released.add(source);
    try { source.dispose(); } catch { /* Do not expose adapter errors or prevent the remaining cleanup. */ }
  }
  /** True means a usable source exists. Calls coalesce, and no provider work runs while any category is available. */
  reload(): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    if (this.flight) return this.flight;
    if (this.healthy()) return Promise.resolve(true);
    if (!this.configured) return Promise.resolve(false);
    const lifetime = new AbortController(), signal = lifetime.signal;
    this.pending = lifetime;
    const timer = setTimeout(() => lifetime.abort(), 60_000); timer.unref();
    let published = false;
    const raw = Promise.resolve().then(() => {
      signal.throwIfAborted(); return this.prepare({ ...this.env }, { signal });
    }).then(source => {
      if (this.closed || signal.aborted) { this.release(source); return false; }
      try {
        if (!source || this.released.has(source) || typeof source.dispose !== 'function' ||
          typeof source.catalog.select !== 'function' || typeof source.catalog.media !== 'function' ||
          typeof source.media.read !== 'function' || !summaries(source.catalog).some(category => category.available)) throw unavailable();
        // A source that became healthy again during preparation still belongs to its existing games.
        const healthy = this.healthy();
        if (this.closed || signal.aborted) { this.release(source); return false; }
        if (healthy) { this.release(source); return true; }
        const previous = this.current;
        this.current = { source, lifetime }; published = true;
        if (previous) { previous.lifetime.abort(); this.release(previous.source); }
        return true;
      } catch { this.release(source); return this.healthy(); }
    }).catch(() => this.healthy());
    const result = guessAbort(raw, signal).catch(() => this.healthy());
    this.flight = result;
    // Keep single-flight ownership until the raw factory settles even if it ignores cancellation.
    void raw.finally(() => {
      clearTimeout(timer);
      if (!published) lifetime.abort();
      if (this.pending === lifetime) this.pending = undefined;
      if (this.flight === result) this.flight = undefined;
    });
    return result;
  }
  dispose = () => {
    if (this.closed) return;
    this.closed = true; this.externalSignal.removeEventListener('abort', this.dispose);
    this.pending?.abort();
    const current = this.current; this.current = undefined;
    if (current) { current.lifetime.abort(); this.release(current.source); }
  };
}
