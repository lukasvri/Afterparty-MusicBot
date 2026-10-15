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
  const generation = useRef(0),
    pending = useRef(false),
    serial = useRef(0);
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
  useEffect(() => {
    generation.current++;
    pending.current = false;
    setBusy(false);
    setData(null);
    setError("");
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
      generation.current++;
      clearTimeout(timer);
    };
  }, [guildId, refresh]);
  const action = async (name: string, extra: Record<string, unknown> = {}) => {
    if (!guildId || !data || pending.current) return;
    const g = generation.current,
      id = ++serial.current;
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
    }
  };
  return { data, error, busy, action };
}
