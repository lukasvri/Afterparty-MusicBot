"use client";
import { useLanguage } from "@/components/language";
export function StartEvening({
  offline,
  onBrowser,
  onDiscord,
  onJoin,
}: {
  offline: boolean;
  onBrowser: () => void;
  onDiscord: () => void;
  onJoin: () => void;
}) {
  const { t } = useLanguage();

  return (
    <section className="start-evening" aria-labelledby="start-evening-title">
      <div>
        <span className="party-kicker">{t("KVELDEN STARTAR HER")}</span>
        <h2 id="start-evening-title">{t("Kor vil de høyre musikken?")}</h2>
        <p>
          {offline
            ? t(
                "Discord er ikkje tilkopla akkurat no. De kan framleis starte eit videorom.",
              )
            : t(
                "Vel kvar lyden skal spele. Inviter venene når rommet er klart.",
              )}
        </p>
      </div>
      <div className="start-options">
        <button onClick={onBrowser}>
          <strong>{t("Spel i nettlesaren")}</strong>
          <span>{t("Musikk og video her. Ingen Discord nødvendig.")}</span>
        </button>
        <button onClick={onDiscord}>
          <strong>{t("Sjå med Discord")}</strong>
          <span>
            {t(
              "Lyden i talekanalen. Videoen her. Start med /konsert i Discord.",
            )}
          </span>
        </button>
      </div>
      <button className="text-button" onClick={onJoin}>
        {t("Har du ei romlenkje? Bli med")}
      </button>
    </section>
  );
}
