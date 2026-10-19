"use client";
import { useEffect, useRef, useState } from "react";
import { headers } from "@/lib/browser-api";
import type { Room } from "@/lib/types";

export const REACTIONS = ["🔥", "❤️", "👏", "🤘", "✨", "🎉"] as const;
export type ConcertSocialState = {
  scope: "room" | "guild"; scopeId: string; playbackKey: string; revision: number; enabled: boolean;
  reactions: { id: string; emoji: string; at: number }[];
  highlights: { id: string; text: string; position: number; videoId: string; at: number }[];
  bingo: { cells: string[]; marked: number[]; active: boolean } | null;
};
type Action = "reaction" | "highlight" | "remove-highlight" | "bingo-start" | "bingo-mark" | "bingo-stop" | "configure";
const validState = (s: ConcertSocialState) => s && Number.isSafeInteger(s.revision) && s.revision >= 0 && typeof s.enabled === "boolean" &&
  Array.isArray(s.reactions) && s.reactions.length <= 100 && s.reactions.every(r => typeof r.id === "string" && REACTIONS.some(e => e === r.emoji) && Number.isFinite(r.at)) &&
  Array.isArray(s.highlights) && s.highlights.length <= 100 && s.highlights.every(h => typeof h.id === "string" && typeof h.text === "string" && h.text.length <= 240 && /^[\w-]{11}$/.test(h.videoId) && Number.isFinite(h.position) && h.position >= 0 && Number.isFinite(h.at)) &&
  (s.bingo === null || (s.bingo && typeof s.bingo.active === "boolean" && Array.isArray(s.bingo.cells) && s.bingo.cells.length === 9 && s.bingo.cells.every(c => typeof c === "string" && c.length <= 80) && Array.isArray(s.bingo.marked) && s.bingo.marked.length <= 9 && s.bingo.marked.every(n => Number.isInteger(n) && n >= 0 && n < 9)));

/** An opt-in, independent social channel. Failed mutations are never replayed. */
export function useConcertSocial(room: Room, open: boolean) {
  const [social, setSocial] = useState<ConcertSocialState | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const dispatch = useRef<((action: Action, fields: Record<string, unknown>) => Promise<boolean>) | null>(null);
  const scope = room.mode === "discord" ? "guild" : "room";
  const scopeId = scope === "guild" ? room.guildId : room.code;
  const playbackKey = room.playbackKey;
  useEffect(() => {
    if (!open || !scopeId || !playbackKey) return;
    let alive = true, token = "", revision = -1, inflight = false, failures = 0, lastReaction = 0;
    let timer: ReturnType<typeof setTimeout>;
    let streamController: AbortController | null = null;
    let streaming = false;
    const receivedReactions = new Map<string, number>();
    const mergeReactions = (previous: ConcertSocialState["reactions"], next: ConcertSocialState["reactions"]) => {
      const now = performance.now();
      for (const reaction of next) if (!receivedReactions.has(reaction.id)) receivedReactions.set(reaction.id, now);
      const merged = [...new Map([...previous, ...next].filter(r => now - (receivedReactions.get(r.id) ?? -Infinity) < 6000).map(r => [r.id, r])).values()].slice(-20);
      // Retain recent seen IDs to prevent a repeated frame restarting an expired reaction.
      for (const [id, at] of receivedReactions) if (now - at > 60000) receivedReactions.delete(id);
      while (receivedReactions.size > 200) receivedReactions.delete(receivedReactions.keys().next().value!);
      return merged;
    };
    const accept = (data: { social: ConcertSocialState; canManage?: boolean }) => {
      const next = data.social;
      if (!validState(next) || next.scope !== scope || next.scopeId !== scopeId || next.playbackKey !== playbackKey) throw new Error("Waiting for this concert’s latest state.");
      if (next.revision >= revision) { revision = next.revision; setSocial(previous => ({ ...next, reactions: next.enabled ? mergeReactions(previous?.reactions ?? [], next.reactions) : [] })); setCanManage(data.canManage === true); }
    };
    const controller = new AbortController();
    const send = async (action: Action | "join" | "read", fields: Record<string, unknown> = {}): Promise<boolean> => {
      if (!alive || inflight || !navigator.onLine) return false;
      if (action === "reaction" && Date.now() - lastReaction < 1500) return false;
      inflight = true;
      let refresh = false;
      const mutation = action !== "join" && action !== "read";
      if (mutation) setBusy(true);
      try {
        const response = await fetch("/api/social", {
          method: "POST", headers: headers(room.code), cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
          body: JSON.stringify({ scope, scopeId, playbackKey, action, ...(token ? { token } : {}), ...(mutation ? { eventId: crypto.randomUUID(), revision } : {}), ...fields }),
        });
        if (!alive) return false;
        if (response.status === 401) { token = ""; setSignIn(scope === "guild"); throw new Error(scope === "guild" ? "Sign in with Discord to join this concert." : "Your social session expired. Reconnecting…"); }
        if (response.status === 409) refresh = true;
        if (!response.ok) throw new Error(response.status === 429 ? "The room is busy. Try again in a moment." : response.status === 409 ? "The concert changed. Refreshing the shared panel…" : response.status === 503 ? "Concert extras need a connected, updated Core." : "Concert extras are unavailable. Please try again shortly.");
        const data = await response.json() as { social: ConcertSocialState; token?: string; canManage?: boolean };
        if (!alive) return false;
        accept(data);
        if (data.token) token = data.token;
        setError(""); setSignIn(false); failures = 0;
        if (action === "reaction") lastReaction = Date.now();
        return true;
      } catch (cause) {
        if (alive) { failures = Math.min(failures + 1, 4); setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Connection interrupted. Reconnecting…"); }
        return false;
      } finally { inflight = false; if (alive && mutation) setBusy(false); if (alive && refresh) void send("read"); }
    };
    dispatch.current = (action, fields) => token ? send(action, fields) : Promise.resolve(false);
    const visible = () => document.visibilityState !== "hidden";
    const poll = async () => {
      if (!alive || streaming) return;
      clearTimeout(timer);
      if (inflight) { timer = setTimeout(poll, 2000); return; }
      if (document.visibilityState === "hidden" || !navigator.onLine) return;
      if (!token && !await send("join")) { if (alive) timer = setTimeout(poll, Math.min(60000, 10000 * 2 ** failures)); return; }
      if (!alive) return;
      streaming = true;
      streamController = new AbortController();
      try {
        const response = await fetch("/api/social/stream", { method: "POST", headers: headers(room.code), cache: "no-store", signal: AbortSignal.any([controller.signal, streamController.signal, AbortSignal.timeout(75000)]), body: JSON.stringify({ scope, scopeId, token, action: "stream" }) });
        if (response.status === 401) token = "";
        if (!response.ok || !response.body) throw new Error("stream unavailable");
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = "";
        try {
          while (alive) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > 65536) throw new Error("Oversize social update");
            let boundary;
            while ((boundary = buffer.indexOf("\n\n")) >= 0) {
              const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
              const payload = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
              if (payload && alive) { accept(JSON.parse(payload)); setError(""); failures = 0; }
            }
          }
        } finally { await reader.cancel().catch(() => {}); }
      } catch {
        if (alive && visible() && navigator.onLine) { await send(token ? "read" : "join"); failures = Math.min(failures + 1, 4); }
      } finally {
        streaming = false;
        if (alive && visible() && navigator.onLine) { clearTimeout(timer); timer = setTimeout(poll, failures ? Math.min(60000, 10000 * 2 ** failures) : 2000); }
      }
    };
    const reconnect = () => { clearTimeout(timer); if (document.visibilityState === "hidden" || !navigator.onLine) streamController?.abort(); else if (!streaming) void poll(); };
    const expiry = setInterval(() => { if (alive) setSocial(previous => previous ? { ...previous, reactions: mergeReactions(previous.reactions, []) } : previous); }, 2000);
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    void poll();
    return () => { alive = false; controller.abort(); clearTimeout(timer); clearInterval(expiry); dispatch.current = null; window.removeEventListener("online", reconnect); document.removeEventListener("visibilitychange", reconnect); };
  }, [open, scope, scopeId, playbackKey, room.code]);
  const current = social?.scope === scope && social.scopeId === scopeId && social.playbackKey === playbackKey ? social : null;
  return { social: current, canManage, busy, error, signIn, act: (action: Action, fields: Record<string, unknown> = {}) => dispatch.current?.(action, fields) ?? Promise.resolve(false) };
}
