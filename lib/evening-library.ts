import type { Video } from "./types";
export type Evening = {
  id: string;
  name: string;
  tracks: Video[];
  savedAt: number;
};
export type EveningLibrary = {
  version: 1;
  evenings: Evening[];
  favorites: Video[];
};
export const emptyLibrary = (): EveningLibrary => ({
  version: 1,
  evenings: [],
  favorites: [],
});
export function readLibrary(raw: string | null): EveningLibrary {
  if (!raw) return emptyLibrary();
  const data = JSON.parse(raw);
  const video = (v: Video) =>
    v &&
    typeof v.id === "string" &&
    /^[\w-]{11}$/.test(v.id) &&
    typeof v.title === "string" &&
    v.title.length <= 500 &&
    typeof v.artist === "string" &&
    typeof v.image === "string" &&
    Number.isFinite(v.duration) &&
    v.duration >= 0 &&
    typeof v.embeddable === "boolean";
  if (
    data.version !== 1 ||
    !Array.isArray(data.evenings) ||
    data.evenings.length > 30 ||
    !Array.isArray(data.favorites) ||
    data.favorites.length > 200 ||
    !data.favorites.every(video) ||
    !data.evenings.every(
      (e: Evening) =>
        typeof e.id === "string" &&
        typeof e.name === "string" &&
        e.name.length <= 80 &&
        Number.isFinite(e.savedAt) &&
        Array.isArray(e.tracks) &&
        e.tracks.length <= 50 &&
        e.tracks.every(video),
    )
  )
    throw new Error("Filen er ikke et gyldig Afterparty-bibliotek.");
  return data;
}
