import { Providers } from './providers.ts';
import { UserError, type Track } from './types.ts';
import type { Store } from './store.ts';

type CatalogProvider = Pick<Providers, 'search' | 'video'>;
type Input = { query?: string; ids?: string[] };
/** One request owns one bounded provider instance. It never cancels shared
 * playback/radio lookups and does not queue cold HTTP jobs behind one another. */
export class Catalog {
  private active: AbortController | null = null;
  private factory: (signal: AbortSignal) => CatalogProvider;
  private timeoutMs: number;
  constructor(store: Store, env: NodeJS.ProcessEnv = process.env,
    factory: (signal: AbortSignal) => CatalogProvider = signal => new Providers(store, env, { signal, metadataConcurrency: 1 }),
    timeoutMs = 50000) { this.factory = factory; this.timeoutMs = timeoutMs; }
  async lookup(input: Input, caller: AbortSignal): Promise<Track[]> {
    if (this.active) throw new UserError('Music search is busy. Wait for the current search to finish.', 503);
    caller.throwIfAborted();
    const controller = new AbortController();
    this.active = controller;
    const signal = AbortSignal.any([caller, controller.signal]);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const provider = this.factory(signal);
      const tracks = input.ids ? await provider.video(input.ids) : await provider.search(input.query ?? '', 4);
      signal.throwIfAborted();
      return tracks;
    } catch (error) {
      if (signal.aborted) throw new UserError(controller.signal.aborted ? 'Music search timed out. Try a more specific search or a YouTube link.' : 'Music search was cancelled.', controller.signal.aborted ? 504 : 499);
      throw error;
    } finally {
      clearTimeout(timer);
      // Provider promises settle only after their owned subprocess exits.
      this.active = null;
    }
  }
  close() { this.active?.abort(); }
}
