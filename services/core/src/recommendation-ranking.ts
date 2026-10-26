import { normalized, type CatalogSong } from './matching.ts';
import { isRadioTitle, radioArtist, radioDiscoveryGenre, radioGenre, radioTitle } from './radio.ts';
import type { PublicTrack, Track } from './types.ts';
import { metadataAiGenerated } from './music-content.ts';

type Candidate = { track: Track; related: boolean; index: number; themeMatch?: boolean };
export type FavoriteRecording = { source: 'youtube'; id: string } | { source: 'soundcloud'; url: string };
/** Resolve only recognized identities locally. Favorite search text is never fetched or treated as an identity. */
export function favoriteRecording(query: unknown): FavoriteRecording | null {
  if (typeof query !== 'string' || query.length > 2000 || /[\p{Cc}\p{Cf}]/u.test(query)) return null;
  if (/^[\w-]{11}$/.test(query)) return { source: 'youtube', id: query };
  let url: URL;
  try { url = new URL(query); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  if (['youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) {
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') :
      url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})\/?$/)?.[1];
    return id && /^[\w-]{11}$/.test(id) ? { source: 'youtube', id } : null;
  }
  if (['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'].includes(url.hostname) &&
    /^\/[\w-]+\/[\w-]+\/?$/.test(url.pathname) && !/^\/(?:sets|search|discover|stream|you|charts|tracks)\//.test(url.pathname))
    return { source: 'soundcloud', url: `https://soundcloud.com${url.pathname.replace(/\/$/, '')}` };
  return null;
}
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' &&
  value.length <= maximum && Boolean(normalized(value)) && !/[\p{Cc}\p{Cf}]/u.test(value);
/** Copy only bounded descriptor fields; provider/cache objects are never recommendation proof. */
export function copyRadioDescriptor(value: unknown): CatalogSong | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const song = value as CatalogSong;
  if (!text(song.title, 320) || !text(song.artist, 200) || !isRadioTitle(song.title) || metadataAiGenerated(song.title, song.artist) === true ||
    !Number.isFinite(song.duration) || song.duration < 0 || song.duration > 86400 ||
    (song.id !== undefined && !text(song.id, 128)) || (song.isrc !== undefined && !text(song.isrc, 128)) ||
    (song.artistCredit !== undefined && !text(song.artistCredit, 300))) return null;
  return { title: song.title.trim(), artist: song.artist.trim(), duration: song.duration,
    ...(song.id === undefined ? {} : { id: song.id }), ...(song.isrc === undefined ? {} : { isrc: song.isrc }),
    ...(song.artistCredit === undefined ? {} : { artistCredit: song.artistCredit }) };
}
/** Ranking is preference only. Callers must apply recording, relationship and playback gates first. */
export function createRecommendationRanking(seed: Track, recent: readonly PublicTrack[], favorites: readonly string[] = [], recordings: readonly FavoriteRecording[] = []) {
  const seedArtist = normalized(radioArtist(seed)), genre = radioDiscoveryGenre(seed);
  const artists = recent.slice(-5).map(track => normalized(radioArtist(track)));
  const counts = new Map<string, number>();
  for (const artist of artists) counts.set(artist, (counts.get(artist) ?? 0) + 1);
  // A five-song cooldown alone can cycle the provider's first six artists
  // forever. Among equally cooled-down artists, give less exposed artists a
  // turn before falling back to favorites and stable provider order. This is
  // bounded local preference, never an admission gate or another lookup.
  const exposure = new Map<string, number>();
  for (const track of recent.slice(-20)) {
    const artist = normalized(radioArtist(track));
    exposure.set(artist, (exposure.get(artist) ?? 0) + 1);
  }
  const preferred = new Set(favorites.slice(0, 1000).filter(name => typeof name === 'string' && name.length <= 1000).map(normalized));
  // Full artist/title identity prevents a favorite named "Night" from promoting "Midnight" or another artist.
  const favorite = (artist: string, title: string) => Boolean(normalized(artist) && normalized(title)) && preferred.has(normalized(`${artist} - ${title}`));
  const identities = new Set(recordings.slice(0, 1000).flatMap(recording => {
    if (recording?.source === 'youtube' && /^[\w-]{11}$/.test(recording.id)) return [`youtube:${recording.id}`];
    const canonical = recording?.source === 'soundcloud' ? favoriteRecording(recording.url) : null;
    return canonical?.source === 'soundcloud' ? [`soundcloud:${canonical.url}`] : [];
  }));
  const favoriteTrack = (track: Track) => {
    const identity = (track.source ?? 'youtube') === 'youtube' ? `youtube:${track.id}` :
      track.source === 'soundcloud' ? favoriteRecording(track.url) : null;
    return (typeof identity === 'string' ? identities.has(identity) : identity?.source === 'soundcloud' && identities.has(`soundcloud:${identity.url}`)) ||
      favorite(radioArtist(track), radioTitle(track));
  };
  const diversity = (artist: string) => (counts.get(normalized(artist)) ?? 0) * 2 + Number(normalized(artist) === seedArtist);
  const cooldown = (artist: string) => {
    const name = normalized(artist);
    return Number(Boolean(name) && artists.at(-1) === name) * 2 + Number(Boolean(name) && artists.at(-2) === name);
  };
  const compareArtists = (a: string, b: string) => diversity(a) - diversity(b) || cooldown(a) - cooldown(b) ||
    (exposure.get(normalized(a)) ?? 0) - (exposure.get(normalized(b)) ?? 0);
  return {
    /** Spread the existing bounded hydration budget across artists before trying another song by one artist. */
    descriptors(songs: readonly CatalogSong[]): CatalogSong[] {
      const pending = songs.map((song, index) => ({ song, index })), ordered: CatalogSong[] = [];
      const attemptedArtists = new Map<string, number>();
      while (pending.length) {
        pending.sort((a, b) => (attemptedArtists.get(normalized(a.song.artist)) ?? 0) - (attemptedArtists.get(normalized(b.song.artist)) ?? 0) ||
          compareArtists(a.song.artist, b.song.artist) || Number(favorite(b.song.artist, b.song.title)) - Number(favorite(a.song.artist, a.song.title)) || a.index - b.index);
        const next = pending.shift()!.song, artist = normalized(next.artist);
        ordered.push(next); attemptedArtists.set(artist, (attemptedArtists.get(artist) ?? 0) + 1);
      }
      return ordered;
    },
    compare(a: Candidate, b: Candidate): number {
      const quality = (item: Candidate) => genre && radioGenre(item.track) === genre ? 5 : item.themeMatch ? 4 : item.related ? 3 : 2;
      const official = (track: Track) => /\b(official audio|official music video|provided to youtube)\b/i.test(track.title) || /Topic$|VEVO$/i.test(track.artist);
      return quality(b) - quality(a) || compareArtists(radioArtist(a.track), radioArtist(b.track)) ||
        Number(favoriteTrack(b.track)) - Number(favoriteTrack(a.track)) ||
        Number(official(b.track)) - Number(official(a.track)) || a.index - b.index;
    },
  };
}
