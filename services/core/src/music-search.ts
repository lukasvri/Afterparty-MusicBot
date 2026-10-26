import { normalized } from './matching.ts';

type SearchRecording = {
  id: string;
  title: string;
  artist: string;
  embeddable: boolean;
  live: boolean;
  music?: boolean;
  aiGenerated?: boolean;
};
const formats = [
  /\blive\b/, /\bremix\b/, /\bcovers?\b/, /\bkaraoke\b/, /\binstrumental\b/,
  /\bslowed\b/, /\bsped up\b/, /\bnightcore\b/, /\btutorial\b/,
  /\breactions?\b/, /\binterviews?\b/, /\bpodcasts?\b/,
  /\bcompilation\b/, /\bfull album\b/, /\b(?:full|dj) set\b/,
];
const spokenIntent = /\b(?:tutorial|reaction|interview|podcast)\b/;
const syntheticIntent = /\b(?:ai|suno|udio|synthetic)\b/;
const concertIntent = /\b(?:tomorrowland|ultra|edc|creamfields|rai|festival|concert|set)\b/;

/** Rank the existing bounded result pool, without changing the provider query or making lookups. */
export function rankMusicSearch<T extends SearchRecording>(query: string, tracks: readonly T[]): T[] {
  // Negative provider terms are exclusions, never desired recording words.
  const wanted = normalized(query.slice(0, 2000).replace(/(?:^|\s)-(?:(?:"[^"]*")|\S+)/g, ' '));
  const words = [...new Set(wanted.split(' ').filter(Boolean))];
  const requestedFormats = formats.map(format => format.test(wanted));
  if (concertIntent.test(wanted)) {
    requestedFormats[0] = true;
    requestedFormats[formats.length - 1] = true;
  }
  const seen = new Set<string>();
  return tracks.slice(0, 50).flatMap((track, index) => {
    if (seen.has(track.id)) return [];
    seen.add(track.id);
    const rawTitle = track.title.slice(0, 2000), rawArtist = track.artist.slice(0, 500);
    const title = normalized(rawTitle);
    const artist = normalized(rawArtist.replace(/(?:\s*-\s*Topic|VEVO)$/i, ''));
    const label = `${title} ${artist}`;
    const availableWords = new Set(label.split(' '));
    const coverage = words.filter(word => availableWords.has(word)).length;
    const cleanTitle = normalized(rawTitle.replace(
      /[[(]\s*(?:official(?: music)?(?: video| audio)?|lyrics?|lyric video|hd|hq|4k)\s*[\])]/gi, '',
    ));
    const exact = Number(Boolean(wanted) && (cleanTitle === wanted ||
      cleanTitle === `${artist} ${wanted}` || wanted === `${artist} ${cleanTitle}`));
    const observedFormats = formats.map((format, i) => i === 0
      ? track.live || /\blive\s*(?:$|at\b|from\b|in\b|on\b|set\b|performance\b)/.test(title) ||
        /[[(][^\])]*\blive\b/i.test(rawTitle)
      : format.test(title));
    const unwantedFormats = observedFormats.reduce((count, observed, i) =>
      count + Number(!requestedFormats[i] && observed), 0);
    const requested = observedFormats.reduce((count, observed, i) =>
      count + Number(requestedFormats[i] && observed), 0);
    const unsuitable = Number(!track.embeddable) +
      Number(track.live && !requestedFormats[0]) +
      Number(track.music === false && !spokenIntent.test(wanted)) +
      Number(track.aiGenerated === true && !syntheticIntent.test(wanted));
    const official = Number(/(?:\s*-\s*Topic|VEVO)$/i.test(rawArtist) ||
      /\bofficial (?:audio|music video|video)\b/.test(title));
    // A matching title/artist matters before format preferences. Keep explicit
    // remix/live/cover searches available and provider order for equal evidence.
    return [{ track, index, coverage, exact, unwantedFormats, requested, unsuitable, official }];
  }).sort((a, b) => b.coverage - a.coverage || b.exact - a.exact || a.unsuitable - b.unsuitable ||
    b.requested - a.requested || a.unwantedFormats - b.unwantedFormats ||
    b.official - a.official || a.index - b.index).map(item => item.track);
}
