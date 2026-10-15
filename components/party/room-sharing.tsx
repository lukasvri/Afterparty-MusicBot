"use client";
import { useLanguage } from "@/components/language";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { browserStorage } from "@/lib/browser-storage";
import type { Room } from "@/lib/types";
export function RoomSharing({
  room,
  tv,
  onTV,
  onManage,
}: {
  room: Room;
  tv: boolean;
  onTV: () => void;
  onManage: (action: string) => Promise<string | undefined>;
}) {
  const { t } = useLanguage();

  const [url, setUrl] = useState(""),
    [qr, setQr] = useState(""),
    [message, setMessage] = useState(""),
    [invite, setInvite] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setInvite("");
    setMessage("");
    setUrl(`${location.origin}/?room=${room.code}`);
  }, [room.code]);
  useEffect(() => {
    let stopped = false;
    if (url)
      void QRCode.toDataURL(url, {
        width: 180,
        margin: 2,
        color: { dark: "#111111", light: "#ffffff" },
      })
        .then((value) => {
          if (!stopped) setQr(value);
        })
        .catch(() =>
          setMessage(t("QR-koden kunne ikkje lagast. Bruk lenkja.")),
        );
    return () => {
      stopped = true;
    };
  }, [url]);
  async function manage(action: string) {
    if (busy) return;
    if (
      action === "transfer-invite" &&
      !confirm(
        t(
          "Lag ei eingongslenkje som overfører eigarskapen når mottakaren opnar henne? Du mistar vertstilgangen.",
        ),
      )
    )
      return;
    if (
      action === "revoke-hosts" &&
      !confirm(t("Fjerne alle medvertar og ubrukte invitasjonar?"))
    )
      return;
    setBusy(true);
    try {
      const token = await onManage(action);
      setInvite(token ? `${url}#host=${token}` : "");
      setMessage(
        action === "revoke-hosts"
          ? t("Medvertar og invitasjonar er fjerna.")
          : t("Del denne private eingongslenkja med mottakaren."),
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={"room-sharing" + (tv ? " tv-invite" : "")}
      aria-label={t("Del kvelden")}
    >
      <div>
        {qr && (
          <img
            src={qr}
            width={180}
            height={180}
            alt={t("QR-kode for å bli med i rommet")}
          />
        )}
        <strong>{tv ? t("Skann og ønsk ei låt") : t("Inviter venene")}</strong>
        <label className="share-url">
          {t("Romlenkje")}
          <input readOnly value={url} onFocus={(e) => e.target.select()} />
        </label>
        <button
          className="button subtle"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setMessage(t("Romlenkja er kopiert."));
            } catch {
              setMessage(t("Marker og kopier romlenkja frå feltet."));
            }
          }}
        >
          {t("Kopier lenkje")}
        </button>
        <button className="button subtle" onClick={onTV}>
          {tv ? t("Avslutt TV-modus") : t("Vis på TV")}
        </button>
      </div>
      {!tv && room.isHost && (
        <button
          className="button subtle"
          onClick={() => {
            const token = browserStorage.get(`afterparty-host:${room.code}`);
            if (!token) return;
            const blob = URL.createObjectURL(
              new Blob([`${url}#access=${token}`], { type: "text/plain" }),
            );
            const a = document.createElement("a");
            a.href = blob;
            a.download = "afterparty-private-host-link.txt";
            a.click();
            URL.revokeObjectURL(blob);
            setMessage(
              t(
                "Privat vertslenkje lasta ned. Alle med denne lenkja får din tilgang. Oppbevar henne trygt.",
              ),
            );
          }}
        >
          {t("Last ned privat vertslenkje")}
        </button>
      )}
      {!tv && room.isOwner && (
        <details>
          <summary>{t("Vertar og tilgang")}</summary>
          <p>
            {t(
              "Medvertar kan styre musikk og kø. Berre eigaren kan dele tilgang. Invitasjonane kan brukast éin gong.",
            )}
          </p>
          <button
            className="button subtle"
            disabled={busy}
            onClick={() => void manage("invite")}
          >
            {t("Inviter medvert")}
          </button>
          <button
            className="button subtle"
            disabled={busy}
            onClick={() => void manage("transfer-invite")}
          >
            {t("Overfør eigarskap")}
          </button>
          <button
            className="button subtle"
            disabled={busy}
            onClick={() => void manage("revoke-hosts")}
          >
            {t("Fjern medvertar")}
          </button>
          {invite && (
            <label>
              {t("Privat invitasjonslenkje")}
              <input
                value={invite}
                readOnly
                onFocus={(e) => e.target.select()}
              />
            </label>
          )}
        </details>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
