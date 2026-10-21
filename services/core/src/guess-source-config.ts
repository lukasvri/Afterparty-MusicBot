import { readFileSync } from 'node:fs';
import { UserError } from './types.ts';

export type GuessSourceProvider = 'disabled' | 'youtube' | 'deezer' | 'synthetic';
export type GuessSourceSelection = { provider: GuessSourceProvider; pack?: string; alphaDefault: boolean };
const packageVersion: string = (() => {
  try {
    const value: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    return typeof value === 'string' ? value : '';
  } catch { return ''; } // Unknown release metadata never enables a provider automatically.
})();
const alphaVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-alpha\.(?:0|[1-9]\d*)$/;

/** Server-only release policy. Package version is read once; selection opens no inventories and contacts no providers. */
export function selectGuessSource(env: NodeJS.ProcessEnv, version = packageVersion): GuessSourceSelection {
  const youtube = env.GUESS_YOUTUBE_CLIPS, deezer = env.GUESS_DEEZER_PREVIEWS === '1', synthetic = env.GUESS_SYNTHETIC_TEST === '1';
  if ([youtube === '1', deezer, synthetic].filter(Boolean).length > 1)
    throw new UserError('The configured game preview source is unavailable.', 503);
  if (deezer) return { provider: 'deezer', alphaDefault: false };
  if (synthetic) return { provider: 'synthetic', alphaDefault: false };
  const alpha = typeof version === 'string' && version.trim() === version && alphaVersion.test(version);
  const automatic = alpha && (youtube === undefined || youtube === '' || youtube === 'auto');
  if (youtube !== '1' && !automatic) return { provider: 'disabled', alphaDefault: false };
  const path = env.GUESS_YOUTUBE_INVENTORY_PATH, pack = env.GUESS_YOUTUBE_PACK;
  if (path && pack) throw new UserError('The configured game preview source is unavailable.', 503);
  const selectedPack = pack || (!path && alpha ? 'edm-festival-hits' : undefined);
  return { provider: 'youtube', ...(selectedPack ? { pack: selectedPack } : {}),
    alphaDefault: automatic || youtube === '1' && !path && !pack && alpha };
}
