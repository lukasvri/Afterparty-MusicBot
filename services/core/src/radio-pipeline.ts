import type { CatalogSong } from "./matching.ts";
import { normalized, scoreMatch } from "./matching.ts";
import type { PublicTrack, Track } from "./types.ts";
import { copyRadioDescriptor, createRecommendationRanking, type FavoriteRecording } from "./recommendation-ranking.ts";
import {
  createRadioRanker, isRadioMusic, isRadioTitle, radioArtist, radioGenre,
  radioQuery, radioRelated, radioStyleCompatible, radioTitle,
  sameRadioRecording, sameRadioSong, specificRadioGenre,
} from "./radio.ts";

export const RADIO_LIMITS = Object.freeze({ metadata: 12, descriptors: 15, similarMatches: 3,
  catalogMatches: 4, searchResults: 20, discoverySearches: 2, candidates: 60, videoResults: 12 });
export type RadioSource = "catalog" | "artist-catalog" | "genre" | "artist";
type Stage = "metadata" | "catalog" | "artist-catalog" | "genre" | "artist";
type StageResult = "unavailable" | "skipped" | "selected" | "empty" | "filtered" | "failed";
type Rejection = "content" | "visibility" | "style" | "relationship" | "excluded" | "recording" | "catalog-match";
export type RadioDiagnostic = {
  version: 2;
  outcome: "selected" | "empty" | "filtered" | "provider-error" | "insufficient-metadata";
  seedGenre: string | null;
  artistKnown: boolean;
  metadata: "unchanged" | "refined" | "unavailable";
  searches: number;
  failedSearches: number;
  musicVideo: StageResult;
  videoSearches: number;
  videoCandidates: number;
  candidates: number;
  catalogMatches: number;
  failedCatalogMatches: number;
  source: RadioSource | null;
  stages: Record<Stage, StageResult>;
  rejected: Record<Rejection, number>;
};
export type RadioInput = {
  seed: Track;
  recent: PublicTrack[];
  excluded: string[];
  requireEmbeddable: boolean;
  search: (query: string) => Promise<Track[]>;
  similar?: (seed: Track) => Promise<CatalogSong[]>;
  topTracks?: (seed: Track) => Promise<CatalogSong[]>;
  match?: (song: CatalogSong) => Promise<Track>;
  favorites?: string[];
  favoriteRecordings?: FavoriteRecording[];
  diagnose?: (diagnostic: RadioDiagnostic) => void;
};
export type RadioSelection = { track: Track | null; source: RadioSource | null;
  diagnostic: RadioDiagnostic; error?: unknown };

/** Platform-neutral discovery and policy. No state writes, clocks or provider credentials. */
export async function selectRadio(input: RadioInput): Promise<RadioSelection> {
  const original = input.seed;
  let seed = original;
  const artist = radioArtist(original);
  const diagnostic: RadioDiagnostic = {
    version: 2, outcome: "empty", seedGenre: radioGenre(seed), artistKnown: Boolean(artist),
    musicVideo: "skipped", videoSearches: 0, videoCandidates: 0,
    metadata: "unchanged", searches: 0, failedSearches: 0, candidates: 0, catalogMatches: 0, failedCatalogMatches: 0, source: null,
    stages: { metadata: "skipped", catalog: input.similar && input.match ? "skipped" : "unavailable",
      "artist-catalog": input.topTracks && input.match ? "skipped" : "unavailable", genre: "skipped", artist: "skipped" },
    rejected: { content: 0, visibility: 0, style: 0, relationship: 0, excluded: 0, recording: 0, "catalog-match": 0 },
  };
  const finish = (track: Track | null, source: RadioSource | null, error?: unknown): RadioSelection => {
    diagnostic.source = source;
    if (track) diagnostic.outcome = "selected";
    input.diagnose?.(diagnostic);
    return { track, source, diagnostic, ...(error === undefined ? {} : { error }) };
  };
  if (original.live || original.music === false || (!artist && !specificRadioGenre(seed))) {
    diagnostic.outcome = "insufficient-metadata";
    return finish(null, null);
  }

  // Learn only from a safe upload of the exact original recording. The original
  // object and catalog remain intact; later discovery still uses its identity.
  if (!specificRadioGenre(seed) && artist) {
    try {
      const candidates = (await input.search(`${artist} "${radioTitle(seed).replace(/"/g, "")}"`)).slice(0, RADIO_LIMITS.metadata);
      const tagged = candidates.find(track => isRadioMusic(track) && track.embeddable &&
        specificRadioGenre(track) && radioStyleCompatible(seed, track) && sameRadioRecording(seed, track));
      if (tagged) {
        seed = { ...original, title: tagged.title, genres: tagged.genres };
        diagnostic.metadata = "refined";
        diagnostic.seedGenre = radioGenre(seed);
        diagnostic.stages.metadata = "selected";
      } else diagnostic.stages.metadata = candidates.length ? "filtered" : "empty";
    } catch {
      diagnostic.metadata = "unavailable";
      diagnostic.stages.metadata = "failed";
    }
  }

  const ids = new Set([original.id, ...input.excluded, ...input.recent.map(track => track.id)]);
  const ranker = createRadioRanker(seed, input.recent, input.excluded);
  const preferences = createRecommendationRanking(seed, input.recent, input.favorites, input.favoriteRecordings);
  const pool: { track: Track; source: RadioSource; related: boolean; index: number }[] = [];
  let lastError: unknown;
  let successfulDiscovery = 0;
  const queries: { source: "genre" | "artist"; query: string }[] = [
    { source: specificRadioGenre(seed) ? "genre" as const : "artist" as const, query: radioQuery(seed) },
    ...(artist ? [{ source: "artist" as const, query: `${artist} music audio` }] : []),
  ].slice(0, RADIO_LIMITS.discoverySearches);
  const reject = (reason: Rejection) => { diagnostic.rejected[reason]++; return false; };
  const admit = (value: Track, source: RadioSource, related = false) => {
    if (diagnostic.candidates >= RADIO_LIMITS.candidates) return false;
    diagnostic.candidates++;
    const track = { ...value };
    // Provider/search metadata is not a relationship token. Only this pass can
    // supply catalog proof after matching a named recording to the original seed.
    delete track.radioRelatedTo;
    if (!isRadioMusic(track) || track.concert) return reject("content");
    if (input.requireEmbeddable && ((track.source ?? "youtube") !== "youtube" || !track.embeddable)) return reject("visibility");
    if (!radioStyleCompatible(seed, track)) return reject("style");
    if (!radioRelated(seed, track, related)) return reject("relationship");
    if (ids.has(track.id)) return reject("excluded");
    if (!ranker.rank([track], related).length) return reject("recording");
    pool.push({ track, source, related, index: pool.length });
    return true;
  };

  const known = [original, ...input.recent];
  const descriptors = new Set<string>();
  const discoverCatalog = async (source: "catalog" | "artist-catalog", limit: number) => {
    const discover = source === "catalog" ? input.similar : input.topTracks;
    if (!discover || !input.match || !artist) return;
    let songs: CatalogSong[];
    try {
      songs = (await discover(original)).slice(0, RADIO_LIMITS.descriptors)
        .map(copyRadioDescriptor).filter((song): song is CatalogSong => song !== null);
    } catch (error) {
      lastError = error;
      diagnostic.stages[source] = "failed";
      return;
    }
    const localDescriptors = new Set<string>();
    const descriptorKey = (song: CatalogSong) => JSON.stringify([normalized(song.artist), normalized(song.title)]);
    const eligible = songs.filter(song => {
      if (!song || typeof song.title !== "string" || typeof song.artist !== "string" ||
        !song.title.trim() || !song.artist.trim() || !isRadioTitle(song.title)) return false;
      if (source === "artist-catalog" && normalized(song.artist) !== normalized(artist)) return false;
      const recording: Track = { ...original, id: "catalog", title: song.title, artist: `${song.artist} - Topic`, catalog: song };
      const key = descriptorKey(song);
      if (descriptors.has(key) || localDescriptors.has(key) || known.some(track => sameRadioSong(track, recording))) return false;
      localDescriptors.add(key);
      return true;
    });
    const before = pool.length;
    const attemptsBefore = diagnostic.catalogMatches, failuresBefore = diagnostic.failedCatalogMatches;
    for (const song of preferences.descriptors(eligible)) {
      if (diagnostic.catalogMatches >= limit || diagnostic.catalogMatches >= RADIO_LIMITS.catalogMatches) break;
      diagnostic.catalogMatches++;
      descriptors.add(descriptorKey(song));
      try {
        const matched = await input.match(song);
        successfulDiscovery++;
        const raw = { ...matched };
        delete raw.catalog;
        const expected = { ...raw, title: song.title, artist: `${song.artist} - Topic`, catalog: song };
        if (scoreMatch(song, raw) < 0.85 || !sameRadioRecording(expected, raw)) {
          reject("catalog-match");
          continue;
        }
        admit(matched, source, source === "catalog");
      } catch (error) {
        lastError = error;
        diagnostic.failedCatalogMatches++;
        reject("catalog-match");
      }
    }
    const attempts = diagnostic.catalogMatches - attemptsBefore;
    diagnostic.stages[source] = pool.length > before ? "selected" : attempts > 0 &&
      diagnostic.failedCatalogMatches - failuresBefore === attempts ? "failed" : songs.length ? "filtered" : "empty";
  };
  await discoverCatalog("catalog", RADIO_LIMITS.similarMatches);
  if (!pool.length) await discoverCatalog("artist-catalog", RADIO_LIMITS.catalogMatches);

  // Both bounded discovery pools participate. An early same-artist catalog or
  // genre hit cannot hide a later, equally supported and more diverse song.
  const stagePriority: Record<StageResult, number> = { unavailable: 0, skipped: 0, failed: 1, empty: 2, filtered: 3, selected: 4 };
  const discoveries = await Promise.all(queries.map(async ({ source, query }) => {
    diagnostic.searches++;
    try {
      return { source, found: (await input.search(query)).slice(0, RADIO_LIMITS.searchResults) };
    } catch (error) { return { source, error }; }
  }));
  // Fetch only the two existing bounded pools concurrently. Admit their results
  // in query order, so provider completion timing cannot change tie-breaking.
  // Core coalesces overlapping cold video IDs before hydration.
  for (const discovery of discoveries) {
    const { source, found } = discovery;
    let status: StageResult;
    if (found) {
      successfulDiscovery++;
      const before = pool.length;
      for (const candidate of found) admit(candidate, source);
      status = pool.length > before ? "selected" : found.length ? "filtered" : "empty";
    } else {
      lastError = discovery.error;
      diagnostic.failedSearches++;
      status = "failed";
    }
    if (stagePriority[status] > stagePriority[diagnostic.stages[source]]) diagnostic.stages[source] = status;
  }

  pool.sort(preferences.compare);
  const chosen = pool[0];
  if (chosen) {
    // Format preference is scoped to the already selected recording. A video
    // must never buy a different song a better genre/diversity/favorite rank.
    const selected = chosen.track;
    const artist = radioArtist(selected);
    const title = radioTitle(selected).replace(/\s+official(?: music)? (?:audio|video)\s*$/i, "").trim();
    const musicVideo = (track: Track) => (track.source ?? "youtube") === "youtube" &&
      /\bofficial(?: music)? video\b/i.test(track.title) &&
      !/\b(?:official audio|lyric(?:s)? video|visualizer)\b/i.test(track.title);
    const eligibleVideo = (value: Track) => {
      if (!artist || (selected.source ?? "youtube") !== "youtube") return null;
      const raw = { ...value };
      // A title is a format hint, not proof of authenticity. Catalog labels
      // supplied with a search result cannot establish its recording identity.
      delete raw.catalog;
      delete raw.radioRelatedTo;
      if (!musicVideo(raw) || !isRadioMusic(raw) || raw.concert ||
        (input.requireEmbeddable && !raw.embeddable) || ids.has(raw.id) ||
        !sameRadioRecording(selected, raw) ||
        !radioStyleCompatible(selected, raw) || !radioStyleCompatible(seed, raw) ||
        !ranker.rank([raw], chosen.related).length) return null;
      return raw;
    };
    let video = pool.map(item => eligibleVideo(item.track)).find(track => track !== null);
    if (!video && (selected.source ?? "youtube") === "youtube" && artist) {
      diagnostic.videoSearches++;
      try {
        const found = (await input.search(`${artist} "${title.replace(/"/g, "")}" official music video`))
          .slice(0, RADIO_LIMITS.videoResults);
        diagnostic.videoCandidates = found.length;
        video = found.map(eligibleVideo).find(track => track !== null);
        diagnostic.musicVideo = video ? "selected" : found.length ? "filtered" : "empty";
      } catch {
        // An optional format lookup cannot invalidate an eligible audio match.
        diagnostic.musicVideo = "failed";
      }
    } else if (video) diagnostic.musicVideo = "selected";
    return finish({ ...(video ?? selected), radioRelatedTo: original.id }, chosen.source);
  }
  diagnostic.outcome = !successfulDiscovery && lastError ? "provider-error" : diagnostic.candidates ||
    diagnostic.rejected["catalog-match"] > diagnostic.failedCatalogMatches ? "filtered" : "empty";
  return finish(null, null, diagnostic.outcome === "provider-error" ? lastError : undefined);
}
