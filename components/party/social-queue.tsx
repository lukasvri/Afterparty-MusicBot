"use client";
import Image from "next/image";
import { ArrowDown, ArrowUp, Check, Heart, SkipForward, Trash2, Undo2, X } from "lucide-react";
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
    <section className="social-queue" aria-label={t("Felles spelekø")} aria-busy={busy}>
      {!room.current && room.mode !== "discord" && room.radio !== false && !!room.history?.length && room.isHost && <div className="radio-retry">
        <p>{t("Radioen fann ikkje neste låt.")}</p>
        <button disabled={busy} onClick={() => onAction("radio", { enabled: true })}>{t("Prøv radio igjen")}</button>
      </div>}
      {entries.map(({v, i, eta}) => {
        return (
          <article className="afterparty-queue-track" key={v.entryId ?? v.id}>
            <span className="queue-number">{i + 1}</span>
            <Image unoptimized width={48} height={48} className="queue-art" src={v.image || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" loading="lazy" />
            <div className="queue-track-copy">
              <strong>{v.title}</strong>
              <small>{v.artist}</small>
              <small>
                {v.radio ? "Radio" : v.requestedBy ?? t("Gjest")} · {eta}
              </small>
            </div>
            <button
              className="queue-vote"
              disabled={busy}
              onClick={() => onAction("vote", { videoId: v.entryId ?? v.id })}
              aria-label={t("Stem på ") + v.title}
            >
              <Heart size={16} aria-hidden="true" /> <span>{room.voteCounts?.[v.entryId ?? v.id] ?? 0}</span>
            </button>
            {room.isHost && (
              <>
                <button
                  className="queue-move-up"
                  disabled={busy || i === 0}
                  aria-label={t("Flytt opp ") + v.title}
                  onClick={() => onAction("move", { videoId: v.entryId ?? v.id, to: i - 1 })}
                >
                  <ArrowUp size={16} aria-hidden="true" />
                </button>
                <button
                  className="queue-move-down"
                  disabled={busy || i === entries.length - 1}
                  aria-label={t("Move down {title}", { title: v.title })}
                  onClick={() => onAction("move", { videoId: v.entryId ?? v.id, to: i + 1 })}
                >
                  <ArrowDown size={16} aria-hidden="true" />
                </button>
                <button
                  className="queue-remove"
                  disabled={busy}
                  aria-label={t("Fjern ") + v.title}
                  onClick={() => onAction("remove", { videoId: v.entryId ?? v.id })}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </>
            )}
          </article>
        );
      })}
      {room.mode !== "discord" && room.radio === true && (
        <p className="queue-help">{t("Radio finds related songs and avoids recent repeats.")}</p>
      )}
      {room.current && !room.isHost && (
        <button
          className="button subtle"
          disabled={busy}
          onClick={() => onAction("skip-vote")}
        >
          <SkipForward size={16} aria-hidden="true" />
          {t("Stem for neste låt")} · {room.skipVotes ?? 0}/3
        </button>
      )}
      {!!room.requests?.length && (
        <div className="queue-requests">
          <h3>{t("Ventande låtønske")}</h3>
          {room.requests.map((v) => (
            <article className="afterparty-queue-track queue-request" key={v.entryId ?? v.id}>
              <div className="queue-track-copy">
                <strong>{v.title}</strong>
                <small>{t("Frå")} {v.requestedBy ?? t("Gjest")}</small>
              </div>
              {room.isHost ? (
                <>
                  <button
                    className="queue-approve"
                    disabled={busy}
                    aria-label={t("Approve {title}", { title: v.title })}
                    onClick={() => onAction("approve", { videoId: v.entryId ?? v.id })}
                  >
                    <Check size={16} aria-hidden="true" />
                    {t("Godkjenn")}
                  </button>
                  <button
                    className="queue-reject"
                    disabled={busy}
                    aria-label={t("Reject {title}", { title: v.title })}
                    onClick={() => onAction("reject", { videoId: v.entryId ?? v.id })}
                  >
                    <X size={16} aria-hidden="true" />
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
              <Trash2 size={16} aria-hidden="true" />
              {t("Tøm")}
            </button>
            <button className="button subtle" disabled={busy} onClick={() => onAction("undo")}>
              <Undo2 size={16} aria-hidden="true" />
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
