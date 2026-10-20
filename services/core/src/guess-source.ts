import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { GuessCatalog } from './guess-catalog.ts';
import type { GuessMediaSource } from './guess-media.ts';
import { SyntheticGuessSource } from './guess-synthetic.ts';
import { prepareDeezerGuessInventory, type DeezerGuessOptions } from './guess-deezer.ts';
import { UserError } from './types.ts';

type Source = { catalog: GuessCatalog; media: GuessMediaSource; dispose(): void };
const unavailable = () => new UserError('The configured game preview source is unavailable.', 503);

/** Startup-only private configuration. This is never a browser request or public upload path. */
export async function prepareConfiguredGuessSource(env: NodeJS.ProcessEnv, options: DeezerGuessOptions): Promise<Source | undefined> {
  if (env.GUESS_DEEZER_PREVIEWS !== '1') {
    if (env.GUESS_SYNTHETIC_TEST !== '1') return undefined;
    const source = new SyntheticGuessSource();
    return { catalog: source, media: source, dispose() {} };
  }
  try {
    if (env.GUESS_SYNTHETIC_TEST === '1' || options.signal.aborted) throw unavailable();
    const path = env.GUESS_DEEZER_INVENTORY_PATH;
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
    return await prepareDeezerGuessInventory(records, options);
  } catch { throw unavailable(); }
}
