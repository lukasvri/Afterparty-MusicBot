import type {YouTubeResponses, ExtractedMedia} from "./external-types.ts";
import { metadataGenres, metadataMusic, radioArtist, radioTitle, sameRadioRecording, RADIO_HISTORY_LIMIT, type RadioTrack } from "./radio.ts";
import { ExtractorFormatError, runJson, type ExtractorProfile } from "./extractor.ts";
export { runJson } from "./extractor.ts";
import { randomUUID } from "node:crypto";
import { SpotifyCatalog, spotifyRef, expandSpotifyLink } from "./spotify.ts";
import { normalizePlaylistUrl } from "./playlist-url.ts";
import { metadataAiGenerated } from "./music-content.ts";
import { verifyRadioContent } from "./youtube-content.ts";
import { rankMusicSearch, MUSIC_SEARCH_CACHE_MS, EMPTY_MUSIC_SEARCH_CACHE_MS } from "./music-search.ts";
import { deezerRef, deezerShareUrl, expandDeezerLink, loadDeezer } from "./deezer.ts";
import { resolveSoundcloud, soundcloudUrl } from "./soundcloud.ts";
import { Recommendations } from "./recommendations.ts";
import {
  scoreMatch,
  normalized,
  mapLimited,
  type CatalogSong,
} from "./matching.ts";
export { normalized, scoreMatch } from "./matching.ts";
import { selectRadio } from "./radio-pipeline.ts";
import { favoriteRecording } from "./recommendation-ranking.ts";
import { Store } from "./store.ts";
import { UserError, publicTrack, type Track } from "./types.ts";
import { ProviderWork, CORE_SEARCH_DEADLINE_MS, CORE_SEARCH_RESULTS_MS } from "./provider-work.ts";
function extractedCatalogArtist(media: ExtractedMedia) {
  const original = media.artist ?? media.uploader ?? "YouTube";
  const artists = media.artists;
  const unchanged = { artist: original };
  if (!Array.isArray(artists) || !artists.length || artists.length > 16 ||
    !artists.every(artist => typeof artist === "string" && Boolean(artist.trim()) && artist.length <= 200)) return unchanged;
  const uploader = (media.uploader ?? "").replace(/(?:\s*-\s*Topic|VEVO)$/i, "").trim();
  // A list distinguishes collaborators from a comma inside one artist name.
  // Do not guess a lead from list order: require the named uploader to agree.
  const artist = artists.length === 1 ? artists[0].trim()
    : artists.find(artist => normalized(artist) === normalized(uploader))?.trim();
  if (!artist) return unchanged;
  // Retain a private exact alias for older persisted combined credits. A
  // contradictory/free-form artist string is never evidence for this alias.
  return { artist, ...(normalized(original) !== normalized(artist) &&
    normalized(original) === normalized(artists.join(", ")) ? { artistCredit: original } : {}) };
}
function cachedArtistCredit(song: CatalogSong, track: Track, cached: Track) {
  const evidence = cached.catalog;
  if (typeof evidence?.artistCredit !== "string" || !evidence.artistCredit.trim() ||
    normalized(evidence.artist) !== normalized(song.artist) || cached.id !== track.id ||
    (cached.source ?? "youtube") !== (track.source ?? "youtube") ||
    !Number.isFinite(cached.duration) || cached.duration <= 0 ||
    !Number.isFinite(track.duration) || track.duration <= 0) return;
  const observedArtist = radioArtist(track) || track.artist.replace(/(?:\s*-\s*Topic|VEVO)$/i, "").trim();
  if (normalized(observedArtist) !== normalized(song.artist)) return;
  // API metadata has no private catalog. Compare its actual title/version and
  // duration with the verified cached recording before restoring that proof.
  const observed = { ...track, catalog: { artist: evidence.artist, title: radioTitle(track), duration: track.duration } };
  return sameRadioRecording(cached, observed) ? evidence.artistCredit : undefined;
}
function matchedCatalog(song: CatalogSong, track: Track, cached?: Track): CatalogSong {
  const catalog = { ...song };
  delete catalog.artistCredit;
  const evidence = track.catalog;
  if (typeof evidence?.artistCredit === "string" && evidence.artistCredit.trim() &&
    normalized(evidence.artist) === normalized(song.artist)) catalog.artistCredit = evidence.artistCredit;
  else if (cached) {
    const credit = cachedArtistCredit(song, track, cached);
    if (credit) catalog.artistCredit = credit;
  }
  return catalog;
}
export function youtubeId(query: string) {
  if (/^[\w-]{11}$/.test(query)) return query;
  try {
    const u = new URL(query);
    if (
      [
        "www.youtube.com",
        "youtube.com",
        "music.youtube.com",
        "m.youtube.com",
      ].includes(u.hostname)
    ) {
      const id =
        u.searchParams.get("v") ??
        u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/)?.[1];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (u.hostname === "youtu.be" && /^\/[\w-]{11}$/.test(u.pathname))
      return u.pathname.slice(1);
  } catch { /* Malformed URLs are not supported video identifiers. */ }
  return null;
}
function validSearchTrack(value: unknown): value is Track {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const t = value as Track;
  return typeof t.id === "string" && /^[\w-]{11}$/.test(t.id) && typeof t.title === "string" && typeof t.artist === "string" &&
    typeof t.image === "string" && Number.isFinite(t.duration) && t.duration >= 0 && typeof t.live === "boolean" && typeof t.embeddable === "boolean" &&
    (t.aiGenerated === undefined || typeof t.aiGenerated === "boolean") &&
    (t.genres === undefined || Array.isArray(t.genres) && t.genres.every(genre => typeof genre === "string")) &&
    (t.catalog === undefined || Boolean(t.catalog) && typeof t.catalog === "object" && typeof t.catalog.title === "string" && typeof t.catalog.artist === "string" && Number.isFinite(t.catalog.duration));
}
const copySearchTrack = (t: Track): Track => ({ ...t, entryId: randomUUID(),
  ...(t.genres ? { genres: [...t.genres] } : {}), ...(t.catalog ? { catalog: { ...t.catalog } } : {}) });
export type PlaylistImportResult = { videos: Track[]; total?: number; skipped: number; limited: boolean };
type SearchResult = { tracks: Track[]; complete: boolean };
const importObject = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const unavailablePlaylistEntry = (entry: Record<string, unknown>) =>
  entry.is_unavailable === true || entry.availability !== undefined && !["public", "unlisted"].includes(String(entry.availability)) ||
  typeof entry.title === "string" && /^\[?(?:deleted|private|unavailable) video\]?$/i.test(entry.title.trim());

export class Providers {
  verifyRadioContent = verifyRadioContent;
  store: Store;
  key: string;
  spotifyId: string;
  spotifySecret: string;
  spotifyCatalog: SpotifyCatalog;
  private readonly deezerMetadata: boolean;
  recommendations: Recommendations;
  recommendationStatus = "artist";
  private searches = new Map<string, ProviderWork<SearchResult>>();
  private videoLookups = new Map<string, ProviderWork<Track | undefined>>();
  constructor(store: Store, env: NodeJS.ProcessEnv = process.env) {
    this.store = store;
    this.key = env.YOUTUBE_API_KEY ?? "";
    this.spotifyId = env.SPOTIFY_CLIENT_ID ?? "";
    this.spotifySecret = env.SPOTIFY_CLIENT_SECRET ?? "";
    this.deezerMetadata = env.DEEZER_METADATA === "1";
    this.spotifyCatalog = new SpotifyCatalog(
      this.spotifyId,
      this.spotifySecret,
    );
    this.recommendations = new Recommendations(store, env.LASTFM_API_KEY ?? "");
  }
  async youtube<K extends keyof YouTubeResponses>(path: K, params: Record<string, string>, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const url = new URL("https://www.googleapis.com/youtube/v3/" + path);
    for (const [k, v] of Object.entries({ ...params, key: this.key }))
      url.searchParams.set(k, v);
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
    signal?.throwIfAborted();
    if (!response.ok)
      throw new UserError(
        "YouTube search is temporarily unavailable.",
        response.status === 403 || response.status === 429 ? 429 : 502,
      );
    const value = await response.json() as YouTubeResponses[K];
    signal?.throwIfAborted();
    return value;
  }
  async extract(args: string[], signal?: AbortSignal, priority = false, profile: ExtractorProfile = "media") {
    return runJson<ExtractedMedia>(process.env.YTDLP_PATH ?? "yt-dlp", args, signal, priority, profile);
  }
  async video(ids: string[], skipUnavailable = false, signal?: AbortSignal, partial = false): Promise<Track[]> {
    const controller = new AbortController();
    try {
      return await this.videoResults(ids, skipUnavailable,
        signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, partial);
    } finally { controller.abort(new UserError("The request was cancelled.", 499)); }
  }
  private async videoResults(ids: string[], skipUnavailable: boolean, signal: AbortSignal, partial: boolean): Promise<Track[]> {
    if (!partial) signal.throwIfAborted();
    if (!ids.length) return [];
    if (ids.some((id) => !/^[\w-]{11}$/.test(id)))
      throw new UserError("Invalid video ID.");
    const found = new Map<string, Track>(),
      missing: string[] = [];
    for (const id of ids) {
      const cached = this.store.get<{ at: number; track: Track } | null>(
        "metadata:v6:" + id,
        null,
      );
      if (cached && Date.now() - cached.at < 86400000)
        found.set(id, cached.track);
      else if (!missing.includes(id)) missing.push(id);
    }
    for (let index = 0; index < missing.length; index += 50) {
      const batch = missing.slice(index, index + 50);
      if (signal.aborted && partial) break;
      signal.throwIfAborted();
      const owned = new Map<string, ProviderWork<Track | undefined>>();
      const batchController = new AbortController();
      const abandoned = new Map<string, () => void>();
      const pending: [string, Promise<Track | undefined>][] = [];
      const complete = (id: string, value: Track | Error | undefined) => {
        const lookup = owned.get(id);
        if (!lookup) return;
        owned.delete(id);
        lookup.signal.removeEventListener("abort", abandoned.get(id)!);
        abandoned.delete(id);
        if (value instanceof Error) lookup.reject(value); else lookup.resolve(value);
      };
      for (const id of batch) {
        // Another caller or earlier batch may have populated this cache while
        // we waited. Reserve only this <=50-ID batch, never a whole playlist.
        if (index > 0) {
          const cached = this.store.get<{ at: number; track: Track } | null>("metadata:v6:" + id, null);
          if (cached && Date.now() - cached.at < 86400000) { found.set(id, cached.track); continue; }
        }
        let lookup = this.videoLookups.get(id);
        if (!lookup) {
          if (this.videoLookups.size >= 128) {
            pending.push([id, Promise.reject(new UserError("The music source is busy. Try again shortly.", 503))]);
            continue;
          }
          // Search/import subscribers own their deadlines. Metadata queued
          // inside a batch must retain the adapter's per-execution budget.
          const shared = new ProviderWork<Track | undefined>(null, () => {
            if (this.videoLookups.get(id) === shared) this.videoLookups.delete(id);
          });
          owned.set(id, shared);
          const abandon = () => {
            owned.delete(id); abandoned.delete(id);
            if (!owned.size) batchController.abort(shared.signal.reason);
          };
          abandoned.set(id, abandon);
          shared.signal.addEventListener("abort", abandon, { once: true });
          this.videoLookups.set(id, shared); lookup = shared;
        }
        pending.push([id, lookup.wait(signal)]);
      }
      if (owned.size) void this.hydrateVideoBatch([...owned.keys()], complete, batchController.signal, id => owned.get(id)?.signal).catch(error => {
        for (const id of owned.keys()) complete(id, error instanceof Error ? error : new Error(String(error)));
      });
      await Promise.all(pending.map(async ([id, lookup]) => {
        try { const track = await lookup; if (track) found.set(id, track); }
        catch (error) { if (signal.aborted && !partial || !skipUnavailable) throw error; }
      }));
    }
    if (!partial) signal.throwIfAborted();
    return ids
      .map((id) => found.get(id))
      .filter((t): t is Track => Boolean(t))
      .map((t) => ({ ...t, entryId: randomUUID(),
        ...(t.genres ? { genres: [...t.genres] } : {}), ...(t.catalog ? { catalog: { ...t.catalog } } : {}) }));
  }
  /** A shared batch contains raw per-ID outcomes; caller strictness stays outside. */
  private async hydrateVideoBatch(batch: string[], complete: (id: string, value: Track | Error | undefined) => void, signal: AbortSignal, active: (id: string) => AbortSignal | undefined): Promise<void> {
    const found = new Map<string, Track>();
    const remember = (track: Track) => {
      signal.throwIfAborted();
      if (!active(track.id)) return;
      this.store.set("metadata:v6:" + track.id, { at: Date.now(), track });
      found.set(track.id, track);
    };
    try {
      const data = await this.youtube("videos", {
        id: batch.join(","), part: "snippet,contentDetails,status",
      }, signal);
      signal.throwIfAborted();
      for (const v of data.items ?? []) {
        if (!active(v.id)) continue;
        const parts = String(v.contentDetails.duration).match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
        remember({
          id: v.id,
          genres: metadataGenres(v.snippet.description, v.snippet.tags),
          music: metadataMusic(v.snippet.categoryId),
          title: decode(v.snippet.title), artist: decode(v.snippet.channelTitle),
          aiGenerated: metadataAiGenerated(decode(v.snippet.title), decode(v.snippet.channelTitle), v.snippet.description, v.snippet.tags, v.status.containsSyntheticMedia),
          image: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
          duration: parts ? Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0) : 0,
          live: v.snippet.liveBroadcastContent === "live", embeddable: v.status.embeddable !== false,
          entryId: randomUUID(), source: "youtube",
        });
      }
      for (const id of batch) complete(id, found.get(id));
    } catch {
      signal.throwIfAborted();
      await mapLimited(batch, 3, async (id) => {
        signal.throwIfAborted();
        const item = active(id);
        if (!item || item.aborted) return;
        const itemSignal = AbortSignal.any([signal, item]);
        try {
          const args = [
            "--no-playlist", "--dump-single-json", "--skip-download", "--js-runtimes", "node",
          ], url = "https://www.youtube.com/watch?v=" + id;
          let v: ExtractedMedia;
          try {
            // Metadata still comes from full video/player responses. Avoid
            // resolving audio formats until playback actually needs a stream.
            v = await this.extract([...args, "--extractor-args", "youtube:player_skip=js;skip=hls,dash",
              "--no-ignore-no-formats-error", url], itemSignal, false, "metadata");
          } catch (error) {
            // Some playable videos have only JS-dependent formats. Preserve
            // their full fallback without retrying private/network/deadline errors.
            itemSignal.throwIfAborted();
            if (!active(id) || !(error instanceof ExtractorFormatError)) throw error;
            v = await this.extract([...args, url], itemSignal);
          }
          remember({
            id, genres: metadataGenres(v.description, v.tags), music: metadataMusic(undefined, v.categories),
            title: v.title ?? "YouTube", artist: v.artist ?? v.uploader ?? "YouTube",
            aiGenerated: metadataAiGenerated(v.title, [v.artist, v.uploader].filter(Boolean).join(" "), v.description, v.tags),
            image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, duration: Number(v.duration) || 0,
            live: v.is_live === true, embeddable: v.playable_in_embed === true,
            source: "youtube", entryId: randomUUID(),
            ...(v.artist && v.track ? { catalog: { ...extractedCatalogArtist(v), title: v.track, duration: Number(v.duration) || 0 } } : {}),
          });
          complete(id, found.get(id));
        } catch (error) { complete(id, error instanceof Error ? error : new Error(String(error))); }
      });
    }
  }
  async search(query: string, count = 30, musicOnly = false, signal?: AbortSignal): Promise<Track[]> {
    return (await this.searchResult(query, count, musicOnly, signal)).tracks;
  }
  async searchResult(query: string, count = 30, musicOnly = false, signal?: AbortSignal): Promise<SearchResult> {
    signal?.throwIfAborted();
    query = query.trim();
    if (!query || query.length > 2000 || !Number.isInteger(count) || count < 1 || count > 50 || typeof musicOnly !== "boolean")
      throw new UserError("Invalid music search.");
    const key =
        "search:v7:" +
        JSON.stringify([
          query.trim().normalize("NFKC").toLowerCase(),
          count,
          musicOnly,
        ]),
      cached = this.store.get<{ at: number; tracks: Track[] } | null>(
        key,
        null,
      );
    const now = Date.now();
    if (cached && Number.isFinite(cached.at) && cached.at <= now && Array.isArray(cached.tracks) &&
      now - cached.at < (cached.tracks.length ? MUSIC_SEARCH_CACHE_MS : EMPTY_MUSIC_SEARCH_CACHE_MS) &&
      (cached.tracks.length > 0 || !musicOnly) && cached.tracks.length <= count && cached.tracks.every(validSearchTrack) &&
      new Set(cached.tracks.map(track => track.id)).size === cached.tracks.length)
      return { tracks: cached.tracks.map(copySearchTrack), complete: true };
    let lookup = this.searches.get(key);
    if (!lookup) {
      if (this.searches.size >= 64) throw new UserError("The music source is busy. Try again shortly.", 503);
      const shared = new ProviderWork<SearchResult>(CORE_SEARCH_DEADLINE_MS, () => {
        if (this.searches.get(key) === shared) this.searches.delete(key);
      });
      lookup = shared;
      // Coalesce bursts and bound the number of distinct provider lookups in flight.
      this.searches.set(key, lookup);
      shared.run(async signal => {
        const hydration = new AbortController();
        // One soft cutoff from search start, not a new budget for each ID.
        const timer = setTimeout(() => hydration.abort(), CORE_SEARCH_RESULTS_MS);
        try {
          const { tracks, emptySearch } = await this.searchUncached(query, count, musicOnly, signal, hydration.signal);
          signal.throwIfAborted();
          const complete = !hydration.signal.aborted || musicOnly;
          if (complete && (tracks.length || emptySearch && !musicOnly))
            this.store.set(key, { at: Date.now(), tracks });
          return { tracks, complete };
        } finally { clearTimeout(timer); }
      });
    }
    const result = await lookup.wait(signal);
    return { tracks: result.tracks.map(copySearchTrack), complete: result.complete };
  }
  private async searchUncached(
    query: string,
    count: number,
    musicOnly: boolean,
    signal: AbortSignal,
    hydration: AbortSignal,
  ): Promise<{ tracks: Track[]; emptySearch: boolean }> {
    let ids: string[];
    try {
      const data = await this.youtube("search", {
        q: query,
        type: "video",
        maxResults: String(count),
        videoEmbeddable: "true",
        part: "snippet",
        safeSearch: "moderate",
        ...(musicOnly ? { videoCategoryId: "10" } : {}),
      }, signal);
      signal.throwIfAborted();
      ids = data.items.map((i) => i.id.videoId);
    } catch {
      signal.throwIfAborted();
      const data = await this.extract([
        "--flat-playlist",
        "--dump-single-json",
        "--skip-download",
        `ytsearch${count}:${query}`,
      ], signal);
      signal.throwIfAborted();
      ids = (data.entries ?? [])
        .map((t) => t?.id)
        .filter((id): id is string => typeof id === "string" && /^[\w-]{11}$/.test(id));
    }
    const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && /^[\w-]{11}$/.test(id)))].slice(0, count);
    const partial = !musicOnly;
    const tracks = await this.video(unique, true, partial ? AbortSignal.any([signal, hydration]) : signal, partial);
    signal.throwIfAborted();
    if (partial && hydration.aborted && unique.length && !tracks.length)
      throw new UserError("The music source took too long. Try again shortly.", 504);
    // Hydration deliberately tolerates unavailable IDs. Only an empty discovery
    // result proves a negative cache entry is safe; failed hydration must retry.
    return { tracks: musicOnly ? tracks : rankMusicSearch(query, tracks), emptySearch: unique.length === 0 };
  }
  /** Metadata-only import. Its 500-entry budget is independent of ordinary queue settings. */
  async importPlaylist(input: string, signal: AbortSignal): Promise<PlaylistImportResult> {
    signal.throwIfAborted();
    let ref = normalizePlaylistUrl(input);
    if (new URL(ref.url).hostname === "spotify.link") {
      const expanded = await expandSpotifyLink(ref.url, fetch, signal);
      signal.throwIfAborted();
      ref = normalizePlaylistUrl(expanded);
      if (ref.source !== "spotify" || new URL(ref.url).hostname !== "open.spotify.com") throw new UserError("Invalid Spotify playlist URL.");
    }
    if (ref.source === "spotify") {
      const spotify = spotifyRef(ref.url);
      if (!spotify || !["playlist", "album"].includes(spotify.kind)) throw new UserError("Invalid Spotify playlist URL.");
      const source = await this.spotifyCatalog.loadWithSummary(spotify.kind, spotify.id, 500, signal);
      signal.throwIfAborted();
      const items = source.items.slice(0, 500), results = new Array<Track | undefined>(items.length);
      let next = 0;
      // Await all raw work before returning, even if a dependency ignores cancellation.
      await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
        while (!signal.aborted && next < items.length) {
          const index = next++;
          try {
            signal.throwIfAborted();
            const found = await this.matchSong(items[index]);
            signal.throwIfAborted();
            if (validSearchTrack(found) && found.embeddable && (found.source === undefined || found.source === "youtube")) results[index] = copySearchTrack(found);
          } catch { if (signal.aborted) return; }
        }
      }));
      signal.throwIfAborted();
      const seen = new Set<string>(), videos = results.filter((track): track is Track => {
        if (!track || seen.has(track.id)) return false;
        seen.add(track.id); return true;
      });
      return { videos, ...(source.total !== undefined ? { total: source.total } : {}),
        skipped: source.skipped + items.length - videos.length, limited: source.limited || source.items.length > 500 };
    }
    const ids: string[] = [], seen = new Set<string>();
    let skipped = 0, total: number | undefined, limited = false;
    const remember = (value: unknown, unavailable = false) => {
      if (unavailable || typeof value !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(value) || seen.has(value)) { skipped++; return; }
      seen.add(value); ids.push(value);
    };
    try {
      if (!this.key) throw new UserError("YouTube API access is not configured.");
      const playlistId = new URL(ref.url).searchParams.get("list")!, visited = new Set<string>();
      let page = "", entries = 0;
      do {
        signal.throwIfAborted();
        visited.add(page);
        const data = importObject(await this.youtube("playlistItems", { playlistId, part: "contentDetails,snippet,status", maxResults: "50", ...(page ? { pageToken: page } : {}) }, signal));
        signal.throwIfAborted();
        if (!data || !Array.isArray(data.items) || data.items.length > 50) throw new UserError("Invalid YouTube playlist response.");
        const count = importObject(data.pageInfo)?.totalResults;
        if (total === undefined && typeof count === "number" && Number.isSafeInteger(count) && count >= 0) total = count;
        for (const raw of data.items) {
          const item = importObject(raw), snippet = importObject(item?.snippet), status = importObject(item?.status);
          entries++;
          remember(importObject(item?.contentDetails)?.videoId, !item || status?.privacyStatus === "private" || Boolean(snippet && unavailablePlaylistEntry(snippet)));
        }
        if (data.nextPageToken !== undefined && (typeof data.nextPageToken !== "string" || data.nextPageToken.length > 512 || /[\p{Cc}\p{Cf}]/u.test(data.nextPageToken))) throw new UserError("Invalid YouTube playlist page.");
        page = typeof data.nextPageToken === "string" ? data.nextPageToken : "";
        if (page && (entries >= 500 || visited.has(page) || visited.size >= 10)) { limited = true; break; }
      } while (page);
      limited ||= total !== undefined && total > entries;
    } catch {
      signal.throwIfAborted();
      ids.length = 0; seen.clear(); skipped = 0; total = undefined;
      const raw = await this.extract(["--flat-playlist", "--dump-single-json", "--skip-download", "--ignore-config", "--no-cache-dir", "--js-runtimes", "node", "--playlist-end", "501", "--", ref.url], signal);
      signal.throwIfAborted();
      const data = importObject(raw);
      if (!data || !Array.isArray(data.entries)) throw new UserError("The playlist is unavailable.", 502);
      const count = data.playlist_count;
      if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) total = count;
      limited = data.entries.length > 500 || total !== undefined && total > Math.min(data.entries.length, 500);
      for (const raw of data.entries.slice(0, 500)) {
        const entry = importObject(raw); remember(entry?.id, !entry || unavailablePlaylistEntry(entry));
      }
    }
    const found = new Map<string, Track>();
    for (let index = 0; index < ids.length; index += 50) {
      signal.throwIfAborted();
      const batch = ids.slice(index, index + 50), requested = new Set(batch);
      const tracks = await this.video(batch, true, signal);
      signal.throwIfAborted();
      for (const track of tracks) if (validSearchTrack(track) && requested.has(track.id) && track.embeddable &&
        (track.source === undefined || track.source === "youtube") && !found.has(track.id)) found.set(track.id, copySearchTrack(track));
    }
    const videos = ids.map(id => found.get(id)).filter((track): track is Track => Boolean(track));
    return { videos, ...(total !== undefined ? { total } : {}), skipped: skipped + ids.length - videos.length, limited };
  }
  async resolve(query: string): Promise<Track[]> {
    query = query.trim();
    if (!query || query.length > 2000)
      throw new UserError("Enter a search or a valid music link.");
    if (/^https:\/\/spotify\.link\//i.test(query))
      query = await expandSpotifyLink(query);
    const id = youtubeId(query);
    if (id) return this.video([id]);
    try {
      const url = new URL(query);
      const playlist = url.searchParams.get("list");
      if (
        ["youtube.com", "www.youtube.com", "music.youtube.com"].includes(
          url.hostname,
        ) &&
        playlist &&
        /^[\w-]{10,100}$/.test(playlist)
      ) {
        const ids: string[] = [];
        let page = "";
        do {
          const data = await this.youtube("playlistItems", {
            playlistId: playlist,
            part: "contentDetails",
            maxResults: "50",
            ...(page ? { pageToken: page } : {}),
          });
          ids.push(...data.items.map((i) => i.contentDetails.videoId));
          page = data.nextPageToken ?? "";
        } while (page && ids.length < this.store.settings().playlistLimit);
        const tracks: Track[] = [];
        for (
          let i = 0;
          i < Math.min(ids.length, this.store.settings().playlistLimit);
          i += 50
        )
          tracks.push(
            ...(await this.video(
              ids.slice(
                i,
                Math.min(i + 50, this.store.settings().playlistLimit),
              ),
            )),
          );
        return tracks;
      }
    } catch (error) {
      if (error instanceof UserError) throw error;
    }
    const spotify = spotifyRef(query);
    if (spotify) {
      const items = await this.spotify(spotify.kind, spotify.id);
      return mapLimited(items, 3, (item) => this.matchSong(item));
    }
    const deezer = deezerRef(query), deezerSharing = deezerShareUrl(query);
    if (deezer || deezerSharing) {
      if (!this.deezerMetadata) throw new UserError("Deezer link matching is not enabled for this installation.");
      const ref = deezer ?? await expandDeezerLink(deezerSharing!);
      const items = await loadDeezer(ref, Math.min(500, this.store.settings().playlistLimit));
      return mapLimited(items, 3, (item) => this.matchSong(item));
    }
    if (soundcloudUrl(query) || /^sc(?:search)?:/i.test(query))
      return resolveSoundcloud(
        query,
        this.store.settings().playlistLimit,
        (args) => runJson<ExtractedMedia>(process.env.YTDLP_PATH ?? "yt-dlp", args),
      );
    if (/^https?:\/\//.test(query))
      throw new UserError(this.deezerMetadata ? "Use a YouTube, Spotify, Deezer or SoundCloud link." : "Use a YouTube, Spotify or SoundCloud link.");
    const audio = /\b(live|video|konsert|concert)\b/i.test(query)
      ? query
      : query + " audio";
    const found = await this.search(audio, 5);
    if (!found[0]) throw new UserError("No results. Try another search.");
    return [found[0]];
  }
  async stream(track: Track, signal: AbortSignal) {
    const target =
      track.source === "soundcloud"
        ? track.url
        : `https://www.youtube.com/watch?v=${track.id}`;
    const data = await this.extract(
      [
        "--no-playlist",
        "--dump-single-json",
        "--skip-download",
        "--js-runtimes",
        "node",
        "-f",
        track.source === "soundcloud"
          ? "bestaudio/best"
          : "bestaudio[protocol*=m3u8]/bestaudio/best",
        target!,
      ],
      signal,
      true,
    );
    if (
      data.is_preview ||
      (data.full_duration && Number(data.duration) < data.full_duration - 2)
    )
      throw new UserError("The source only offers a preview.");
    if (typeof data.url !== "string" || !/^https?:\/\//.test(data.url))
      throw new UserError("The media source has no audio stream.", 502);
    const headers = Object.entries(data.http_headers ?? {})
      .filter(([k, v]) => typeof v === "string" && !/[\r\n]/.test(k + v))
      .map(([k, v]) => `${k}: ${v}\r\n`)
      .join("");
    return {
      url: data.url,
      headers,
      duration: Number.isFinite(data.duration)
        ? Number(data.duration)
        : track.duration,
    };
  }
  async matchSong(input: CatalogSong): Promise<Track> {
    let song = input;
    if (input.id && !input.isrc) {
      try {
        song = await this.spotifyCatalog.enrich(input);
      } catch {
        /* Metadata already sufficient for a strict fallback match. */
      }
    }
    const key =
      "match:v2:" +
      JSON.stringify([
        song.id ?? song.isrc ?? "",
        song.artist,
        song.title,
        song.duration,
      ]);
    const cached = this.store.get<{ at: number; track: Track } | null>(
      key,
      null,
    );
    if (cached && Date.now() - cached.at < 7 * 86400000) {
      const fresh = (await this.video([cached.track.id]))[0];
      if (fresh && scoreMatch(song, fresh) >= 0.85)
        return { ...fresh, catalog: matchedCatalog(song, fresh, cached.track), entryId: randomUUID() };
    }
    let candidates: Track[] = [];
    if (song.isrc && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(song.isrc))
      candidates = await this.search(`"${song.isrc}"`, 6, true);
    let ranked = candidates
      .map((track) => ({ track, score: scoreMatch(song, track) }))
      .filter((t) => t.score >= 0.85)
      .sort((a, b) => b.score - a.score);
    if (!ranked.length) {
      candidates = await this.search(
        `${song.artist} ${song.title} official audio`,
        12,
        true,
      );
      ranked = candidates
        .map((track) => ({ track, score: scoreMatch(song, track) }))
        .filter((t) => t.score >= 0.85)
        .sort((a, b) => b.score - a.score);
    }
    if (!ranked[0])
      throw new UserError(
        `Could not find a reliable audio match for ${song.artist} - ${song.title}.`,
      );
    const track = { ...ranked[0].track, catalog: matchedCatalog(song, ranked[0].track), entryId: randomUUID() };
    this.store.set(key, { at: Date.now(), track });
    return track;
  }
  rememberRadioTrack(track: Track) {
    const history = this.store.get<RadioTrack[]>("radio-history", []);
    this.store.set("radio-history", [
      ...history.filter((item) => item.id !== track.id),
      { ...publicTrack(track)!, ...(track.catalog ? { catalog: track.catalog } : {}) },
    ].slice(-RADIO_HISTORY_LIMIT));
  }
  radioHistory(): RadioTrack[] {
    const skipped = this.store.get<{ track: RadioTrack; at: number }[]>("radio-skipped-tracks", []);
    const recorded = this.store.history(RADIO_HISTORY_LIMIT).reverse();
    const canonical = this.store.get<RadioTrack[]>("radio-history", []);
    const identities = new Map(canonical.map((track) => [track.id, track]));
    const recordedIds = new Set(recorded.map((item) => item.video.id));
    return [
      ...canonical.filter((track) => !recordedIds.has(track.id)).map((track) => ({ track, at: 0 })),
      ...recorded.map((item) => ({ track: identities.get(item.video.id) ?? item.video, at: item.at })),
      ...skipped.filter((item) => Date.now() - item.at < 7 * 86400000),
    ].sort((a, b) => a.at - b.at).map((item) => item.track);
  }
  async radio(seed: Track, excluded: string[], current: RadioTrack[] = []) {
    if (seed.live || seed.music === false) return null;
    const recent = [...this.radioHistory(), ...current];
    const skipped = this.store.get<Record<string, number>>("radio-skips", {});
    const banned = [...excluded, ...Object.entries(skipped)
      .filter(([, at]) => Date.now() - at < 7 * 86400000).map(([id]) => id)];
    const soundcloud = seed.source === "soundcloud" && !seed.concert;
    const result = await selectRadio({
      verifyContent: this.verifyRadioContent,
      seed, recent, excluded: banned, requireEmbeddable: Boolean(seed.concert),
      search: query => soundcloud
        ? resolveSoundcloud(`sc:${query}`, 5,
          args => runJson<ExtractedMedia>(process.env.YTDLP_PATH ?? "yt-dlp", args), 5)
        : this.search(query, 20, true),
      ...(this.recommendations.enabled ? {
        similar: (original: Track) => this.recommendations.similar(original),
        topTracks: (original: Track) => this.recommendations.topTracks(original),
        match: (song: CatalogSong) => this.matchSong(song),
      } : {}),
      favoriteRecordings: this.store.favorites().flatMap(favorite => {
        const recording = favoriteRecording(favorite.query);
        return recording ? [recording] : [];
      }),
      diagnose: diagnostic => console.info("core-radio", JSON.stringify(diagnostic)),
    });
    this.recommendationStatus = result.source === "catalog" || result.source === "artist-catalog"
      ? "lastfm" : soundcloud ? "soundcloud" : "artist";
    if (result.error) throw result.error;
    return result.track;
  }
  async spotify(kind: string, id: string): Promise<CatalogSong[]> {
    return this.spotifyCatalog.load(
      kind,
      id,
      this.store.settings().playlistLimit,
    );
  }
}
function decode(value: string) {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
