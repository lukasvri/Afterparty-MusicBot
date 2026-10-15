"use client";
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
  return (
    <section className="social-queue" aria-label={t("Felles spelekø")}>
      <div className="queue-summary">
        <span>{room.queue.length} låtar i kø</span>
        {room.isHost && (
          <>
            <button
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
            <button disabled={busy} onClick={() => onAction("undo")}>
              {t("Angre køendring")}
            </button>
          </>
        )}
      </div>
      {room.queue.map((v, i) => {
        const eta = unknown
          ? t("Etter direktesendinga")
          : `${room.playing ? t("Om lag") : t("Når avspelinga startar: ca.")} ${time(wait)}`;
        wait += v.duration;
        unknown ||= v.live;
        return (
          <article className="social-track" key={v.id}>
            <span className="queue-number">{i + 1}</span>
            <div>
              <strong>{v.title}</strong>
              <small>
                {v.requestedBy ?? t("Gjest")} · {eta}
              </small>
            </div>
            <button
              disabled={busy}
              onClick={() => onAction("vote", { videoId: v.id })}
              aria-label={t("Stem på ") + v.title}
            >
              ♡ {room.voteCounts?.[v.id] ?? 0}
            </button>
            {room.isHost && (
              <>
                <button
                  disabled={busy || i === 0}
                  aria-label={t("Flytt opp ") + v.title}
                  onClick={() => onAction("move", { videoId: v.id, to: i - 1 })}
                >
                  ↑
                </button>
                <button
                  disabled={busy}
                  aria-label={t("Fjern ") + v.title}
                  onClick={() => onAction("remove", { videoId: v.id })}
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
          Stem for neste låt · {room.skipVotes ?? 0}/3
        </button>
      )}
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
      {!!room.requests?.length && (
        <div>
          <h3>{t("Ventande låtønske")}</h3>
          {room.requests.map((v) => (
            <article className="social-track" key={v.id}>
              <div>
                <strong>{v.title}</strong>
                <small>Frå {v.requestedBy ?? t("Gjest")}</small>
              </div>
              {room.isHost ? (
                <>
                  <button
                    disabled={busy}
                    onClick={() => onAction("approve", { videoId: v.id })}
                  >
                    {t("Godkjenn")}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => onAction("reject", { videoId: v.id })}
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
