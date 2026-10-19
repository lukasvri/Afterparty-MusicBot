"use client";
import { useEffect, useRef, useState } from "react";
import type { DiscordSDK } from "@discord/embedded-app-sdk";
import Afterparty from "@/app/afterparty";
import {installActivityYoutubeScripts,youtubeMappings} from "@/lib/activity-youtube";
import { openActivityVideo } from "@/lib/activity-media";
import { installActivityTransport } from "@/lib/activity-transport";
import { LoaderCircle, Radio, ShieldCheck, X } from "lucide-react";

type Session = { roomCode: string; guildId: string; expiresAt: number };
type Phase = "idle" | "configuration" | "discord" | "authorization" | "verification" | "connected" | "disconnecting" | "error";
const progress: Record<Phase, string> = {
  idle: "Connect from your Discord server to join its concert.", configuration: "Checking Activity availability…",
  discord: "Connecting to Discord…", authorization: "Waiting for Discord authorization…", verification: "Verifying your server access…",
  connected: "Connected to your server's concert.", disconnecting: "Disconnecting from the Activity…", error: "",
};
const snowflake = (value: unknown): value is string => typeof value === "string" && /^\d{14,22}$/.test(value);

export function ActivityEntry() {
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const sdkRef = useRef<DiscordSDK | null>(null);
  useEffect(() => {
    if (!attempt) return;
    let alive = true, issuedSession = false, cancelled = false;
    let sdk: DiscordSDK | null = null;
    let restore: (() => void) | undefined;
    let restoreMedia: (() => void) | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const logout = async () => {
      if (!issuedSession) return true;
      issuedSession = false;
      try { return (await fetch("/api/activity/logout", { method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(4000) })).ok; } catch { return false; }
    };
    const close = () => { controller.abort(); clearTimeout(timeout); clearTimeout(expiry); restore?.(); restore = undefined; restoreMedia?.(); restoreMedia = undefined; sdkRef.current = null; sdk?.close(1000, "Activity session ended"); sdk = null; };
    // SDK commands do not accept AbortSignal, so race them without replaying an authorization.
    const bounded = <T,>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
      const aborted = () => reject(new Error("Connection cancelled or timed out. Try connecting again."));
      if (controller.signal.aborted) { aborted(); return; }
      controller.signal.addEventListener("abort", aborted, { once: true });
      promise.then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", aborted));
    });
    cancel.current = () => {
      cancelled = true; controller.abort(); setSession(null); setPhase("disconnecting");
      void logout().then(confirmed => { close(); if (alive) { setError(confirmed ? "Connection cancelled. You can connect again when you are ready." : "Disconnected locally. Server sign-out could not be confirmed; the session will expire automatically."); setPhase("error"); } });
    };
    void (async () => {
      try {
        const configResponse = await fetch("/api/activity", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (!configResponse.ok) throw new Error("This Activity is not enabled here. Ask the server owner about the private test.");
        const config = await configResponse.json() as { enabled?: boolean; clientId?: string; state?: string };
        if (config.enabled !== true || !snowflake(config.clientId) || typeof config.state !== "string" || config.state.length < 16 || config.state.length > 512)
          throw new Error("This Activity is not available with the current configuration.");
        if (!alive || controller.signal.aborted) return;
        setPhase("discord");
        const { DiscordSDK, attemptRemap } = await bounded(import("@discord/embedded-app-sdk"));
        if (!alive || controller.signal.aborted) return;
        const parameters = new URLSearchParams(location.search);
        if (!["frame_id", "instance_id"].every(key => { const value = parameters.get(key); return value && value.length <= 256; }) || !["desktop", "mobile"].includes(parameters.get("platform") ?? ""))
          throw new Error("Open Afterparty from a Discord server. Direct-message Activities are not supported.");
        // Disable SDK console forwarding so unrelated logs never become Discord RPC payloads.
        sdk = new DiscordSDK(config.clientId, { disableConsoleLogOverride: true });
        await bounded(sdk.ready());
        const guildId = sdk.guildId;
        if (!snowflake(guildId)) throw new Error("Open Afterparty from a Discord server. Direct-message Activities are not supported.");
        setPhase("authorization");
        const authorization = await bounded(sdk.commands.authorize({ client_id: config.clientId, response_type: "code", state: config.state, prompt: "none", scope: ["identify", "guilds"] }));
        if (!alive || controller.signal.aborted) return;
        if (typeof authorization.code !== "string" || !authorization.code || authorization.code.length > 2048) throw new Error("Discord did not return a valid authorization. Try again.");
        setPhase("verification");
        const response = await fetch("/api/activity/auth", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ code: authorization.code, guildId, state: config.state }) });
        if (!response.ok) throw new Error(response.status === 403 ? "This Discord server is not eligible for the private Activity test, or your membership could not be verified." : "Your Discord authorization could not be verified. Connect again to retry.");
        issuedSession = true;
        const result = await response.json() as Session & { accessToken?: string; userId?: string };
        if (!alive || controller.signal.aborted) return;
        if (result.guildId !== guildId || !/^[A-Z0-9]{8}$/.test(result.roomCode) || !snowflake(result.userId) || typeof result.accessToken !== "string" || !result.accessToken || result.accessToken.length > 4096 || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now() || result.expiresAt > Date.now() + 86400000)
          throw new Error("The server returned an invalid Activity session. Connect again to retry.");
        const authenticated = await bounded(sdk.commands.authenticate({ access_token: result.accessToken }));
        // The server verified membership; this comparison prevents mounting a different SDK identity.
        if (!authenticated || authenticated.user.id !== result.userId) throw new Error("Discord account verification did not match. Connect again to retry.");
        if (!alive || controller.signal.aborted) return;
        clearTimeout(timeout);
        restoreMedia = installActivityYoutubeScripts(url => attemptRemap({url,mappings:youtubeMappings}));
        restore = installActivityTransport();
        const verified = { roomCode: result.roomCode, guildId: result.guildId, expiresAt: result.expiresAt };
        sdkRef.current = sdk;
        setSession(verified); setPhase("connected");
        expiry = setTimeout(() => { close(); if (alive) { setSession(null); setError("Your Activity session expired. Connect again to continue."); setPhase("error"); } }, verified.expiresAt - Date.now());
      } catch (cause) {
        if (!alive || cancelled) return;
        await logout();
        if (!alive) return;
        close(); setSession(null);
        // Never render arbitrary SDK/server error objects, codes, or credentials.
        const message = cause instanceof Error && cause.name === "Error" && /^(This Activity|Open Afterparty|Discord did not|This Discord server|Your Discord authorization|The server returned|Discord account verification|Connection cancelled)/.test(cause.message) ? cause.message : "Could not connect to Discord. Open the Activity inside Discord and try again.";
        setError(message); setPhase("error");
      }
    })();
    return () => { alive = false; cancel.current = null; close(); void logout(); };
  }, [attempt]);
  const start = () => { setError(""); setSession(null); setPhase("configuration"); setAttempt(value => value + 1); };
  const working = !["idle", "error", "connected"].includes(phase);
  return <div className="activity-root" data-activity-phase={phase}>
    {session ? <>
      <header className="activity-connected"><span><ShieldCheck size={16} aria-hidden="true" /> Discord Activity <small>Private test</small></span><button onClick={() => cancel.current?.()}><X size={16} aria-hidden="true" /> Disconnect</button></header>
      <Afterparty activityScope={{...session, openVideo: id => sdkRef.current ? openActivityVideo(sdkRef.current.commands,id) : Promise.resolve(false)}} />
    </> : <main className="activity-gate">
      <div className="activity-mark" aria-hidden="true"><Radio size={30} /></div>
      <p className="activity-eyebrow">AFTERPARTY · PRIVATE ACTIVITY TEST</p>
      <h1>Your server. One concert.</h1>
      <p className="activity-description">Join the music, react together and save the moments you want to remember.</p>
      <div className="activity-status" role="status" aria-live="polite">{working && <LoaderCircle size={18} aria-hidden="true" className="activity-spinner" />}{error || progress[phase]}</div>
      <div className="activity-gate-actions">{working ? <button disabled={phase === "disconnecting"} onClick={() => cancel.current?.()}>Cancel connection</button> : <button className="activity-connect" onClick={start}>{phase === "error" ? "Try connecting again" : "Connect with Discord"}</button>}</div>
      <p className="activity-footnote">Available only in an enabled Discord server. Audio plays in Discord. Embedded video requires the test app’s approved URL mappings.</p>
    </main>}
  </div>;
}
