"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { headers, request } from "@/lib/browser-api";
import type { Room } from "@/lib/types";
type QueueState = Pick<
  Room,
  "queue" | "requests" | "approvalRequired" | "voteCounts" | "skipVotes"
> & {
  revision: string;
};
export function useConcertQueue(guildId: string | undefined) {
  const [data, setData] = useState<{
      state: QueueState;
      canManage: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [previousGuild, setPreviousGuild] = useState(guildId);
  if(previousGuild !== guildId){setPreviousGuild(guildId);setBusy(false);setData(null);setError("");}
  const generation = useRef(0),
    pending = useRef(false),
    serial = useRef(0),
    actionDone = useRef(Promise.resolve(true));
  const invalidate = useCallback(() => { generation.current++; }, []);
  const refresh = useCallback(async () => {
    if (!guildId) return;
    const g = generation.current,
      id = ++serial.current;
    const result = await request<{
      state: QueueState;
      canManage: boolean;
    }>("/api/discord/queue?guildId=" + guildId, { headers: headers() });
    if (g === generation.current && id === serial.current) setData(result);
  }, [guildId]);
  const reload = async () => {
    const g = generation.current;
    // Preserve the newer mutation response before reading another snapshot.
    const actionSucceeded = pending.current ? await actionDone.current : true;
    if (g !== generation.current) return;
    const id = serial.current + 1;
    try {
      await refresh();
      if (actionSucceeded && g === generation.current && id === serial.current) setError("");
    } catch {
      if (actionSucceeded && g === generation.current && id === serial.current) setError("Konsertkøen er ikkje tilgjengeleg.");
    }
  };
  useEffect(() => {
    invalidate();
    pending.current = false;
    if (!guildId) return;
    let stopped = false;
    const update = async () => {
      try {
        if (!pending.current) await refresh();
      } catch {
        if (!stopped) setError("Konsertkøen er ikkje tilgjengeleg.");
      }
      if (!stopped) timer = setTimeout(update, 3000);
    };
    let timer: ReturnType<typeof setTimeout>;
    void update();
    return () => {
      stopped = true;
      invalidate();
      clearTimeout(timer);
    };
  }, [guildId, refresh, invalidate]);
  const action = async (name: string, extra: Record<string, unknown> = {}) => {
    if (!guildId || !data || pending.current) return;
    const g = generation.current,
      id = ++serial.current;
    let complete: (succeeded: boolean) => void = () => {};
    let succeeded = false;
    actionDone.current = new Promise<boolean>(resolve => { complete = resolve; });
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await request<{
        state: QueueState;
        canManage: boolean;
      }>("/api/discord/queue", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          guildId,
          action: name,
          revision: data.state.revision,
          ...extra,
        }),
      });
      succeeded = true;
      if (g === generation.current && id === serial.current) setData(result);
    } catch (e) {
      if (g === generation.current) {
        setError((e as Error).message);
        await refresh().catch(() => {});
      }
    } finally {
      if (g === generation.current) {
        pending.current = false;
        setBusy(false);
      }
      complete(succeeded);
    }
  };
  return { data, error, busy, action, reload };
}
