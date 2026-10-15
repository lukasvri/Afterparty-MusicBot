"use client";
import { useEffect, useRef, useState } from "react";
import { LiveClock } from "@/lib/live-clock";
import { readRoomTimeline } from "@/services/core/src/protocol";
import type { Room } from "@/lib/types";
export function useLiveRoom(
  code: string | undefined,
  onRoom: (room: Room) => void,
) {
  const callback = useRef(onRoom);
  callback.current = onRoom;
  const fresh = useRef(false);
  const [live, setLive] = useState(false),
    [rtt, setRtt] = useState<number | null>(null);
  useEffect(() => {
    fresh.current = false;
    setLive(false);
    setRtt(null);
    if (!code || code === "DISCORD1") return;
    let stopped = false,
      last = 0,
      latestTime = 0,
      epoch = "";
    const controller = new AbortController(),
      timing = new LiveClock();
    const clock = async () => {
      const trip = await timing.sample(controller.signal);
      if (!stopped && trip !== null) setRtt(trip);
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
        setLive(true);
        const age = timing.age(room.serverTime);
        const advance = room.playing
          ? Math.max(
              0,
              room.serverTime +
                age -
                Math.max(room.serverTime, room.startsAt ?? 0),
            ) / 1000
          : 0;
        callback.current({
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
      setLive(false);
    });
    const timer = setInterval(() => {
      if (performance.now() - last > 5000) {
        fresh.current = false;
        setLive(false);
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
  return { live, rtt, fresh };
}
