"use client";
import { useLanguage } from "@/components/language";
import { useEffect, useRef } from "react";
export function RoomDialog({
  mode,
  name,
  onName,
  code,
  onCode,
  isPublic,
  onPublic,
  busy,
  error,
  onClose,
  onCreate,
  onJoin,
  firstQuery,
  onFirstQuery,
}: {
  mode: "create" | "join" | null;
  name: string;
  onName: (v: string) => void;
  code: string;
  onCode: (v: string) => void;
  isPublic: boolean;
  onPublic: (v: boolean) => void;
  busy: boolean;
  error: string;
  onClose: () => void;
  onCreate: () => void;
  onJoin: (v: string) => void;
  firstQuery: string;
  onFirstQuery: (v: string) => void;
}) {
  const { t } = useLanguage();

  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mode) {
      dialog.current?.showModal();
      input.current?.focus();
    } else dialog.current?.close();
  }, [mode]);
  useEffect(() => {
    if (error && mode) input.current?.focus();
  }, [error, mode]);
  return (
    <dialog
      ref={dialog}
      className="room-dialog"
      aria-labelledby="room-dialog-title"
      aria-describedby="room-dialog-description"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <button
        className="dialog-close icon-button"
        aria-label={t("Lukk")}
        onClick={onClose}
      >
        ×
      </button>
      <h2 id="room-dialog-title">
        {mode === "create" ? t("Start kvelden") : t("Bli med i rom")}
      </h2>
      <p id="room-dialog-description">
        {mode === "create"
          ? t(
              "Spel musikk saman i nettlesaren. Du er vert, og gjestene kan ønskje låtar.",
            )
          : t("Lim inn romkoden eller lenkja du har fått.")}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === "create") onCreate();
          else {
            let value = code;
            try {
              value = new URL(code).searchParams.get("room") ?? code;
            } catch {}
            onJoin(value);
          }
        }}
      >
        <label htmlFor="room-input">
          {mode === "create"
            ? t("Namn på kvelden")
            : t("Romkode eller romlenkje")}
        </label>
        <input
          ref={input}
          id="room-input"
          autoComplete="off"
          spellCheck={false}
          required
          maxLength={mode === "create" ? 48 : 300}
          value={mode === "create" ? name : code}
          onChange={(e) =>
            mode === "create" ? onName(e.target.value) : onCode(e.target.value)
          }
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "room-dialog-error" : undefined}
        />
        {mode === "create" && (
          <>
            <label htmlFor="first-song">
              {t("Første låt eller artist (valfritt)")}
            </label>
            <input
              id="first-song"
              value={firstQuery}
              maxLength={120}
              onChange={(e) => onFirstQuery(e.target.value)}
              placeholder={t("Søk når rommet er klart …")}
            />
            <fieldset className="room-audience">
              <legend>{t("Kven skal kunne finne kvelden?")}</legend>
              <label>
                <input
                  type="radio"
                  name="audience"
                  checked={!isPublic}
                  onChange={() => onPublic(false)}
                />{" "}
                {t("Berre dei med lenkja")}
              </label>
              <label>
                <input
                  type="radio"
                  name="audience"
                  checked={isPublic}
                  onChange={() => onPublic(true)}
                />{" "}
                {t("Alle i Åpne rom")}
              </label>
            </fieldset>
          </>
        )}
        {error && (
          <p id="room-dialog-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy
            ? t("Koplar til …")
            : mode === "create"
              ? t("Opprett og finn musikk")
              : t("Bli med i rommet")}
        </button>
      </form>
      <small>
        {mode === "create"
          ? t("Ingen konto nødvendig. Rommet varer i 48 timar.")
          : t(
              "Lyd i Discord-konsertar kjem frå Discord. Eigne videorom spelar lyd her.",
            )}
      </small>
    </dialog>
  );
}
