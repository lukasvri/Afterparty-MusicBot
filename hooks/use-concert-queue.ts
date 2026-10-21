"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { headers, request } from "@/lib/browser-api";
import type { Room } from "@/lib/types";
type QueueState = Pick<Room, "queue" | "requests" | "approvalRequired" | "voteCounts" | "skipVotes"> & { revision: string };
type QueueData = { state: QueueState; canManage: boolean };
type Session = { guildId: string; serial: number; pending: boolean; controller: AbortController; actionDone: Promise<boolean> };
type View = { guildId: string | undefined; data: QueueData | null; busy: boolean; error: string; errorKind?: "poll" | "action" };
const initial = (guildId: string | undefined): View => ({ guildId, data: null, busy: false, error: "" });
const unavailable = "Konsertkøen er ikkje tilgjengeleg.";

export function useConcertQueue(guildId: string | undefined) {
  const [view, setView] = useState<View>(() => initial(guildId));
  const session = useRef<Session | null>(null);
  // Clear the old server's controls before the new server can be painted.
  if (view.guildId !== guildId) setView(initial(guildId));
  const current = useCallback((target: Session) => session.current === target && !target.controller.signal.aborted, []);
  const update = useCallback((target: Session, change: (previous: View) => View) => {
    if (current(target)) setView(previous => current(target) && previous.guildId === target.guildId ? change(previous) : previous);
  }, [current]);
  const refresh = useCallback(async (target: Session, clearActionError = false) => {
    if (!current(target)) return;
    const id = ++target.serial;
    try {
      const result = await request<QueueData>("/api/discord/queue?guildId=" + target.guildId, {
        headers: headers(), signal: AbortSignal.any([target.controller.signal, AbortSignal.timeout(12000)]),
      });
      if (id === target.serial) update(target, previous => ({ ...previous, data: result,
        ...(previous.errorKind !== "action" || clearActionError ? { error: "", errorKind: undefined } : {}),
      }));
    } catch {
      if (id === target.serial) update(target, previous => previous.errorKind === "action" ? previous : { ...previous, error: unavailable, errorKind: "poll" });
    }
  }, [current, update]);
  useEffect(() => {
    if (!guildId) return;
    const target: Session = { guildId, serial: 0, pending: false, controller: new AbortController(), actionDone: Promise.resolve(true) };
    session.current = target;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!target.pending) await refresh(target);
      if (current(target)) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      target.controller.abort(); clearTimeout(timer);
      if (session.current === target) session.current = null;
    };
  }, [guildId, current, refresh]);
  const reload = async () => {
    const target = session.current;
    if (!target || target.guildId !== guildId) return;
    // A pending mutation owns the revision until its response has been applied.
    const succeeded = target.pending ? await target.actionDone : true;
    if (current(target)) await refresh(target, succeeded);
  };
  const action = async (name: string, extra: Record<string, unknown> = {}) => {
    const target = session.current;
    if (!target || target.guildId !== guildId || !view.data || view.guildId !== guildId || target.pending) return;
    const id = ++target.serial;
    let complete: (succeeded: boolean) => void = () => {};
    let succeeded = false;
    target.actionDone = new Promise<boolean>(resolve => { complete = resolve; });
    target.pending = true;
    update(target, previous => ({ ...previous, busy: true, error: "", errorKind: undefined }));
    try {
      const result = await request<QueueData>("/api/discord/queue", {
        method: "POST", headers: headers(),
        signal: AbortSignal.any([target.controller.signal, AbortSignal.timeout(12000)]),
        body: JSON.stringify({ ...extra, guildId: target.guildId, action: name, revision: view.data.state.revision }),
      });
      succeeded = true;
      if (id === target.serial) update(target, previous => ({ ...previous, data: result }));
    } catch (error) {
      if (current(target)) {
        update(target, previous => ({ ...previous, error: error instanceof Error ? error.message : unavailable, errorKind: "action" }));
        await refresh(target);
      }
    } finally {
      target.pending = false;
      update(target, previous => ({ ...previous, busy: false }));
      complete(succeeded);
    }
  };
  return { data: view.data, error: view.error, busy: view.busy, action, reload };
}
