"use client";
import { useLanguage } from "@/components/language";
import { useState } from "react";
import type { Video } from "@/lib/types";
import { useEveningLibrary } from "@/hooks/use-evening-library";
import { uniqueEveningTracks } from "@/lib/evening-library";
export function EveningLibrary({
  tracks,
  history,
  onAdd,
  onRestore,
  busy,
}: {
  tracks: Video[];
  history: Video[];
  onAdd: (v: Video) => void;
  onRestore: (v: Video[]) => void;
  busy: boolean;
}) {
  const { t } = useLanguage();

  const shelf = useEveningLibrary(),
    [name, setName] = useState(t("Kvelden vår")),
    [message, setMessage] = useState("");
  const favoriteIds = new Set(shelf.library.favorites.map(video => video.id));
  const downloadable = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(shelf.library, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "afterparty-library.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="evening-library" aria-label={t("Kveldane våre")}>
      <h2>{t("Kveldane våre")}</h2>
      <p>
        {t(
          "Favorittar og sett lagrast på denne eininga. Last ned ei kopi for å ta dei med vidare.",
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          shelf.save(name, tracks);
          setMessage(t("Kvelden er lagra."));
        }}
      >
        <label>
          {t("Namn på kvelden")}
          <input
            value={name}
            maxLength={80}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="button primary" disabled={!tracks.length}>
          {t("Lagre spelekøen")}
        </button>
        <button
          type="button"
          className="button subtle"
          disabled={!history.length}
          onClick={() => {
            shelf.save(name, history);
            setMessage(t("Kvelden er lagra."));
          }}
        >
          {t("Lagre kveldshistorikken")}
        </button>
      </form>
      {(shelf.error || message) && (
        <p role="status">{shelf.error || message}</p>
      )}
      <div className="library-transfer">
        <button className="button subtle" onClick={downloadable}>
          {t("Last ned bibliotek")}
        </button>
        <label className="button subtle">
          {t("Importer bibliotek")}
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                if (file.size > 1000000) throw Error(t("Filen er for stor."));
                if (
                  !confirm(
                    t(
                      "Erstatte biblioteket på denne eininga? Last ned ei kopi først om du vil behalde det.",
                    ),
                  )
                )
                  return;
                shelf.import(await file.text());
                setMessage(t("Biblioteket er importert."));
              } catch (error) {
                setMessage((error as Error).message);
              }
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {shelf.library.evenings.map((evening) => (
        <details key={evening.id}>
          <summary>
            {evening.name} · {evening.tracks.length} låtar
          </summary>
          <label>
            {t("Namn")}
            <input
              value={evening.name}
              maxLength={80}
              onChange={(e) =>
                shelf.update({
                  ...shelf.library,
                  evenings: shelf.library.evenings.map((x) =>
                    x.id === evening.id ? { ...x, name: e.target.value } : x,
                  ),
                })
              }
            />
          </label>
          <button
            className="button primary"
            disabled={busy || !evening.tracks.length}
            onClick={() => onRestore(evening.tracks)}
          >
            {t("Legg settet i kø")}
          </button>
          <button
            className="button subtle"
            onClick={() => {
              if (confirm(t("Slette denne lagra kvelden?")))
                shelf.update({
                  ...shelf.library,
                  evenings: shelf.library.evenings.filter(
                    (x) => x.id !== evening.id,
                  ),
                });
            }}
          >
            {t("Slett kvelden")}
          </button>
          <ol>
            {evening.tracks.map((v, i) => (
              <li key={v.id + i}>
                <span>{v.title}</span>
                <button
                  aria-label={t("Flytt opp ") + v.title}
                  disabled={i === 0}
                  onClick={() => {
                    const next = [...evening.tracks];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    shelf.update({
                      ...shelf.library,
                      evenings: shelf.library.evenings.map((x) =>
                        x.id === evening.id ? { ...x, tracks: next } : x,
                      ),
                    });
                  }}
                >
                  ↑
                </button>
                <button
                  aria-label={t("Fjern ") + v.title}
                  onClick={() =>
                    shelf.update({
                      ...shelf.library,
                      evenings: shelf.library.evenings.map((x) =>
                        x.id === evening.id
                          ? { ...x, tracks: x.tracks.filter((_, n) => n !== i) }
                          : x,
                      ),
                    })
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        </details>
      ))}
      <h3>{t("Favorittar")}</h3>
      {!shelf.library.favorites.length && (
        <p>
          {t("Merk ei låt frå køen eller kveldshistorikken med eit hjarte.")}
        </p>
      )}
      {shelf.library.favorites.map((v) => (
        <div className="saved-track" key={v.id}>
          <span>{v.title}</span>
          <button
            disabled={busy}
            onClick={() => onAdd(v)}
            aria-label={t("Legg til ") + v.title}
          >
            ＋
          </button>
          <button
            onClick={() => shelf.favorite(v)}
            aria-label={t("Fjern favoritt ") + v.title}
          >
            ♥
          </button>
        </div>
      ))}
      <h3>{t("Denne kvelden")}</h3>
      {uniqueEveningTracks(history, tracks)
        .map((v) => (
          <div className="saved-track" key={v.id}>
            <span>{v.title}</span>
            <button
              onClick={() => shelf.favorite(v)}
              aria-label={t("Favoritt ") + v.title}
              aria-pressed={favoriteIds.has(v.id)}
            >
              {favoriteIds.has(v.id) ? "♥" : "♡"}
            </button>
          </div>
        ))}
    </section>
  );
}
