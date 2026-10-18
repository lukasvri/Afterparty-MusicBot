"use client";
import Image from "next/image";
import Link from "next/link";
import { Radio, ShieldCheck, Users } from "lucide-react";
import { useLanguage } from "./language";
export function Logo() {
  const { t } = useLanguage();
  return (
    <Link prefetch={false} target="_top" className="brand" href="/" aria-label={t("Afterparty forsiden")}>
      <span className="brand-mark" aria-hidden="true">
        <Image unoptimized width={48} height={48} src="/afterparty-mark.svg" alt="" />
      </span>
      <span>
        afterparty
        <span className="brand-dot" aria-hidden="true">
          .
        </span>
      </span>
    </Link>
  );
}
export function Sidebar({
  admin = false,
  view = "music",
  onNavigate,
}: {
  admin?: boolean;
  view?: "music" | "rooms";
  onNavigate?: (view: "music" | "rooms") => void;
}) {
  const { t } = useLanguage();
  return (
    <aside className="sidebar">
      <Logo />
      <nav aria-label={t("Hovedmeny")}>
        <Link prefetch={false} target="_top"
          className={
            !admin && view === "music" ? "nav-link active" : "nav-link"
          }
          aria-current={!admin && view === "music" ? "page" : undefined}
          href="/"
          onClick={
            onNavigate
              ? (e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  onNavigate("music");
                }
              : undefined
          }
        >
          <Radio size={17} /> {t("Musikk")}
        </Link>
        <Link prefetch={false} target="_top"
          className={
            !admin && view === "rooms" ? "nav-link active" : "nav-link"
          }
          aria-current={!admin && view === "rooms" ? "page" : undefined}
          href="/?view=rooms"
          onClick={
            onNavigate
              ? (e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  onNavigate("rooms");
                }
              : undefined
          }
        >
          <Users size={17} /> {t("Åpne rom")}
        </Link>
        <Link prefetch={false} target="_top"
          className={admin ? "nav-link active" : "nav-link"}
          aria-current={admin ? "page" : undefined}
          href="/admin"
        >
          <ShieldCheck size={17} /> Admin
        </Link>
      </nav>
    </aside>
  );
}
