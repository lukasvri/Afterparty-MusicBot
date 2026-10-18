"use client";
import Image from "next/image";
import Link from "next/link";
import { useClientReady } from "@/hooks/use-browser-value";
import { AdminSeek } from "@/components/party/admin-seek";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ShieldCheck,
  LoaderCircle,
  LogOut,
  Play,
  Pause,
  SkipForward,
  Square,
  Shuffle,
  Plus,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { useLanguage, LanguageSwitch } from "@/components/language";
import { Sidebar } from "@/components/afterparty-navigation";
import type { DiscordState, Room } from "@/lib/types";
import "./settings.css";
type Guild = { id: string; name: string; roomCode: string; installed: boolean };
type Job = {
  id: string;
  status: string;
  result?: string;
  payload: { action: string };
};
type Detail = {
  audio?: {missedFrames?:number;maxConsecutiveMissedFrames?:number;interruptions:number;maxInterruptionMs:number;buffering:boolean;events:{at:number;reason:string;durationMs:number}[]};
  performance?: {eventLoopP95Ms:number;eventLoopMaxMs:number};
  guildId: string;
  roomCode: string;
  state: DiscordState;
  settings: Record<string, number | boolean>;
  player: {
    loopCurrentSong: boolean;
    loopCurrentQueue: boolean;
    bitrate: number;
    radioProvider: string;
    radioError?: string;
    lastfmConfigured: boolean;
  };
  snapshots: Array<{ id: string; name: string; songCount: number }>;
  commands: Job[];
  sleepTimerEndsAt: number | null;
};
async function api<T>(
  url: string,
  method = "GET",
  input?: unknown,
): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
    signal: AbortSignal.timeout(35000),
  });
  const d = (await r.json()) as T & {error?: string};
  if (!r.ok) throw Error(d.error ?? "Tjenesten svarer ikke.");
  return d;
}
type SettingField = {key: string; label: string; help: string; min?: number; max?: number; toggle?: boolean};
const settingGroups: {title: string; description: string; fields: SettingField[]}[] = [
  {title: "Audio playback", description: "Playback defaults for this Discord server.", fields: [
    {key: "defaultVolume", label: "Default volume", min: 0, max: 100, help: "0–100%. Current playback volume has its own control."},
    {key: "audioBitrateKbps", label: "Audio bitrate", min: 64, max: 384, help: "64–384 kbit/s. Applies at the next playback start, capped by the voice channel."},
    {key: "crossfade", label: "Crossfade", min: 0, max: 12, help: "0–12 seconds between tracks. Set 0 to turn crossfade off."},
    {key: "radio", label: "Radio when the queue is empty", toggle: true, help: "Prepare related music when the manual queue runs out."},
  ]},
  {title: "Voice and listeners", description: "Connection behavior and volume while people speak.", fields: [
    {key: "secondsToWaitAfterQueueEmpties", label: "Wait after the queue empties", min: 0, max: 86400, help: "0–86400 seconds. Set 0 to stay connected indefinitely after the queue ends."},
    {key: "leaveIfNoListeners", label: "Leave when no listeners remain", toggle: true, help: "Disconnect when everyone else leaves the voice channel."},
    {key: "turnDownVolumeWhenPeopleSpeak", label: "Lower volume while people speak", toggle: true, help: "Voice detection is enabled when joining. Reconnect after changing this option."},
    {key: "turnDownVolumeWhenPeopleSpeakTarget", label: "Volume while people speak", min: 0, max: 100, help: "0–100%. Used while voice volume reduction is enabled."},
  ]},
  {title: "Queue and playlists", description: "Import limits and the Discord queue display.", fields: [
    {key: "playlistLimit", label: "Playlist limit", min: 1, max: 1000, help: "1–1000 tracks imported from a playlist."},
    {key: "defaultQueuePageSize", label: "Tracks per queue page", min: 1, max: 30, help: "1–30 tracks shown by the Discord queue command."},
  ]},
];
export default function Admin() {
  const { t, language } = useLanguage();
  const [authenticated, setAuthenticated] = useState(false),
    [checking, setChecking] = useState(true),
    [guilds, setGuilds] = useState<Guild[]>([]),
    [guildId, setGuildId] = useState(""),
    [invite, setInvite] = useState(""),
    [password, setPassword] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("player"),
    [query, setQuery] = useState(""),
    [volume, setVolume] = useState(60),
    [settings, setSettings] = useState<Record<string, number | boolean>>({}),
    [settingsError, setSettingsError] = useState(""),
    [settingsNotice, setSettingsNotice] = useState(""),
    [snapshotName, setSnapshotName] = useState(""),
    [minutes, setMinutes] = useState(30),
    [channels, setChannels] = useState<
      Array<{ id: string; name: string; voice: boolean }>
    >([]),
    [channelId, setChannelId] = useState("");
  const [globalAdmin, setGlobalAdmin] = useState(false),
    [rooms, setRooms] = useState<Room[]>([]);
  const volumeDirty = useRef(false);
  const requestedGuild = useRef("");
  const generation = useRef(0),
    refreshing = useRef(false),
    alive = useRef(true),
    actionBusy = useRef(false);
  const selected = guilds.find((g) => g.id === guildId);
  function loadGuilds() {
      const requested = new URLSearchParams(location.search).get("guildId");
      if (requested && /^\d{14,22}$/.test(requested)) requestedGuild.current = requested;
      return api<{
        authenticated: boolean;
        globalAdmin: boolean;
        guilds: Guild[];
        invite: string;
      }>("/api/admin/guilds").then(r => {
      if (!alive.current) return;
      setAuthenticated(r.authenticated);
      setGlobalAdmin(r.globalAdmin);
      setGuilds(r.guilds);
      setInvite(r.invite);
      setGuildId((previous) =>
        r.guilds.some((g) => g.id === (previous || requestedGuild.current))
          ? (previous || requestedGuild.current)
          : (r.guilds.find((g) => g.installed)?.id ?? r.guilds[0]?.id ?? ""),
      );
    }, e => {
      if(alive.current) setError((e as Error).message);
    }).finally(() => { if(alive.current) setChecking(false); });
  }
  const refresh = useCallback((id = guildId) => {
    if (!id || refreshing.current) return;
    const version = generation.current;
    refreshing.current = true;
    return api<Detail>("/api/admin/control?guildId=" + id).then(r => {
      if (alive.current && version === generation.current) {
        setDetail(r);
        if (!volumeDirty.current) setVolume(r.state.volume);
        setError("");
      }
    }, e => {
      if (alive.current && version === generation.current) setError((e as Error).message);
    }).finally(() => { refreshing.current = false; });
  }, [guildId]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const clientReady = useClientReady();
  const [checkedLogin, setCheckedLogin] = useState(false);
  if(clientReady && !checkedLogin){
    setCheckedLogin(true);
    if(new URLSearchParams(location.search).has("login")) setError("Discord-innloggingen kunne ikke fullføres. Kontroller appoppsettet og prøv igjen.");
  }
  useEffect(() => {
    alive.current = true;
    void loadGuilds();
    return () => {
      alive.current = false;
      invalidate();
    };
  }, [invalidate]);
  const scope = `${authenticated}:${guildId}:${selected?.installed}`;
  const [previousScope, setPreviousScope] = useState(scope);
  if(previousScope !== scope){
    setPreviousScope(scope);
    setDetail(null);
    setChannels([]);
    setChannelId("");
    setSettings({});
    setSettingsError("");
    setSettingsNotice("");
  }
  useEffect(() => {
    invalidate();
    volumeDirty.current = false;
    if (!authenticated || !selected?.installed) return;
    void refresh();
    const t = setInterval(() => {
      if (!document.hidden && !actionBusy.current) void refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [authenticated, guildId, selected?.installed, refresh, invalidate]);
  const settingsKey = `${tab}:${guildId}:${detail?.guildId ?? ""}`;
  const [previousSettingsKey, setPreviousSettingsKey] = useState(settingsKey);
  if(previousSettingsKey !== settingsKey){
    setPreviousSettingsKey(settingsKey);
    if(tab === "settings" && detail?.guildId === guildId) setSettings(detail.settings);
  }
  async function control(
    operation: string,
    extra: Record<string, unknown> = {},
  ) {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setBusy(true);
    setError("");
    const id = guildId,
      version = generation.current;
    try {
      const result = await api<{id: string; status: string; settings?: Record<string, number | boolean>; channels?: Array<{id: string; name: string; voice: boolean}>}>("/api/admin/control", "POST", {
        guildId: id,
        operation,
        ...extra,
      });
      if (operation === "command") {
        const until = performance.now() + 35000;
        let status = result.status;
        while (status === "processing" && performance.now() < until) {
          await new Promise((r) => setTimeout(r, 500));
          const read = await api<Detail>("/api/admin/control?guildId=" + id);
          const job = read.commands.find((j) => j.id === result.id);
          status = job?.status ?? "processing";
          if (job && ["failed", "unknown"].includes(job.status))
            throw Error(job.result ?? "Handlingen mislyktes.");
        }
        if (status !== "done")
          throw Error(
            "Boten har ikke bekreftet handlingen. Sjekk køen før du prøver igjen.",
          );
      }
      if (version === generation.current) {
        if (operation === "settings") {
          const keys = settingGroups.flatMap(group => group.fields.map(field => field.key));
          if (!result.settings || keys.some(key => result.settings![key] !== (extra.settings as Record<string, unknown>)[key]))
            throw Error("The server did not confirm these settings. Reload and check before trying again.");
          setSettings(Object.fromEntries(keys.map(key => [key, result.settings![key]])));
          setSettingsNotice("Settings saved for {server}.");
        } else setNotice(operation === "command" ? "Utført." : "Lagret.");
        await refresh(id);
      }
      return result;
    } catch (e) {
      if (version === generation.current) {
        if (operation === "settings") setSettingsError((e as Error).message);
        else setError((e as Error).message);
      }
    } finally {
      actionBusy.current = false;
      setBusy(false);
    }
  }
  const command = (action: string, extra: Record<string, unknown> = {}) =>
    control("command", {
      commandId: crypto.randomUUID(),
      command: { action, queueRevision: detail?.state.queueRevision, ...extra },
    });
  function loadRooms() {
    return api<{rooms: Room[]}>("/api/admin/rooms").then(r => {
      if(alive.current) setRooms(r.rooms);
    }, e => { if(alive.current) setError((e as Error).message); });
  }
  useEffect(() => {
    if (tab === "rooms" && globalAdmin) void loadRooms();
  }, [tab, globalAdmin]);
  async function closeRoom(code: string) {
    if (!confirm(t("Avslutte dette videorommet for alle?"))) return;
    try {
      await api("/api/admin/rooms", "DELETE", { code });
      await loadRooms();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function login() {
    setBusy(true);
    try {
      await api("/api/admin/session", "POST", { password });
      setPassword("");
      await loadGuilds();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      const result = await api<{ redirect: string }>(
        "/api/admin/session",
        "DELETE",
        {},
      );
      location.assign(result.redirect);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function readChannels() {
    try {
      const result = await control("channels");
      if (result?.channels) setChannels(result.channels);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const state = detail?.state,
    online = Boolean(state?.ready),
    current = state?.current;
  return (
    <div className="app-shell admin-shell">
      <Sidebar admin />
      <main className="main">
        <header className="topbar">
          <LanguageSwitch />
          <span className="breadcrumb">
            <ShieldCheck size={16} /> {t("Kontrollrom")}
          </span>
          {authenticated && (
            <button className="button subtle" onClick={() => void logout()}>
              <LogOut size={16} /> {t("Logg ut")}
            </button>
          )}
        </header>
        <div className="content">
          {error && (
            <div className="notice error" role="alert">
              {t(error)}
            </div>
          )}
          {checking ? (
            <p>
              <LoaderCircle className="spin" /> {t("Sjekker innlogging …")}
            </p>
          ) : !authenticated ? (
            <section className="admin-login">
              <span className="party-kicker">AFTERPARTY / ADMIN</span>
              <h1>{t("Din server. Din musikk.")}</h1>
              <p>
                {t(
                  "Logg inn med Discord for å styre serverne du administrerer.",
                )}
              </p>
              <a className="button primary" href="/api/auth/discord">
                {t("Logg inn med Discord")} <ArrowUpRight size={16} />
              </a>
              {invite && (
                <a
                  className="button subtle"
                  href={invite}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Legg til boten")}
                </a>
              )}
              <details>
                <summary>{t("Eierinnlogging")}</summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void login();
                  }}
                >
                  <label htmlFor="admin-password">
                    {t("Adminpassord for Afterparty")}
                  </label>
                  <input
                    id="admin-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    maxLength={200}
                  />
                  <button className="button subtle" disabled={busy}>
                    {t("Logg inn")}
                  </button>
                </form>
              </details>
            </section>
          ) : (
            <>
              <section className="scene-heading admin-heading">
                <div>
                  <span className="party-kicker">AFTERPARTY</span>
                  <h1>{t("Kontrollrom.")}</h1>
                  <p>{t("Spiller, kø og innstillinger for din server.")}</p>
                </div>
                <button
                  className="button subtle"
                  disabled={busy}
                  onClick={() => void loadGuilds()}
                >
                  <RefreshCw size={16} /> {t("Oppdater servere")}
                </button>
              </section>
              <label className="guild-select">
                {t("Discord-server")}
                <select
                  value={guildId}
                  disabled={busy}
                  onChange={(e) => setGuildId(e.target.value)}
                >
                  {guilds.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {g.installed ? "" : t(" · legg til boten")}
                    </option>
                  ))}
                </select>
              </label>
              {!guilds.length ? (
                <p>
                  {t("Du har ingen servere med administrasjonstilgang.")}{" "}
                  <a href={invite}>{t("Legg til boten")}</a>
                </p>
              ) : !selected?.installed ? (
                <section className="admin-card">
                  <h2>
                    {t("Legg til Afterparty på")} {selected?.name}
                  </h2>
                  <a
                    className="button primary"
                    href={
                      invite +
                      "&guild_id=" +
                      guildId +
                      "&disable_guild_select=true"
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("Legg til boten")} <ArrowUpRight size={16} />
                  </a>
                  <p>
                    {t("Oppdater serverlisten etter at boten er lagt til.")}
                  </p>
                </section>
              ) : (
                <>
                  <nav className="admin-tabs" aria-label={t("Kontrollrom")}>
                    <button
                      aria-pressed={tab === "player"}
                      onClick={() => setTab("player")}
                    >
                      {t("Spiller og kø")}
                    </button>
                    <button
                      aria-pressed={tab === "settings"}
                      onClick={() => setTab("settings")}
                    >
                      {t("Innstillinger")}
                    </button>
                    <button
                      aria-pressed={tab === "tools"}
                      onClick={() => setTab("tools")}
                    >
                      {t("Verktøy")}
                    </button>
                    {globalAdmin && (
                      <button
                        aria-pressed={tab === "rooms"}
                        onClick={() => setTab("rooms")}
                      >
                        {t("Videorom")}
                      </button>
                    )}
                    <a href={"/?room=" + selected.roomCode}>
                      {t("Se video")} <ArrowUpRight size={14} />
                    </a>
                  </nav>
                  {!detail ? (
                    <p>{t("Henter serveren …")}</p>
                  ) : tab === "player" ? (
                    <>
                      <section className="bot-control">
                        <div className="bot-control-heading">
                          <strong>
                            {online
                              ? state?.connected
                                ? t("I talekanal")
                                : t("Klar i Discord")
                              : t("Discord er frakoblet")}
                          </strong>
                          <span>
                            {detail.player.bitrate / 1000}{" "}
                            {t("kbit/s · radio:")}{" "}
                            {{
                              lastfm: "Last.fm",
                              artist: t("Artistradio"),
                              soundcloud: "SoundCloud",
                              fallback: t("Reserve"),
                            }[detail.player.radioProvider as "lastfm"] ??
                              t("Klar")}
                          </span>
                        </div>
                        <div className="bot-deck">
                          {current ? (
                            <Image unoptimized width={320} height={320} src={current.image} alt="" />
                          ) : (
                            <div className="bot-empty-art">GK</div>
                          )}
                          <div>
                            <span className="party-kicker">
                              {state?.playing
                                ? t("SPILLER")
                                : current
                                  ? t("PÅ PAUSE")
                                  : t("KLAR")}
                            </span>
                            <h2>{current?.title ?? t("Klar for musikk")}</h2>
                            <p>
                              {current?.artist ??
                                t(
                                  "Start med /play i Discord, eller velg en talekanal under Verktøy.",
                                )}
                            </p>
                            <div className="bot-buttons">
                              <button
                                className="button primary"
                                disabled={busy || !current}
                                onClick={() =>
                                  void command(
                                    state?.playing ? "pause" : "resume",
                                  )
                                }
                              >
                                {state?.playing ? (
                                  <Pause size={16} />
                                ) : (
                                  <Play size={16} />
                                )}{" "}
                                {state?.playing ? t("Pause") : t("Fortsett")}
                              </button>
                              <button
                                className="button subtle"
                                disabled={busy || !current}
                                onClick={() => void command("skip")}
                              >
                                <SkipForward size={16} /> {t("Neste")}
                              </button>
                              <button
                                className="button subtle"
                                disabled={busy}
                                onClick={() => void command("shuffle")}
                              >
                                <Shuffle size={16} /> {t("Bland")}
                              </button>
                              <button
                                className="button danger-button"
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    confirm(
                                      t(
                                        "Stoppe musikken og tømme køen på denne serveren?",
                                      ),
                                    )
                                  )
                                    void command("stop");
                                }}
                              >
                                <Square size={16} /> {t("Stopp")}
                              </button>
                            </div>
                          </div>
                        </div>
                        {current && !current.live && (
                          <AdminSeek
                            trackId={current.id}
                            position={state?.position ?? 0}
                            duration={current.duration}
                            playing={Boolean(state?.playing)}
                            disabled={busy}
                            onSeek={(seconds) =>
                              void command("seek", { seconds })
                            }
                          />
                        )}
                        {Boolean(detail.settings.radio) &&
                          detail.player.radioError && (
                            <p className="admin-notice" role="status">
                              {t(detail.player.radioError)}
                            </p>
                          )}
                        <div className="admin-volume">
                          <label htmlFor="bot-volume">
                            {t("Discord-volum")} {volume}%
                          </label>
                          <input
                            id="bot-volume"
                            type="range"
                            min={0}
                            max={100}
                            value={volume}
                            onChange={(e) => {
                              volumeDirty.current = true;
                              setVolume(Number(e.target.value));
                            }}
                          />
                          <button
                            className="button subtle"
                            disabled={busy}
                            onClick={() => {
                              void command("volume", { value: volume }).then(
                                (result) => {
                                  if (result) volumeDirty.current = false;
                                },
                              );
                            }}
                          >
                            {t("Bruk volum")}
                          </button>
                        </div>
                        <form
                          className="search-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void command("enqueue", { query, concert: false });
                          }}
                        >
                          <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            aria-label={t("Sang eller lenke")}
                            placeholder={t(
                              "Søk, Spotify- eller SoundCloud-lenke. sc: for SoundCloud",
                            )}
                            required
                            maxLength={2000}
                          />
                          <button
                            className="button primary"
                            disabled={busy || !state?.connected}
                          >
                            <Plus size={16} /> {t("Legg til")}
                          </button>
                        </form>
                        <div className="admin-bot-queue">
                          {state?.queue.map((track, i) => (
                            <div key={`${track.id}-${i}`}>
                              <span>{i + 1}</span>
                              <strong>{track.title}</strong>
                              <button
                                className="icon-button"
                                aria-label={
                                  t("Flytt ") + track.title + t(" opp")
                                }
                                disabled={busy || i === 0}
                                onClick={() =>
                                  void command("move", { from: i + 1, to: i })
                                }
                              >
                                ↑
                              </button>
                              <button
                                className="icon-button"
                                aria-label={
                                  t("Spill ") + track.title + t(" nå")
                                }
                                disabled={busy}
                                onClick={() =>
                                  void command("jump", { position: i + 1 })
                                }
                              >
                                <Play size={15} />
                              </button>
                              <button
                                className="icon-button"
                                aria-label={t("Fjern ") + track.title}
                                disabled={busy}
                                onClick={() =>
                                  void command("remove", { index: i })
                                }
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="bot-buttons">
                          <button
                            className="button subtle"
                            disabled={busy}
                            onClick={() =>
                              void command("loop-sang", {
                                value: !detail.player.loopCurrentSong,
                              })
                            }
                          >
                            {t("🔁 Gjenta sang")}{" "}
                            {detail.player.loopCurrentSong ? t("på") : t("av")}
                          </button>
                          <button
                            className="button subtle"
                            disabled={busy}
                            onClick={() =>
                              void command("loop-queue", {
                                value: !detail.player.loopCurrentQueue,
                              })
                            }
                          >
                            {t("🔁 Gjenta kø")}{" "}
                            {detail.player.loopCurrentQueue ? t("på") : t("av")}
                          </button>
                          <button
                            className="button subtle"
                            disabled={busy}
                            onClick={() => void command("replay")}
                          >
                            {t("↩️ Start på nytt")}
                          </button>
                          <button
                            className="button subtle"
                            disabled={busy}
                            onClick={() => void command("unskip")}
                          >
                            {t("⏮️ Forrige sang")}
                          </button>
                          <button
                            className="button subtle"
                            disabled={busy}
                            onClick={() => void command("clear")}
                          >
                            {t("Tøm kø")}
                          </button>
                        </div>
                      </section>
                      {detail.audio && <section className="admin-card"><h2>{t("Lydstatus")}</h2>
                        <p>{t("Avbrot")}: {detail.audio.interruptions} · {t("Lengste avbrot")}: {detail.audio.maxInterruptionMs} ms</p>
                        <p>{t("Manglande lydrammer")}: {detail.audio.missedFrames ?? 0} · max: {detail.audio.maxConsecutiveMissedFrames ?? 0}</p>
                        <p>Event loop p95: {detail.performance?.eventLoopP95Ms?.toFixed(2) ?? "?"} ms · max: {detail.performance?.eventLoopMaxMs?.toFixed(2) ?? "?"} ms</p>
                        <details><summary>{t("Siste lydhendingar")}</summary><ul>{detail.audio.events.map((event,i)=><li key={i}>{new Date(event.at).toLocaleTimeString()} · {event.reason} · {event.durationMs} ms</li>)}</ul></details>
                      </section>}
                    </>
                  ) : tab === "settings" ? (
                    <form
                      className="admin-card settings-grid admin-settings"
                      onSubmit={(e) => {
                        e.preventDefault();
                        setSettingsError("");
                        setSettingsNotice("");
                        setNotice("");
                        const selectedSettings = Object.fromEntries(settingGroups.flatMap(group => group.fields.map(field => [field.key, settings[field.key] ?? detail.settings[field.key]])));
                        void control("settings", { settings: selectedSettings });
                      }}
                    >
                      <h2>{t("Serverinnstillinger")}</h2>
                      <p>{t("Changes apply only to {server}. Settings are managed here instead of Discord slash commands.", {server: selected?.name ?? t("this server")})}</p>
                      {settingGroups.map(group => <fieldset key={group.title} disabled={busy}>
                        <legend>{t(group.title)}</legend>
                        <p>{t(group.description)}</p>
                        <div className="setting-fields">
                          {group.fields.map(field => <label className="setting-row" key={field.key} htmlFor={"setting-" + field.key}>
                            <span><strong>{t(field.label)}</strong><small id={"setting-help-" + field.key}>{t(field.help)}</small></span>
                            {field.toggle ? <input id={"setting-" + field.key} type="checkbox" aria-label={t(field.label)}
                              aria-describedby={"setting-help-" + field.key} checked={Boolean(settings[field.key] ?? detail.settings[field.key])}
                              onChange={e => {setSettingsNotice(""); setSettings(s => ({...s, [field.key]: e.target.checked}));}} />
                              : <input id={"setting-" + field.key} type="number" aria-label={t(field.label)} aria-describedby={"setting-help-" + field.key}
                                min={field.min} max={field.max} step={1} required value={Number(settings[field.key] ?? detail.settings[field.key])}
                                onChange={e => {setSettingsNotice(""); setSettings(s => ({...s, [field.key]: Number(e.target.value)}));}} />}
                          </label>)}
                        </div>
                      </fieldset>)}
                      {settingsError && <p className="settings-save-error" role="alert">{t(settingsError)}</p>}
                      {settingsNotice && <p className="settings-save-notice" role="status">{t(settingsNotice, {server: selected?.name ?? t("this server")})}</p>}
                      <button className="button primary" disabled={busy}>
                        {t("Lagre innstillinger")}
                      </button>
                    </form>
                  ) : tab === "rooms" ? (
                    <section className="admin-card">
                      <h2>{t("Videorom")}</h2>
                      <button
                        className="button subtle"
                        onClick={() => void loadRooms()}
                      >
                        {t("Oppdater rom")}
                      </button>
                      {rooms.map((r) => (
                        <article className="admin-room" key={r.code}>
                          <div>
                            <h3>{r.name}</h3>
                            <p>
                              {r.current?.title ?? t("Ingen video")} ·{" "}
                              {r.viewers} {t("i rommet")}
                            </p>
                          </div>
                          <a
                            className="button subtle"
                            href={"/?room=" + r.code}
                          >
                            {t("Se video")}
                          </a>
                          {r.mode !== "discord" && (
                            <button
                              className="button danger-button"
                              onClick={() => void closeRoom(r.code)}
                            >
                              {t("Avslutt")}
                            </button>
                          )}
                        </article>
                      ))}
                    </section>
                  ) : (
                    <div className="admin-columns">
                      <section className="admin-card">
                        <h2>{t("Talekanal og spillermelding")}</h2>
                        <button
                          className="button subtle"
                          disabled={busy}
                          onClick={() => void readChannels()}
                        >
                          {t("Hent kanaler")}
                        </button>
                        <select
                          aria-label={t("Velg kanal")}
                          value={channelId}
                          onChange={(e) => setChannelId(e.target.value)}
                        >
                          <option value="">{t("Velg kanal")}</option>
                          {channels.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.voice ? "🔊" : "#"} {c.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="button subtle"
                          disabled={
                            busy ||
                            !channels.find((c) => c.id === channelId)?.voice
                          }
                          onClick={() => void control("join", { channelId })}
                        >
                          {t("Bli med")}
                        </button>
                        <button
                          className="button subtle"
                          disabled={
                            busy ||
                            channels.find((c) => c.id === channelId)?.voice ||
                            !channelId
                          }
                          onClick={() =>
                            void control("music-channel", { channelId })
                          }
                        >
                          {t("Bruk som musikk-kanal")}
                        </button>
                        <button
                          className="button subtle"
                          disabled={busy}
                          onClick={() => void command("disconnect")}
                        >
                          {t("Koble fra")}
                        </button>
                      </section>
                      <section className="admin-card">
                        <h2>{t("Stopptimer")}</h2>
                        <input
                          aria-label={t("Minutter til stopp")}
                          type="number"
                          min={1}
                          max={1440}
                          value={minutes}
                          onChange={(e) => setMinutes(Number(e.target.value))}
                        />
                        <button
                          className="button subtle"
                          disabled={busy}
                          onClick={() =>
                            void command("sleep-timer", { minutes })
                          }
                        >
                          {t("Start timer")}
                        </button>
                        <button
                          className="button subtle"
                          disabled={busy}
                          onClick={() => void command("cancel-sleep-timer")}
                        >
                          {t("Avbryt timer")}
                        </button>
                        {detail.sleepTimerEndsAt && (
                          <p>
                            {t("Stopper")}{" "}
                            {new Date(
                              detail.sleepTimerEndsAt,
                            ).toLocaleTimeString(
                              language === "en" ? "en-GB" : "nb-NO",
                            )}
                          </p>
                        )}
                      </section>
                      <section className="admin-card">
                        <h2>{t("Lagrede køer")}</h2>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void command("snapshot-save", {
                              name: snapshotName,
                            });
                          }}
                        >
                          <input
                            aria-label={t("Navn på lagret kø")}
                            value={snapshotName}
                            onChange={(e) => setSnapshotName(e.target.value)}
                            required
                            maxLength={80}
                          />
                          <button className="button subtle" disabled={busy}>
                            {t("Lagre køen")}
                          </button>
                        </form>
                        {detail.snapshots.map((s) => (
                          <article className="saved-queue" key={s.id}>
                            <strong>
                              {s.name} · {s.songCount} {t("sanger")}
                            </strong>
                            <button
                              className="button subtle"
                              disabled={busy}
                              onClick={() =>
                                void command("snapshot-restore", {
                                  id: s.id,
                                  replace: false,
                                })
                              }
                            >
                              {t("Legg til")}
                            </button>
                            <button
                              className="button subtle"
                              disabled={busy}
                              onClick={() => {
                                if (confirm(t("Erstatte køen?")))
                                  void command("snapshot-restore", {
                                    id: s.id,
                                    replace: true,
                                  });
                              }}
                            >
                              {t("Erstatt kø")}
                            </button>
                            <button
                              className="icon-button"
                              aria-label={t("Slett ") + s.name}
                              disabled={busy}
                              onClick={() => {
                                if (confirm(t("Slette denne lagrede køen?")))
                                  void command("snapshot-delete", { id: s.id });
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </article>
                        ))}
                      </section>
                      <section className="admin-card">
                        <h2>{t("Vedlikehold")}</h2>
                        <button
                          className="button subtle"
                          disabled={busy}
                          onClick={() => void command("cleanup-duplicates")}
                        >
                          {t("Fjern duplikater i køen")}
                        </button>
                        <button
                          className="button subtle"
                          disabled={
                            busy ||
                            Boolean(current) ||
                            Boolean(state?.connected)
                          }
                          onClick={() => void command("diagnostic")}
                        >
                          {t("Test lydtilkoblingen")}
                        </button>
                        <p>
                          {t("Testen krever en tom bot og en tom talekanal.")}
                        </p>
                      </section>
                    </div>
                  )}
                  {notice && (
                    <p role="status" className="admin-notice">
                      {t(notice)}
                    </p>
                  )}
                  {detail && (
                    <details className="admin-card">
                      <summary>{t("Siste handlinger")}</summary>
                      {detail.commands.slice(0, 10).map((j) => (
                        <p key={j.id}>
                          {j.payload.action}: {j.status}
                          {j.result ? " · " + j.result : ""}
                        </p>
                      ))}
                    </details>
                  )}
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>AFTERPARTY</span>
            <Link prefetch={false} target="_top" href="/">
              {t("Til musikken")} <ArrowUpRight size={13} />
            </Link>
          </footer>
        </div>
      </main>
    </div>
  );
}
