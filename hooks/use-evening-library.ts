"use client";
import { useEffect, useState } from "react";
import { browserStorage } from "@/lib/browser-storage";
import {
  emptyLibrary,
  readLibrary,
  type EveningLibrary,
} from "@/lib/evening-library";
import type { Video } from "@/lib/types";
export function useEveningLibrary() {
  const [library, setLibrary] = useState<EveningLibrary>(emptyLibrary),
    [error, setError] = useState("");
  useEffect(() => {
    try {
      setLibrary(readLibrary(browserStorage.get("afterparty-library-v1")));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  function update(next: EveningLibrary) {
    setLibrary(next);
    setError(
      browserStorage.set("afterparty-library-v1", JSON.stringify(next))
        ? ""
        : "Nettleseren blokkerer lagring. Last ned biblioteket før du lukker siden.",
    );
  }
  return {
    library,
    error,
    update,
    favorite(video: Video) {
      const exists = library.favorites.some((v) => v.id === video.id);
      update({
        ...library,
        favorites: exists
          ? library.favorites.filter((v) => v.id !== video.id)
          : [video, ...library.favorites].slice(0, 200),
      });
    },
    save(name: string, tracks: Video[]) {
      update({
        ...library,
        evenings: [
          {
            id: crypto.randomUUID(),
            name: name.trim().slice(0, 80) || "Kvelden vår",
            tracks: tracks.filter((v) => /^[\w-]{11}$/.test(v.id)).slice(0, 50),
            savedAt: Date.now(),
          },
          ...library.evenings,
        ].slice(0, 30),
      });
    },
    import(raw: string) {
      update(readLibrary(raw));
    },
  };
}
