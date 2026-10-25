"use client";
import { useEffect } from "react";
import { initializeErrorReporting } from "@/lib/error-reporting";

export function ErrorReporting() {
  useEffect(() => { void initializeErrorReporting(process.env.NEXT_PUBLIC_SENTRY_DSN, "classic"); }, []);
  return null;
}
