"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { LiveClock } from "@/lib/live-clock";
import { isDuplicateSnapshot, isOlderSnapshot } from "@/lib/playback-sync";
import { elapsedPlayingMs, readRoomTimeline } from "@/services/core/src/protocol";
import type { Room } from "@/lib/types";

export function useLiveRoom(code: string | undefined, onRoom: (room: Room) => void) {
  const callback = useEffectEvent(onRoom);
  const fresh = useRef(false);
  const [status, setStatus] = useState<{
    code: string | undefined;
    live: boolean;
    rtt: number | null;
  }>({ code, live: false, rtt: null });
  useEffect(() => {
    fresh.current = false;
    if (!code || code === "DISCORD1") return;
    let stopped = false, expiresAt = 0;
    let source: EventSource | null = null,
      retry: ReturnType<typeof setTimeout> | undefined;
    let latest: Room | null = null;
    const update = (change: { live?: boolean; rtt?: number | null }) =>
      setStatus((previous) => {
        const next = { ...(previous.code === code ? previous : { code, live: false, rtt: null }), ...change };
        return previous.code === next.code && previous.live === next.live && previous.rtt === next.rtt
          ? previous
          : next;
      });
    const controller = new AbortController(), timing = new LiveClock();
    const clock = async () => {
      const trip = await timing.sample(controller.signal);
      if (!stopped && trip !== null) update({ rtt: trip });
    };
    const lost = () => {
      if (stopped) return;
      fresh.current = false;
      update({ live: false });
    };
    const receive = (event: MessageEvent<string>) => {
      if (stopped) return;
      try {
        const message = JSON.parse((event as MessageEvent<string>).data),
          room = message.type === "room" ? readRoomTimeline(message.room) : null;
        if (!room || room.code !== code || isOlderSnapshot(latest, room) || isDuplicateSnapshot(latest, room)) return;
        if (latest && latest.syncEpoch !== room.syncEpoch) {
          timing.reset();
          void clock();
        }
        const age = timing.age(room.serverTime, room.syncValidForMs);
        if (age >= room.syncValidForMs) {
          lost();
          return;
        }
        latest = room;
        expiresAt = performance.now() + room.syncValidForMs - age;
        fresh.current = true;
        update({ live: true });
        callback({
          ...room,
          position: room.position + (room.playing ? elapsedPlayingMs(room.serverTime, room.startsAt, age) / 1000 : 0),
          syncSampledAt: room.serverTime,
          serverTime: room.serverTime + age,
          syncValidForMs: room.syncValidForMs - age,
        });
      } catch {
        // An invalid event cannot replace the last validated timeline.
      }
    };
    const connect = () => {
      if (stopped) return;
      const stream = new EventSource("/api/realtime/stream?room=" + code);
      source = stream;
      stream.addEventListener("open", () => {
        if (!stopped && source === stream) void clock();
      });
      stream.addEventListener("message", (event) => {
        if (source === stream) receive(event);
      });
      stream.addEventListener("error", () => {
        if (stopped || source !== stream) return;
        lost();
        if (stream.readyState === EventSource.CLOSED) {
          stream.close();
          source = null;
          retry = setTimeout(connect, 10000);
        }
      });
    };
    connect();
    const measure = setInterval(() => {
      if (source) void clock();
    }, 10000);
    const watch = setInterval(() => {
      if (fresh.current && performance.now() >= expiresAt) lost();
    }, 1000);
    return () => {
      stopped = true;
      fresh.current = false;
      controller.abort();
      source?.close();
      clearTimeout(retry);
      clearInterval(measure);
      clearInterval(watch);
    };
  }, [code]);
  return { live: status.code === code && status.live, rtt: status.code === code ? status.rtt : null, fresh };
}
