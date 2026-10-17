"use client";
import Image from "next/image";
import { useLanguage } from "@/components/language";
import type { Room } from "@/lib/types";
import { time } from "@/lib/types";
export function SocialQueue({
  room,
  busy,
  onAction,
}: {
  room: Room;
  busy: boolean;
  onAction: (action: string, extra?: Record<string, unknown>) => void;
}) {
  const { t } = useLanguage();

  let wait =
    room.current && !room.current.live
      ? Math.max(0, room.current.duration - room.position)
      : 0;
  let unknown = Boolean(room.current?.live);
  const entries = [];
  for (const [i, v] of room.queue.entries()) {
    const eta = (v.waitSeconds === null || (v.waitSeconds === undefined && unknown))
      ? t("Etter direktesendinga")
      : `${room.playing ? t("Om lag") : t("Når avspelinga startar: ca.")} ${time(v.waitSeconds ?? wait)}`;
    entries.push({v, i, eta});
    wait += v.duration;
    unknown ||= v.live;
  }
  return (
    <section className="social-queue" aria-label={t("Felles spelekø")}>
      {!room.current && room.radio !== false && !!room.history?.length && room.isHost && <div className="radio-retry">
        <p>{t("Radioen fann ikkje neste låt.")}</p>
        <button disabled={busy} onClick={() => onAction("radio", { enabled: true })}>{t("Prøv radio igjen")}</button>
      </div>}
      {entries.map(({v, i, eta}) => {
        return (
          <article className="social-track" key={v.entryId ?? v.id}>
            <span className="queue-number">{i + 1}</span>
            <Image unoptimized width={48} height={48} className="queue-art" src={v.image || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" loading="lazy" />
            <div>
              <strong>{v.title}</strong>
              <small>{v.artist}</small>
              <small>
                {v.radio ? "Radio" : v.requestedBy ?? t("Gjest")} · {eta}
              </small>
            </div>
            <button
              disabled={busy}
              onClick={() => onAction("vote", { videoId: v.entryId ?? v.id })}
              aria-label={t("Stem på ") + v.title}
            >
              ♡ {room.voteCounts?.[v.entryId ?? v.id] ?? 0}
            </button>
            {room.isHost && (
              <>
                <button
                  disabled={busy || i === 0}
                  aria-label={t("Flytt opp ") + v.title}
                  onClick={() => onAction("move", { videoId: v.entryId ?? v.id, to: i - 1 })}
                >
                  ↑
                </button>
                <button
                  disabled={busy}
                  aria-label={t("Fjern ") + v.title}
                  onClick={() => onAction("remove", { videoId: v.entryId ?? v.id })}
                >
                  ×
                </button>
              </>
            )}
          </article>
        );
      })}
      {room.current && !room.isHost && (
        <button
          className="button subtle"
          disabled={busy}
          onClick={() => onAction("skip-vote")}
        >
          {t("Stem for neste låt")} · {room.skipVotes ?? 0}/3
        </button>
      )}
      {!!room.requests?.length && (
        <div>
          <h3>{t("Ventande låtønske")}</h3>
          {room.requests.map((v) => (
            <article className="social-track" key={v.entryId ?? v.id}>
              <div>
                <strong>{v.title}</strong>
                <small>Frå {v.requestedBy ?? t("Gjest")}</small>
              </div>
              {room.isHost ? (
                <>
                  <button
                    disabled={busy}
                    onClick={() => onAction("approve", { videoId: v.entryId ?? v.id })}
                  >
                    {t("Godkjenn")}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => onAction("reject", { videoId: v.entryId ?? v.id })}
                  >
                    {t("Avvis")}
                  </button>
                </>
              ) : (
                <span>{t("Ventar på verten")}</span>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function QueueSettings({room,busy,onAction}:{room:Room;busy:boolean;onAction:(action:string,extra?:Record<string,unknown>)=>void}) {
 const {t}=useLanguage();
 return (      <div className="queue-options">
      {room.isHost && room.mode !== "discord" && room.radio !== false && !room.queue.length && (room.current || !!room.history?.length) && (
        <button className="button subtle" disabled={busy} onClick={() => onAction("radio", { enabled: true })}>
          {t("Prøv radio igjen")}
        </button>
      )}
      <div className="queue-summary">

        {room.isHost && (
          <>
            <button
              className="button subtle"
              disabled={busy || !room.queue.length}
              onClick={() => {
                if (
                  confirm(t("Tømme køen? Du kan angre den siste køendringa."))
                )
                  onAction("clear");
              }}
            >
              {t("Tøm")}
            </button>
            <button className="button subtle" disabled={busy} onClick={() => onAction("undo")}>
              {t("Angre køendring")}
            </button>
          </>
        )}
      </div>
      <p className="queue-help">
        {t(
          "Stemmer viser kva gjestene ønskjer. Verten bestemmer rekkjefølgja. Tre stemmer hoppar over låta. Éi stemme per nettlesar.",
        )}
      </p>
      {room.isHost && (
        <label className="approval-choice">
          <input
            type="checkbox"
            checked={room.approvalRequired ?? false}
            disabled={busy}
            onChange={(e) =>
              onAction("approval", { enabled: e.target.checked })
            }
          />{" "}
          {t("Godkjenn gjestene sine låtønske")}
        </label>
      )}
      </div>
);
}
