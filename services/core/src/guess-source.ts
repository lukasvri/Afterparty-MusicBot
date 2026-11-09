import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { GUESS_AUDIO_MAX_BYTES } from './guess-audio-format.ts';
import type { GuessCatalog } from './guess-catalog.ts';
import type { GuessMediaSource } from './guess-media.ts';
import { SyntheticGuessSource } from './guess-synthetic.ts';
import { prepareDeezerGuessInventory, type DeezerGuessOptions } from './guess-deezer.ts';
import { prepareYoutubeGuessInventory, type YoutubeGuessOptions } from './guess-youtube.ts';
import { buildGuessPackInventory } from './guess-packs.ts';
import { prepareOperatorGuessInventory, type OperatorGuessInventoryRecord } from './guess-operator-inventory.ts';
import { selectGuessSource } from './guess-source-config.ts';
import { UserError } from './types.ts';

type Source = { catalog: GuessCatalog; media: GuessMediaSource; dispose(): void };
export type GuessSourceOptions = DeezerGuessOptions & { youtube?: Omit<YoutubeGuessOptions, 'signal'> };
const unavailable = () => new UserError('The configured game preview source is unavailable.', 503);
type LocalGuessRecord = Omit<OperatorGuessInventoryRecord, 'wav'> & { audioFile: string };

async function readPrivateFile(path: string, maximum: number, signal: AbortSignal) {
  signal.throwIfAborted();
  // Nonblocking open avoids waiting on a FIFO; symlinks and non-regular files are rejected.
  const before = constants.O_NOFOLLOW === undefined ? await lstat(path, { bigint: true }) : undefined;
  if (before && !before.isFile()) throw unavailable();
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat({ bigint: true });
    if (!stat.isFile() || stat.size < 1n || stat.size > BigInt(maximum) || signal.aborted ||
      before && (before.dev !== stat.dev || before.ino !== stat.ino)) throw unavailable();
    const expectedSize = Number(stat.size);
    const bytes = Buffer.alloc(expectedSize + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await file.read(bytes, size, bytes.length - size, size);
      signal.throwIfAborted();
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size !== expectedSize) throw unavailable();
    return bytes.subarray(0, size);
  } finally { await file.close(); }
}

async function prepareLocalGuessSource(records: readonly LocalGuessRecord[], directory: string, signal: AbortSignal): Promise<Source> {
  const names = new Set<string>();
  const prepared: OperatorGuessInventoryRecord[] = [];
  for (const record of records) {
    if (!record || typeof record.audioFile !== 'string' || !/^clip-[a-z0-9_-]{1,59}\.wav$/.test(record.audioFile) ||
      names.has(record.audioFile)) throw unavailable();
    names.add(record.audioFile);
    const wav = await readPrivateFile(join(directory, record.audioFile), GUESS_AUDIO_MAX_BYTES, signal);
    prepared.push({ song: record.song, categoryIds: record.categoryIds, permission: record.permission, wav });
  }
  signal.throwIfAborted();
  const source = prepareOperatorGuessInventory(prepared, { lifetimeMs: 1_800_000 });
  const dispose = () => { signal.removeEventListener('abort', dispose); source.dispose(); };
  signal.addEventListener('abort', dispose, { once: true });
  return { ...source, dispose };
}

/** Private server configuration only. Never a browser request or public upload path. */
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
    const local = selection.provider === 'local';
    const path = local ? env.GUESS_LOCAL_INVENTORY_PATH : youtube
      ? (selection.pack ? env.GUESS_YOUTUBE_PACK_APPROVAL_PATH : env.GUESS_YOUTUBE_INVENTORY_PATH)
      : env.GUESS_DEEZER_INVENTORY_PATH;
    if (!path || !isAbsolute(path) || path.length > 4096 || /[\p{Cc}\p{Cf}]/u.test(path)) throw unavailable();
    const bytes = await readPrivateFile(path, 32_768, options.signal);
    const records: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!Array.isArray(records) || !records.length || records.length > 8) throw unavailable();
    if (local) return await prepareLocalGuessSource(records, dirname(path), options.signal);
    return youtube
      ? await prepareYoutubeGuessInventory(selection.pack ? buildGuessPackInventory(selection.pack, records) : records,
        { ...options.youtube, signal: options.signal })
      : await prepareDeezerGuessInventory(records, options);
  } catch { throw unavailable(); }
}
