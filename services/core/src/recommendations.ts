import type { Track } from "./types.ts";
import type { CatalogSong } from "./matching.ts";
import { radioArtist, radioTitle, isRadioTitle } from "./radio.ts";
import type { Store } from "./store.ts";
export class Recommendations {
  private store: Store;
  private key: string;
  private request: typeof fetch;
  constructor(store: Store, key: string, request: typeof fetch = fetch) {
    this.store = store;
    this.key = key;
    this.request = request;
  }
  get enabled() {
    return Boolean(this.key);
  }
  async similar(seed: Track): Promise<CatalogSong[]> {
    if (!this.key) return [];
    const artist = seed.catalog?.artist ?? radioArtist(seed);
    const title = radioTitle(seed);
    if (!artist || !title) return [];
    const cacheKey = "similar:v2:" + JSON.stringify([artist, title]);
    const cached = this.store.get<{ at: number; songs: CatalogSong[] } | null>(
      cacheKey,
      null,
    );
    if (cached && Date.now() - cached.at < 86400000) return cached.songs;
    const url = new URL("https://ws.audioscrobbler.com/2.0/");
    url.search = new URLSearchParams({
      method: "track.getSimilar",
      artist,
      track: title,
      autocorrect: "1",
      limit: "15",
      api_key: this.key,
      format: "json",
    }).toString();
    const r = await this.request(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error("Last.fm unavailable");
    const data = (await r.json()) as {
      error?: unknown;
      similartracks?: { track?: unknown };
    };
    if (data.error) throw new Error("Last.fm unavailable");
    const raw = data.similartracks?.track;
    const songs: CatalogSong[] = [];
    for (const item of Array.isArray(raw) ? raw : []) {
      if (!item || typeof item !== "object") continue;
      const t = item as {
        name?: unknown;
        artist?: { name?: unknown } | null;
        match?: unknown;
      };
      if (
        typeof t.name !== "string" ||
        typeof t.artist?.name !== "string" ||
        !t.name.trim() ||
        !t.artist.name.trim() ||
        !isRadioTitle(t.name)
      )
        continue;
      const similarity = Number(t.match);
      if (
        !["string", "number"].includes(typeof t.match) ||
        !Number.isFinite(similarity) ||
        similarity < 0.2 ||
        similarity > 1
      )
        continue;
      songs.push({ title: t.name, artist: t.artist.name, duration: 0 });
    }
    this.store.set(cacheKey, { at: Date.now(), songs });
    return songs;
  }
}
