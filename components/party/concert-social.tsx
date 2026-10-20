"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useLanguage } from "@/components/language";
import { ChevronDown, Sparkles, Bookmark, Grid3X3, ExternalLink, Trash2, ArrowLeft, X } from "lucide-react";
import { REACTIONS, useConcertSocial } from "@/hooks/use-concert-social";
import { time, type Room } from "@/lib/types";

type Extra = "reactions" | "bingo" | "moments";
const EXTRAS = [{ key: "reactions", label: "Live reactions", icon: Sparkles }, { key: "bingo", label: "Concert bingo", icon: Grid3X3 }, { key: "moments", label: "Shared moments", icon: Bookmark }] as const;
const DEFAULT_CELLS = ["Opening song", "Crowd sings along", "Guitar solo", "A favourite returns", "Hands in the air", "Acoustic moment", "Band introduction", "Encore", "Final bow"];
export function ConcertSocial({ room }: { room: Room }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); requestAnimationFrame(() => toggle.current?.focus()); };
  if (!room.current || room.current.source === "soundcloud") return null;
  return <section className="concert-social" aria-label={t("Games & extras")}>
    <button ref={toggle} className="concert-social-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <span className="concert-social-icon"><Sparkles size={18} aria-hidden="true" /></span>
      <span><strong>{t("Games & extras")}<small>{t("Preview")}</small></strong><span>{t("Choose an optional concert extra")}</span></span>
      <ChevronDown size={18} aria-hidden="true" className={open ? "is-open" : ""} />
    </button>
    <div id={id} hidden={!open}>{open && <SocialContent key={`${room.mode}:${room.guildId ?? room.code}`} room={room} onClose={close} />}</div>
  </section>;
}
function SocialContent({ room, onClose }: { room: Room; onClose: () => void }) {
  const { t } = useLanguage();
  const { social, canManage, busy, error, signIn, ready, reconnect, act } = useConcertSocial(room, true);
  const [selected, setSelected] = useState<Extra | null>(null);
  const choices = useRef<Partial<Record<Extra, HTMLButtonElement | null>>>({});
  const previous = useRef<Extra>("reactions");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (selected) heading.current?.focus(); else choices.current[previous.current]?.focus(); }, [selected]);
  const back = () => { setSelected(null); setEditing(false); };
  const [text, setText] = useState("");
  const [cells, setCells] = useState(() => DEFAULT_CELLS.map(c => t(c)));
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const id = useId();
  const editor = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const disabled = busy || !ready || !social?.enabled;
  const invalidCells = cells.some(c => !c.trim() || /[\u0000-\u001f\u007f]/.test(c)) || new Set(cells.map(c => c.trim().toLowerCase())).size !== 9;
  const invalidText = !text.trim() || /[\u0000-\u001f\u007f]/.test(text);
  const marked = social?.bingo?.marked ?? [];
  const line = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]].some(indices => indices.every(i => marked.includes(i)));
  return <div className="concert-social-body" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (selected) back(); else onClose(); } }}>
    <div className="concert-extras-navigation">{selected ? <button type="button" className="concert-extras-back" onClick={back}><ArrowLeft size={16} aria-hidden="true" />{t("All extras")}</button> : <h3>{t("Choose an extra")}</h3>}<button type="button" className="concert-extras-close" aria-label={t("Close extras")} onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
    {!selected && <div className="concert-extras-menu" role="group" aria-label={t("Choose an extra")}>{EXTRAS.map(({ key, label, icon: Icon }) => <button key={key} type="button" ref={el => { choices.current[key] = el; }} onClick={() => { previous.current = key; setSelected(key); }}><Icon size={20} aria-hidden="true" /><span>{t(label)}</span></button>)}</div>}
    {selected && <h3 ref={heading} tabIndex={-1} className="concert-extras-title">{t(EXTRAS.find(item => item.key === selected)!.label)}</h3>}
    <div className="concert-social-meta"><span className="concert-social-dot" /> <span>{t(room.mode === "discord" ? "Shared with this concert" : "Shared with this room")}</span>{canManage && social && <button className="concert-social-text-button" disabled={busy || !ready} onClick={() => void act("configure", { enabled: !social.enabled })}>{social.enabled ? t("Disable extras") : t("Enable extras")}</button>}</div>
    {error && <p className="concert-social-status" role="status">{t(error)} {!ready && !signIn && <button type="button" className="concert-social-text-button" onClick={reconnect}>{t("Reconnect extras")}</button>} {signIn && <a href="/api/auth/discord">{t("Sign in with Discord")}</a>}</p>}
    {!room.playbackKey && <p className="concert-social-status">{t("Waiting for a shared playback session.")}</p>}
    {!social && !error && room.playbackKey && <p className="concert-social-status">{t("Joining the concert…")}</p>}
    {social && <>
      {!social.enabled && <p className="concert-social-status">{t("The host has turned concert extras off.")}</p>}
      {selected === "reactions" && <div className="concert-social-reactions" role="group" aria-label={t("Send a live reaction")}>{REACTIONS.map((emoji, index) => <button key={emoji} disabled={disabled} aria-label={t(["Fire", "Love", "Applause", "Rock on", "Sparkle", "Celebrate"][index])} onClick={() => void act("reaction", { emoji }).then(ok => { if (ok) setNotice("Reaction sent"); })}><span aria-hidden="true">{emoji}</span><small>{social.reactions.filter(r => r.emoji === emoji).length || t("React")}</small></button>)}</div>}
      <div className="concert-social-columns is-single">
        {selected === "bingo" && <section className="concert-social-card" aria-labelledby={`${id}-bingo`}>
          <div className="concert-social-card-heading"><h3 id={`${id}-bingo`}><Grid3X3 size={16} aria-hidden="true" /> {t("Concert bingo")}</h3><span>{marked.length}{t("/9")}</span></div>
          <p className="concert-social-help">{t("Watch together. The host marks each moment as it happens.")}</p>
          {social.bingo && !editing ? <>
            <div className="concert-bingo-grid" role="group" aria-label={t("Shared bingo card")}>{social.bingo.cells.map((cell, i) => <button key={i} aria-pressed={marked.includes(i)} disabled={disabled || !canManage || !social.bingo?.active || marked.includes(i)} onClick={() => void act("bingo-mark", { cell: i })}><span className="concert-bingo-check" aria-hidden="true">{marked.includes(i) ? "✓" : String(i + 1).padStart(2, "0")}</span>{cell}</button>)}</div>
            <p className="concert-social-help">{!social.bingo.active ? t("This card has ended.") : line ? t("Bingo! A shared line to remember.") : canManage ? t("Tap a square when you spot it.") : t("Your host is calling the moments.")}</p>
          </> : !editing && <div className="concert-social-empty"><Grid3X3 size={25} aria-hidden="true" /><strong>{t("A little more to look out for")}</strong><span>{canManage ? t("Pick nine concert moments and start a shared card.") : t("Your host can start a shared concert card.")}</span></div>}
          {editing && <form onSubmit={e => { e.preventDefault(); if (disabled || invalidCells) return; void act("bingo-start", { cells: cells.map(c => c.trim()) }).then(ok => { if (ok) { setEditing(false); requestAnimationFrame(() => editButton.current?.focus()); } }); }}>
            <div className="concert-bingo-editor">{cells.map((cell, i) => <label key={i}><span>{t("Moment {number}", { number: i + 1 })}</span><input ref={i === 0 ? editor : undefined} autoFocus={i === 0} aria-describedby={invalidCells ? `${id}-bingo-error` : undefined} value={cell} maxLength={60} required disabled={disabled} onChange={e => setCells(cells.map((c, j) => i === j ? e.target.value : c))} /></label>)}</div>
            {invalidCells && <p id={`${id}-bingo-error`} className="concert-social-help" role="status">{t("Enter nine different, non-empty moments without control characters.")}</p>}
            <div className="concert-social-actions"><button className="concert-social-primary" disabled={disabled || invalidCells}>{t("Start card")}</button><button type="button" onClick={() => { setEditing(false); requestAnimationFrame(() => editButton.current?.focus()); }}>{t("Cancel")}</button></div>
          </form>}
          {canManage && !editing && <div className="concert-social-actions"><button ref={editButton} disabled={disabled} onClick={() => { setCells(social.bingo?.cells ?? DEFAULT_CELLS.map(c => t(c))); setEditing(true); }}>{social.bingo ? t("New card") : t("Create card")}</button>{social.bingo?.active && <button disabled={busy || !ready} onClick={() => void act("bingo-stop")}>{t("End card")}</button>}</div>}
        </section>}
        {selected === "moments" && <section className="concert-social-card" aria-labelledby={`${id}-moments`}>
          <div className="concert-social-card-heading"><h3 id={`${id}-moments`}><Bookmark size={16} aria-hidden="true" /> {t("Shared moments")}</h3><span>{social.highlights.length}</span></div>
          <p className="concert-social-help">{t("Save the current shared timestamp with a short note. Links only, no recordings.")}</p>
          <form className="concert-highlight-form" onSubmit={e => { e.preventDefault(); if (disabled || invalidText) return; void act("highlight", { text: text.trim() }).then(ok => { if (ok) { setText(""); setNotice("Moment saved"); } }); }}>
            <label htmlFor={`${id}-note`}>{t("What made this moment?")}</label>
            <input id={`${id}-note`} placeholder={t("That solo. That crowd. That feeling.")} value={text} maxLength={160} disabled={disabled} required onChange={e => setText(e.target.value)} />
            <button className="concert-social-primary" disabled={disabled || invalidText}><Bookmark size={14} aria-hidden="true" /> {t("Save this moment")}</button>
          </form>
          <ul className="concert-highlight-list">{[...social.highlights].reverse().map(h => <li key={h.id}><a href={`https://www.youtube.com/watch?v=${encodeURIComponent(h.videoId)}&t=${Math.floor(h.position)}s`} target="_blank" rel="noopener noreferrer"><time>{time(h.position)}</time><span>{h.text}</span><ExternalLink size={13} aria-label={t("Opens in a new tab")} /></a>{canManage && <button disabled={busy || !ready} aria-label={t("Remove moment: {text}", { text: h.text })} onClick={() => void act("remove-highlight", { highlightId: h.id })}><Trash2 size={14} aria-hidden="true" /></button>}</li>)}</ul>
          {!social.highlights.length && <p className="concert-social-help concert-moments-empty">{t("The best moments deserve a bookmark.")}</p>}
        </section>}
      </div>
      <p className="concert-social-footnote" role="status">{t(notice || "Optional extras. Your music keeps playing.")}</p>
    </>}
  </div>;
}
