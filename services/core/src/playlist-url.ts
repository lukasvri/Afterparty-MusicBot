export type PlaylistUrl = { url: string; source: 'youtube' | 'spotify' };

const invalid = () => new Error('The playlist URL is invalid.');
const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com']);

/** Normalize supported playlist references without fetching or resolving short links. */
export function normalizePlaylistUrl(input: string): PlaylistUrl {
  if (typeof input !== 'string' || input.length > 2048 || /[\p{Cc}\p{Cf}]/u.test(input)) throw invalid();
  const value = input.trim();
  if (!value || /[\s\\]/u.test(value) || value.includes('#')) throw invalid();
  // URL removes default ports and accepts some malformed authorities. Inspect the original first.
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || authority.includes(':') || authority.includes('@') || authority.includes('%')) throw invalid();
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw invalid(); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || /%2f|%5c/i.test(parsed.pathname)) throw invalid();
  if (youtubeHosts.has(parsed.hostname)) {
    if (parsed.pathname !== '/playlist' && parsed.pathname !== '/watch') throw invalid();
    const lists = parsed.searchParams.getAll('list');
    if (lists.length !== 1 || !/^[A-Za-z0-9_-]{10,100}$/.test(lists[0])) throw invalid();
    return { url: 'https://www.youtube.com/playlist?list=' + lists[0], source: 'youtube' };
  }
  if (parsed.hostname === 'open.spotify.com') {
    const match = /^\/(?:intl-[a-z]{2}\/)?(playlist|album)\/([A-Za-z0-9]{22})\/?$/.exec(parsed.pathname);
    if (!match) throw invalid();
    return { url: `https://open.spotify.com/${match[1]}/${match[2]}`, source: 'spotify' };
  }
  if (parsed.hostname === 'spotify.link' && /^\/[A-Za-z0-9_-]{1,100}$/.test(parsed.pathname)) {
    return { url: 'https://spotify.link' + parsed.pathname, source: 'spotify' };
  }
  throw invalid();
}
