"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { LiveClock } from "@/lib/live-clock";
import { acceptsLiveState, DISCORD_LIVE_LEASE_MS, readLiveState, type LiveState } from "@/lib/live-room";

/** One reconnecting stream. A transport interruption never sends a playback command. */
export function useLiveDiscord(
  onState: (state: LiveState, ageMs: number) => void,
  onDisconnect?: () => void,
  guildId?: string,
  enabled = true,
) {
  const callback = useEffectEvent(onState),
    disconnect = useEffectEvent(() => onDisconnect?.()),
    fresh = useRef(false);
  const key = guildId ?? "";
  const [status, setStatus] = useState<{
    key: string | null;
    live: boolean;
    rtt: number | null;
    phase: string;
  }>({ key: null, live: false, rtt: null, phase: "starting" });
  useEffect(() => {
    fresh.current = false;
    if (!enabled) return;
    const update = (change: Partial<typeof status>) =>
      setStatus((previous) => {
        const base = previous.key === key
          ? previous
          : { key, live: false, rtt: null, phase: "starting" };
        if (base === previous && Object.entries(change).every(([name, value]) => previous[name as keyof typeof previous] === value))
          return previous;
        return { ...base, ...change };
      });
    let stopped = false,
      expiresAt = 0,
      latest: LiveState | null = null,
      source: EventSource | null = null,
      retry: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController(), timing = new LiveClock();
    const lost = () => {
      if (!stopped && fresh.current) {
        fresh.current = false;
        update({ live: false });
        disconnect();
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
          state = message.type === "state" ? readLiveState(message.state) : null;
        if (!state || !acceptsLiveState(latest, state, guildId)) return;
        if (latest && latest.epoch !== state.epoch) {
          timing.reset();
          void clock();
        }
        const age = timing.age(state.serverTime, DISCORD_LIVE_LEASE_MS);
        if (age >= DISCORD_LIVE_LEASE_MS) {
          lost();
          return;
        }
        latest = state;
        expiresAt = performance.now() + DISCORD_LIVE_LEASE_MS - age;
        fresh.current = true;
        update({ live: true, phase: "live:http" });
        callback(state, age);
      } catch {
        update({ phase: "invalid-message" });
      }
    };
    const reconnect = () => {
      if (!stopped) retry = setTimeout(() => void connect(), 10000);
    };
    const connect = async () => {
      try {
        const response = await fetch("/api/realtime", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        });
        const value: unknown = response.ok ? await response.json() : null;
        if (stopped) return;
        if (!value || typeof value !== "object" || !("url" in value) || typeof value.url !== "string") {
          update({ phase: "polling" });
          reconnect();
          return;
        }
        const stream = new EventSource("/api/realtime/stream" + (guildId ? "?guildId=" + guildId : ""));
        source = stream;
        stream.addEventListener("open", () => {
          if (!stopped && source === stream) {
            update({ phase: "connected" });
            void clock();
          }
        });
        stream.addEventListener("message", (event) => {
          if (source === stream) receive(event);
        });
        stream.addEventListener("error", () => {
          if (stopped || source !== stream) return;
          lost();
          update({ phase: "http-reconnecting" });
          // EventSource retries interruptions itself, but a terminal HTTP failure
          // requires a new source. Keep that retry bounded and cancel it on exit.
          if (stream.readyState === EventSource.CLOSED) {
            stream.close();
            source = null;
            reconnect();
          }
        });
      } catch {
        if (!stopped) {
          update({ phase: "polling" });
          reconnect();
        }
      }
    };
    void connect();
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
      clearInterval(measure);
      clearInterval(watch);
      clearTimeout(retry);
      source?.close();
    };
  }, [guildId, key, enabled]);
  const current = enabled && status.key === key;
  return {
    live: current && status.live,
    rtt: current ? status.rtt : null,
    fresh,
    phase: !enabled ? "idle" : current ? status.phase : "starting",
    socketState: -1,
  };
}
