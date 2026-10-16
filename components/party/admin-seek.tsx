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
    [editing, setEditing] = useState(false),
    sample = useRef({ position, at: 0 });
  const [previous, setPrevious] = useState({trackId, position});
  if(previous.trackId !== trackId || previous.position !== position){
    setPrevious({trackId, position});
    if(previous.trackId !== trackId){setEditing(false);setValue(position);}
    else if(!editing) setValue(position);
  }
  useEffect(() => {
    sample.current = { position, at: performance.now() };
  }, [trackId, position]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!editing)
        setValue(
          Math.min(
            duration,
            sample.current.position +
              (playing ? (performance.now() - sample.current.at) / 1000 : 0),
          ),
        );
    }, 500);
    return () => clearInterval(timer);
  }, [duration, playing, editing]);
  const commit = () => {
    if (editing) {
      setEditing(false);
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
          setEditing(true);
        }}
        onChange={(e) => {
          setEditing(true);
          setValue(Number(e.target.value));
        }}
        onPointerUp={commit}
        onPointerCancel={() => {
          setEditing(false);
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
