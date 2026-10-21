import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { GuessCatalog } from './guess-catalog.ts';
import type { GuessMediaSource } from './guess-media.ts';
import { SyntheticGuessSource } from './guess-synthetic.ts';
import { prepareDeezerGuessInventory, type DeezerGuessOptions } from './guess-deezer.ts';
import { prepareYoutubeGuessInventory, prepareYoutubeGuessPack, type YoutubeGuessOptions } from './guess-youtube.ts';
import { selectGuessSource } from './guess-source-config.ts';
import { UserError } from './types.ts';

type Source = { catalog: GuessCatalog; media: GuessMediaSource; dispose(): void };
export type GuessSourceOptions = DeezerGuessOptions & { youtube?: Omit<YoutubeGuessOptions, 'signal'> };
const unavailable = () => new UserError('The configured game preview source is unavailable.', 503);

/** Server configuration only, including the alpha preset default. Never a browser request or public upload path. */
export async function prepareConfiguredGuessSource(env: NodeJS.ProcessEnv, options: GuessSourceOptions): Promise<Source | undefined> {
  try {
    const selection = selectGuessSource(env);
    if (selection.provider === 'disabled') return undefined;
    if (options.signal.aborted) throw unavailable();
    if (selection.provider === 'synthetic') {
      const source = new SyntheticGuessSource();
      return { catalog: source, media: source, dispose() {} };
    }
    const youtube = selection.provider === 'youtube';
    if (selection.pack) {
      return await prepareYoutubeGuessPack(selection.pack, { ...options.youtube, signal: options.signal });
    }
    const path = youtube ? env.GUESS_YOUTUBE_INVENTORY_PATH : env.GUESS_DEEZER_INVENTORY_PATH;
    if (!path || !isAbsolute(path) || path.length > 4096 || /[\p{Cc}\p{Cf}]/u.test(path)) throw unavailable();
    // Nonblocking open avoids waiting on a FIFO; symlinks and non-regular files are rejected.
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    let records: unknown;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > 32_768 || options.signal.aborted) throw unavailable();
      const bytes = Buffer.alloc(32_769);
      let size = 0;
      while (size < bytes.length) {
        const result = await file.read(bytes, size, bytes.length - size, size);
        options.signal.throwIfAborted();
        if (!result.bytesRead) break;
        size += result.bytesRead;
      }
      if (!size || size > 32_768) throw unavailable();
      records = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
    } finally { await file.close(); }
    if (!Array.isArray(records) || !records.length || records.length > 8) throw unavailable();
    return youtube
      ? await prepareYoutubeGuessInventory(records, { ...options.youtube, signal: options.signal })
      : await prepareDeezerGuessInventory(records, options);
  } catch { throw unavailable(); }
}
