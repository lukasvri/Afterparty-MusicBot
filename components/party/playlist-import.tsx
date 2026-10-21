"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useLanguage } from "@/components/language";
import type { Video } from "@/lib/types";
import { normalizePlaylistUrl } from "@/services/core/src/playlist-url";

type Job = {
  id: string;
  token?: string;
  status: "processing" | "done" | "failed" | "cancelled";
  source: "youtube" | "spotify";
  videos: Video[];
  total?: number;
  skipped: number;
  limited: boolean;
  error?: string;
};
type Capability = { id: string; token: string };
const PAGE_SIZE = 20;
const REQUEST_TIMEOUT = 15_000;
const JOB_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const JOB_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
class PlaylistError extends Error {}
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function validVideo(value: unknown): value is Video {
  if (!value || typeof value !== "object") return false;
  const video = value as Partial<Video>;
  return typeof video.id === "string" && /^[A-Za-z0-9_-]{11}$/.test(video.id) &&
    typeof video.title === "string" && video.title.length <= 1000 && typeof video.artist === "string" && video.artist.length <= 500 &&
    typeof video.image === "string" && typeof video.duration === "number" && Number.isFinite(video.duration) && video.duration >= 0 &&
    typeof video.live === "boolean" && typeof video.embeddable === "boolean";
}

/** Only provider links are rendered; job capabilities stay in component memory. */
function providerLink(input: string) {
  try { return normalizePlaylistUrl(input).url; }
  catch { /* The API supplies the actionable validation error. */ }
}

async function request(body: object, signal?: AbortSignal): Promise<Job> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT);
  const response = await fetch("/api/playlists", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const raw: unknown = await response.json();
  const data = raw && typeof raw === "object" ? raw as Partial<Job> : {};
  if (!response.ok) throw new PlaylistError(typeof data.error === "string" ? data.error : "Playlist could not be loaded. Try again.");
  if (typeof data.id !== "string" || !JOB_ID.test(data.id) ||
    (data.token !== undefined && (typeof data.token !== "string" || !JOB_TOKEN.test(data.token))) ||
    !["processing", "done", "failed", "cancelled"].includes(String(data.status)) ||
    !["youtube", "spotify"].includes(String(data.source)) || !Array.isArray(data.videos) || data.videos.length > 500 || !data.videos.every(validVideo) ||
    !count(data.skipped) || typeof data.limited !== "boolean" || (data.total !== undefined && !count(data.total)) ||
    (data.error !== undefined && (typeof data.error !== "string" || data.error.length > 1000))) throw new PlaylistError("Playlist could not be loaded. Try again.");
  return data as Job;
}
function cancelRemote(capability: Capability) {
  void request({ action: "cancel", ...capability }).catch(() => {});
}

type Props = {
  busy: boolean;
  onEnqueue?: (ids: readonly string[]) => void;
  capacity?: number;
  initialUrl?: string;
};
export function PlaylistImport(props: Props) {
  // A newly submitted discovery link replaces the preview and cancels its old job on unmount.
  return <PlaylistImportForm key={props.initialUrl ?? ""} {...props} />;
}
function PlaylistImportForm({ busy, onEnqueue, capacity = 50, initialUrl = "" }: Props) {
  const { t } = useLanguage(), id = useId();
  const [query, setQuery] = useState(initialUrl.slice(0, 2000)), [sourceUrl, setSourceUrl] = useState("");
  const [job, setJob] = useState<Job | null>(null), [loading, setLoading] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [selection, setSelection] = useState<string[]>([]), [page, setPage] = useState(0);
  const generation = useRef(0), controller = useRef<AbortController | null>(null);
  const capability = useRef<Capability | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poll = useRef<(() => void) | null>(null);
  const limit = Math.max(0, Math.min(50, Number.isFinite(capacity) ? Math.floor(capacity) : 0));
  const videos = job?.status === "done" ? job.videos.filter((video, index, all) =>
    typeof video.id === "string" && all.findIndex(candidate => candidate.id === video.id) === index) : [];
  const selected = selection.filter(value => videos.some(video => video.id === value));
  const pages = Math.max(1, Math.ceil(videos.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const shown = videos.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  function invalidate() {
    generation.current++;
    controller.current?.abort(); controller.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; poll.current = null;
    if (capability.current) cancelRemote(capability.current);
    capability.current = null;
  }
  useEffect(() => {
    function visibility() {
      if (document.hidden) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        if (capability.current) { controller.current?.abort(); controller.current = null; }
      } else poll.current?.();
    }
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("visibilitychange", visibility); invalidate(); };
  }, []);

  async function load() {
    invalidate();
    const version = generation.current;
    setJob(null); setSelection([]); setPage(0); setError(""); setNotice(""); setLoading(true);
    setSourceUrl(providerLink(query.trim()) ?? "");
    async function accept(next: Job) {
      if (version !== generation.current) {
        if (next.token) cancelRemote({ id: next.id, token: next.token });
        return;
      }
      if (next.token) capability.current = { id: next.id, token: next.token };
      setJob(next);
      if (next.status !== "processing") {
        setLoading(false); poll.current = null; capability.current = null;
        if (next.status === "failed") setError(next.error || "Playlist could not be loaded. Try again.");
        if (next.status === "cancelled") setNotice("Playlist loading cancelled.");
        return;
      }
      if (!capability.current) throw new PlaylistError("Playlist could not be loaded. Try again.");
      if (!document.hidden) timer.current = setTimeout(() => poll.current?.(), 1500);
    }
    async function run(body: { action: string; id?: string; token?: string; url?: string }) {
      const active = new AbortController(); controller.current = active;
      try {
        const next = await request(body, active.signal);
        if (active.signal.aborted || active !== controller.current) {
          if (body.action === "start" && next.token) cancelRemote({ id: next.id, token: next.token });
          return;
        }
        if (body.id && next.id !== body.id) throw new PlaylistError("Playlist could not be loaded. Try again.");
        await accept(next);
      }
      catch (caught) {
        if (version !== generation.current || active.signal.aborted) return;
        setLoading(false); poll.current = null;
        if (capability.current) cancelRemote(capability.current);
        capability.current = null;
        setError(caught instanceof Error && caught.name === "TimeoutError" ? "Playlist loading timed out. Try again." :
          caught instanceof PlaylistError ? caught.message : "Playlist could not be loaded. Try again.");
      } finally { if (controller.current === active) controller.current = null; }
    }
    poll.current = () => {
      if (version !== generation.current || document.hidden || controller.current || !capability.current) return;
      void run({ action: "read", ...capability.current });
    };
    await run({ action: "start", url: query.trim() });
  }
  return (
    <section className="playlist-import" aria-labelledby={`${id}-title`} aria-busy={loading}>
      <h2 id={`${id}-title`}>{t("Import a playlist")}</h2>
      <p>{t("Paste a YouTube or Spotify playlist link, then choose what to add to the queue.")}</p>
      <form onSubmit={event => { event.preventDefault(); void load(); }}>
        <label htmlFor={`${id}-url`}>{t("Playlist link")}</label>
        <div className="playlist-import-input">
          <input id={`${id}-url`} type="url" maxLength={2000} required value={query} placeholder="https://www.youtube.com/playlist?list=…"
            aria-describedby={`${id}-help`} onChange={event => {
              invalidate(); setQuery(event.target.value); setLoading(false); setJob(null); setSelection([]); setPage(0); setError(""); setNotice("");
            }} />
          <button className="button subtle" type="submit" disabled={!query.trim()}>{t("Load playlist")}</button>
          {loading && <button className="button subtle" type="button" onClick={() => {
            invalidate(); setLoading(false); setJob(null); setNotice("Playlist loading cancelled.");
          }}>{t("Cancel loading")}</button>}
        </div>
      </form>
      <p id={`${id}-help`} className="playlist-import-note">{t("Spotify track information is matched to available playback sources. Spotify audio is not streamed.")}</p>
      {loading && <p role="status">{t("Loading playlist…")}</p>}
      {error && <p role="alert">{t(error)}</p>}
      {notice && <p role="status">{t(notice)}</p>}
      {job?.status === "done" && <>
        <div className="playlist-import-summary">
          <p role="status">{t("{count} available tracks", { count: videos.length })}
            {typeof job.total === "number" ? ` · ${t("{count} playlist entries", { count: job.total })}` : ""}</p>
          {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{t("Open original playlist")}</a>}
        </div>
        {job.skipped > 0 && <p>{t("{count} unavailable or unmatched entries were skipped.", { count: job.skipped })}</p>}
        {job.limited && <p>{t("This is a partial preview. The source or import limit may exclude some entries.")}</p>}
        <p>{limit > 0 ? t("Select up to {count} tracks for the queue. The full preview stays available.", { count: limit }) : t("The queue is full. Make room before adding tracks.")}</p>
        {videos.length > 0 && <>
          <div className="playlist-import-actions">
            <button className="button subtle" type="button" disabled={!limit} onClick={() => setSelection(videos.slice(0, limit).map(video => video.id))}>
              {t("Select first {count}", { count: Math.min(limit, videos.length) })}</button>
            <button className="button subtle" type="button" disabled={!selected.length} onClick={() => setSelection([])}>{t("Clear selection")}</button>
            <span role="status">{t("{count} selected", { count: selected.length })}</span>
          </div>
          <ol className="playlist-import-list" start={currentPage * PAGE_SIZE + 1}>
            {shown.map(video => <li key={video.id}>
              <label><input type="checkbox" checked={selected.includes(video.id)}
                disabled={!selected.includes(video.id) && selected.length >= limit}
                onChange={event => setSelection(previous => event.target.checked ? [...previous, video.id] : previous.filter(value => value !== video.id))} />
                <span><strong>{video.title}</strong><small>{video.artist}</small></span>
              </label>
            </li>)}
          </ol>
          <nav className="playlist-import-pages" aria-label={t("Playlist pages")}>
            <button className="button subtle" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("Previous page")}</button>
            <span role="status">{t("Page {page} of {pages}", { page: currentPage + 1, pages })}</span>
            <button className="button subtle" type="button" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>{t("Next page")}</button>
          </nav>
          <button className="button subtle playlist-import-enqueue" type="button" disabled={busy || !onEnqueue || !selected.length || selected.length > limit}
            onClick={() => {
              if (busy || !onEnqueue || !selected.length || selected.length > limit) return;
              onEnqueue(selected); setSelection([]);
            }}>{t("Add {count} selected to queue", { count: selected.length })}</button>
        </>}
      </>}
    </section>
  );
}
