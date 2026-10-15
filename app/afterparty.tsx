"use client";
import { loadYoutube, type Player } from "@/lib/youtube-player";
import { headers, request } from "@/lib/browser-api";
import { StartEvening } from "@/components/party/start-evening";
import { RoomDialog } from "@/components/party/room-dialog";
import { RoomSharing } from "@/components/party/room-sharing";
import { SocialQueue } from "@/components/party/social-queue";
import { EveningLibrary } from "@/components/party/evening-library";
import { browserStorage as storage } from "@/lib/browser-storage";
import { Sidebar } from "@/components/afterparty-navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronRight,
  Copy,
  Link2,
  ListMusic,
  LoaderCircle,
  Music2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  SkipForward,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import {
  Room,
  Video,
  time,
  type DiscordState,
  type HistoryVideo,
} from "@/lib/types";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { useAudioPreferences } from "@/hooks/use-audio-preferences";
import { useImmersiveControls } from "@/hooks/use-immersive-controls";
import { applyAudioPreferences } from "@/lib/audio-preferences";
import {
  canCorrectPlayback,
  isLocalSeek,
  compensateDelivery,
  playbackTarget,
  shouldCorrect,
  readSyncMode,
  syncRecoveryMs,
  roomPollMs,
  type SyncMode,
} from "@/lib/playback-sync";
import { useLiveRoom } from "@/hooks/use-live-room";
import { useLiveDiscord } from "@/hooks/use-live-discord";
import { liveRoom, liveMetadata } from "@/lib/live-room";
import { deliverCommand, type CommandReceipt } from "@/lib/live-command";
import { LanguageSwitch, useLanguage } from "@/components/language";
import { OpenRooms } from "@/components/open-rooms";
import { ConcertScenery } from "@/components/concert-scenery";
import { PlayerSettings } from "@/components/player-settings";

export default function Afterparty() {
  const { t } = useLanguage();
  const [directoryOpen, setDirectoryOpen] = useState(false),
    [publicListing, setPublicListing] = useState(false);
  const navigate = (view: "music" | "rooms") => {
    setDirectoryOpen(view === "rooms");
    const url = new URL(location.href);
    view === "rooms"
      ? url.searchParams.set("view", "rooms")
      : url.searchParams.delete("view");
    history.pushState(null, "", url.pathname + url.search);
  };
  const fullscreen = useFullscreen();
  const audio = useAudioPreferences();
  const [motion, setMotion] = useState(true),
    [panel, setPanel] = useState<"queue" | "music" | "library">("queue"),
    [syncOffset, setSyncOffset] = useState(0),
    [syncStatus, setSyncStatus] = useState("Ventar på video"),
    [syncDrift, setSyncDrift] = useState<number | null>(null),
    [botPending, setBotPending] = useState(false);
  const [firstQuery, setFirstQuery] = useState(""),
    [displayName, setDisplayName] = useState(""),
    [tv, setTV] = useState(false),
    [sharing, setSharing] = useState(false);
  const syncOffsetRef = useRef(0),
    lastCorrection = useRef(-Infinity),
    syncRef = useRef<(force?: boolean) => void>(() => {}),
    botBusy = useRef(false),
    mounted = useRef(true),
    joinGeneration = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const value = Number(storage.get("afterparty-sync-offset") ?? 0);
    if (Number.isFinite(value)) {
      syncOffsetRef.current = Math.max(-5, Math.min(5, value));
      setSyncOffset(syncOffsetRef.current);
    }
    return () => {
      mounted.current = false;
    };
  }, []);
  const adjustSync = (value: number) => {
    syncOffsetRef.current = value;
    setSyncOffset(value);
    storage.set("afterparty-sync-offset", String(value));
    syncRef.current(true);
  };
  const fullscreenToggle = () => {
    if (roomRef.current?.current) {
      setConsent(true);
      void fullscreen
        .toggle()
        .catch(() => announce("Fullskjerm kunne ikke avsluttes. Prøv Escape."));
    }
  };
  const [room, setRoom] = useState<Room | null>(null),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<Video[]>([]),
    [featured, setFeatured] = useState<HistoryVideo[]>([]),
    [searching, setSearching] = useState(false),
    [searched, setSearched] = useState(false),
    [pending, setPending] = useState(false),
    [loadingRoom, setLoadingRoom] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState<"create" | "join" | null>(null),
    [roomName, setRoomName] = useState("Musikkrom"),
    [joinCode, setJoinCode] = useState(""),
    [consent, setConsent] = useState(false),
    [playerLoading, setPlayerLoading] = useState(false),
    [playerError, setPlayerError] = useState(""),
    [autoplayBlocked, setAutoplayBlocked] = useState(false),
    [online, setOnline] = useState(true);
  const [discord, setDiscord] = useState<DiscordState | null>(null),
    [historySort, setHistorySort] = useState<"recent" | "popular">("recent");
  const loggedPlay = useRef("");
  const [settingsOpen, setSettingsOpen] = useState(false),
    [syncMode, setSyncMode] = useState<SyncMode>("precise"),
    [quality, setQuality] = useState(""),
    [playerEpoch, setPlayerEpoch] = useState(0),
    [bufferSeconds, setBufferSeconds] = useState(0);
  const temporaryMute = useRef(false),
    mutedFallbackTried = useRef(false);
  const [autoplayMuted, setAutoplayMuted] = useState(false);
  const syncModeRef = useRef<SyncMode>("precise"),
    bufferStarted = useRef<number | null>(null),
    settleUntil = useRef(0),
    locallyPaused = useRef(false),
    audioWriteUntil = useRef(0),
    nativeTransportPending = useRef(false),
    playerWriteUntil = useRef(0),
    playerTransportWrite = useRef(false),
    localPosition = useRef<{
      position: number;
      at: number;
      playing: boolean;
    } | null>(null);
  useEffect(() => {
    const mode = readSyncMode(storage.get("afterparty-sync-mode-v1"));
    syncModeRef.current = mode;
    setSyncMode(mode);
  }, []);
  const changeSyncMode = (mode: SyncMode) => {
    syncModeRef.current = mode;
    setSyncMode(mode);
    storage.set("afterparty-sync-mode-v1", mode);
  };
  const reloadPlayer = () => {
    setPlayerError("");
    setAutoplayBlocked(false);
    setBufferSeconds(0);
    bufferStarted.current = null;
    settleUntil.current = 0;
    locallyPaused.current = false;
    localPosition.current = null;
    setQuality("");
    setConsent(true);
    setPlayerEpoch((epoch) => epoch + 1);
  };
  const roomRef = useRef<Room | null>(null),
    activeCode = useRef(""),
    queuedVideo = useRef<Video | null>(null),
    received = useRef(0),
    player = useRef<Player | null>(null),
    playerReady = useRef(false),
    playerRoot = useRef<HTMLDivElement>(null),
    loadedId = useRef(""),
    busy = useRef(false),
    pollGeneration = useRef(0),
    searchGeneration = useRef(0),
    lastEnded = useRef(""),
    actionRef = useRef<
      (action: string, extras?: Record<string, unknown>) => Promise<void>
    >(async () => {}),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);
  const accept = useCallback((next: Room) => {
    const previous = roomRef.current;
    if (previous?.code === next.code)
      next = {
        ...next,
        isPublic: next.isPublic ?? previous.isPublic,
        isOwner: next.isOwner ?? previous.isOwner,
      };
    if (
      previous?.code === next.code &&
      previous.syncSource === next.syncSource &&
      previous.syncEpoch === next.syncEpoch &&
      previous.version > next.version
    )
      return;
    if (
      previous?.code === next.code &&
      next.version > previous.version &&
      (next.position < previous.position - 1 ||
        (!previous.playing && next.playing))
    )
      lastEnded.current = "";
    roomRef.current = next;
    received.current = performance.now();
    if (
      next.syncSource !== "live" ||
      JSON.stringify([
        previous?.syncEpoch,
        previous?.version,
        previous?.playing,
        previous?.discordOnline,
        previous?.viewers,
        previous?.isPublic,
      ]) !==
        JSON.stringify([
          next.syncEpoch,
          next.version,
          next.playing,
          next.discordOnline,
          next.viewers,
          next.isPublic,
        ])
    )
      setRoom(next);
    if (
      loadedId.current &&
      !loadedId.current.startsWith(
        `${next.code}:${next.playbackKey ?? next.current?.id}`,
      )
    )
      setPlayerError("");
    setOnline(true);
  }, []);
  const liveKey = useRef("");
  const realtime = useLiveDiscord(
    (state, age) => {
      const key = liveMetadata(state);
      if (key !== liveKey.current) {
        liveKey.current = key;
        setDiscord({ ...state, online: true });
      }
      if (activeCode.current === (state.roomCode ?? "DISCORD1"))
        accept(liveRoom(state, age));
    },
    () => {
      liveKey.current = "";
      setDiscord((previous) =>
        previous ? { ...previous, online: false } : null,
      );
    },
    room?.guildId,
  );
  const roomLive = useLiveRoom(
    room?.mode === "discord" ? undefined : room?.code,
    (next) => {
      const previous = roomRef.current;
      if (activeCode.current === next.code)
        accept({ ...next, isHost: previous?.isHost ?? false });
    },
  );
  const liveFresh = realtime.fresh;
  const authorityAt = useRef(0);
  const refresh = useCallback(
    async (code: string) => {
      if (
        roomRef.current?.mode === "discord" &&
        realtime.latest.current?.roomCode === code &&
        liveFresh.current &&
        realtime.latest.current
      ) {
        accept(
          liveRoom(
            realtime.latest.current,
            performance.now() - realtime.sampleAt.current,
          ),
        );
        return;
      }
      const generation = pollGeneration.current,
        started = performance.now();
      const next = await request<Room>(`/api/rooms/${code}`, {
        headers: headers(code),
      });
      if (
        mounted.current &&
        generation === pollGeneration.current &&
        activeCode.current === code
      ) {
        authorityAt.current = performance.now();
        accept(compensateDelivery(next, performance.now() - started));
      }
    },
    [accept],
  );
  const join = useCallback(
    async (code: string, recordHistory = true) => {
      code = code.toUpperCase().trim();
      if (!/^[A-Z0-9]{8}$/.test(code)) {
        setError("Romkoden har åtte bokstaver eller tall.");
        return;
      }
      const generation = ++joinGeneration.current;
      setLoadingRoom(true);
      setError("");
      try {
        const started = performance.now();
        const next = await request<Room>(`/api/rooms/${code}`, {
          headers: headers(code),
        });
        if (!mounted.current || generation !== joinGeneration.current) return;
        pollGeneration.current++;
        activeCode.current = code;
        accept(compensateDelivery(next, performance.now() - started));
        if (recordHistory) {
          const url = new URL(location.href);
          url.searchParams.set("room", code);
          url.searchParams.delete("view");
          history.pushState(null, "", url.pathname + url.search);
        }
        setDirectoryOpen(false);
        setModal(null);
        setPlayerError("");
        setPanel("queue");
      } catch (e) {
        if (generation === joinGeneration.current)
          setError((e as Error).message);
      } finally {
        if (generation === joinGeneration.current) setLoadingRoom(false);
      }
    },
    [accept],
  );
  const create = async () => {
    const generation = ++joinGeneration.current;
    setPending(true);
    setError("");
    try {
      const data = await request<{ room: Room; token: string }>("/api/rooms", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ name: roomName, isPublic: publicListing }),
      });
      const persisted = storage.set(
        `afterparty-host:${data.room.code}`,
        data.token,
      );
      if (!mounted.current || generation !== joinGeneration.current)
        return null;
      pollGeneration.current++;
      activeCode.current = data.room.code;
      accept({ ...data.room, isHost: true, isOwner: true });
      history.replaceState(null, "", `/?room=${data.room.code}`);
      setModal(null);
      setDirectoryOpen(false);
      setConsent(false);
      setPlayerError("");
      announce(
        persisted
          ? t("Rommet er opprettet. Del lenkja og inviter venene.")
          : t(
              "Nettleseren blokkerer lagring. Vertstilgangen varer berre til sida blir lasta på nytt.",
            ),
      );
      setSharing(false);
      setPanel("music");
      if (firstQuery.trim()) void find(firstQuery);
      if (queuedVideo.current) {
        const v = queuedVideo.current;
        queuedVideo.current = null;
        await actionRef.current("add", { videoId: v.id });
      }
      return data.room.code;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setPending(false);
    }
  };
  const action = useCallback(
    async (name: string, extras: Record<string, unknown> = {}) => {
      const current = roomRef.current;
      if (!current || busy.current) return;
      const generation = pollGeneration.current;
      busy.current = true;
      setPending(true);
      setError("");
      try {
        const data = await request<{ room: Room }>(
          `/api/rooms/${current.code}`,
          {
            method: "POST",
            headers: headers(current.code),
            ...(name === "next" ? { signal: AbortSignal.timeout(35000) } : {}),
            body: JSON.stringify({
              action: name,
              guildId: roomRef.current?.guildId,
              version: current.version,
              displayName: storage.get("afterparty-display-name") ?? t("Gjest"),
              ...extras,
            }),
          },
        );
        if (
          generation === pollGeneration.current &&
          activeCode.current === current.code
        ) {
          accept(data.room);
          if (name === "add")
            announce(
              data.room.approvalRequired && !data.room.isHost
                ? t("Låtønsket ventar på godkjenning.")
                : t("Låta er lagd til."),
            );
        }
      } catch (e) {
        if (generation !== pollGeneration.current) return;
        setError((e as Error).message);
        try {
          await refresh(current.code);
        } catch {
          /* keep action error visible */
        }
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [accept, refresh],
  );
  actionRef.current = action;
  const add = async (video: Video) => {
    if (roomRef.current?.mode === "discord") {
      await botCommand("enqueue", { videoId: video.id });
      return;
    }
    if (!roomRef.current) {
      queuedVideo.current = video;
      setModal("create");
      announce("Namn på rommet. Videoen blir lagt til automatisk.");
      return;
    }
    await action("add", { videoId: video.id });
  };
  const find = async (q = query) => {
    q = q.trim();
    if (!q) return;
    const generation = ++searchGeneration.current;
    setQuery(q);
    setSearching(true);
    setSearched(true);
    setError("");
    try {
      const data = await request<{ videos: Video[] }>(
        `/api/search?q=${encodeURIComponent(q)}`,
      );
      if (generation === searchGeneration.current) setResults(data.videos);
    } catch (e) {
      if (generation === searchGeneration.current) {
        setResults([]);
        setError((e as Error).message);
      }
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  };
  const closeModal = () => {
    queuedVideo.current = null;
    setModal(null);
    setError("");
  };

  const share = () => setSharing((value) => !value);
  const manageRoom = async (operation: string) => {
    const current = roomRef.current;
    if (!current) return;
    const data = await request<{ token?: string; room: Room }>(
      `/api/rooms/${current.code}`,
      {
        method: "POST",
        headers: headers(current.code),
        body: JSON.stringify({ action: operation }),
      },
    );
    await refresh(current.code);
    return data.token;
  };
  const restoring = useRef(false);
  const restoreEvening = async (tracks: Video[]) => {
    if (restoring.current) return;
    restoring.current = true;
    busy.current = true;
    setPending(true);
    try {
      for (const video of tracks) {
        const active = roomRef.current;
        if (
          active?.current?.id === video.id ||
          active?.queue.some((v) => v.id === video.id)
        )
          continue;
        try {
          if (active?.mode === "discord") {
            if (!(await botCommand("enqueue", { videoId: video.id }))) return;
          } else {
            const code = active?.code ?? (await create());
            if (!code) return;
            const data = await request<{ room: Room }>(`/api/rooms/${code}`, {
              method: "POST",
              headers: headers(code),
              body: JSON.stringify({
                action: "add",
                videoId: video.id,
                version: roomRef.current?.version,
                displayName:
                  storage.get("afterparty-display-name") ?? t("Gjest"),
              }),
            });
            accept(data.room);
          }
        } catch (e) {
          setError("Settet er delvis lagt til. " + (e as Error).message);
          return;
        }
      }
      announce(t("Settet er lagt i køen."));
    } finally {
      restoring.current = false;
      busy.current = false;
      setPending(false);
    }
  };
  useEffect(() => {
    setMotion(storage.get("afterparty-motion") !== "off");
    setDisplayName(storage.get("afterparty-display-name") ?? "");
    if (!storage.get("afterparty-visitor"))
      storage.set("afterparty-visitor", crypto.randomUUID());
    const params = new URLSearchParams(location.search),
      code = params.get("room");
    setTV(params.get("tv") === "1");
    setDirectoryOpen(params.get("view") === "rooms");
    const fragment = new URLSearchParams(location.hash.slice(1));
    const invitation = fragment.get("host"),
      access = fragment.get("access");
    if (access && code && /^[a-f0-9]{64}$/.test(access)) {
      storage.set(`afterparty-host:${code}`, access);
      history.replaceState(null, "", location.pathname + location.search);
    }
    if (invitation && code) {
      history.replaceState(null, "", location.pathname + location.search);
      void request<{ token: string }>(`/api/rooms/${code}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action: "claim-host", token: invitation }),
      })
        .then((data) => {
          storage.set(`afterparty-host:${code}`, data.token);
          return join(code, false);
        })
        .catch((e) => setError(e.message));
    } else if (code)
      void join(code, false).then(() => {
        if (params.get("view") === "rooms") setDirectoryOpen(true);
      });
    const pop = () => {
      const p = new URLSearchParams(location.search);
      setDirectoryOpen(p.get("view") === "rooms");
      setTV(p.get("tv") === "1");
      const next = p.get("room");
      if (next && next !== activeCode.current) {
        void request<Room>(`/api/rooms/${next}`, { headers: headers(next) })
          .then((value) => {
            pollGeneration.current++;
            activeCode.current = next;
            accept(value);
          })
          .catch((e) => setError(e.message));
      } else if (!next) {
        pollGeneration.current++;
        activeCode.current = "";
        roomRef.current = null;
        setRoom(null);
      }
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (panel === "music" && !directoryOpen && !tv) {
      requestAnimationFrame(() => {
        const input =
          document.querySelector<HTMLInputElement>(".search-form input");
        input?.focus({ preventScroll: true });
        input?.scrollIntoView({
          block: "center",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
      });
    }
  }, [panel, directoryOpen, tv]);
  const toggleTV = () => {
    const next = !tv;
    setTV(next);
    const url = new URL(location.href);
    next ? url.searchParams.set("tv", "1") : url.searchParams.delete("tv");
    history.pushState(null, "", url.pathname + url.search);
  };

  const botCommand = async (
    action: "skip" | "enqueue" | "pause" | "resume",
    extras: Record<string, unknown> = {},
  ) => {
    const target = roomRef.current,
      generation = pollGeneration.current;
    if (botBusy.current) return false;
    botBusy.current = true;
    setBotPending(true);
    setError("");
    try {
      const sent = await request<CommandReceipt>(
        "/api/discord" + (target?.guildId ? "?guildId=" + target!.guildId : ""),
        {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            action,
            guildId: target?.guildId,
            commandId: crypto.randomUUID(),
            queueRevision: discord?.queueRevision,
            playbackKey: target?.playbackKey,
            ...extras,
          }),
        },
      );
      if (generation !== pollGeneration.current) return false;
      const immediate =
        sent.status === "done"
          ? { command: { status: "done" } }
          : await deliverCommand(sent);
      if (
        immediate?.command.status === "failed" ||
        immediate?.command.status === "unknown"
      )
        throw new Error(
          ("result" in immediate.command ? immediate.command.result : "") ||
            "Handlingen mislyktes.",
        );
      if (immediate?.command.status === "done") {
        announce(
          action === "pause"
            ? "Musikk og video er satt på pause for alle."
            : action === "resume"
              ? "Musikk og video fortsetter for alle."
              : action === "skip"
                ? "Neste låt spiller."
                : "Sangen er lagt i køen.",
        );
        if (roomRef.current?.mode === "discord")
          await refresh(activeCode.current);
        return true;
      }
      const deadline = performance.now() + 35000;
      let confirmed = false;
      while (mounted.current && performance.now() < deadline) {
        const response = await request<{
          state: DiscordState | null;
          command: { status: string; result: string } | null;
        }>(
          `/api/discord?command=${encodeURIComponent(sent.id)}${target?.guildId ? "&guildId=" + target!.guildId : ""}`,
        );
        if (!mounted.current || generation !== pollGeneration.current)
          return false;
        if (!liveFresh.current) setDiscord(response.state);
        const job = response.command;
        if (job?.status === "done") {
          confirmed = true;
          announce(
            action === "skip"
              ? "Sangen er hoppet over i Discord."
              : action === "pause"
                ? "Musikk og video er satt på pause for alle."
                : action === "resume"
                  ? "Musikk og video fortsetter for alle."
                  : "Sangen er lagt i Discord-køen.",
          );
          if (roomRef.current?.mode === "discord")
            await refresh(activeCode.current);
          break;
        }
        if (job && ["failed", "expired", "unknown"].includes(job.status))
          throw new Error(job.result || "Boten bekreftet ikke kommandoen.");
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!confirmed && mounted.current)
        throw new Error(
          "Boten har ikke bekreftet kommandoen. Sjekk køen før du prøver igjen.",
        );
      return confirmed;
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      return false;
    } finally {
      botBusy.current = false;
      if (mounted.current) setBotPending(false);
    }
  };
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      try {
        if (liveFresh.current) {
          timer = setTimeout(update, 10000);
          return;
        }
        const d = await request<{ state: DiscordState | null }>(
          "/api/discord" +
            (roomRef.current?.guildId
              ? "?guildId=" + roomRef.current.guildId
              : ""),
        );
        if (!disposed && !liveFresh.current) setDiscord(d.state);
      } catch {
        if (!disposed)
          setDiscord((previous) =>
            previous ? { ...previous, online: false } : null,
          );
      }
      if (!disposed) timer = setTimeout(update, document.hidden ? 15000 : 3000);
    };
    void update();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);
  function startVideo() {
    const r = roomRef.current;
    if (!r?.current) return;
    setConsent(true);
    setAutoplayBlocked(false);
    locallyPaused.current = false;
    mutedFallbackTried.current = false;
    if (!r.playing && (r.mode === "discord" || r.isHost)) {
      if (r.mode === "discord") void botCommand("resume");
      else void action("play");
    }
    if (playerReady.current && player.current && r.playing) {
      playerTransportWrite.current = true;
      playerWriteUntil.current = performance.now() + 1000;
      applyAudioPreferences(player.current, audio.current.current);
      syncRef.current(true);
      player.current.playVideo();
    }
  }
  function enableVideoAudio() {
    if (!player.current) return;
    temporaryMute.current = false;
    setAutoplayMuted(false);
    audioWriteUntil.current = performance.now() + 1000;
    applyAudioPreferences(player.current, audio.current.current);
    player.current.playVideo();
  }
  useEffect(() => {
    let disposed = false;
    void request<{ videos: HistoryVideo[] }>(`/api/history?sort=${historySort}`)
      .then((d) => {
        if (!disposed) setFeatured(d.videos);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [historySort, room?.current?.id]);
  useEffect(() => {
    if (!room?.code) return;
    let stopped = false,
      inFlight = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        if (
          room.mode !== "discord"
            ? !roomLive.fresh.current ||
              performance.now() - authorityAt.current > 15000
            : !liveFresh.current
        )
          await refresh(room.code);
      } catch (e) {
        if (!stopped) {
          setOnline(false);
          if ((e as Error).message.includes("avsluttet")) {
            setError((e as Error).message);
            stopped = true;
          }
        }
      } finally {
        inFlight = false;
      }
      if (!stopped) timer = setTimeout(poll, roomPollMs(document.hidden));
    };
    timer = setTimeout(poll, roomPollMs(document.hidden));
    const focus = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void poll();
        syncRef.current(true);
      }
    };
    document.addEventListener("visibilitychange", focus);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [room?.code, refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      const current = roomRef.current;
      if (current) syncRef.current();
      setBufferSeconds(
        bufferStarted.current === null
          ? 0
          : Math.floor((performance.now() - bufferStarted.current) / 1000),
      );
    }, 100);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!consent || !playerRoot.current) return;
    let disposed = false;
    setPlayerLoading(true);
    const readyTimer = setTimeout(() => {
      if (!disposed && !playerReady.current) {
        setPlayerLoading(false);
        setPlayerError("YouTube-spilleren svarer ikke. Prøv videoen igjen.");
      }
    }, 15000);
    loadYoutube()
      .then(() => {
        if (disposed || !playerRoot.current) return;
        const target = document.createElement("div");
        playerRoot.current.replaceChildren(target);
        player.current = new window.YT!.Player(target, {
          videoId: roomRef.current?.current?.id,
          width: "100%",
          height: "100%",
          playerVars: {
            controls: 1,
            playsinline: 1,
            rel: 0,
            fs: 0,
            origin: location.origin,
          },
          events: {
            onPlaybackQualityChange: (event: { data: string }) => {
              if (!disposed)
                setQuality(
                  (
                    {
                      small: "240p",
                      medium: "360p",
                      large: "480p",
                      hd720: "720p",
                      hd1080: "1080p",
                      hd1440: "1440p",
                      hd2160: "2160p",
                      highres: "Høy oppløsning",
                    } as Record<string, string>
                  )[event.data] ?? "YouTube Auto",
                );
            },
            onPlaybackRateChange: (event: { data: number }) => {
              if (!disposed && event.data !== 1)
                player.current?.setPlaybackRate(1);
            },
            onReady: () => {
              if (disposed) return;
              playerReady.current = true;
              clearTimeout(readyTimer);
              setPlayerLoading(false);
              const iframe = playerRoot.current?.querySelector("iframe");
              iframe?.setAttribute(
                "referrerpolicy",
                "strict-origin-when-cross-origin",
              );
              if (iframe && !iframe.allow.includes("autoplay"))
                iframe.allow += "; autoplay";
              loadedId.current = "";
              setAutoplayBlocked(false);
              const p = player.current;
              if (!p) return;
              applyAudioPreferences(p, audio.current.current);
              syncRef.current(true);
            },
            onError: (event: { data: number }) => {
              if (disposed) return;
              bufferStarted.current = null;
              setBufferSeconds(0);
              setSyncStatus("Video utilgjengelig");
              setPlayerError(
                [101, 150].includes(event.data)
                  ? "Eieren har blokkert denne videoen på andre nettsider."
                  : event.data === 153
                    ? "YouTube kunne ikke bekrefte videospilleren. Prøv å laste siden på nytt."
                    : "Videoen er ikke tilgjengelig her. Velg en annen video.",
              );
            },
            onAutoplayBlocked: () => {
              if (disposed) return;
              const r = roomRef.current,
                p = player.current;
              if (
                p &&
                r &&
                playbackTarget(r, received.current, performance.now())
                  .playing &&
                !mutedFallbackTried.current
              ) {
                mutedFallbackTried.current = true;
                temporaryMute.current = true;
                setAutoplayMuted(true);
                p.mute();
                p.playVideo();
              } else setAutoplayBlocked(true);
            },
            onStateChange: (event: { data: number }) => {
              if (disposed) return;
              const written = playerTransportWrite.current,
                r0 = roomRef.current,
                expected = r0
                  ? playbackTarget(r0, received.current, performance.now())
                      .playing
                  : false;
              if (
                written &&
                ((event.data === 1 && expected) ||
                  ([2, 5].includes(event.data) && !expected))
              )
                playerTransportWrite.current = false;
              observeLocalPosition();
              if (event.data === 3) {
                bufferStarted.current ??= performance.now();
                setSyncStatus("Bufrer video");
              } else {
                if (event.data === 1 && bufferStarted.current !== null) {
                  settleUntil.current =
                    performance.now() + syncRecoveryMs(syncModeRef.current);
                  lastCorrection.current = performance.now();
                }
                bufferStarted.current = null;
                setBufferSeconds(0);
              }
              if (event.data === 1) {
                const resuming = locallyPaused.current;
                locallyPaused.current = false;
                setAutoplayBlocked(false);
                syncRef.current(resuming);
              }
              const r = roomRef.current;
              if (event.data === 0 && r?.current) {
                const key = `${r.code}:${r.playbackKey ?? r.current.id}`;
                if (lastEnded.current !== key) {
                  lastEnded.current = key;
                  void refresh(r.code).catch(() => {});
                }
              }
            },
          },
        });
      })
      .catch((e) => {
        setPlayerLoading(false);
        setPlayerError(e.message);
      });
    return () => {
      disposed = true;
      clearTimeout(readyTimer);
      playerReady.current = false;
      player.current?.destroy();
      player.current = null;
      loadedId.current = "";
      bufferStarted.current = null;
    };
  }, [consent, playerEpoch]);
  function observeLocalPosition() {
    const p = player.current,
      r = roomRef.current;
    if (!p || !playerReady.current) return;
    const now = performance.now(),
      position = p.getCurrentTime(),
      state = p.getPlayerState();
    if (
      r?.isHost &&
      r.current &&
      !r.current.live &&
      !playerTransportWrite.current &&
      now >= playerWriteUntil.current &&
      isLocalSeek(localPosition.current, position, now)
    ) {
      lastCorrection.current = now;
      nativeTransportPending.current = true;
      void actionRef.current("seek", { position }).finally(() => {
        nativeTransportPending.current = false;
        syncRef.current();
      });
    }
    localPosition.current = { position, at: now, playing: state === 1 };
  }
  function recordPlayback() {
    const r = roomRef.current;
    if (r?.isHost && r.playing && r.current) {
      const key = r.playbackKey ?? `${r.code}:${r.current.id}`;
      if (loggedPlay.current !== key) {
        loggedPlay.current = key;
        void request(`/api/rooms/${r.code}`, {
          method: "POST",
          headers: headers(r.code),
          body: JSON.stringify({ action: "played", videoId: r.current.id }),
        }).catch(() => {
          loggedPlay.current = "";
        });
      }
    }
  }
  function syncPlayer(force = false) {
    const p = player.current,
      r = roomRef.current;
    if (!p || !playerReady.current) return;
    if (!r?.current || r.current.source === "soundcloud") {
      p.pauseVideo();
      setSyncStatus(r?.current ? "Lyd i Discord" : "Ingen video");
      return;
    }
    const now = performance.now(),
      target = playbackTarget(r, received.current, now, syncOffsetRef.current);
    if (!target.playing && (r.mode === "discord" || r.isHost))
      locallyPaused.current = false;
    if (target.stale) {
      p.pauseVideo();
      setSyncStatus(
        r.mode === "discord" ? "Ventar på boten" : "Venter på rommet",
      );
      return;
    }
    if (playerError) return;
    const key = `${r.code}:${r.playbackKey ?? r.current.id}`;
    if (lastEnded.current === key) {
      if (p.getPlayerState() === 1) p.pauseVideo();
      setSyncStatus("Venter på neste video");
      return;
    }
    if (loadedId.current !== key) {
      loadedId.current = key;
      locallyPaused.current = false;
      localPosition.current = null;
      playerTransportWrite.current = true;
      playerWriteUntil.current = now + 2000;
      lastCorrection.current = now;
      settleUntil.current = now + syncRecoveryMs(syncModeRef.current);
      bufferStarted.current = null;
      setBufferSeconds(0);
      setQuality("");
      setPlayerError("");
      setAutoplayBlocked(false);
      temporaryMute.current = false;
      setAutoplayMuted(false);
      mutedFallbackTried.current = false;
      audioWriteUntil.current = now + 1000;
      applyAudioPreferences(p, audio.current.current);
      target.playing
        ? p.loadVideoById({
            videoId: r.current.id,
            startSeconds: target.position,
          })
        : p.cueVideoById({
            videoId: r.current.id,
            startSeconds: target.position,
          });
      setSyncStatus("Laster video");
      return;
    }
    observeLocalPosition();
    if (temporaryMute.current && !p.isMuted()) {
      temporaryMute.current = false;
      setAutoplayMuted(false);
    }
    if (now >= audioWriteUntil.current && !temporaryMute.current)
      audio.fromPlayer(p.getVolume(), p.isMuted());
    const state = p.getPlayerState();
    if (state === 1) recordPlayback();
    const currentTime = p.getCurrentTime();
    setSyncDrift(
      r.current.live
        ? null
        : Math.round((currentTime - target.position) * 10) / 10,
    );
    if (
      (!locallyPaused.current || force) &&
      canCorrectPlayback(
        state,
        target.playing,
        now,
        settleUntil.current,
        force,
      ) &&
      shouldCorrect(
        target.position,
        currentTime,
        now,
        lastCorrection.current,
        force || !target.playing,
        syncModeRef.current,
      ) &&
      !r.current.live
    ) {
      playerTransportWrite.current = true;
      playerWriteUntil.current = now + 2000;
      p.seekTo(target.position, true);
      lastCorrection.current = now;
      setSyncStatus("Justerer synk");
    } else
      setSyncStatus(
        r.startsAt && r.serverTime + now - received.current < r.startsAt
          ? "Starter sammen"
          : r.current.live
            ? "Direkte"
            : state === 3
              ? "Bufrer video"
              : autoplayBlocked
                ? "Trykk start"
                : locallyPaused.current
                  ? "Video på pause"
                  : target.playing
                    ? "Synk aktiv"
                    : "På pause",
      );
    if (
      target.playing &&
      !autoplayBlocked &&
      !locallyPaused.current &&
      ![1, 3].includes(state)
    ) {
      playerTransportWrite.current = true;
      playerWriteUntil.current = now + 1000;
      p.playVideo();
    }
    if (!target.playing && state === 1) {
      playerTransportWrite.current = true;
      playerWriteUntil.current = now + 1000;
      p.pauseVideo();
    }
  }
  syncRef.current = syncPlayer;
  useEffect(() => {
    syncRef.current();
  }, [room, consent, playerError]);
  useEffect(() => {
    if (playerReady.current && player.current) {
      temporaryMute.current = false;
      setAutoplayMuted(false);
      audioWriteUntil.current = performance.now() + 1000;
      applyAudioPreferences(player.current, audio.value);
    }
  }, [audio.value]);
  const current = room?.current,
    audioOnly = current?.source === "soundcloud",
    shown = searched ? results : featured;
  const discordMode = room?.mode === "discord",
    botOnline = Boolean(discord?.online && discord.ready),
    canSkip = Boolean(
      discordMode && botOnline && discord?.connected && current,
    ),
    adding = pending || botPending;
  const needsVideoStart = Boolean(
    current &&
    !audioOnly &&
    (!consent || autoplayBlocked || locallyPaused.current),
  );
  const playLabel = needsVideoStart
    ? t("Start videoen")
    : room?.playing
      ? t("Pause for alle")
      : t("Spill for alle");
  const togglePlayback = () => {
    if (needsVideoStart || !room?.playing) startVideo();
    else if (discordMode) void botCommand("pause");
    else void action("pause");
  };
  const controls = useImmersiveControls(
    fullscreen.active,
    Boolean(playerError || autoplayBlocked || !current || settingsOpen),
    fullscreen.element,
  );
  const hideChrome = fullscreen.active && !controls.visible;
  const shortcutRef = useRef({
    fullscreenToggle,
    toggleMute: audio.toggleMute,
  });
  shortcutRef.current = { fullscreenToggle, toggleMute: audio.toggleMute };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.target instanceof HTMLElement &&
          Boolean(
            event.target.closest(
              'input,textarea,select,button,a,[contenteditable="true"],dialog',
            ),
          ))
      )
        return;
      if (event.key.toLowerCase() === "f" && roomRef.current?.current) {
        event.preventDefault();
        shortcutRef.current.fullscreenToggle();
      }
      if (event.key.toLowerCase() === "m" && roomRef.current?.current) {
        event.preventDefault();
        shortcutRef.current.toggleMute();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const playerSettings = current && (
    <PlayerSettings
      compact={fullscreen.active}
      open={settingsOpen}
      onOpen={setSettingsOpen}
      mode={syncMode}
      onMode={changeSyncMode}
      quality={t(quality)}
      enabled={consent}
      onRetry={reloadPlayer}
      onSync={() => syncRef.current(true)}
    >
      {
        <div className="sync-offset-tools">
          <label htmlFor="sync-offset">
            {t("Finjuster video")}{" "}
            <strong>
              {syncOffset > 0 ? "+" : ""}
              {syncOffset.toFixed(1)} s
            </strong>
          </label>
          <input
            id="sync-offset"
            type="range"
            min={-5}
            max={5}
            step={0.1}
            value={syncOffset}
            onChange={(e) => adjustSync(Number(e.target.value))}
          />
          <button
            className="icon-button"
            aria-label={t("Nullstill finjustering")}
            onClick={() => adjustSync(0)}
          >
            <X size={15} />
          </button>
          <small>
            {syncDrift !== null && consent && !playerError && (
              <span data-sync-drift={syncDrift.toFixed(3)}>
                {t("Videoavvik:")} {Math.abs(syncDrift).toFixed(1)} s.{" "}
              </span>
            )}
            {t("Video foran lyden? Flytt til venstre.")}
          </small>
        </div>
      }
    </PlayerSettings>
  );
  return (
    <div
      className="app-shell studio-shell concert-shell"
      data-motion={motion ? "on" : "off"}
      data-playing={Boolean(room?.playing)}
      data-tv={tv}
      data-empty={!current}
    >
      <Sidebar view={directoryOpen ? "rooms" : "music"} onNavigate={navigate} />
      <a className="skip-link" href="#party-content">
        {t("Hopp til musikken")}
      </a>
      <main className="main" id="party-content">
        <header className="topbar">
          <div className="top-actions">
            <LanguageSwitch />
            <button
              className="icon-button motion-toggle"
              aria-label={
                motion ? t("Slå av animasjonar") : t("Slå på animasjonar")
              }
              aria-pressed={motion}
              onClick={() => {
                setMotion(!motion);
                storage.set("afterparty-motion", motion ? "off" : "on");
              }}
            >
              <Sparkles size={17} />
            </button>
            <button className="button subtle" onClick={() => setModal("join")}>
              <Link2 size={16} /> {t("Bli med")}
            </button>
            <button
              className="button subtle"
              onClick={() => setModal("create")}
            >
              <Plus size={17} /> {t("Eige rom")}
            </button>
          </div>
        </header>
        <div className="content">
          {!directoryOpen && (!room || (discordMode && !botOnline)) && (
            <StartEvening
              offline={Boolean(room)}
              onBrowser={() => setModal("create")}
              onDiscord={() => void join("DISCORD1")}
              onJoin={() => setModal("join")}
            />
          )}
          <section className="studio-heading" hidden={!room && !directoryOpen}>
            <div>
              <h1>
                {directoryOpen ? (
                  <>
                    {t("Åpne rom")}
                    <span className="title-stop">.</span>
                  </>
                ) : discordMode || !room ? (
                  <>
                    AFTERPARTY<span className="title-stop">.</span>
                  </>
                ) : (
                  room.name
                )}
              </h1>
              <p className="concert-subtitle">
                {directoryOpen
                  ? t(
                      "Rom som vertene har åpnet for alle. Ingen konto nødvendig.",
                    )
                  : discordMode || !room
                    ? t("Musikken i Discord. Videoen her. Same augeblikk.")
                    : t("Eitt rom. Ei kø. Musikk de deler.")}
              </p>
            </div>
            <div className="room-switch" hidden={directoryOpen}>
              <span className="mode-button selected">
                <Radio size={16} />
                <span>
                  {discordMode ? t("Konsertrommet") : t("Videorommet")}
                </span>
                <span className={`status-dot ${botOnline ? "live" : ""}`} />
              </span>
              {room && !discordMode && (
                <span className="room-label">
                  {room.isHost ? t("Ditt rom") : t("Felles rom")}
                </span>
              )}
              {room?.isHost && !discordMode && (
                <button
                  className="button subtle"
                  aria-pressed={room.radio !== false}
                  disabled={pending}
                  onClick={() =>
                    void action("radio", { enabled: room.radio === false })
                  }
                >
                  <Radio size={16} />
                  {room.radio === false ? t("Radio av") : t("Radio på")}
                </button>
              )}
              {room?.isOwner && !discordMode && (
                <label className="room-visibility">
                  <input
                    type="checkbox"
                    checked={Boolean(room.isPublic)}
                    disabled={pending}
                    onChange={(e) =>
                      void action("visibility", { isPublic: e.target.checked })
                    }
                  />
                  {t("Vis i Åpne rom")}
                </label>
              )}
              <button
                className="button subtle share-button"
                disabled={!room}
                aria-label={t("Del rommet")}
                title={t("Del rommet")}
                onClick={share}
              >
                <Copy size={17} />
                {t("Inviter")}
              </button>
            </div>
          </section>
          {!directoryOpen && room && (
            <div className="party-tools">
              <label>
                {t("Kallenamnet ditt")}
                <input
                  maxLength={32}
                  value={displayName}
                  placeholder={t("Gjest")}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    storage.set("afterparty-display-name", e.target.value);
                  }}
                />
              </label>
              <button
                className="button subtle"
                onClick={() => setPanel("library")}
              >
                {t("Kveldane våre")}
              </button>
              <button className="button subtle" onClick={toggleTV}>
                {tv ? t("Avslutt TV-modus") : t("TV-modus")}
              </button>
              <span>
                {discordMode
                  ? t("Lyden kjem frå Discord")
                  : t("Lyd og video i nettlesaren")}{" "}
                ·{" "}
                {room.isOwner
                  ? t("Eigar")
                  : room.isHost
                    ? t("Medvert")
                    : t("Gjest")}
              </span>
            </div>
          )}
          {(sharing || tv) && room && (
            <RoomSharing
              room={room}
              tv={tv}
              onTV={toggleTV}
              onManage={manageRoom}
            />
          )}
          {error && (
            <div className="notice error" role="alert">
              <span>{t(error)}</span>
              <button
                className="icon-button"
                aria-label={t("Lukk melding")}
                onClick={() => setError("")}
              >
                <X size={18} />
              </button>
            </div>
          )}
          {!directoryOpen &&
            room &&
            (!online || (discordMode && !botOnline)) && (
              <div className="notice" role="status">
                {discordMode
                  ? t(
                      "Ventar på Discord-boten. Videoen tek pause dersom kontakten blir borte.",
                    )
                  : t("Kontakten med rommet er broten. Vi prøver igjen.")}
              </div>
            )}
          {directoryOpen && (
            <OpenRooms
              currentCode={room?.code}
              joining={loadingRoom}
              onCreate={() => setModal("create")}
              onJoin={(code) => {
                void join(code, false).then(() => {
                  if (activeCode.current === code) navigate("music");
                });
              }}
            />
          )}
          <div
            className="studio-grid"
            hidden={directoryOpen || !room}
          >
            <section
              ref={fullscreen.element}
              className={`stage-panel${fullscreen.fallback ? " fullscreen-fallback" : ""}`}
              data-immersive={fullscreen.active}
              data-controls-visible={controls.visible}
              tabIndex={fullscreen.active ? -1 : undefined}
              onPointerMove={controls.onPointerMove}
              onPointerDown={controls.onPointerDown}
              onPointerUp={controls.onPointerUp}
              onPointerCancel={controls.onPointerCancel}
              onBlurCapture={controls.onBlurCapture}
              aria-label={t("Videospiller")}
            >
              <div
                className="concert-stage-bar"
                data-player-chrome
                inert={hideChrome}
              >
                <span>
                  <Radio size={14} />
                  {discordMode ? t("Konsertrommet") : t("Videorommet")}
                </span>
                <span
                  className={
                    room?.playing ? "venue-status playing" : "venue-status"
                  }
                >
                  <span className="tiny-dot" />
                  {loadingRoom
                    ? t("Koplar til")
                    : room?.playing
                      ? t("På scena no")
                      : current
                        ? t("På pause")
                        : t("Klar for musikk")}
                </span>
              </div>
              <div
                className="cinema-toolbar"
                role="group"
                aria-label={t("Avspillingskontroller")}
                data-player-chrome
                inert={hideChrome}
                onPointerLeave={controls.onPointerLeave}
              >
                {current && (discordMode || room?.isHost) && (
                  <>
                    <button
                      className="cinema-button"
                      aria-label={playLabel}
                      title={playLabel}
                      disabled={pending || botPending || playerLoading}
                      onClick={togglePlayback}
                    >
                      {room?.playing && !needsVideoStart ? (
                        <Pause size={20} />
                      ) : (
                        <Play size={20} />
                      )}
                      <span>{playLabel}</span>
                    </button>
                    <button
                      className="cinema-button"
                      aria-label={t("Neste video for alle")}
                      title={t("Neste video for alle")}
                      disabled={
                        pending || botPending || (discordMode && !canSkip)
                      }
                      onClick={() =>
                        discordMode
                          ? void botCommand("skip")
                          : void action("next")
                      }
                    >
                      <SkipForward size={20} />
                      <span>{t("Neste video")}</span>
                    </button>
                  </>
                )}
                {fullscreen.active && playerSettings}
                <button
                  className="cinema-button"
                  data-fullscreen-close
                  aria-label={t("Gå ut av fullskjerm")}
                  title={t("Gå ut av fullskjerm")}
                  onClick={fullscreenToggle}
                >
                  <Minimize2 size={20} />
                  <span>{t("Lukk fullskjerm")}</span>
                </button>
              </div>
              <div
                className="stage"
                data-current={Boolean(current)}
                data-player-status={syncStatus}
                data-room-position={room?.position.toFixed(3)}
              >
                {consent && (
                  <div
                    className="youtube-player"
                    ref={playerRoot}
                    style={{
                      visibility:
                        current && !audioOnly && !playerError
                          ? "visible"
                          : "hidden",
                    }}
                  />
                )}
                {(!current ||
                  audioOnly ||
                  !consent ||
                  playerError ||
                  playerLoading) && (
                  <>
                    {current ? (
                      <img className="stage-cover" src={current.image} alt="" />
                    ) : (
                      <ConcertScenery />
                    )}
                    <div className="stage-shade" />
                    <div className="stage-intro">
                      {current ? (
                        <>
                          <h2>
                            {playerError
                              ? t("Videoen kan ikke vises")
                              : current.title}
                          </h2>
                          <p>
                            {audioOnly
                              ? t("Denne sangen spiller som lyd i Discord.")
                              : playerError
                                ? t(playerError)
                                : playerLoading
                                  ? t("Laster videospilleren …")
                                  : t("Last videoen fra YouTube.")}
                          </p>
                          {audioOnly ? (
                            <a
                              className="button subtle"
                              href={current.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {t("Åpne på SoundCloud")}{" "}
                              <ArrowUpRight size={17} />
                            </a>
                          ) : playerError ? (
                            <>
                              <button
                                className="button primary"
                                onClick={reloadPlayer}
                              >
                                <RefreshCw size={17} />{" "}
                                {t("Prøv videoen igjen")}
                              </button>
                              <a
                                className="button subtle"
                                href={`https://www.youtube.com/watch?v=${current.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {t("Åpne på YouTube")}{" "}
                                <ArrowUpRight size={17} />
                              </a>
                            </>
                          ) : (
                            <button
                              className="button primary"
                              disabled={playerLoading || pending || botPending}
                              onClick={startVideo}
                            >
                              {playerLoading ? (
                                <LoaderCircle className="spin" size={17} />
                              ) : (
                                <Play size={17} fill="currentColor" />
                              )}{" "}
                              {playerLoading
                                ? t("Laster videospilleren …")
                                : t("Start videoen")}
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <h2>
                            {discordMode ? (
                              <>
                                {t("SCENA")}
                                <br />
                                {t("ER DI.")}
                              </>
                            ) : (
                              <>
                                {t("SET TONEN.")}
                                <br />
                                {t("DEL KVELDEN.")}
                              </>
                            )}
                          </h2>
                          <p>
                            {discordMode
                              ? !discord?.connected
                                ? t(
                                    "Start med /konsert i ein talekanal. Vi tek oss av videoen.",
                                  )
                                : t(
                                    "Vel neste låt. Lyden går i Discord, videoen kjem her.",
                                  )
                              : t(
                                  "Finn ei låt i musikksøket og legg henne i køen.",
                                )}
                          </p>
                          <button
                            className="button primary"
                            onClick={() => setPanel("music")}
                          >
                            <Search size={17} /> {t("Finn musikk")}
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
                {current && consent && autoplayBlocked && !playerError && (
                  <div className="autoplay-prompt">
                    <button className="button primary" onClick={startVideo}>
                      <Play size={17} /> {t("Start videoen")}
                    </button>
                  </div>
                )}
                {autoplayMuted &&
                  !audio.value.muted &&
                  audio.value.level > 0 && (
                    <div className="audio-unlock">
                      <button
                        className="button subtle"
                        onClick={enableVideoAudio}
                      >
                        <AudioLines size={17} />
                        {t("Slå på lyd")}
                      </button>
                    </div>
                  )}
                {current && consent && !playerError && bufferSeconds >= 3 && (
                  <div className="buffer-notice" role="status">
                    <LoaderCircle className="spin" size={16} />
                    <span>
                      {t("Bufrer video ·")} {bufferSeconds} s
                      {bufferSeconds >= 8 && (
                        <small>{t("Prøv lavere kvalitet i tannhjulet.")}</small>
                      )}
                    </span>
                    {bufferSeconds >= 8 && (
                      <button className="button subtle" onClick={reloadPlayer}>
                        {t("Prøv igjen")}
                      </button>
                    )}
                  </div>
                )}
                {fullscreen.active && !controls.visible && (
                  <div
                    className="fullscreen-wake"
                    aria-hidden="true"
                    onPointerMove={controls.onPointerMove}
                    onPointerDown={controls.show}
                  />
                )}
              </div>
              <div
                className="now-playing"
                data-player-chrome
                inert={hideChrome}
                onPointerLeave={controls.onPointerLeave}
              >
                <div className="track-details">
                  <div className="track-icon">
                    <Music2 size={21} />
                  </div>
                  <div>
                    <h2>{current?.title ?? t("Ingen video vald")}</h2>
                    <p>
                      {current?.artist ??
                        t("Søk etter ei låt eller lim inn ei YouTube-lenkje.")}
                    </p>
                  </div>
                </div>
                <div className="transport">
                  {
                    <span className="sync-badge" role="status">
                      <span className="tiny-dot" />
                      {botPending ? t("Ventar på boten") : t(syncStatus)}
                    </span>
                  }
                  {current && (discordMode || room?.isHost) && (
                    <button
                      className="icon-button shared-play"
                      aria-label={playLabel}
                      disabled={pending || botPending || playerLoading}
                      onClick={togglePlayback}
                    >
                      {room?.playing && !needsVideoStart ? (
                        <Pause size={21} />
                      ) : (
                        <Play size={21} />
                      )}
                    </button>
                  )}
                  <button
                    className="icon-button"
                    aria-label={
                      discordMode
                        ? t("Neste låt i Discord")
                        : t("Neste video for alle")
                    }
                    title={
                      discordMode ? t("Neste låt i Discord") : t("Neste video")
                    }
                    disabled={
                      discordMode
                        ? !canSkip || botPending
                        : !current || !room?.isHost || pending
                    }
                    onClick={() =>
                      discordMode
                        ? void botCommand("skip")
                        : void action("next")
                    }
                  >
                    <SkipForward size={21} />
                  </button>
                  <button
                    className="icon-button fullscreen-button"
                    data-fullscreen-button
                    disabled={!current}
                    aria-label={
                      fullscreen.active
                        ? t("Gå ut av fullskjerm")
                        : t("Fullskjerm")
                    }
                    title={
                      fullscreen.active
                        ? t("Gå ut av fullskjerm")
                        : t("Fullskjerm")
                    }
                    onClick={fullscreenToggle}
                  >
                    {fullscreen.active ? (
                      <Minimize2 size={20} />
                    ) : (
                      <Maximize2 size={20} />
                    )}
                  </button>
                </div>
              </div>
              {!fullscreen.active && playerSettings}
              {room && !room.isHost && !discordMode && (
                <p className="guest-hint">
                  {t("Verten styrer avspillingen. Du kan legge til sanger.")}
                </p>
              )}
            </section>
            <aside className="library-panel" aria-label={t("Kø og musikksøk")}>
              <div
                className="library-tabs"
                role="tablist"
                aria-label={t("Musikk")}
                onKeyDown={(event) => {
                  if (
                    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key,
                    )
                  )
                    return;
                  event.preventDefault();
                  const tabs = ["queue", "music", "library"] as const;
                  const next =
                    event.key === "Home"
                      ? "queue"
                      : event.key === "End"
                        ? "library"
                        : tabs[
                            (tabs.indexOf(panel) +
                              (event.key === "ArrowLeft" ? 2 : 1)) %
                              3
                          ];
                  setPanel(next);
                  event.currentTarget
                    .querySelector<HTMLButtonElement>(`#${next}-tab`)
                    ?.focus();
                }}
              >
                <button
                  id="queue-tab"
                  role="tab"
                  tabIndex={panel === "queue" ? 0 : -1}
                  aria-controls="queue-content"
                  aria-selected={panel === "queue"}
                  onClick={() => setPanel("queue")}
                >
                  <ListMusic size={20} aria-hidden="true" />
                  <span className="tab-label">{t("Kø")}</span>
                  <span className="tab-count">{room?.queue.length ?? 0}</span>
                </button>
                <button
                  id="music-tab"
                  role="tab"
                  tabIndex={panel === "music" ? 0 : -1}
                  aria-controls="music-content"
                  aria-selected={panel === "music"}
                  onClick={() => setPanel("music")}
                >
                  <Search size={20} aria-hidden="true" />
                  <span className="tab-label">{t("Søk")}</span>
                </button>
                <button
                  id="library-tab"
                  role="tab"
                  tabIndex={panel === "library" ? 0 : -1}
                  aria-controls="library-content"
                  aria-selected={panel === "library"}
                  onClick={() => setPanel("library")}
                >
                  {t("Kveldar")}
                </button>
              </div>
              {panel === "queue" ? (
                <section
                  id="queue-content"
                  role="tabpanel"
                  aria-labelledby="queue-tab"
                  className="queue-panel"
                >
                  <div className="panel-heading">
                    <span>
                      {discordMode ? t("Neste på scena") : t("Neste i rommet")}
                    </span>
                    <small>
                      {botPending
                        ? t("Ventar på boten")
                        : room?.playing
                          ? t("Spelar no")
                          : t("Klar")}
                    </small>
                  </div>
                  <div className="queue-content">
                    {current && (
                      <div className="queue-current">
                        <img src={current.image} alt="" />
                        <div>
                          <span>
                            <AudioLines size={13} />{" "}
                            {room?.playing ? t("Spelar no") : t("På pause")}
                          </span>
                          <strong>{current.title}</strong>
                          <small>{current.artist}</small>
                        </div>
                      </div>
                    )}
                    {room && room.mode !== "discord" ? (
                      <SocialQueue
                        room={room}
                        busy={pending}
                        onAction={(name, extra) => void action(name, extra)}
                      />
                    ) : (
                      room?.queue.map((v, i) => (
                        <div className="queue-track" key={v.id + i}>
                          <span>{i + 1}</span>
                          <div>
                            <strong>{v.title}</strong>
                            <small>{v.artist}</small>
                          </div>
                        </div>
                      ))
                    )}
                    {!room?.queue.length && (
                      <div className="empty-queue">
                        <div className="empty-queue-icon" aria-hidden="true">
                          <AudioLines size={36} strokeWidth={1.7} />
                        </div>
                        <h3>
                          {current
                            ? t("Kva skal spele etterpå?")
                            : t("Bygg kveldens sett")}
                        </h3>
                        <p>
                          {t(
                            "Finn ei låt. Legg henne i køen. Gjer kvelden til dykkar.",
                          )}
                        </p>
                        <button
                          className="text-button"
                          onClick={() => setPanel("music")}
                        >
                          {t("Finn musikk")} <ArrowUpRight size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                  <footer>
                    <Users size={14} />
                    <span>
                      {discordMode
                        ? t("Konsertar frå Discord")
                        : room
                          ? t("inRoom", { count: room.viewers })
                          : t("Vel eit rom")}
                    </span>
                    {canSkip && (
                      <button
                        className="button subtle"
                        disabled={botPending}
                        onClick={() => void botCommand("skip")}
                      >
                        <SkipForward size={15} />
                        {botPending ? t("Venter") : t("Neste låt")}
                      </button>
                    )}
                  </footer>
                </section>
              ) : panel === "library" ? (
                <section
                  id="library-content"
                  role="tabpanel"
                  aria-labelledby="library-tab"
                >
                  <EveningLibrary
                    tracks={[
                      ...(room?.current ? [room.current] : []),
                      ...(room?.queue ?? []),
                    ]}
                    history={room?.history ?? []}
                    onAdd={(v) => void add(v)}
                    onRestore={(v) => void restoreEvening(v)}
                    busy={adding}
                  />
                </section>
              ) : (
                <section
                  id="music-content"
                  role="tabpanel"
                  aria-labelledby="music-tab"
                  className="discovery"
                >
                  <form
                    className="search-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void find();
                    }}
                  >
                    <input
                      aria-label={t(
                        "Søk etter låt, artist eller YouTube-lenkje",
                      )}
                      placeholder={t("Låt, artist eller YouTube-lenkje")}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      maxLength={120}
                      minLength={2}
                      required
                    />
                    <button
                      className="button primary"
                      aria-label={t("Søk etter musikk")}
                      disabled={searching}
                    >
                      {searching ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <Search size={17} />
                      )}
                    </button>
                  </form>
                  <div className="search-chips">
                    {!searched ? (
                      <>
                        <button
                          className={historySort === "recent" ? "selected" : ""}
                          onClick={() => setHistorySort("recent")}
                        >
                          {t("Nyleg spelt")}
                        </button>
                        <button
                          className={
                            historySort === "popular" ? "selected" : ""
                          }
                          onClick={() => setHistorySort("popular")}
                        >
                          {t("Mest spelt")}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          searchGeneration.current++;
                          setSearching(false);
                          setSearched(false);
                          setQuery("");
                        }}
                      >
                        {t("Historikk")} <X size={12} />
                      </button>
                    )}
                  </div>
                  {searching ? (
                    <div className="search-status" role="status">
                      <LoaderCircle className="spin" size={22} /> {t("Søker …")}
                    </div>
                  ) : shown.length ? (
                    <div className="music-list">
                      {shown.map((v) => (
                        <article className="music-row" key={v.id}>
                          <div className="music-art">
                            <img src={v.image} alt="" loading="lazy" />
                            <span>{v.live ? "LIVE" : time(v.duration)}</span>
                          </div>
                          <div className="music-copy">
                            <h3>{v.title}</h3>
                            <p>{v.artist}</p>
                            {!searched && "plays" in v && (
                              <small>
                                {Number(v.plays)} {t("avspillinger")}
                              </small>
                            )}
                          </div>
                          <button
                            className="icon-button add-track"
                            disabled={
                              adding ||
                              (!discordMode && !v.embeddable) ||
                              (discordMode &&
                                (!botOnline || !discord?.connected))
                            }
                            aria-label={
                              discordMode
                                ? t("addDiscord", { title: v.title })
                                : t("addRoom", { title: v.title })
                            }
                            title={
                              discordMode
                                ? t("Legg i Discord-kø")
                                : t("Legg i rommet")
                            }
                            onClick={() => void add(v)}
                          >
                            <Plus size={19} />
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="search-status">
                      {searched
                        ? t("Ingen treff. Prøv eit anna søk.")
                        : t("Ingen låtar i historikken enno.")}
                    </div>
                  )}
                  <p className="library-note">
                    {discordMode
                      ? !discord?.connected
                        ? t("Start /konsert i ein talekanal i Discord.")
                        : t("Konsertar spelar i Discord og blir viste her.")
                      : t("Låtar blir lagde i dette rommet.")}
                  </p>
                </section>
              )}
            </aside>
          </div>
          <div
            className="studio-foot"
            data-live-state={
              discordMode
                ? realtime.phase
                : roomLive.live
                  ? "live:room"
                  : "connecting:room"
            }
            data-socket-state={realtime.socketState}
          >
            <span className={`live-label ${room?.playing ? "is-playing" : ""}`}>
              <span className="tiny-dot" />
              {discordMode
                ? botOnline
                  ? realtime.live
                    ? t("Direkte synk")
                    : t("DISCORD TILKOPLA")
                  : t("DISCORD FRÅKOPLA")
                : roomLive.live
                  ? t("Direkte romsynk")
                  : room?.isHost
                    ? t("Du styrer rommet")
                    : t("Felles videorom")}
            </span>
            <span>
              {(discordMode ? realtime.rtt : roomLive.rtt) !== null
                ? t("connection", {
                    ms: (discordMode ? realtime.rtt : roomLive.rtt) ?? 0,
                  }) + " · "
                : ""}
              {room?.code}
              {!discordMode && room ? t(" · 48 timer") : ""}
            </span>
            <nav className="footer-links" aria-label={t("Snarveier")}>
              <a href="/patch-notes">{t("Patch notes")}</a>
              <a href="/admin" target="_top">
                Admin <ArrowUpRight size={13} />
              </a>
            </nav>
          </div>
        </div>
      </main>
      <RoomDialog
        mode={modal}
        name={roomName}
        onName={setRoomName}
        code={joinCode}
        onCode={setJoinCode}
        isPublic={publicListing}
        onPublic={setPublicListing}
        busy={pending || loadingRoom}
        error={error}
        onClose={closeModal}
        onCreate={() => void create()}
        onJoin={(code) => void join(code)}
        firstQuery={firstQuery}
        onFirstQuery={setFirstQuery}
      />
      {!tv && !directoryOpen && room && (
        <nav className="mobile-party-nav" aria-label={t("Festkontroll")}>
          <button
            onClick={() =>
              document
                .querySelector(".stage-panel")
                ?.scrollIntoView({ block: "start", behavior: "smooth" })
            }
          >
            {t("Spelar")}
          </button>
          <button
            onClick={() => {
              setPanel("music");
              requestAnimationFrame(() =>
                document
                  .querySelector<HTMLInputElement>(".search-form input")
                  ?.focus(),
              );
            }}
          >
            {t("Søk")}
          </button>
          <button
            onClick={() => {
              setPanel("queue");
              requestAnimationFrame(() =>
                document
                  .querySelector(".library-panel")
                  ?.scrollIntoView({ block: "start", behavior: "smooth" }),
              );
            }}
          >
            Kø {room?.queue.length ?? 0}
          </button>
          <button
            onClick={() => {
              setPanel("library");
              requestAnimationFrame(() =>
                document
                  .querySelector(".library-panel")
                  ?.scrollIntoView({ block: "start", behavior: "smooth" }),
              );
            }}
          >
            {t("Kveldar")}
          </button>
        </nav>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {t(toast)}
        </div>
      )}
    </div>
  );
}
