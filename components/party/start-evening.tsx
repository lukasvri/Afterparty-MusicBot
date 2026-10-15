"use client";
import { ArrowUpRight, Play, Radio, Users, ListMusic, Monitor, ArrowRight } from "lucide-react";
import { useLanguage } from "@/components/language";
import { ConcertScenery } from "@/components/concert-scenery";
import releases from "@/lib/releases.json";

export function StartEvening({ offline, onBrowser, onDiscord, onJoin }: {
  offline: boolean; onBrowser: () => void; onDiscord: () => void; onJoin: () => void;
}) {
  const { language, t } = useLanguage();
  const en = language === "en";
  return <section className="start-evening" aria-labelledby="start-evening-title">
    <a className="welcome-release" href="/patch-notes"><span>V{releases[0].version}</span> {en ? "New night. New Afterparty." : "Ny kveld. Ny Afterparty."}<span className="release-link">Patch notes <ArrowUpRight size={15}/></span></a>
    <div className="welcome-hero">
      <div className="welcome-copy">
        <span className="party-kicker">GUTTA KRUTT AFTERPARTY</span>
        <h1 id="start-evening-title">{en ? "Good friends." : "Gode vener."}<br/><span>{en ? "One more song." : "Éin låt til."}</span></h1>
        <p>{en ? "Bring your people. Build the queue together. Keep the night going, wherever you are." : "Samle gjengen. Fyll køa saman. La kvelden vare litt lenger, same kvar de er."}</p>
        <button className="button primary welcome-start" onClick={onBrowser}><Play size={18} fill="currentColor"/>{t("Spel i nettlesaren")}<ArrowRight size={18}/></button>
        <span className="welcome-reassurance">{en ? "No account. A private room. Your music." : "Ingen konto. Eit privat rom. Dykkar musikk."}</span>
        <button className="welcome-join" onClick={onJoin}>{t("Har du ei romlenkje? Bli med")} <ArrowUpRight size={16}/></button>
      </div>
      <div className="welcome-art"><ConcertScenery/><span className="welcome-stage-label"><span className="tiny-dot"/>{en ? "THE STAGE IS YOURS" : "SCENA ER DYKKAR"}</span></div>
    </div>
    <div className="welcome-bottom">
      <div className="welcome-steps" aria-label={en ? "How it works" : "Slik fungerer det"}>
        <div><Users size={20}/><span><strong>{en ? "Bring your people" : "Inviter gjengen"}</strong><small>{en ? "One link or a QR code." : "Ei lenkje eller ein QR-kode."}</small></span></div>
        <div><ListMusic size={20}/><span><strong>{en ? "Make it your night" : "Set tonen saman"}</strong><small>{en ? "Suggest songs. Vote. Save the queue." : "Ønsk låtar. Stem. Lagre køa."}</small></span></div>
        <div><Monitor size={20}/><span><strong>{en ? "Go big" : "Ta scena til TV-en"}</strong><small>{en ? "TV view. Music on every screen." : "TV-visning for dei store kveldane."}</small></span></div>
      </div>
      <button className="welcome-discord" onClick={onDiscord}><Radio size={22}/><span><strong>{t("Sjå med Discord")}</strong><small>{en ? "Voice-channel audio, video here. Start with /konsert." : "Lyden i talekanalen, videoen her. Start med /konsert."}</small></span><ArrowUpRight size={20}/></button>
    </div>
    {offline && <p className="welcome-offline" role="status">{t("Discord er ikkje tilkopla akkurat no. De kan framleis starte eit videorom.")}</p>}
  </section>;
}
