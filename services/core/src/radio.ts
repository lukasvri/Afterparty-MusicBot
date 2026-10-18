import type { PublicTrack, Track } from "./types.ts";

const normalize = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export type RadioTrack = PublicTrack & Pick<Partial<Track>, "catalog">;
const artistSeparator = /\s+[-\u2013\u2014]\s*|\s*[-\u2013\u2014]\s+|[\u2013\u2014]/;
const officialArtist = /(?:\s*-\s*Topic|VEVO)$/i;
const publisherArtist = /^(?:NCS|NoCopyrightSounds|YouTube|Various Artists|Trap Nation|MrSuicideSheep|Monstercat)$/i;
export const RADIO_HISTORY_LIMIT = 100;
export function canPlayRadioTrack(seed: Track, track: Track) {
  return (
    isRadioMusic(track) &&
    radioStyleCompatible(seed, track) &&
    (!seed.concert ||
      ((track.source ?? "youtube") === "youtube" && track.embeddable))
  );
}
export function radioStyleCompatible(seed: RadioTrack, track: RadioTrack) {
  const genre = radioGenre(seed),
    candidate = radioGenre(track);
  // A broad House label is incomplete, not evidence against a named House
  // subgenre. This only removes a contradiction; radioRelated still requires
  // the same artist, the same specific genre or a vetted recording relation.
  // Two different specific subgenres remain incompatible.
  return (
    !genre || !candidate || genre === candidate ||
    (genre === "house" && candidate.endsWith(" house")) ||
    (candidate === "house" && genre.endsWith(" house"))
  );
}
/** Missing category data is unknown; an explicit non-music category is negative evidence. */
export function metadataMusic(category: unknown, categories?: unknown): boolean | undefined {
  if (typeof category === "string" && category.trim()) return category === "10";
  if (Array.isArray(categories)) {
    const labels = categories.filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
    if (labels.length) return labels.some((label) => normalize(label) === "music");
  }
  return undefined;
}
/** Shared by searches, catalog matches and metadata enrichment. Manual playback is unaffected. */
export function isRadioTitle(title: string) {
  const text = normalize(title);
  return (
    !/\b(reactions?|reacts|interviews?|tutorials?|howto|podcasts?|compilations?|playlist|full album|full set|dj set|live set|concert|hours?|best of|top \d+|karaoke|remake|recreation|recreated|bootleg|fanmade|sped up|slowed|lessons?|masterclass|walkthrough|walk through|step by step|sound design|production tips|production lesson|fl studio|ableton|logic pro|garageband|behind the scenes|making of|breakdown|explained|vlogs?|gameplay|unboxing|documentary|documentaries|studio tour|room tour|music news|album review|song review|track review|pranks?|challenge video|funny moments|memes?|trailer|teaser|shorts)\b/i.test(
      text,
    ) &&
    // These words also occur inside ordinary studio song names. Reject
    // explicit upload-format positions and qualifiers, not every occurrence.
    !/[\[(][^\])]*\b(?:live|covers?)\b/i.test(title) &&
    !/(?:\s[-|\u2013\u2014]\s*|\|)\s*(?:(?:hd|hq|4k|official|piano|guitar|drum|vocal|acoustic|instrumental)\s+)*(?:live|covers?)\b/i.test(title) &&
    !/(?:^|\s[-|\u2013\u2014]\s*)\s*(?:live|covers?)\s*[:|-]/i.test(title) &&
    !/\b(?:live|covers?)\s*(?:[|\[(]|$)/i.test(title) &&
    !/\b(?:live|covers?)\s+(?:at|from|in|on|by|session|performance|version|recording)\b/i.test(text) &&
    !/^how to\s*:/i.test(title) &&
    !/\bhow to$|\bhow (?:i|we) (?:made|make|produced|produce|remade|recreated|built)\b/i.test(
      text,
    ) &&
    !/\bhow (?:to|do (?:i|you)) (?:make|play|create|produce|mix|master|remake|recreate|learn|write|use|get|sound|build|reproduce|sing|compose)\b/i.test(
      text,
    )
  );
}
export function isRadioMusic(track: RadioTrack) {
  return (
    track.music !== false &&
    !track.live &&
    Number.isFinite(track.duration) &&
    track.duration >= 90 &&
    track.duration <= 600 &&
    isRadioTitle(contentTitle(track)) &&
    Boolean(songIdentity(track))
  );
}
const broadGenres = new Set([
  "pop",
  "rock",
  "house",
  "metal",
  "jazz",
  "soul",
  "funk",
  "country",
  "reggae",
  "disco",
  "punk",
  "rnb",
  "ambient",
]);
export function specificRadioGenre(track: RadioTrack) {
  const genre = radioGenre(track);
  return genre && !broadGenres.has(genre) ? genre : null;
}
export function radioArtist(track: RadioTrack) {
  const parts = track.title.split(artistSeparator);
  const prefix = parts[0];
  const channel = track.artist.replace(officialArtist, "").trim();
  const suffix = parts.slice(1).join(" - ").trim();
  // Topic titles often append a recording label without naming the artist.
  // A normal Artist - Song title wins over a conflicting uploader, including
  // channels that happen to end in Topic or VEVO.
  const versionSuffix = /^(?:(?:19|20)\d{2}\s+)?(?:re[ -]?master(?:ed)?|radio edit|single edit|original mix|extended(?: mix| version)?|official(?: music)? (?:audio|video)|instrumental(?: version)?|acoustic(?: version)?)(?:\s+(?:version|audio|(?:19|20)\d{2}))?\s*(?:[|\[(].*)?$/i.test(suffix);
  const artist =
    track.catalog?.artist ||
    (parts.length > 1 && !versionSuffix
      ? prefix
      : officialArtist.test(track.artist) && !publisherArtist.test(channel)
        ? channel
        : track.source === "soundcloud"
          ? track.artist
          : "");
  if (!track.catalog?.artist && publisherArtist.test(artist.trim()))
    return "";
  return artist
    .replace(officialArtist, "")
    .trim();
}
function contentTitle(track: RadioTrack) {
  const parts = track.title.split(artistSeparator);
  const artist = normalize(radioArtist(track)),
    prefix = normalize(parts[0]);
  const hasArtistPrefix =
    Boolean(artist) && (prefix === artist || prefix.startsWith(artist + " "));
  return (
    parts.length > 1 && hasArtistPrefix
      ? parts.slice(1).join(" - ")
      : track.title
  );
}
export function radioTitle(track: RadioTrack) {
  if (track.catalog?.title) return track.catalog.title;
  return contentTitle(track)
    .split("|")[0]
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/\b(?:feat\.?|ft\.?)\s+.*/i, "")
    .trim();
}
/** Use explicit genre labels, not the uploader's identity, as similarity evidence. */
export function radioGenre(track: RadioTrack) {
  const labels = [
    ...(track.genres ?? []),
    ...track.title.split("|").slice(1),
    ...(track.title.match(/\[[^\]]+\]|\([^)]*\)/g) ?? []),
  ];
  const genres = [
    "progressive house",
    "melodic house",
    "deep house",
    "future house",
    "bass house",
    "electro house",
    "tropical house",
    "tech house",
    "drum and bass",
    "drum bass",
    "liquid dnb",
    "dnb",
    "electronic pop",
    "dance pop",
    "synth pop",
    "indie pop",
    "future bass",
    "melodic dubstep",
    "dubstep",
    "hardstyle",
    "phonk",
    "hip hop",
    "lo fi",
    "lofi",
    "techno",
    "trance",
    "reggaeton",
    "reggae",
    "metal",
    "country",
    "jazz",
    "soul",
    "funk",
    "house",
    "pop",
    "rock",
    "ambient",
    "disco",
    "punk",
    "rnb",
  ];
  const labelText = (value: string) => normalize(value.replace(/\br\s*&\s*b\b/gi, "rnb"))
    .replace(/\bdrum bass\b|\bdnb\b/g, "drum and bass").replace(/\blofi\b/g, "lo fi");
  const detected = labels.map(label => {
    const content = label.trim().replace(/^[([]|[\])]$/g, "").trim();
    const explicit = /^(?:genre|style)\s*:/i.test(content);
    const text = labelText(content.replace(/^(?:genre|style)\s*:\s*/i, ""));
    // Credits and song annotations are free-form text, not genre evidence.
    // Whole labels may add "music"; explicitly named Genre:/Style: lines
    // may contain additional labels without relying on an artist's name.
    return genres.find(genre => text === labelText(genre) || text === `${labelText(genre)} music`)
      ?? (explicit ? genres.find(genre => ` ${text} `.includes(` ${labelText(genre)} `)) : undefined);
  });
  const found = genres.find(genre => detected.includes(genre));
  return found === "drum bass" || found === "dnb"
    ? "drum and bass"
    : found === "lofi"
      ? "lo fi"
      : (found ?? null);
}
export function metadataGenres(description: unknown, tags: unknown): string[] {
  const labels = [
    ...(Array.isArray(tags)
      ? tags.filter((t): t is string => typeof t === "string")
      : []),
    ...(typeof description === "string"
      ? (description.match(/(?:genre|style)\s*:\s*[^\n]+/gi) ?? [])
      : []),
  ];
  return [
    ...new Set(
      labels
        .map((label) => radioGenre({
            title: `| ${label}`,
            artist: "",
            id: "",
            duration: 0,
            image: "",
            live: false,
            embeddable: true,
          }))
        .filter((genre): genre is string => Boolean(genre)),
    ),
  ].slice(0, 8);
}
export function radioQuery(track: RadioTrack) {
  const artist = radioArtist(track),
    song = radioTitle(track).replace(/"/g, "");
  const genre = specificRadioGenre(track);
  return `${genre ?? artist} audio${song ? ` -"${song}"` : ""}`;
}
export function songIdentity(track: RadioTrack) {
  return songTitleIdentity(radioTitle(track));
}
function songTitleIdentity(rawTitle: string) {
  const title = rawTitle
      .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
      .replace(/\b(?:feat\.?|ft\.?)\s+.*/i, "");
  const identity = normalize(title
      // Different uploads and remasters are still the same radio song. Keep
      // radioTitle intact for catalog searches and recording-version checks.
      .replace(/\s+[-\u2013\u2014]\s+[^|]*\b(?:remix|remaster(?:ed)?|radio edit|extended|instrumental|acoustic)\b.*$/i, "")
      .replace(/\s+DJ\s+[^|]+?\s+Remix\b.*$/i, "")
      .replace(/\b(?:(?:19|20)\d{2}\s+)?(?:re[ -]?master(?:ed)?|radio edit|single edit|album version|original mix|extended(?: mix| version)?|remix|instrumental|acoustic)(?:\s+(?:version|audio))?(?:\s+(?:19|20)\d{2})?\b/gi, "")
      .replace(
        /\b(?:official(?: music)? (?:video|audio)|official lyric(?:s)? video|lyric(?:s)? video|official visualizer)\b|\s+(?:official|audio|lyrics?|visualizer|hd|hq|4k)\s*$/gi,
        "",
      ),
  );
  // "Music", "Audio" and even "Remix" can be real song names. An empty
  // cleaned value must not turn them into invalid radio entries.
  return identity || (/^(?:music|audio|video|remix|instrumental|acoustic)$/i.test(title.trim()) ? normalize(title) : "");
}
function recordingIdentity(track: RadioTrack) {
  const title = radioTitle(track);
  return {
    song: songTitleIdentity(title),
    artist: normalize(radioArtist(track)),
    title: normalize(title),
    variant: /\b(?:remix|instrumental|acoustic|remaster(?:ed)?|radio edit|extended)(?:\s+(?:version|mix|\d{4}))*\s*$/i.test(title),
  };
}
function duplicateRecording(a: ReturnType<typeof recordingIdentity>, b: ReturnType<typeof recordingIdentity>) {
  if (a.artist && b.artist && a.artist !== b.artist) return false;
  if (a.song === b.song) return true;
  // A named remix without delimiters cannot be split reliably in isolation.
  // Compare it with the known original instead of treating the remixer as a
  // new song. This conservative rule is limited to an explicit version suffix.
  return Boolean(
    (b.variant && b.title.startsWith(a.song + " ")) ||
    (a.variant && a.title.startsWith(b.song + " "))
  );
}
export function sameRadioSong(a: RadioTrack, b: RadioTrack) {
  return duplicateRecording(recordingIdentity(a), recordingIdentity(b));
}
/** A vetted catalog relationship may fill missing metadata, never a conflicting style. */
export function radioRelated(seed: RadioTrack, track: RadioTrack, relatedRecording = false) {
  const artist = normalize(radioArtist(seed));
  const specific = specificRadioGenre(seed);
  return radioStyleCompatible(seed, track) && (
    Boolean(artist && normalize(radioArtist(track)) === artist) ||
    Boolean(specific && radioGenre(track) === specific) ||
    relatedRecording
  );
}
export function sameRadioRecording(seed: RadioTrack, candidate: RadioTrack) {
  if (
    normalize(radioArtist(seed)) !== normalize(radioArtist(candidate)) ||
    songIdentity(seed) !== songIdentity(candidate)
  )
    return false;
  const versions =
    /\b(?:remix|live|acoustic|instrumental|karaoke|cover|sped up|slowed|remaster(?:ed)?|radio edit|extended)\b/g;
  const labels = (track: RadioTrack) =>
    [...new Set(normalize(track.title).match(versions) ?? [])].sort().join(",");
  return (
    labels(seed) === labels(candidate) &&
    Math.abs(seed.duration - candidate.duration) <=
      Math.max(12, Math.min(30, seed.duration * 0.08))
  );
}
/** Prefer a different artist with the same explicit genre; artist matching is a fallback when genre is unknown. */
export function rankRadio(
  seed: Track,
  candidates: Track[],
  recent: PublicTrack[],
  excluded: string[],
  relatedRecording = false,
) {
  return createRadioRanker(seed, recent, excluded).rank(candidates, relatedRecording);
}
/** One synchronous selection pass. Rebuild after a room or its history changes. */
export function createRadioRanker(seed: Track, recent: PublicTrack[], excluded: string[]) {
  const artist = normalize(radioArtist(seed));
  const genre = radioGenre(seed);
  const ids = new Set([seed.id, ...excluded, ...recent.map((t) => t.id)]);
  const songs = artist || genre ? [seed, ...recent].map(recordingIdentity) : [];
  let recentTail = recent.slice(-5);
  return {
    remember(track: PublicTrack) {
      ids.add(track.id);
      songs.push(recordingIdentity(track));
      recentTail = [...recentTail.slice(-4), track];
    },
    rank(candidates: Track[], relatedRecording = false) {
      if (!artist && !genre) return [];
      const recentArtists = new Map<string, number>();
      for (const track of recentTail) {
        const key = normalize(radioArtist(track));
        recentArtists.set(key, (recentArtists.get(key) ?? 0) + 1);
      }
      const ranked = candidates
        .map((track, index) => {
          const identity = recordingIdentity(track);
          const matches =
            Boolean(artist) && normalize(radioArtist(track)) === artist;
          const candidateGenre = radioGenre(track);
          const genreMatch = Boolean(genre && candidateGenre === genre);
          const related = radioRelated(seed, track, relatedRecording);
          const recentArtistCount = recentArtists.get(normalize(radioArtist(track))) ?? 0;
          const valid =
            related &&
            isRadioMusic(track) &&
            !track.concert &&
            !ids.has(track.id) &&
            !songs.some((song) => duplicateRecording(song, identity));
          const official =
            /\b(official audio|official music video|provided to youtube)\b/i.test(
              track.title,
            ) || /Topic$|VEVO$/i.test(track.artist);
          return {
            track,
            score: valid
              ? 100 +
                (genreMatch ? 60 : 0) +
                (official ? 10 : 0) -
                (genreMatch && matches ? 30 : 0) -
                recentArtistCount * 15 -
                index
              : -1,
          };
        })
        .filter((t) => t.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((t) => t.track);
      const seen: ReturnType<typeof recordingIdentity>[] = [];
      return ranked.filter((track) => {
        const identity = recordingIdentity(track);
        if (seen.some((song) => duplicateRecording(song, identity))) return false;
        seen.push(identity);
        return true;
      });
    },
  };
}
