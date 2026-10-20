import { randomUUID } from 'node:crypto';
import { OperatorGuessCatalog, type OperatorGuessRecord } from './guess-catalog.ts';
import { guessWaveSeconds } from './guess-audio-format.ts';
import { fetchDeezerPreview, PreparedGuessMedia } from './guess-media.ts';
import { resolveDeezerSeeds, seedIdentity, type DeezerSeed, type DeezerPermission } from './guess-deezer-metadata.ts';
import { UserError } from './types.ts';
/** Explicit private development injection only. No bootstrap/env/public-route activation. */
export async function prepareDeezerGuess(options: { seeds: readonly DeezerSeed[]; permission: DeezerPermission; signal?: AbortSignal; fetcher?: typeof fetch }) {
  const signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(50000)]);
  const resolved = await resolveDeezerSeeds({ ...options, signal });
  const clips = new Map<string, Uint8Array>(), records: OperatorGuessRecord[] = [];
  for (const seed of resolved) {
    signal.throwIfAborted();
    // This is an explicit operator attestation supplied independently of API metadata.
    const rightsCleared = options.permission.recordings.includes(seedIdentity(seed)) ? true : undefined;
    if (!rightsCleared) throw new UserError('Provider permission is required.', 503);
    const clip = await fetchDeezerPreview(seed.previewUrl, signal, options.fetcher), durationSeconds = guessWaveSeconds(clip);
    if (durationSeconds < 15) throw new UserError('This preview is too short for a game round.', 503);
    const mediaKey = randomUUID().replaceAll('-', ''); clips.set(mediaKey, clip);
    records.push({ rightsCleared, categoryIds: seed.categoryIds, song: { id: randomUUID(), title: seed.title, artist: seed.artist, aliases: [], mediaKey }, media: { key: mediaKey, mimeType: 'audio/wav', durationSeconds } });
  }
  signal.throwIfAborted();
  const stored = new OperatorGuessCatalog(records), expires = Date.now() + 300000;
  const active = () => { if (Date.now() >= expires) throw new UserError('The private preview catalog expired. Prepare it again.', 503); };
  return { catalog: {
    categories: () => stored.categories().map(c => Date.now() < expires ? c : { ...c, available: false, count: 0 }),
    select: (...args: Parameters<OperatorGuessCatalog['select']>) => { active(); return stored.select(...args); },
    media: (...args: Parameters<OperatorGuessCatalog['media']>) => { active(); return stored.media(...args); },
  }, media: new PreparedGuessMedia(clips, expires) };
}
