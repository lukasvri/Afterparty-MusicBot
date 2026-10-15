"use client";
import { useEffect, useRef, useState } from "react";
import { LiveClock } from "@/lib/live-clock";
import { readLiveState, type LiveState } from "@/lib/live-room";

/** One reconnecting stream. A transport interruption never sends a playback command. */
export function useLiveDiscord(
  onState: (state: LiveState, ageMs: number) => void,
  onDisconnect?: () => void,
  guildId?: string,
  enabled = true,
) {
  const callback = useRef(onState),
    disconnect = useRef(onDisconnect),
    fresh = useRef(false);
  const latest = useRef<LiveState | null>(null),
    sampleAt = useRef(0);
  callback.current = onState;
  disconnect.current = onDisconnect;
  const key = guildId ?? "";
  const [status, setStatus] = useState<{
    key: string | null;
    live: boolean;
    rtt: number | null;
    phase: string;
  }>({ key: null, live: false, rtt: null, phase: "starting" });
  useEffect(() => {
    fresh.current = false;
    latest.current = null;
    if (!enabled) return;
    const update = (change: Partial<typeof status>) =>
      setStatus((previous) => {
        const base =
          previous.key === key
            ? previous
            : { key, live: false, rtt: null, phase: "starting" };
        if (
          base === previous &&
          Object.entries(change).every(
            ([name, value]) =>
              previous[name as keyof typeof previous] === value,
          )
        )
          return previous;
        return { ...base, ...change };
      });
    let stopped = false,
      lastFrame = 0,
      source: EventSource | null = null;
    const controller = new AbortController(),
      timing = new LiveClock();
    const lost = () => {
      if (!stopped && fresh.current) {
        fresh.current = false;
        update({ live: false });
        disconnect.current?.();
      }
    };
    const clock = async () => {
      const trip = await timing.sample(controller.signal);
      if (!stopped && trip !== null) update({ rtt: trip });
    };
    const receive = (event: MessageEvent<string>) => {
      if (stopped) return;
      try {
        const message = JSON.parse(event.data),
          state =
            message.type === "state" ? readLiveState(message.state) : null;
        if (!state) return;
        const previous = latest.current;
        if (
          previous?.epoch === state.epoch &&
          previous.serverTime > state.serverTime
        )
          return;
        const age = timing.age(state.serverTime);
        lastFrame = performance.now();
        sampleAt.current = lastFrame;
        fresh.current = true;
        latest.current = {
          ...state,
          position:
            state.position +
            (state.playing && !state.buffering ? age / 1000 : 0),
        };
        update({ live: true, phase: "live:http" });
        callback.current(state, age);
      } catch {
        update({ phase: "invalid-message" });
      }
    };
    void fetch("/api/realtime", {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        if (
          stopped ||
          !value ||
          typeof value !== "object" ||
          !("url" in value) ||
          typeof value.url !== "string"
        ) {
          if (!stopped) update({ phase: "polling" });
          return;
        }
        source = new EventSource(
          "/api/realtime/stream" + (guildId ? "?guildId=" + guildId : ""),
        );
        source.addEventListener("open", () => {
          if (!stopped) {
            update({ phase: "connected" });
            void clock();
          }
        });
        source.addEventListener("message", receive);
        source.addEventListener("error", () => {
          if (!stopped) update({ phase: "http-reconnecting" });
        });
      })
      .catch(() => {
        if (!stopped) update({ phase: "polling" });
      });
    const measure = setInterval(() => {
      if (source) void clock();
    }, 10000);
    const watch = setInterval(() => {
      if (fresh.current && performance.now() - lastFrame > 7000) lost();
    }, 1000);
    return () => {
      stopped = true;
      fresh.current = false;
      controller.abort();
      clearInterval(measure);
      clearInterval(watch);
      source?.close();
    };
  }, [guildId, key, enabled]);
  const current = enabled && status.key === key;
  return {
    live: current && status.live,
    rtt: current ? status.rtt : null,
    fresh,
    latest,
    sampleAt,
    phase: !enabled ? "idle" : current ? status.phase : "starting",
    socketState: -1,
  };
}
