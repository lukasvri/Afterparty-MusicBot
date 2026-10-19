"use client";
import { useId, useState } from "react";
import { ChevronDown, Sparkles, Bookmark, Grid3X3, ExternalLink, Trash2 } from "lucide-react";
import { REACTIONS, useConcertSocial } from "@/hooks/use-concert-social";
import { time, type Room } from "@/lib/types";

const DEFAULT_CELLS = ["Opening song", "Crowd sings along", "Guitar solo", "A favourite returns", "Hands in the air", "Acoustic moment", "Band introduction", "Encore", "Final bow"];
export function ConcertSocial({ room }: { room: Room }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!room.current || room.current.source === "soundcloud") return null;
  return <section className="concert-social" aria-label="Concert together">
    <button className="concert-social-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <span className="concert-social-icon"><Sparkles size={18} aria-hidden="true" /></span>
      <span><strong>Concert together <small>Preview</small></strong><span>Reactions, concert bingo & shared moments</span></span>
      <ChevronDown size={18} aria-hidden="true" className={open ? "is-open" : ""} />
    </button>
    <div id={id} hidden={!open}>{open && <SocialContent key={`${room.mode}:${room.guildId ?? room.code}:${room.playbackKey}`} room={room} />}</div>
  </section>;
}
function SocialContent({ room }: { room: Room }) {
  const { social, canManage, busy, error, signIn, act } = useConcertSocial(room, true);
  const [text, setText] = useState("");
  const [cells, setCells] = useState(DEFAULT_CELLS);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const disabled = busy || !social?.enabled;
  const marked = social?.bingo?.marked ?? [];
  const line = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]].some(indices => indices.every(i => marked.includes(i)));
  return <div className="concert-social-body">
    <div className="concert-social-meta"><span className="concert-social-dot" /> <span>Shared with this {room.mode === "discord" ? "concert" : "room"}</span>{canManage && social && <button className="concert-social-text-button" disabled={busy} onClick={() => void act("configure", { enabled: !social.enabled })}>{social.enabled ? "Disable extras" : "Enable extras"}</button>}</div>
    {error && <p className="concert-social-status" role="status">{error} {signIn && <a href="/api/auth/discord">Sign in with Discord</a>}</p>}
    {!room.playbackKey && <p className="concert-social-status">Waiting for a shared playback session.</p>}
    {!social && !error && room.playbackKey && <p className="concert-social-status">Joining the concert…</p>}
    {social && <>
      {!social.enabled && <p className="concert-social-status">The host has turned concert extras off.</p>}
      <div className="concert-social-reactions" role="group" aria-label="Send a live reaction">{REACTIONS.map((emoji, index) => <button key={emoji} disabled={disabled} aria-label={["Fire", "Love", "Applause", "Rock on", "Sparkle", "Celebrate"][index]} onClick={() => void act("reaction", { emoji }).then(ok => { if (ok) setNotice("Reaction sent"); })}><span aria-hidden="true">{emoji}</span><small>{social.reactions.filter(r => r.emoji === emoji).length || "React"}</small></button>)}</div>
      <div className="concert-social-columns">
        <section className="concert-social-card" aria-labelledby="concert-bingo-heading">
          <div className="concert-social-card-heading"><h3 id="concert-bingo-heading"><Grid3X3 size={16} aria-hidden="true" /> Concert bingo</h3><span>{marked.length}/9</span></div>
          <p className="concert-social-help">Watch together. The host marks each moment as it happens.</p>
          {social.bingo && !editing ? <>
            <div className="concert-bingo-grid" role="group" aria-label="Shared bingo card">{social.bingo.cells.map((cell, i) => <button key={i} aria-pressed={marked.includes(i)} disabled={disabled || !canManage || !social.bingo?.active} onClick={() => void act("bingo-mark", { cell: i })}><span className="concert-bingo-check" aria-hidden="true">{marked.includes(i) ? "✓" : String(i + 1).padStart(2, "0")}</span>{cell}</button>)}</div>
            <p className="concert-social-help">{!social.bingo.active ? "This card has ended." : line ? "Bingo! A shared line to remember." : canManage ? "Tap a square when you spot it." : "Your host is calling the moments."}</p>
          </> : !editing && <div className="concert-social-empty"><Grid3X3 size={25} aria-hidden="true" /><strong>A little more to look out for</strong><span>{canManage ? "Pick nine concert moments and start a shared card." : "Your host can start a shared concert card."}</span></div>}
          {editing && <form onSubmit={e => { e.preventDefault(); void act("bingo-start", { cells: cells.map(c => c.trim()) }).then(ok => { if (ok) setEditing(false); }); }}>
            <div className="concert-bingo-editor">{cells.map((cell, i) => <label key={i}><span>Moment {i + 1}</span><input value={cell} maxLength={60} required disabled={disabled} onChange={e => setCells(cells.map((c, j) => i === j ? e.target.value : c))} /></label>)}</div>
            <div className="concert-social-actions"><button className="concert-social-primary" disabled={disabled || cells.some(c => !c.trim()) || new Set(cells.map(c => c.trim().toLowerCase())).size !== 9}>Start card</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>
          </form>}
          {canManage && !editing && <div className="concert-social-actions"><button disabled={disabled} onClick={() => { setCells(social.bingo?.cells ?? DEFAULT_CELLS); setEditing(true); }}>{social.bingo ? "New card" : "Create card"}</button>{social.bingo?.active && <button disabled={busy} onClick={() => void act("bingo-stop")}>End card</button>}</div>}
        </section>
        <section className="concert-social-card" aria-labelledby="concert-moments-heading">
          <div className="concert-social-card-heading"><h3 id="concert-moments-heading"><Bookmark size={16} aria-hidden="true" /> Shared moments</h3><span>{social.highlights.length}</span></div>
          <p className="concert-social-help">Save the current shared timestamp with a short note. Links only, no recordings.</p>
          <form className="concert-highlight-form" onSubmit={e => { e.preventDefault(); void act("highlight", { text: text.trim() }).then(ok => { if (ok) { setText(""); setNotice("Moment saved"); } }); }}>
            <label htmlFor="concert-highlight-note">What made this moment?</label>
            <input id="concert-highlight-note" placeholder="That solo. That crowd. That feeling." value={text} maxLength={160} disabled={disabled} required onChange={e => setText(e.target.value)} />
            <button className="concert-social-primary" disabled={disabled || !text.trim()}><Bookmark size={14} aria-hidden="true" /> Save this moment</button>
          </form>
          <ul className="concert-highlight-list">{[...social.highlights].reverse().map(h => <li key={h.id}><a href={`https://www.youtube.com/watch?v=${encodeURIComponent(h.videoId)}&t=${Math.floor(h.position)}s`} target="_blank" rel="noopener noreferrer"><time>{time(h.position)}</time><span>{h.text}</span><ExternalLink size={13} aria-label="Opens in a new tab" /></a>{canManage && <button disabled={busy} aria-label={`Remove moment: ${h.text}`} onClick={() => void act("remove-highlight", { highlightId: h.id })}><Trash2 size={14} aria-hidden="true" /></button>}</li>)}</ul>
          {!social.highlights.length && <p className="concert-social-help concert-moments-empty">The best moments deserve a bookmark.</p>}
        </section>
      </div>
      <p className="concert-social-footnote" role="status">{notice || "Optional extras. Your music keeps playing."}</p>
    </>}
  </div>;
}
