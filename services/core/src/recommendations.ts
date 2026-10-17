import type { Track } from "./types.ts";
import type { CatalogSong } from "./matching.ts";
import { normalized } from "./matching.ts";
import { radioArtist, radioTitle, isRadioTitle } from "./radio.ts";
import type { Store } from "./store.ts";

const POSITIVE_CACHE_MS = 86400000;
export const NEGATIVE_RADIO_CACHE_MS = 60000;
const CATALOG_LIMIT = 15;
type CatalogItem = { name?: unknown; artist?: { name?: unknown } | string | null; match?: unknown };
const validSong = (song: CatalogSong) => song && typeof song.title === "string" &&
  typeof song.artist === "string" && Boolean(song.title.trim() && song.artist.trim()) &&
  isRadioTitle(song.title) && Number.isFinite(song.duration) && song.duration >= 0;

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
      cached.songs.length <= CATALOG_LIMIT && cached.songs.every(validSong) &&
      now - cached.at < (cached.songs.length ? POSITIVE_CACHE_MS : NEGATIVE_RADIO_CACHE_MS)) {
      return cached.songs.map(song => ({ ...song }));
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
    const songs: CatalogSong[] = [];
    for (const item of raw.slice(0, CATALOG_LIMIT)) {
      if (!item || typeof item !== "object") continue;
      const track = item as CatalogItem;
      const namedArtist = typeof track.artist === "string" ? track.artist : track.artist?.name;
      const candidateArtist = namedArtist === undefined && method === "artist.getTopTracks" ? artist : namedArtist;
      if (typeof track.name !== "string" || typeof candidateArtist !== "string" ||
        !track.name.trim() || !candidateArtist.trim() || !isRadioTitle(track.name)) continue;
      if (method === "track.getSimilar") {
        const similarity = Number(track.match);
        if (!["string", "number"].includes(typeof track.match) || !Number.isFinite(similarity) || similarity < 0.2 || similarity > 1) continue;
      } else if (normalized(candidateArtist) !== normalized(artist)) continue;
      songs.push({ title: track.name, artist: candidateArtist, duration: 0 });
    }
    this.store.set(cacheKey, { at: Date.now(), songs });
    return songs.map(song => ({ ...song }));
  }
}
