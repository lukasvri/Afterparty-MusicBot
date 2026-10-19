"use client";
import { TrackArtwork } from "@/components/track-artwork";
import { LoaderCircle, Plus, Search, X } from "lucide-react";
import { useLanguage } from "@/components/language";
import { time, type Video, type HistoryVideo } from "@/lib/types";

type Props = {
  query: string;
  searching: boolean;
  searched: boolean;
  historySort: "recent" | "popular";
  shown: (Video | HistoryVideo)[];
  adding: boolean;
  discordMode: boolean;
  discordConnected: boolean;
  onQuery: (query: string) => void;
  onSearch: () => void;
  onSort: (sort: "recent" | "popular") => void;
  onHistory: () => void;
  onAdd: (video: Video) => void;
};

/** Discovery owns its presentation; room commands remain at the room boundary. */
export function MusicDiscovery({
  query,
  searching,
  searched,
  historySort,
  shown,
  adding,
  discordMode,
  discordConnected,
  onQuery,
  onSearch,
  onSort,
  onHistory,
  onAdd,
}: Props) {
  const { t } = useLanguage();
  return (
    <section
      id="music-content"
      role="tabpanel"
      aria-labelledby="music-tab"
      className="discovery"
    >
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
      >
        <input
          aria-label={t("Søk etter låt, artist eller YouTube-lenkje")}
          placeholder={t("Låt, artist eller YouTube-lenkje")}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          maxLength={120}
          minLength={2}
          required
        />
        <button
          className="button primary"
          aria-label={t("Søk etter musikk")}
          disabled={searching}
        >
          {searching ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Search size={17} />
          )}
        </button>
      </form>
      <div className="search-chips">
        {!searched ? (
          <>
            <button
              className={historySort === "recent" ? "selected" : ""}
              onClick={() => onSort("recent")}
            >
              {t("Nyleg spelt")}
            </button>
            <button
              className={historySort === "popular" ? "selected" : ""}
              onClick={() => onSort("popular")}
            >
              {t("Mest spelt")}
            </button>
          </>
        ) : (
          <button onClick={onHistory}>
            {t("Historikk")} <X size={12} />
          </button>
        )}
      </div>
      {searching ? (
        <div className="search-status" role="status">
          <LoaderCircle className="spin" size={22} /> {t("Søker …")}
        </div>
      ) : shown.length ? (
        <div className="music-list">
          {shown.map((v) => (
            <article className="music-row" key={v.id}>
              <div className="music-art">
                <TrackArtwork width={320} height={180} video={v} alt="" loading="lazy" />
                <span>{v.live ? "LIVE" : time(v.duration)}</span>
              </div>
              <div className="music-copy">
                <h3>{v.title}</h3>
                <p>{v.artist}</p>
                {!searched && "plays" in v && (
                  <small>
                    {Number(v.plays)} {t("avspillinger")}
                  </small>
                )}
              </div>
              <button
                className="icon-button add-track"
                disabled={
                  adding ||
                  (!discordMode && !v.embeddable) ||
                  (discordMode && !discordConnected)
                }
                aria-label={
                  discordMode
                    ? t("addDiscord", { title: v.title })
                    : t("addRoom", { title: v.title })
                }
                title={
                  discordMode ? t("Legg i Discord-kø") : t("Legg i rommet")
                }
                onClick={() => onAdd(v)}
              >
                <Plus size={19} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="search-status">
          {searched
            ? t("Ingen treff. Prøv eit anna søk.")
            : t("Ingen låtar i historikken enno.")}
        </div>
      )}
      <p className="library-note">
        {discordMode
          ? !discordConnected
            ? t("Start /konsert i ein talekanal i Discord.")
            : t("Konsertar spelar i Discord og blir viste her.")
          : t("Låtar blir lagde i dette rommet.")}
      </p>
    </section>
  );
}
