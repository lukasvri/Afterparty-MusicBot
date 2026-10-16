"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { LiveClock } from "@/lib/live-clock";
import { readRoomTimeline } from "@/services/core/src/protocol";
import type { Room } from "@/lib/types";
export function useLiveRoom(
  code: string | undefined,
  onRoom: (room: Room) => void,
) {
  const callback = useEffectEvent(onRoom);
  const fresh = useRef(false);
  const [status, setStatus] = useState<{code: string | undefined; live: boolean; rtt: number | null}>({code, live: false, rtt: null});
  useEffect(() => {
    fresh.current = false;
    if (!code || code === "DISCORD1") return;
    let stopped = false,
      last = 0,
      latestTime = 0,
      epoch = "";
    const update = (change: {live?:boolean; rtt?:number|null}) => setStatus(previous => ({...(previous.code === code ? previous : {code, live:false, rtt:null}), ...change}));
    const controller = new AbortController(),
      timing = new LiveClock();
    const clock = async () => {
      const trip = await timing.sample(controller.signal);
      if (!stopped && trip !== null) update({rtt:trip});
    };
    const source = new EventSource("/api/realtime/stream?room=" + code);
    source.addEventListener("open", () => {
      void clock();
    });
    source.addEventListener("message", (event) => {
      try {
        const message = JSON.parse((event as MessageEvent<string>).data),
          room =
            message.type === "room" ? readRoomTimeline(message.room) : null;
        if (
          stopped ||
          !room ||
          room.code !== code ||
          (room.syncEpoch === epoch && room.serverTime < latestTime)
        )
          return;
        latestTime = room.serverTime;
        epoch = room.syncEpoch;
        last = performance.now();
        fresh.current = true;
        update({live:true});
        const age = timing.age(room.serverTime);
        const advance = room.playing
          ? Math.max(
              0,
              room.serverTime +
                age -
                Math.max(room.serverTime, room.startsAt ?? 0),
            ) / 1000
          : 0;
        callback({
          ...room,
          position: room.position + advance,
          serverTime: room.serverTime + age,
          syncValidForMs: Math.max(0, room.syncValidForMs - age),
        });
      } catch {}
    });
    source.addEventListener("error", () => {
      if (stopped) return;
      fresh.current = false;
      update({live:false});
    });
    const timer = setInterval(() => {
      if (performance.now() - last > 5000) {
        fresh.current = false;
        update({live:false});
      }
      void clock();
    }, 4000);
    return () => {
      stopped = true;
      fresh.current = false;
      controller.abort();
      source.close();
      clearInterval(timer);
    };
  }, [code]);
  return { live: status.code === code && status.live, rtt: status.code === code ? status.rtt : null, fresh };
}
