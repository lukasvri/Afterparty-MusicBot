"use client";
import Image from "next/image";
import { useId, useState } from "react";
import { ListMusic, LoaderCircle, Plus, Search, X } from "lucide-react";
import { useLanguage } from "@/components/language";
import { time, type Video, type HistoryVideo } from "@/lib/types";
import { radioArtist } from "@/services/core/src/radio";
import { metadataAiGenerated } from "@/services/core/src/music-content";

type Props = {
  query: string;
  resultQuery: string;
  current: Video | null | undefined;
  history: HistoryVideo[];
  searching: boolean;
  searched: boolean;
  historySort: "recent" | "popular";
  shown: (Video | HistoryVideo)[];
  adding: boolean;
  discordMode: boolean;
  discordConnected: boolean;
  onQuery: (query: string) => void;
  onSearch: () => void;
  onPlaylist?: () => void;
  onSuggestion: (query: string) => void;
  onSort: (sort: "recent" | "popular") => void;
  onHistory: () => void;
  onAdd: (video: Video) => void;
};

/** Discovery owns its presentation; room commands remain at the room boundary. */
export function MusicDiscovery({
  query,
  resultQuery,
  current,
  history,
  searching,
  searched,
  historySort,
  shown,
  adding,
  discordMode,
  discordConnected,
  onQuery,
  onSearch,
  onPlaylist,
  onSuggestion,
  onSort,
  onHistory,
  onAdd,
}: Props) {
  const { t } = useLanguage();
  const descriptionId = useId();
  const [expanded, setExpanded] = useState({ key: "", count: 10 });
  const resultKey = resultQuery + ":" + shown.map(video => video.id).join(",");
  const visibleCount = searched && expanded.key === resultKey ? expanded.count : 10;
  const visible = searched ? shown.slice(0, visibleCount) : shown;
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().trim();
  const needle = normalize(query);
  const eligible = (video: Video) => video.aiGenerated !== true && metadataAiGenerated(video.title, video.artist) !== true;
  const suggestions = /^https?:\/\//i.test(query.trim()) ? [] : [
    ...(current && eligible(current) ? [radioArtist(current)] : []),
    ...history.filter(eligible).flatMap(video => [radioArtist(video), video.title]),
  ].filter((value, index, values) => {
    const clean = value.trim(), normalized = normalize(clean);
    return clean.length >= 2 && clean.length <= 120 && !/[\p{Cc}\p{Cf}]/u.test(clean) &&
      normalized !== needle && (!needle || normalized.includes(needle)) &&
      values.findIndex(candidate => normalize(candidate) === normalized) === index;
  }).slice(0, 4);
  return (
    <section
      id="music-content"
      role="tabpanel"
      aria-labelledby="music-tab"
      className="discovery"
      aria-busy={searching || adding}
    >
      <div className="discovery-search-tools">
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            setExpanded({ key: "", count: 10 });
            onSearch();
          }}
        >
          <input
            aria-label={t("Søk etter låt, artist eller YouTube-lenkje")}
            placeholder={t("Låt, artist eller YouTube-lenkje")}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            maxLength={2000}
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
        {onPlaylist && (
          <button className="button subtle discovery-playlist" type="button" onClick={onPlaylist}
            aria-label={t("Import playlist")} title={`YouTube / Spotify ${t("Playlist")}`}>
            <ListMusic size={18} aria-hidden="true" />
            <span>{t("Playlist")}</span>
          </button>
        )}
      </div>
      {suggestions.length > 0 && (
        <div className="search-suggestions" role="group" aria-label={t("Suggested searches")}>
          <span>{t("Suggested searches")}</span>
          <div>
            {suggestions.map(suggestion => (
              <button type="button" key={suggestion} onClick={() => { setExpanded({ key: "", count: 10 }); onSuggestion(suggestion); }}
                aria-label={t("Search for {query}", { query: suggestion })} title={suggestion}>
                <Search size={12} aria-hidden="true" />
                <span>{suggestion}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="discovery-results-header">
        {searched && <p className="search-result-query" title={resultQuery}>{t("Results for {query}", { query: resultQuery })}</p>}
        <div className="discovery-results-controls">
          <div className="search-chips" role={!searched ? "group" : undefined} aria-label={!searched ? t("Historikk") : undefined}>
            {!searched ? (
              <>
                <button
                  className={historySort === "recent" ? "selected" : ""}
                  aria-pressed={historySort === "recent"}
                  onClick={() => onSort("recent")}
                >
                  {t("Nyleg spelt")}
                </button>
                <button
                  className={historySort === "popular" ? "selected" : ""}
                  aria-pressed={historySort === "popular"}
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
          <p className="discovery-summary" role="status" aria-live="polite" aria-atomic="true">
            {adding ? t("Updating queue…") : !searching && shown.length > 0
              ? t(shown.length === 1 ? "1 track" : "{count} tracks", { count: shown.length }) : ""}
          </p>
        </div>
      </div>
      {searching ? (
        <div className="search-status" role="status">
          <LoaderCircle className="spin" size={22} /> {t("Søker …")}
        </div>
      ) : shown.length ? (
        <div className="music-list">
          {visible.map((v, index) => {
            const unavailable = discordMode && !discordConnected
              ? t("Connect the bot to a Discord voice channel before adding music.")
              : !discordMode && !v.embeddable ? t("This video cannot be played in a browser room.") : "";
            return (
            <article className="music-row" key={v.id}>
              <div className="music-art">
                <Image unoptimized width={320} height={180} src={v.image} alt="" loading="lazy" />
                <span>{v.live ? "LIVE" : time(v.duration)}</span>
              </div>
              <div className="music-copy">
                <h3 title={v.title}>{v.title}</h3>
                <p title={v.artist}>{v.artist}</p>
                {!searched && "plays" in v && (
                  <small>
                    {Number(v.plays)} {t("avspillinger")}
                  </small>
                )}
                {unavailable && <small id={`${descriptionId}-${index}`} className="music-unavailable">{unavailable}</small>}
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
                aria-describedby={unavailable ? `${descriptionId}-${index}` : undefined}
                title={
                  discordMode ? t("Legg i Discord-kø") : t("Legg i rommet")
                }
                onClick={() => onAdd(v)}
              >
                <Plus size={19} />
              </button>
            </article>
          ); })}
        </div>
      ) : (
        <div className="search-status">
          {searched
            ? t("Ingen treff. Prøv eit anna søk.")
            : t("Ingen låtar i historikken enno.")}
        </div>
      )}
      {searched && !searching && shown.length > 10 && (
        <div className="search-pagination">
          <span role="status" aria-live="polite">{t("Showing {shown} of {total}", { shown: visible.length, total: shown.length })}</span>
          <button type="button" className="button subtle" aria-disabled={visible.length >= shown.length}
            onClick={() => { if (visible.length < shown.length) setExpanded({ key: resultKey, count: visible.length + 10 }); }}>
            {visible.length < shown.length ? t("Show {count} more", { count: Math.min(10, shown.length - visible.length) }) : t("All results shown")}
          </button>
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
