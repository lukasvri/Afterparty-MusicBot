"use client";
import { ArrowUpRight, Play, Radio, ArrowRight } from "lucide-react";
import { useLanguage } from "@/components/language";
import { ConcertScenery } from "@/components/concert-scenery";
import releases from "@/lib/releases.json";

export function StartEvening({ offline, onBrowser, onDiscord, onJoin }: {
  offline: boolean; onBrowser: () => void; onDiscord: () => void; onJoin: () => void;
}) {
  const { language, t } = useLanguage();
  const en = language === "en";
  return <section className="start-evening" aria-labelledby="start-evening-title">
    <a className="welcome-release" href="/patch-notes"><span>V{releases[0].version}</span> {en ? "What’s new" : "Siste oppdatering"}<span className="release-link">Patch notes <ArrowUpRight size={15}/></span></a>
    <div className="welcome-hero">
      <div className="welcome-copy">
        <span className="party-kicker">{en ? "YOUR SHARED MUSIC ROOM" : "EIT FELLES MUSIKKROM"}</span>
        <h1 id="start-evening-title">Afterparty</h1>
        <p>{en ? "Play music and video together in a shared room." : "Spel musikk og video saman i eit felles rom."}</p>
        <button className="button primary welcome-start" onClick={onBrowser}><Play size={18} fill="currentColor"/>{t("Spel i nettlesaren")}<ArrowRight size={18}/></button>
        <span className="welcome-reassurance">{en ? "Start a private room without an account." : "Start eit privat rom utan konto."}</span>
        <button className="welcome-join" onClick={onJoin}>{t("Har du ei romlenkje? Bli med")} <ArrowUpRight size={16}/></button>
      </div>
      <div className="welcome-art"><ConcertScenery/></div>
    </div>
    <div className="welcome-bottom">
      <button className="welcome-discord" onClick={onDiscord}><Radio size={22}/><span><strong>{t("Sjå med Discord")}</strong><small>{en ? "Voice-channel audio, video here. Start with /konsert." : "Lyden i talekanalen, videoen her. Start med /konsert."}</small></span><ArrowUpRight size={20}/></button>
    </div>
    {offline && <p className="welcome-offline" role="status">{t("Discord er ikkje tilkopla akkurat no. De kan framleis starte eit videorom.")}</p>}
  </section>;
}
