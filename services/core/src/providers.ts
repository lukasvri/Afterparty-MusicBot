import type {YouTubeResponses, ExtractedMedia} from "./external-types.ts";
import { metadataGenres, metadataMusic, RADIO_HISTORY_LIMIT, type RadioTrack } from "./radio.ts";
import { runJson } from "./extractor.ts";
export { runJson } from "./extractor.ts";
import { randomUUID } from "node:crypto";
import { SpotifyCatalog, spotifyRef, expandSpotifyLink } from "./spotify.ts";
import { resolveSoundcloud, soundcloudUrl } from "./soundcloud.ts";
import { Recommendations } from "./recommendations.ts";
import {
  normalized,
  scoreMatch,
  mapLimited,
  type CatalogSong,
} from "./matching.ts";
export { normalized, scoreMatch } from "./matching.ts";
import {
  radioArtist,
  radioQuery,
  specificRadioGenre,
  rankRadio,
  songIdentity,
  canPlayRadioTrack,
} from "./radio.ts";
import { Store } from "./store.ts";
import { UserError, publicTrack, type Track } from "./types.ts";
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
  } catch {}
  return null;
}
export class Providers {
  store: Store;
  key: string;
  spotifyId: string;
  spotifySecret: string;
  spotifyCatalog: SpotifyCatalog;
  recommendations: Recommendations;
  recommendationStatus = "artist";
  private searches = new Map<string, Promise<Track[]>>();
  constructor(store: Store, env: NodeJS.ProcessEnv = process.env) {
    this.store = store;
    this.key = env.YOUTUBE_API_KEY ?? "";
    this.spotifyId = env.SPOTIFY_CLIENT_ID ?? "";
    this.spotifySecret = env.SPOTIFY_CLIENT_SECRET ?? "";
    this.spotifyCatalog = new SpotifyCatalog(
      this.spotifyId,
      this.spotifySecret,
    );
    this.recommendations = new Recommendations(store, env.LASTFM_API_KEY ?? "");
  }
  async youtube<K extends keyof YouTubeResponses>(path: K, params: Record<string, string>) {
    const url = new URL("https://www.googleapis.com/youtube/v3/" + path);
    for (const [k, v] of Object.entries({ ...params, key: this.key }))
      url.searchParams.set(k, v);
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok)
      throw new UserError(
        "YouTube-søket er midlertidig utilgjengelig.",
        response.status === 403 || response.status === 429 ? 429 : 502,
      );
    return response.json() as Promise<YouTubeResponses[K]>;
  }
  async extract(args: string[], signal?: AbortSignal, priority = false) {
    return runJson<ExtractedMedia>(process.env.YTDLP_PATH ?? "yt-dlp", args, signal, priority);
  }
  async video(ids: string[], skipUnavailable = false): Promise<Track[]> {
    if (!ids.length) return [];
    if (ids.some((id) => !/^[\w-]{11}$/.test(id)))
      throw new UserError("Ugyldig video-ID.");
    const found = new Map<string, Track>(),
      missing: string[] = [];
    for (const id of ids) {
      const cached = this.store.get<{ at: number; track: Track } | null>(
        "metadata:v3:" + id,
        null,
      );
      if (cached && Date.now() - cached.at < 86400000)
        found.set(id, cached.track);
      else if (!missing.includes(id)) missing.push(id);
    }
    const remember = (track: Track) => {
      found.set(track.id, track);
      this.store.set("metadata:v3:" + track.id, { at: Date.now(), track });
    };
    for (let index = 0; index < missing.length; index += 50) {
      const batch = missing.slice(index, index + 50);
      try {
        const data = await this.youtube("videos", {
          id: batch.join(","),
          part: "snippet,contentDetails,status",
        });
        for (const v of data.items ?? []) {
          const parts = String(v.contentDetails.duration).match(
            /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/,
          );
          remember({
            id: v.id,
            genres: metadataGenres(v.snippet.description, v.snippet.tags),
            music: metadataMusic(v.snippet.categoryId),
            title: decode(v.snippet.title),
            artist: decode(v.snippet.channelTitle),
            image: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
            duration: parts
              ? Number(parts[1] ?? 0) * 3600 +
                Number(parts[2] ?? 0) * 60 +
                Number(parts[3] ?? 0)
              : 0,
            live: v.snippet.liveBroadcastContent === "live",
            embeddable: v.status.embeddable !== false,
            entryId: randomUUID(),
            source: "youtube",
          });
        }
      } catch {
        await mapLimited(batch, 3, async (id) => {
          try {
            const v = await this.extract([
              "--no-playlist",
              "--dump-single-json",
              "--skip-download",
              "--js-runtimes",
              "node",
              "https://www.youtube.com/watch?v=" + id,
            ]);
            remember({
              id,
              genres: metadataGenres(v.description, v.tags),
              music: metadataMusic(undefined, v.categories),
              title: v.title ?? "YouTube",
              artist: v.artist ?? v.uploader ?? "YouTube",
              image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
              duration: Number(v.duration) || 0,
              live: v.is_live === true,
              embeddable: v.playable_in_embed === true,
              source: "youtube",
              entryId: randomUUID(),
              ...(v.artist && v.track ? { catalog: { artist: v.artist, title: v.track, duration: Number(v.duration) || 0 } } : {}),
            });
          } catch (error) {
            if (!skipUnavailable) throw error;
          }
        });
      }
    }
    return ids
      .map((id) => found.get(id))
      .filter((t): t is Track => Boolean(t))
      .map((t) => ({ ...t, entryId: randomUUID() }));
  }
  async search(query: string, count = 8, musicOnly = false): Promise<Track[]> {
    const key =
        "search:v4:" +
        JSON.stringify([
          query.trim().normalize("NFKC").toLowerCase(),
          count,
          musicOnly,
        ]),
      cached = this.store.get<{ at: number; tracks: Track[] } | null>(
        key,
        null,
      );
    if (cached?.tracks.length && Date.now() - cached.at < 3600000)
      return cached.tracks.map((t) => ({ ...t, entryId: randomUUID() }));
    let lookup = this.searches.get(key);
    if (!lookup) {
      lookup = this.searchUncached(query, count, musicOnly).then((tracks) => {
        if (tracks.length) this.store.set(key, { at: Date.now(), tracks });
        return tracks;
      });
      // Coalesce bursts without retaining an unlimited set of distinct queries.
      if (this.searches.size < 64) this.searches.set(key, lookup);
    }
    try {
      return (await lookup).map((track) => ({
        ...track,
        entryId: randomUUID(),
      }));
    } finally {
      if (this.searches.get(key) === lookup) this.searches.delete(key);
    }
  }
  private async searchUncached(
    query: string,
    count: number,
    musicOnly: boolean,
  ): Promise<Track[]> {
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
      });
      ids = data.items.map((i) => i.id.videoId);
    } catch {
      const data = await this.extract([
        "--flat-playlist",
        "--dump-single-json",
        "--skip-download",
        `ytsearch${count}:${query}`,
      ]);
      ids = (data.entries ?? [])
        .map((t) => t?.id)
        .filter((id): id is string => typeof id === "string" && /^[\w-]{11}$/.test(id));
    }
    return this.video(ids, true);
  }
  async resolve(query: string): Promise<Track[]> {
    query = query.trim();
    if (!query || query.length > 2000)
      throw new UserError("Skriv et søk eller en gyldig musikklenke.");
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
    if (soundcloudUrl(query) || /^sc(?:search)?:/i.test(query))
      return resolveSoundcloud(
        query,
        this.store.settings().playlistLimit,
        (args) => runJson<ExtractedMedia>(process.env.YTDLP_PATH ?? "yt-dlp", args),
      );
    if (/^https?:\/\//.test(query))
      throw new UserError("Bruk en YouTube-, Spotify- eller SoundCloud-lenke.");
    const audio = /\b(live|video|konsert|concert)\b/i.test(query)
      ? query
      : query + " audio";
    const found = await this.search(audio, 5);
    if (!found[0]) throw new UserError("Ingen treff. Prøv et annet søk.");
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
      throw new UserError("Kilden tilbyr bare en forhåndsvisning.");
    if (typeof data.url !== "string" || !/^https?:\/\//.test(data.url))
      throw new UserError("Mediekilden har ingen lydstrøm.", 502);
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
        return { ...fresh, catalog: song, entryId: randomUUID() };
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
        `Fant ikke en sikker lydmatch for ${song.artist} - ${song.title}.`,
      );
    const track = { ...ranked[0].track, catalog: song, entryId: randomUUID() };
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
  async radio(seed: Track, excluded: string[]) {
    if (seed.live || seed.music === false) return null;
    const recent = this.radioHistory(),
      skipped = this.store.get<Record<string, number>>("radio-skips", {});
    const banned = new Set([
      ...excluded,
      ...recent.map((t) => t.id),
      ...Object.entries(skipped)
        .filter(([, at]) => Date.now() - at < 7 * 86400000)
        .map(([id]) => id),
    ]);
    if (this.recommendations.enabled) {
      try {
        const songs = await this.recommendations.similar(seed);
        const favorites = this.store.favorites().map((f) => normalized(f.name));
        songs.sort(
          (a, b) =>
            Number(favorites.some((f) => f.includes(normalized(b.title)))) -
            Number(favorites.some((f) => f.includes(normalized(a.title)))),
        );
        const recentSongs = new Set([
          songIdentity(seed),
          ...recent.map(songIdentity),
        ]);
        for (const song of songs.slice(0, 4)) {
          try {
            const next = await this.matchSong(song);
            if (
              canPlayRadioTrack(seed, next) &&
              rankRadio(seed, [next], recent, [...banned], true).length > 0 &&
              next.id !== seed.id &&
              !banned.has(next.id) &&
              !recentSongs.has(songIdentity(next))
            ) {
              this.recommendationStatus = "lastfm";
              return { ...next, radioRelatedTo: seed.id };
            }
          } catch {}
        }
      } catch {
        this.recommendationStatus = "fallback";
      }
    }
    if (seed.source === "soundcloud" && !seed.concert) {
      const found = await resolveSoundcloud(
        `sc:${radioArtist(seed)}`,
        5,
        (args) => runJson<ExtractedMedia>(process.env.YTDLP_PATH ?? "yt-dlp", args),
        5,
      );
      this.recommendationStatus = "soundcloud";
      return rankRadio(seed, found, recent, [...banned])[0] ?? null;
    }
    const artist = radioArtist(seed);
    if (!artist && !specificRadioGenre(seed)) return null;
    const found = await this.search(radioQuery(seed), 20, true);
    this.recommendationStatus = "artist";
    return (
      rankRadio(seed, found, recent, [...banned]).find((track) =>
        canPlayRadioTrack(seed, track),
      ) ?? null
    );
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
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
