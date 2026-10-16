import type { PublicTrack, Track } from "./types.ts";

const normalize = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
type RadioTrack = PublicTrack & Pick<Partial<Track>, "catalog">;
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
  return !genre || !candidate || genre === candidate;
}
/** Shared by searches, catalog matches and metadata enrichment. Manual playback is unaffected. */
export function isRadioTitle(title: string) {
  const text = normalize(title);
  return (
    !/\b(reactions?|reacts|interviews?|tutorials?|howto|podcasts?|compilations?|playlist|full album|full set|dj set|live set|concert|hours?|best of|top \d+|karaoke|covers?|remake|recreation|recreated|bootleg|live|fanmade|sped up|slowed|lessons?|masterclass|walkthrough|walk through|step by step|sound design|production tips|production lesson|fl studio|ableton|logic pro|garageband|behind the scenes|making of|breakdown|explained)\b/i.test(
      text,
    ) &&
    !/^(?:how to|how do|how i|how we)\b|\bhow to$|\bhow (?:i|we) (?:made|make|produced|produce|remade|recreated|built)\b/i.test(
      text,
    ) &&
    !/\bhow (?:to|do (?:i|you)) (?:make|play|create|produce|mix|master|remake|recreate|learn|write|use|get|sound|build|reproduce|sing|compose)\b/i.test(
      text,
    )
  );
}
export function isRadioMusic(track: RadioTrack) {
  return (
    !track.live &&
    Number.isFinite(track.duration) &&
    track.duration >= 90 &&
    track.duration <= 600 &&
    isRadioTitle(track.title)
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
  const prefix = track.title.split(/\s[-\u2013\u2014]\s/)[0];
  const artist =
    track.catalog?.artist ||
    (/(?:- Topic|VEVO)$/i.test(track.artist)
      ? track.artist
      : prefix !== track.title
        ? prefix
        : track.artist);
  if (
    prefix === track.title &&
    !track.catalog?.artist &&
    /^(?:NCS|NoCopyrightSounds|YouTube|Various Artists|Trap Nation|MrSuicideSheep|Monstercat)$/i.test(
      artist.trim(),
    )
  )
    return "";
  return artist
    .replace(/\s*(?:- Topic|VEVO|Official(?: Music)?)$/i, "")
    .split(",")[0]
    .trim();
}
export function radioTitle(track: RadioTrack) {
  if (track.catalog?.title) return track.catalog.title;
  const parts = track.title.split(/\s[-\u2013\u2014]\s/);
  const artist = normalize(radioArtist(track)),
    prefix = normalize(parts[0]);
  const hasArtistPrefix =
    Boolean(artist) && (prefix === artist || prefix.startsWith(artist + " "));
  return (
    parts.length > 1 && hasArtistPrefix
      ? parts.slice(1).join(" - ")
      : track.title
  )
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
  const text = normalize(labels.join(" "));
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
  const found = genres.find((genre) => ` ${text} `.includes(` ${genre} `));
  return found === "drum bass"
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
        .map((label) =>
          radioGenre({
            title: `| ${label}`,
            artist: "",
            id: "",
            duration: 0,
            image: "",
            live: false,
            embeddable: true,
          }),
        )
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
  return normalize(
    radioTitle(track)
      .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
      .replace(/\b(?:feat\.?|ft\.?)\s+.*/i, "")
      .replace(
        /\b(?:official|music|video|audio|lyrics?|visualizer|hd|hq|4k)\b/gi,
        "",
      ),
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
  const artist = normalize(radioArtist(seed));
  const genre = radioGenre(seed);
  if (!artist && !genre) return [];
  const ids = new Set([seed.id, ...excluded, ...recent.map((t) => t.id)]);
  const songs = new Set([songIdentity(seed), ...recent.map(songIdentity)]);
  const seen = new Set<string>();
  return candidates
    .map((track, index) => {
      const identity = songIdentity(track);
      const matches =
        Boolean(artist) && normalize(radioArtist(track)) === artist;
      const candidateGenre = radioGenre(track);
      const genreMatch = Boolean(genre && candidateGenre === genre);
      const specific = specificRadioGenre(seed);
      // A broad tag alone is not evidence of a related recording. Last.fm's
      // vetted relationship may fill missing metadata, but never override a
      // conflicting explicit style.
      const compatible = !genre || !candidateGenre || genreMatch;
      const related =
        compatible &&
        (matches || Boolean(specific && genreMatch) || relatedRecording);
      const recentArtistCount = recent
        .slice(-5)
        .filter(
          (t) => normalize(radioArtist(t)) === normalize(radioArtist(track)),
        ).length;
      const valid =
        related &&
        isRadioMusic(track) &&
        !track.concert &&
        !ids.has(track.id) &&
        !songs.has(identity) &&
        !seen.has(identity);
      if (valid) seen.add(identity);
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
}
