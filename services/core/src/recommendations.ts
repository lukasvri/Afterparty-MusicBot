import type { Track } from "./types.ts";
import type { CatalogSong } from "./matching.ts";
import { normalized } from "./matching.ts";
import { radioArtist, radioTitle } from "./radio.ts";
import { copyRadioDescriptor } from "./recommendation-ranking.ts";
import type { Store } from "./store.ts";

const POSITIVE_CACHE_MS = 86400000;
export const NEGATIVE_RADIO_CACHE_MS = 60000;
const CATALOG_LIMIT = 15;
type CatalogItem = { name?: unknown; artist?: { name?: unknown } | string | null; match?: unknown };

/** Last.fm supplies discovery metadata only. Playback still requires a safe matched recording. */
export class Recommendations {
  private store: Store;
  private key: string;
  private request: typeof fetch;
  constructor(store: Store, key: string, request: typeof fetch = fetch) {
    this.store = store;
    this.key = key;
    this.request = request;
  }
  get enabled() { return Boolean(this.key); }
  async similar(seed: Track): Promise<CatalogSong[]> {
    return this.discover("track.getSimilar", seed);
  }
  async topTracks(seed: Track): Promise<CatalogSong[]> {
    return this.discover("artist.getTopTracks", seed);
  }
  private async discover(method: "track.getSimilar" | "artist.getTopTracks", seed: Track): Promise<CatalogSong[]> {
    if (!this.key) return [];
    const artist = radioArtist(seed), title = radioTitle(seed);
    if (!artist || (method === "track.getSimilar" && !title)) return [];
    const cacheKey = "radio-catalog:v3:" + JSON.stringify([method, artist, method === "track.getSimilar" ? title : ""]);
    const cached = this.store.get<{ at: number; songs: CatalogSong[] } | null>(cacheKey, null);
    const now = Date.now();
    if (cached && Number.isFinite(cached.at) && cached.at <= now && Array.isArray(cached.songs) &&
      cached.songs.length <= CATALOG_LIMIT && cached.songs.every(song => copyRadioDescriptor(song) !== null) &&
      now - cached.at < (cached.songs.length ? POSITIVE_CACHE_MS : NEGATIVE_RADIO_CACHE_MS)) {
      return cached.songs.map(song => copyRadioDescriptor(song)!);
    }
    const url = new URL("https://ws.audioscrobbler.com/2.0/");
    url.search = new URLSearchParams({ method, artist,
      ...(method === "track.getSimilar" ? { track: title } : {}),
      autocorrect: "1", limit: String(CATALOG_LIMIT), api_key: this.key, format: "json",
    }).toString();
    const response = await this.request(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Last.fm unavailable");
    const data = await response.json() as { error?: unknown; similartracks?: { track?: unknown }; toptracks?: { track?: unknown } };
    if (!data || data.error) throw new Error("Last.fm unavailable");
    const raw = method === "track.getSimilar" ? data.similartracks?.track : data.toptracks?.track;
    if (!Array.isArray(raw)) throw new Error("Last.fm invalid response");
    const songs: CatalogSong[] = [], identities = new Set<string>();
    for (const item of raw.slice(0, CATALOG_LIMIT)) {
      if (!item || typeof item !== "object") continue;
      const track = item as CatalogItem;
      const namedArtist = typeof track.artist === "string" ? track.artist : track.artist?.name;
      const candidateArtist = namedArtist === undefined && method === "artist.getTopTracks" ? artist : namedArtist;
      const song = copyRadioDescriptor({ title: track.name, artist: candidateArtist, duration: 0 });
      if (!song) continue;
      if (method === "track.getSimilar") {
        const similarity = Number(track.match);
        if (!["string", "number"].includes(typeof track.match) || !Number.isFinite(similarity) || similarity < 0.2 || similarity > 1) continue;
      } else if (normalized(song.artist) !== normalized(artist)) continue;
      const identity = JSON.stringify([normalized(song.artist), normalized(song.title)]);
      if (identities.has(identity)) continue;
      identities.add(identity); songs.push(song);
    }
    this.store.set(cacheKey, { at: Date.now(), songs });
    return songs.map(song => ({ ...song }));
  }
}
