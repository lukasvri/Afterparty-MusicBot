"use client";
import { useEffect, useRef, useState } from "react";
import { headers } from "@/lib/browser-api";
import type { Room } from "@/lib/types";

import { validSocial as validState, type SocialAction as Action, type SocialState } from "../services/core/src/social-protocol.ts";
import { createReactionWindow } from "../lib/social-reactions.ts";
export { SOCIAL_REACTIONS as REACTIONS } from "../services/core/src/social-protocol.ts";
export type ConcertSocialState = SocialState;

/** An opt-in, independent social channel. Failed mutations are never replayed. */
export function useConcertSocial(room: Room, open: boolean) {
  const [social, setSocial] = useState<ConcertSocialState | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const [ready, setReady] = useState(false);
  const retry = useRef<(() => void) | null>(null);
  const dispatch = useRef<((action: Action, fields: Record<string, unknown>) => Promise<boolean>) | null>(null);
  const scope = room.mode === "discord" ? "guild" : "room";
  const scopeId = scope === "guild" ? room.guildId : room.code;
  const playbackKey = room.playbackKey;
  useEffect(() => {
    if (!open || !scopeId || !playbackKey) return;
    let alive = true, token = "", revision = -1, inflight = false, failures = 0, lastReaction = 0;
    let timer: ReturnType<typeof setTimeout>;
    let streamController: AbortController | null = null;
    let streaming = false, sessionEpoch = 0, available = false;
    let requestController: AbortController | null = null;
    const visible = () => document.visibilityState !== "hidden";
    const availability = (value: boolean) => { available = value; setReady(value); };
    const invalidate = () => { sessionEpoch++; availability(false); streamController?.abort(); requestController?.abort(); };
    const reactions = createReactionWindow(() => performance.now());
    const accept = (data: { social: ConcertSocialState; canManage?: boolean }) => {
      const next = data.social;
      if (!validState(next) || next.scope !== scope || next.scopeId !== scopeId || next.playbackKey !== playbackKey) throw new Error("Waiting for this concert’s latest state.");
      if (!alive || !visible() || !navigator.onLine) return;
      if (next.revision >= revision) { availability(true); revision = next.revision; setSocial(previous => ({ ...next, reactions: next.enabled ? reactions.merge(previous?.reactions ?? [], next.reactions) : [] })); setCanManage(data.canManage === true); }
    };
    const controller = new AbortController();
    const send = async (action: Action | "join" | "read", fields: Record<string, unknown> = {}): Promise<boolean> => {
      if (!alive || inflight || !navigator.onLine || !visible()) return false;
      const mutation = action !== "join" && action !== "read";
      if (mutation && !available) return false;
      const epoch = sessionEpoch;
      requestController = new AbortController();
      if (action === "reaction" && Date.now() - lastReaction < 1500) return false;
      inflight = true;
      let refresh = false;
      if (mutation) setBusy(true);
      try {
        const response = await fetch("/api/social", {
          method: "POST", headers: headers(room.code), cache: "no-store",
          signal: AbortSignal.any([controller.signal, requestController.signal, AbortSignal.timeout(8000)]),
          body: JSON.stringify({ scope, scopeId, playbackKey, action, ...(token ? { token } : {}), ...(mutation ? { eventId: crypto.randomUUID(), revision } : {}), ...fields }),
        });
        if (!alive || epoch !== sessionEpoch) return false;
        if (response.status === 401) { token = ""; invalidate(); setCanManage(false); setSignIn(scope === "guild"); setError(scope === "guild" ? "Sign in with Discord to join this concert." : "Your social session expired. Reconnecting…"); return false; }
        if (response.status === 403) { invalidate(); setCanManage(false); refresh = mutation; failures = Math.min(failures + 1, 4); setError("Your access changed. Reconnect to check your concert permissions."); return false; }
        if (response.status === 409) { refresh = mutation; availability(false); }
        if (!response.ok) throw new Error(response.status === 429 ? "The room is busy. Try again in a moment." : response.status === 409 ? "The concert changed. Refreshing the shared panel…" : response.status === 503 ? "Concert extras need a connected, updated Core." : "Concert extras are unavailable. Please try again shortly.");
        const data = await response.json() as { social: ConcertSocialState; token?: string; canManage?: boolean };
        if (!alive || epoch !== sessionEpoch) return false;
        accept(data);
        if (data.token) token = data.token;
        setError(""); setSignIn(false); failures = 0;
        if (action === "reaction") lastReaction = Date.now();
        return true;
      } catch (cause) {
        if (alive && epoch === sessionEpoch) { if (!refresh) availability(false); failures = Math.min(failures + 1, 4); setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Connection interrupted. Reconnecting…"); }
        return false;
      } finally { inflight = false; if (alive && mutation) setBusy(false); if (alive && refresh) void send("read"); }
    };
    dispatch.current = (action, fields) => token ? send(action, fields) : Promise.resolve(false);
    const poll = async () => {
      if (!alive || streaming) return;
      clearTimeout(timer);
      if (inflight) { timer = setTimeout(poll, 2000); return; }
      if (document.visibilityState === "hidden" || !navigator.onLine) return;
      if (!token && !await send("join")) { if (alive) timer = setTimeout(poll, Math.min(60000, 10000 * 2 ** failures)); return; }
      if (!alive) return;
      streaming = true;
      const epoch = sessionEpoch;
      streamController = new AbortController();
      try {
        const response = await fetch("/api/social/stream", { method: "POST", headers: headers(room.code), cache: "no-store", signal: AbortSignal.any([controller.signal, streamController.signal, AbortSignal.timeout(75000)]), body: JSON.stringify({ scope, scopeId, token, action: "stream" }) });
        if (response.status === 401) { token = ""; availability(false); setCanManage(false); }
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
              if (payload && alive && epoch === sessionEpoch && !streamController.signal.aborted) { accept(JSON.parse(payload)); setError(""); failures = 0; }
            }
          }
        } finally { await reader.cancel().catch(() => {}); }
      } catch {
        if (alive && epoch === sessionEpoch && visible() && navigator.onLine) { availability(false); await send(token ? "read" : "join"); failures = Math.min(failures + 1, 4); }
      } finally {
        streaming = false;
        if (alive && visible() && navigator.onLine) { clearTimeout(timer); timer = setTimeout(poll, failures ? Math.min(60000, 10000 * 2 ** failures) : 2000); }
      }
    };
    const reconnect = () => {
      clearTimeout(timer);
      if (!visible() || !navigator.onLine) {
        invalidate();
        setError(!navigator.onLine ? "You are offline. Concert extras will reconnect when you return." : "Concert extras are paused while this tab is hidden.");
      } else if (!streaming) { setError("Reconnecting concert extras…"); void poll(); }
    };
    retry.current = () => {
      invalidate(); clearTimeout(timer);
      setError("Reconnecting concert extras…");
      if (!streaming) void poll();
    };
    const expiry = setInterval(() => { if (alive) setSocial(previous => previous ? { ...previous, reactions: reactions.merge(previous.reactions, []) } : previous); }, 2000);
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    if (!navigator.onLine || !visible()) reconnect(); else void poll();
    return () => { alive = false; setReady(false); setCanManage(false); setSignIn(false); setError(""); controller.abort(); clearTimeout(timer); clearInterval(expiry); dispatch.current = null; retry.current = null; window.removeEventListener("online", reconnect); window.removeEventListener("offline", reconnect); document.removeEventListener("visibilitychange", reconnect); };
  }, [open, scope, scopeId, playbackKey, room.code]);
  const current = social?.scope === scope && social.scopeId === scopeId && social.playbackKey === playbackKey ? social : null;
  return { social: current, canManage, busy, error, signIn, ready: ready && Boolean(current), reconnect: () => retry.current?.(), act: (action: Action, fields: Record<string, unknown> = {}) => dispatch.current?.(action, fields) ?? Promise.resolve(false) };
}
