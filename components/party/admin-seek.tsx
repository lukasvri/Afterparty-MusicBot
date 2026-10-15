"use client";
import { useLanguage } from "@/components/language";
import { useEffect, useState, useRef } from "react";
import { time } from "@/lib/types";
export function AdminSeek({
  trackId,
  position,
  duration,
  playing,
  disabled,
  onSeek,
}: {
  trackId: string;
  position: number;
  duration: number;
  playing: boolean;
  disabled: boolean;
  onSeek: (seconds: number) => void;
}) {
  const { t } = useLanguage();

  const [value, setValue] = useState(position),
    editing = useRef(false),
    sample = useRef({ position, at: performance.now() });
  useEffect(() => {
    sample.current = { position, at: performance.now() };
    if (!editing.current) setValue(position);
  }, [trackId, position]);
  useEffect(() => {
    editing.current = false;
  }, [trackId]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!editing.current)
        setValue(
          Math.min(
            duration,
            sample.current.position +
              (playing ? (performance.now() - sample.current.at) / 1000 : 0),
          ),
        );
    }, 500);
    return () => clearInterval(timer);
  }, [duration, playing]);
  const commit = () => {
    if (editing.current) {
      editing.current = false;
      onSeek(value);
    }
  };
  return (
    <label className="admin-seek">
      {t("Spoling")} · {time(value)} / {time(duration)}
      <input
        type="range"
        aria-label={t("Spol musikken")}
        min={0}
        max={Math.max(0, duration - 1)}
        value={value}
        disabled={disabled}
        onPointerDown={() => {
          editing.current = true;
        }}
        onChange={(e) => {
          editing.current = true;
          setValue(Number(e.target.value));
        }}
        onPointerUp={commit}
        onPointerCancel={() => {
          editing.current = false;
          setValue(position);
        }}
        onKeyUp={(e) => {
          if (
            [
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Home",
              "End",
              "PageUp",
              "PageDown",
            ].includes(e.key)
          )
            commit();
        }}
        onBlur={commit}
      />
    </label>
  );
}
