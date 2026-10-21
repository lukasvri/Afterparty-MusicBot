"use client";
import { useId, useState } from "react";
import { ArrowUpRight, ListPlus, Music2, Plus } from "lucide-react";
import { useLanguage } from "@/components/language";
import { CONCERT_CATALOG } from "@/lib/concert-catalog";

/** Public, curated references only. Queue resolution and permissions stay at the existing room boundary. */
export function ConcertCatalog({ busy, onEnqueue }: {
  busy: boolean;
  onEnqueue?: (ids: readonly string[]) => void;
}) {
  const { t } = useLanguage(), id = useId();
  const [selection, setSelection] = useState({ eventId: "", year: 0 });
  const events = new Map<string, string>(CONCERT_CATALOG.map(entry => [entry.eventId, entry.eventName]));
  const eventId = events.has(selection.eventId) ? selection.eventId : events.keys().next().value ?? "";
  const years = [...new Set<number>(CONCERT_CATALOG.filter(entry => entry.eventId === eventId).map(entry => entry.year))].sort((a, b) => b - a);
  const year = years.includes(selection.year) ? selection.year : years[0] ?? 0;
  const selected = CONCERT_CATALOG.filter(entry => entry.eventId === eventId && entry.year === year)
    .filter((entry, index, entries) => entries.findIndex(candidate => candidate.videoId === entry.videoId) === index);
  const unavailable = busy || !onEnqueue;
  return (
    <section className="concert-catalog" aria-labelledby={`${id}-title`} aria-busy={busy}>
      <header className="library-section-heading">
        <Music2 size={20} aria-hidden="true" />
        <h2 id={`${id}-title`}>{t("Festival concerts")}</h2>
      </header>
      <p>{t("Explore official festival uploads by event and year. Add a set or the selected year to your queue.")}</p>
      {events.size > 0 ? <>
        <div className="concert-catalog-filters">
          <div>
            <label htmlFor={`${id}-event`}>{t("Festival")}</label>
            <select id={`${id}-event`} value={eventId} onChange={event => setSelection({ eventId: event.target.value, year: 0 })}>
              {[...events].map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-year`}>{t("Year")}</label>
            <select id={`${id}-year`} value={year} onChange={event => setSelection({ eventId, year: Number(event.target.value) })}>
              {years.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
        </div>
        <div className="concert-catalog-year">
          <p role="status" aria-live="polite" aria-atomic="true">{t("{count} festival sets from {year}", { count: selected.length, year })}</p>
          {selected.length > 0 && <button type="button" className="button subtle" disabled={unavailable}
            onClick={() => onEnqueue?.(selected.map(entry => entry.videoId))}>
            <ListPlus size={16} aria-hidden="true" /> {t("Add selected year to queue")}
          </button>}
        </div>
        <ol className="concert-catalog-list" tabIndex={0} aria-labelledby={`${id}-title`}>
          {selected.map(entry => (
            <li key={entry.id}>
              <h3>{entry.artist}</h3>
              <p className="concert-set-title">{entry.title}</p>
              <p className="concert-set-source">{t("Official upload by {uploader}", { uploader: entry.uploaderName })}</p>
              <div className="concert-set-actions">
                <button type="button" className="button subtle" disabled={unavailable}
                  aria-label={t("Add festival set: {title}", { title: entry.title })} onClick={() => onEnqueue?.([entry.videoId])}>
                  <Plus size={16} aria-hidden="true" /> {t("Add set to queue")}
                </button>
                <a href={`https://www.youtube.com/watch?v=${entry.videoId}`} target="_blank" rel="noopener noreferrer">
                  {t("Official video")} <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              </div>
            </li>
          ))}
        </ol>
      </> : <p role="status">{t("No festival sets are listed yet.")}</p>}
      <p className="concert-catalog-note">{t("Video availability and browser playback depend on the uploader. Adding sets keeps your current playback and saved evenings.")}</p>
    </section>
  );
}
