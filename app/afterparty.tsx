"use client";
import { stageDisplayMode, type ActivityMedia } from "@/lib/activity-media";
import { TrackArtwork } from "@/components/track-artwork";
import { loadYoutube, type Player } from "@/lib/youtube-player";
import { headers, request } from "@/lib/browser-api";
import { useConcertQueue } from "@/hooks/use-concert-queue";
import { notePlayerEvent, playerDiagnostics } from "@/lib/player-diagnostics";
import { NativeSeekTracker } from "@/lib/native-seek";
import { MusicDiscovery } from "@/components/party/music-discovery";
import { StartEvening } from "@/components/party/start-evening";
import { RoomDialog } from "@/components/party/room-dialog";
import { RoomSharing } from "@/components/party/room-sharing";
import { ConcertSocial } from "@/components/party/concert-social";
import { SocialQueue, QueueSettings } from "@/components/party/social-queue";
import { EveningLibrary } from "@/components/party/evening-library";
import { browserStorage as storage } from "@/lib/browser-storage";
import { Sidebar } from "@/components/afterparty-navigation";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  AudioLines,
  Check,
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
import { Room, Video, type DiscordState, type HistoryVideo } from "@/lib/types";
import { useBrowserValue, useClientReady } from "@/hooks/use-browser-value";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { useAudioPreferences } from "@/hooks/use-audio-preferences";
import { useImmersiveControls } from "@/hooks/use-immersive-controls";
import { applyAudioPreferences } from "@/lib/audio-preferences";
import {
  canCorrectPlayback,
  isDuplicateSnapshot,
  isOlderSnapshot,
  roomPollUpdate,
  transportChanged,
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
import { PlayerSettings, type SettingsTab } from "@/components/player-settings";
import releases from "@/lib/releases.json";

export default function Afterparty({ activityScope }: { activityScope?: { roomCode: string; guildId: string } & ActivityMedia } = {}) {
  const activityRoomCode = activityScope?.roomCode, activityGuildId = activityScope?.guildId;
  const { t, language } = useLanguage();
  const displayMode = stageDisplayMode(Boolean(activityScope));
  const [directoryOpen, setDirectoryOpen] = useState(false),
    [publicListing, setPublicListing] = useState(false);
  const navigate = (view: "music" | "rooms") => {
    if (activityRoomCode) return;
    setDirectoryOpen(view === "rooms");
    const url = new URL(location.href);
    if(view === "rooms") url.searchParams.set("view", "rooms");
    else url.searchParams.delete("view");
    history.pushState(null, "", url.pathname + url.search);
  };
  const {element: fullscreenElement, active: fullscreenActive, fallback: fullscreenFallback, toggle: toggleFullscreen} = useFullscreen({viewportOnly:displayMode.viewportOnly});
  const audio = useAudioPreferences();
  const motion = useBrowserValue("afterparty-motion") !== "off";
  const setMotion = (value: boolean) => storage.set("afterparty-motion", value ? "on" : "off");
  const storedOffset = Number(useBrowserValue("afterparty-sync-offset", "0"));
  const syncOffset = Number.isFinite(storedOffset) ? Math.max(-5, Math.min(5, storedOffset)) : 0;
  const displayName = useBrowserValue("afterparty-display-name", "") ?? "";
  const setDisplayName = (value: string) => storage.set("afterparty-display-name", value);
  const [panel, setPanel] = useState<"queue" | "music" | "library">("queue"),
    [syncStatus, setSyncStatus] = useState("Ventar på video"),
    [syncDrift, setSyncDrift] = useState<number | null>(null),
    [botPending, setBotPending] = useState(false);
  const [firstQuery, setFirstQuery] = useState(""),
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
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => { syncOffsetRef.current = syncOffset; }, [syncOffset]);
  const adjustSync = (value: number) => {
    syncOffsetRef.current = value;
    storage.set("afterparty-sync-offset", String(value));
    syncRef.current(true);
  };
  const fullscreenToggle = () => {
    if (roomRef.current?.current) {
      setConsent(true);
      void toggleFullscreen()
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
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("room");
  const [settingsOpen, setSettingsOpen] = useState(false),
    [quality, setQuality] = useState(""),
    [playerEpoch, setPlayerEpoch] = useState(0),
    [bufferSeconds, setBufferSeconds] = useState(0);
  const temporaryMute = useRef(false),
    mutedFallbackTried = useRef(false);
  const [autoplayMuted, setAutoplayMuted] = useState(false);
  const syncMode = readSyncMode(useBrowserValue("afterparty-sync-mode-v1"));
  const syncModeRef = useRef<SyncMode>("precise"),
    bufferStarted = useRef<number | null>(null),
    settleUntil = useRef(0),
    audioWriteUntil = useRef(0),
    nativeSeek = useRef(new NativeSeekTracker()),
    nativeSeekPending = useRef<{
      context: string;
      settled: boolean;
      successful: boolean;
    } | null>(null),
    nativeSeekDeferred = useRef<{ context: string; position: number } | null>(null),
    transportChangedRef = useRef(false),
    correctionCandidate = useRef<number | null>(null);
  useLayoutEffect(() => { syncModeRef.current = syncMode; }, [syncMode]);
  const changeSyncMode = (mode: SyncMode) => {
    syncModeRef.current = mode;
    storage.set("afterparty-sync-mode-v1", mode);
  };
  const reloadPlayer = () => {
    setPlayerError("");
    setAutoplayBlocked(false);
    setBufferSeconds(0);
    bufferStarted.current = null;
    settleUntil.current = 0;

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
      (action: string, extras?: Record<string, unknown>) => Promise<boolean>
    >(async () => false),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);
  const accept = useCallback(
    (next: Room, updateTimeline = true) => {
      if (activityRoomCode && (next.code !== activityRoomCode || next.guildId !== activityGuildId || next.mode !== "discord")) return;
      const previous = roomRef.current;
      if (!updateTimeline) {
        if (previous?.code === next.code) {
          roomRef.current = next;
          setRoom(next);
          setOnline(true);
        }
        return;
      }
      if (previous?.code === next.code)
        next = {
          ...next,
          isPublic: next.isPublic ?? previous.isPublic,
          isOwner: next.isOwner ?? previous.isOwner,
        };
      if (isOlderSnapshot(previous, next) || isDuplicateSnapshot(previous, next)) return;
      if (transportChanged(previous, next)) transportChangedRef.current = true;
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
    },
    [setRoom, setPlayerError, setOnline, activityRoomCode, activityGuildId],
  );
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
    activityGuildId ?? room?.guildId,
    !activityRoomCode && (!room || room.mode === "discord"),
  );
  const roomLive = useLiveRoom(
    activityRoomCode || room?.mode === "discord" ? undefined : room?.code,
    (next) => {
      const previous = roomRef.current;
      if (activeCode.current === next.code)
        accept({
          ...next,
          viewers: previous?.viewers ?? next.viewers,
          isHost: previous?.isHost ?? false,
        });
    },
  );
  const liveFresh = realtime.fresh;
  const authorityAt = useRef(0);
  const refresh = useCallback(
    async (code: string, signal?: AbortSignal) => {
      const generation = pollGeneration.current,
        started = performance.now();
      const next = await request<Room>(`/api/rooms/${code}`, {
        headers: headers(code),
        ...(signal ? { signal } : {}),
      });
      if (
        mounted.current &&
        generation === pollGeneration.current &&
        activeCode.current === code &&
        next.code === code
      ) {
        authorityAt.current = performance.now();
        const update = roomPollUpdate(
          roomRef.current,
          next,
          roomRef.current?.mode === "discord" ? liveFresh.current : roomLive.fresh.current,
        );
        if (update.timeline) {
          accept(compensateDelivery(update.snapshot, performance.now() - started));
        } else {
          // Authority/presence can change independently of the playback sample.
          // Retain its original local receipt time and remaining lease.
          accept(update.snapshot, false);
        }
      }
    },
    [accept, liveFresh, roomLive.fresh],
  );
  const join = useCallback(
    async (code: string, recordHistory = true) => {
      code = code.toUpperCase().trim();
      if (activityRoomCode && code !== activityRoomCode) return;
      if (activityRoomCode) recordHistory = false;
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
    [accept, setError, setLoadingRoom, setModal, setPlayerError, activityRoomCode],
  );
  const create = async () => {
    if (activityRoomCode) return;
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
      if (!current || busy.current) return false;
      const generation = pollGeneration.current;
      busy.current = true;
      setPending(true);
      setError("");
      try {
        const send = (snapshot: Room) =>
          request<{ room: Room }>(`/api/rooms/${current.code}`, {
            method: "POST",
            headers: headers(current.code),
            ...(["next", "radio"].includes(name)
              ? { signal: AbortSignal.timeout(35000) }
              : {}),
            body: JSON.stringify({
              action: name,
              guildId: roomRef.current?.guildId,
              version: snapshot.version,
              displayName: storage.get("afterparty-display-name") ?? t("Gjest"),
              ...extras,
            }),
          });
        let data: { room: Room };
        try {
          data = await send(current);
        } catch (error) {
          if (
            name !== "next" ||
            (error as Error & { status?: number }).status !== 409
          )
            throw error;
          await refresh(current.code);
          const latest = roomRef.current;
          if (
            !latest ||
            generation !== pollGeneration.current ||
            latest.code !== current.code ||
            latest.current?.id !== current.current?.id ||
            latest.playbackKey !== current.playbackKey ||
            latest.playing !== current.playing
          )
            throw error;
          data = await send(latest);
        }
        if (
          generation === pollGeneration.current &&
          activeCode.current === current.code
        ) {
          accept({
            ...data.room,
            viewers: roomRef.current?.viewers ?? data.room.viewers,
          });
          if (name === "add")
            announce(
              data.room.approvalRequired && !data.room.isHost
                ? t("Låtønsket ventar på godkjenning.")
                : t("Låta er lagd til."),
            );
        }
        return generation === pollGeneration.current && activeCode.current === current.code;
      } catch (e) {
        if (generation !== pollGeneration.current) return false;
        setError((e as Error).message);
        try {
          await refresh(current.code);
        } catch {
          /* keep action error visible */
        }
        return false;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [accept, refresh, announce, t, setPending, setError],
  );
  useLayoutEffect(() => { actionRef.current = action; }, [action]);
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
            accept({
              ...data.room,
              viewers: roomRef.current?.viewers ?? data.room.viewers,
            });
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
  const clientReady = useClientReady();
  const [urlInitialized, setUrlInitialized] = useState(false);
  if (clientReady && !urlInitialized) {
    setUrlInitialized(true);
    const params = new URLSearchParams(location.search);
    setLoadingRoom(Boolean(activityRoomCode) || params.has("room"));
    setTV(!activityRoomCode && params.get("tv") === "1");
    setDirectoryOpen(!activityRoomCode && params.get("view") === "rooms");
  }
  useEffect(() => {
    if (!storage.get("afterparty-visitor"))
      storage.set("afterparty-visitor", crypto.randomUUID());
    const params = new URLSearchParams(location.search),
      code = activityRoomCode ?? params.get("room");
    const fragment = new URLSearchParams(location.hash.slice(1));
    const invitation = fragment.get("host"),
      access = fragment.get("access");
    if (!activityRoomCode && access && code && /^[a-f0-9]{64}$/.test(access)) {
      storage.set(`afterparty-host:${code}`, access);
      history.replaceState(null, "", location.pathname + location.search);
    }
    if (!activityRoomCode && invitation && code) {
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
    } else if (code) {
      const generation = ++joinGeneration.current;
      const started = performance.now();
      void request<Room>(`/api/rooms/${code}`, {headers: headers(code)}).then(next => {
        if(!mounted.current || generation !== joinGeneration.current) return;
        pollGeneration.current++;
        activeCode.current = code;
        accept(compensateDelivery(next, performance.now() - started));
        setDirectoryOpen(!activityRoomCode && params.get("view") === "rooms");
        setLoadingRoom(false);
      }, e => { if(mounted.current && generation === joinGeneration.current){setError(e.message);setLoadingRoom(false);} });
    }
    const pop = () => {
      if (activityRoomCode) return;
      const generation = ++joinGeneration.current;
      const p = new URLSearchParams(location.search);
      setDirectoryOpen(p.get("view") === "rooms");
      setTV(p.get("tv") === "1");
      const next = p.get("room");
      if (next && next !== activeCode.current) {
        const started = performance.now();
        void request<Room>(`/api/rooms/${next}`, { headers: headers(next) })
          .then((value) => {
            if (!mounted.current || generation !== joinGeneration.current) return;
            pollGeneration.current++;
            activeCode.current = next;
            accept(compensateDelivery(value, performance.now() - started));
          })
          .catch((e) => {
            if (mounted.current && generation === joinGeneration.current) setError(e.message);
          });
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
  }, [join, accept, activityRoomCode]);
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
    if(next) url.searchParams.set("tv", "1");
    else url.searchParams.delete("tv");
    history.pushState(null, "", url.pathname + url.search);
  };

  const concertQueue = useConcertQueue(
    room?.mode === "discord" ? room.guildId : undefined,
    activityRoomCode ? 10000 : 3000,
  );
  async function seekDiscord(seconds: number) {
    const target = roomRef.current,
      generation = pollGeneration.current;
    if (!target?.guildId || target.mode !== "discord" || !concertQueue.data?.canManage ||
      discord?.guildId !== target.guildId || !discord.queueRevision)
      return false;
    const current = () => mounted.current &&
      generation === pollGeneration.current &&
      roomRef.current?.playbackKey === target.playbackKey &&
      roomRef.current?.code === target.code;
    setError("");
    try {
      // Keep privileged seeking separate from the public transport endpoint.
      const sent = await request<{ id: string; status: string }>("/api/admin/control", {
        method: "POST",
        headers: headers(),
        signal: AbortSignal.timeout(35000),
        body: JSON.stringify({
          guildId: target.guildId,
          operation: "command",
          commandId: crypto.randomUUID(),
          command: { action: "seek", seconds, queueRevision: discord.queueRevision },
        }),
      });
      let status = sent.status;
      const deadline = performance.now() + 35000;
      while (current() && status === "processing" && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (!current()) return false;
        const result = await request<{ commands: Array<{ id: string; status: string; result?: string }> }>(
          "/api/admin/control?guildId=" + target.guildId,
        );
        const job = result.commands.find((job) => job.id === sent.id);
        status = job?.status ?? "processing";
        if (job && ["failed", "unknown", "expired"].includes(job.status))
          throw new Error(job.result || "Boten bekreftet ikke kommandoen.");
      }
      if (!current()) return false;
      if (status !== "done") throw new Error("Boten bekreftet ikke kommandoen.");
      // A cached stream sample can predate the command. Read public authority
      // directly, retaining concert filtering and rejecting older snapshots.
      await refresh(target.code);
      return current();
    } catch (error) {
      if (current()) setError((error as Error).message);
      return false;
    }
  }
  const queueRoom =
    room?.mode === "discord" && concertQueue.data
      ? {
          ...room,
          ...concertQueue.data.state,
          isHost: concertQueue.data.canManage,
        }
      : room;
  const queueAction = (name: string, extra?: Record<string, unknown>) =>
    room?.mode === "discord"
      ? void concertQueue.action(name, {
          playbackKey: room.playbackKey,
          ...extra,
        })
      : void action(name, extra);
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
      if (!mounted.current || generation !== pollGeneration.current) return false;
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
          await Promise.all([refresh(activeCode.current), concertQueue.reload()]);
        return true;
      }
      const deadline = performance.now() + 35000;
      let confirmed = false;
      while (mounted.current && generation === pollGeneration.current && performance.now() < deadline) {
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
            await Promise.all([refresh(activeCode.current), concertQueue.reload()]);
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
    const controller = new AbortController();
    const guildId = activityGuildId ?? room?.guildId;
    const update = async () => {
      try {
        if (
          liveFresh.current ||
          (roomRef.current && roomRef.current.mode !== "discord")
        ) {
          timer = setTimeout(update, 10000);
          return;
        }
        const d = await request<{ state: DiscordState | null }>(
          "/api/discord" +
            (guildId
              ? "?guildId=" + guildId
              : ""),
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(12000),
            ]),
          },
        );
        if (!disposed && !liveFresh.current && (!guildId || !d.state || d.state.guildId === guildId)) setDiscord(d.state);
      } catch {
        if (!disposed && !liveFresh.current)
          setDiscord((previous) =>
            previous ? { ...previous, online: false } : null,
          );
      }
      if (!disposed) timer = setTimeout(update, document.hidden ? 15000 : activityRoomCode ? 10000 : 3000);
    };
    void update();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [liveFresh, room?.guildId, room?.mode, realtime.live, activityGuildId, activityRoomCode]);
  function startVideo() {
    const r = roomRef.current;
    if (!r?.current) return;
    setConsent(true);
    setAutoplayBlocked(false);
    mutedFallbackTried.current = false;
    if (!r.playing && (r.mode === "discord" || r.isHost)) {
      if (r.mode === "discord") void botCommand("resume");
      else void action("play");
    }
    if (playerReady.current && player.current && r.playing) {
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
    const controller = new AbortController();
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
          await refresh(room.code, AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]));
      } catch (e) {
        if (!stopped && !(room.mode === "discord" ? liveFresh.current : roomLive.fresh.current)) {
          setOnline(false);
          if ((e as Error).message.includes("avsluttet")) {
            setError((e as Error).message);
            stopped = true;
          }
        }
      } finally {
        inFlight = false;
      }
      if (!stopped) timer = setTimeout(poll, activityRoomCode ? Math.max(10000, roomPollMs(document.hidden)) : roomPollMs(document.hidden));
    };
    timer = setTimeout(poll, activityRoomCode ? Math.max(10000, roomPollMs(document.hidden)) : roomPollMs(document.hidden));
    const focus = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void poll();
        syncRef.current();
      }
    };
    document.addEventListener("visibilitychange", focus);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [room?.code, room?.mode, refresh, liveFresh, roomLive.fresh, activityRoomCode]);
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
  const playerAudioReady = useEffectEvent((p: Player) => applyAudioPreferences(p, audio.current.current));
  const playerRefresh = useEffectEvent((code: string) => refresh(code));
  useEffect(() => {
    if (!displayMode.embeddedVideo || !consent || !playerRoot.current) return;
    let disposed = false;
    setPlayerLoading(true);
    const readyTimer = setTimeout(() => {
      if (!disposed && !playerReady.current) {
        setPlayerLoading(false);
        setPlayerError("YouTube-spilleren svarer ikke. Prøv videoen igjen.");
      }
    }, 15000);
    Object.assign(window, { afterpartyPlaybackDiagnostics: playerDiagnostics });
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
              playerAudioReady(p);
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
              if (event.data === 3) {
                if (bufferStarted.current === null)
                  notePlayerEvent("buffer-start");
                bufferStarted.current ??= performance.now();
                setSyncStatus("Bufrer video");
              } else {
                if (bufferStarted.current !== null)
                  notePlayerEvent(
                    "buffer-end",
                    performance.now() - bufferStarted.current,
                  );
                if (event.data === 1 && bufferStarted.current !== null) {
                  settleUntil.current =
                    performance.now() + syncRecoveryMs(syncModeRef.current);
                  lastCorrection.current = performance.now();
                }
                bufferStarted.current = null;
                setBufferSeconds(0);
              }
              if (event.data === 1) {
                setAutoplayBlocked(false);
                syncRef.current();
              }
              const r = roomRef.current;
              if (event.data === 0 && r?.current) {
                const key = `${r.code}:${r.playbackKey ?? r.current.id}`;
                if (lastEnded.current !== key) {
                  lastEnded.current = key;
                  void playerRefresh(r.code).catch(() => {});
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
  }, [consent, playerEpoch, displayMode.embeddedVideo]);
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
    const requestedSync = force,
      p = player.current,
      r = roomRef.current;
    const seekContext = r?.current
      ? JSON.stringify([pollGeneration.current, r.code, r.mode, r.guildId, r.playbackKey ?? r.current.id])
      : "";
    const retiredSeek = Boolean(
      (nativeSeekPending.current && nativeSeekPending.current.context !== seekContext) ||
      (nativeSeekDeferred.current && nativeSeekDeferred.current.context !== seekContext),
    );
    if (retiredSeek) nativeSeekPending.current = null;
    if (requestedSync || retiredSeek) {
      nativeSeekDeferred.current = null;
      nativeSeek.current.reset();
    }
    if (!p || !playerReady.current) return;
    if (!r?.current || r.current.source === "soundcloud") {
      p.pauseVideo();
      setSyncStatus(r?.current ? "Lyd i Discord" : "Ingen video");
      return;
    }
    const now = performance.now(),
      target = playbackTarget(r, received.current, now, syncOffsetRef.current);
    if (target.stale) {
      p.pauseVideo();
      setSyncStatus(
        r.mode === "discord" ? "Ventar på boten" : "Venter på rommet",
      );
      return;
    }
    if (playerError) return;
    force ||= transportChangedRef.current;
    const key = `${r.code}:${r.playbackKey ?? r.current.id}`;
    if (lastEnded.current === key) {
      if (p.getPlayerState() === 1) p.pauseVideo();
      setSyncStatus("Venter på neste video");
      return;
    }
    if (loadedId.current !== key) {
      loadedId.current = key;
      nativeSeek.current.write(target.position);
      transportChangedRef.current = false;
      correctionCandidate.current = null;

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
      if(target.playing) p.loadVideoById({
            videoId: r.current.id,
            startSeconds: target.position,
          });
      else p.cueVideoById({
            videoId: r.current.id,
            startSeconds: target.position,
          });
      setSyncStatus("Laster video");
      return;
    }
    if (temporaryMute.current && !p.isMuted()) {
      temporaryMute.current = false;
      setAutoplayMuted(false);
    }
    if (now >= audioWriteUntil.current && !temporaryMute.current)
      audio.fromPlayer(p.getVolume(), p.isMuted());
    const state = p.getPlayerState();
    if (state !== 3) transportChangedRef.current = false;
    if (state === 1) recordPlayback();
    const currentTime = p.getCurrentTime();
    // The iframe can finish our load/seek while Core is still buffering or
    // manager permissions are loading. Observe the landing before those guards
    // so subsequent user scrubs are not mistaken for our unfinished write.
    nativeSeek.current.acknowledge(currentTime, now);
    if (nativeSeekPending.current?.settled && !nativeSeekPending.current.successful) {
      nativeSeekPending.current = null;
      nativeSeekDeferred.current = null;
      nativeSeek.current.resetObservation();
    }
    const canSeek = !r.current.live && Boolean(
      r.mode === "discord"
        ? concertQueue.data?.canManage && discord?.guildId === r.guildId && Boolean(discord?.queueRevision)
        : r.isHost,
    );
    if (!canSeek) {
      nativeSeekDeferred.current = null;
      nativeSeek.current.resetObservation();
    }
    const operation = nativeSeekPending.current,
      retainingSeek = Boolean(operation || nativeSeekDeferred.current);
    if (
      canSeek && !requestedSync &&
      (!force || retainingSeek) &&
      (!(r.buffering && r.playing) || retainingSeek)
    ) {
      // A later scrub can arrive while Core acknowledges the first. Keep the
      // latest confirmed intent through that acknowledgment and its refresh.
      const seek = nativeSeek.current.observe(currentTime, now, state);
      if (seek !== null) nativeSeekDeferred.current = { context: seekContext, position: seek };
      if (nativeSeek.current.pending) return;
      const deferred = nativeSeekDeferred.current;
      if (deferred && (!operation || operation.settled)) {
        const pending = { context: seekContext, settled: false, successful: false };
        nativeSeekPending.current = pending;
        nativeSeekDeferred.current = null;
        const command = r.mode === "discord"
          ? seekDiscord(deferred.position)
          : actionRef.current("seek", { position: deferred.position });
        const completed = (successful: boolean) => {
          if (nativeSeekPending.current !== pending) return;
          pending.settled = true;
          pending.successful = successful;
        };
        void command.then(completed, () => completed(false));
        return;
      }
    }
    if (operation && !operation.settled && !requestedSync) return;
    if (operation?.settled) nativeSeekPending.current = null;
    // A short audio stall is not a shared pause. Keep the iframe intact and
    // let the normal drift policy reconcile once the authoritative clock moves.
    if (r.buffering && r.playing) {
      setSyncStatus("Bufrer lyd i Discord");
      return;
    }
    setSyncDrift(
      r.current.live
        ? null
        : Math.round((currentTime - target.position) * 10) / 10,
    );
    // Require persistent drift; a single delayed iframe sample is not a seek.
    const drift = Math.abs(currentTime - target.position);
    if (state !== 1 || drift < (syncModeRef.current === "stable" ? 1.5 : 0.5))
      correctionCandidate.current = null;
    else correctionCandidate.current ??= now;
    const persistent =
      correctionCandidate.current !== null &&
      now - correctionCandidate.current >= 1000;
    if (
      (force || !target.playing || persistent) &&
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
        force,
        syncModeRef.current,
      ) &&
      !r.current.live
    ) {
      correctionCandidate.current = null;
      settleUntil.current = now + syncRecoveryMs(syncModeRef.current);
      nativeSeek.current.write(target.position);
      notePlayerEvent("correction");
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
                : target.playing
                    ? "Synk aktiv"
                    : "På pause",
      );
    if (
      target.playing &&
      !autoplayBlocked &&
      ![1, 3].includes(state)
    ) {
      p.playVideo();
    }
    if (!target.playing && state === 1) {
      p.pauseVideo();
    }
  }
  useLayoutEffect(() => { syncRef.current = syncPlayer; });
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
    displayMode.embeddedVideo &&
    !audioOnly &&
    (!consent || autoplayBlocked),
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
    fullscreenActive,
    Boolean(!displayMode.embeddedVideo || playerError || autoplayBlocked || !current || settingsOpen),
    fullscreenElement,
  );
  const hideChrome = fullscreenActive && !controls.visible;
  const fullscreenShortcut = useEffectEvent(fullscreenToggle);
  const muteShortcut = useEffectEvent(audio.toggleMute);
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
        fullscreenShortcut();
      }
      if (event.key.toLowerCase() === "m" && roomRef.current?.current) {
        event.preventDefault();
        muteShortcut();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const playerSettings = room && (
    <PlayerSettings
      compact={fullscreenActive}
      open={settingsOpen}
      onOpen={setSettingsOpen}
      active={settingsTab}
      onTab={setSettingsTab}
      mode={syncMode}
      onMode={changeSyncMode}
      quality={t(quality)}
      enabled={Boolean(current) && consent}
      onRetry={reloadPlayer}
      onSync={() => syncRef.current(true)}
      roomSettings={<>
              <div className="party-tools">
                {room?.isHost && !discordMode && (
                  <button
                    className="button subtle room-radio-control"
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
                        void action("visibility", {
                          isPublic: e.target.checked,
                        })
                      }
                    />
                    {t("Vis i Åpne rom")}
                  </label>
                )}

                <div className="room-personalization">
                <label className="display-name">
                  {t("Kallenamnet ditt")}
                  <input
                    maxLength={32}
                    aria-describedby="display-name-help"
                    value={displayName}
                    placeholder={t("Gjest")}
                    onChange={(e) => {
                      setDisplayName(e.target.value);
                    }}
                  />
                </label>
                <button className="button subtle tv-mode-button" onClick={toggleTV}>
                  {tv ? t("Avslutt TV-modus") : t("TV-modus")}
                </button>
                <small id="display-name-help">
                  {t("Namnet som blir vist på låtønska dine. Det gir ingen ekstra tilgang.")}
                </small>
                </div>
              </div>
              {discordMode && !concertQueue.data?.canManage && (
                <p>
                  {t("Logg inn med Discord for å administrere denne serveren.")}{" "}
                  {!activityRoomCode && <a href="/api/auth/discord">Discord</a>}
                </p>
              )}
      </>}
      queueSettings={
              queueRoom && (!discordMode || concertQueue.data) && (
                <QueueSettings
                  room={queueRoom}
                  busy={discordMode ? concertQueue.busy : pending}
                  onAction={queueAction}
                />
              )
      }
    >
      {discordMode && (
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
      )}
    </PlayerSettings>
  );
  return (
    <div
      className="app-shell studio-shell concert-shell"
      data-motion={motion ? "on" : "off"}
      data-welcome={!room && !directoryOpen ? "true" : "false"}
      data-playing={Boolean(room?.playing)}
      data-tv={tv && Boolean(room)}
      data-empty={!current}
    >
      {!activityRoomCode && <Sidebar view={directoryOpen ? "rooms" : "music"} onNavigate={navigate} />}
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
              }}
            >
              <Sparkles size={17} />
            </button>
            {!activityRoomCode && <button className="button subtle" onClick={() => setModal("join")}>
              <Link2 size={16} /> {t("Bli med")}
            </button>}
            {!activityRoomCode && <button
              className="button subtle"
              onClick={() => setModal("create")}
            >
              <Plus size={17} /> {t("Eige rom")}
            </button>}
          </div>
        </header>
        <div className="content">
          {!activityRoomCode && !directoryOpen && (!room || (discordMode && !botOnline)) && (
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
                    ? t(activityScope ? "Musikken og fellesskapet i Discord." : "Musikken i Discord. Videoen her. Same augeblikk.")
                    : null}
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
          <div className="studio-grid" hidden={directoryOpen || !room}>
            <section
              ref={fullscreenElement}
              className={`stage-panel${fullscreenFallback ? " fullscreen-fallback" : ""}`}
              data-immersive={fullscreenActive}
              role={fullscreenFallback ? "dialog" : undefined}
              aria-modal={fullscreenFallback ? true : undefined}
              data-controls-visible={controls.visible}
              tabIndex={fullscreenActive ? -1 : undefined}
              onPointerMove={controls.onPointerMove}
              onPointerDown={controls.onPointerDown}
              onPointerUp={controls.onPointerUp}
              onPointerCancel={controls.onPointerCancel}
              onBlurCapture={controls.onBlurCapture}
              aria-label={t(activityScope ? "Konsertscene" : "Videospiller")}
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
                {fullscreenActive && playerSettings}
                <button
                  className="cinema-button"
                  data-fullscreen-close
                  aria-label={t(fullscreenFallback ? "Gjenopprett scena" : displayMode.restore)}
                  title={t(fullscreenFallback ? "Gjenopprett scena" : displayMode.restore)}
                  onClick={fullscreenToggle}
                >
                  <Minimize2 size={20} />
                  <span>{t(fullscreenFallback ? "Gjenopprett scena" : displayMode.restore)}</span>
                </button>
              </div>
              <div
                className="stage"
                data-current={Boolean(current)}
                data-player-status={activityScope ? "discord-audio" : syncStatus}
                data-room-position={room?.position.toFixed(3)}
              >
                {displayMode.embeddedVideo && consent && (
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
                {(!displayMode.embeddedVideo || !current ||
                  audioOnly ||
                  !consent ||
                  playerError ||
                  playerLoading) && (
                  <>
                    {current ? (
                      <TrackArtwork width={480} height={270} className="stage-cover" video={current} alt="" />
                    ) : (
                      <ConcertScenery />
                    )}
                    <div className="stage-shade" />
                    <div className="stage-intro">
                      {current ? (
                        <>
                          <h2>
                            {!displayMode.embeddedVideo
                              ? current.title
                              : playerError
                              ? t("Videoen kan ikke vises")
                              : current.title}
                          </h2>
                          <p>
                            {activityScope
                              ? t("Lyden spelar i Discord. Video opnar på YouTube.")
                              : audioOnly
                              ? t("Denne sangen spiller som lyd i Discord.")
                              : playerError
                                ? t(playerError)
                                : playerLoading
                                  ? t("Laster videospilleren …")
                                  : t("Last videoen fra YouTube.")}
                          </p>
                          {activityScope && !audioOnly ? (
                            <button className="button subtle" onClick={() => { void activityScope.openVideo(current.id).then(opened => { if (!opened) announce("Discord kunne ikkje opne YouTube. Prøv igjen frå Discord."); }); }}>
                              {t("Åpne på YouTube")} <ArrowUpRight size={17} />
                            </button>
                          ) : audioOnly ? (
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
                {fullscreenActive && !controls.visible && (
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
                      {botPending ? t("Ventar på boten") : activityScope ? t("Lyd i Discord") : t(syncStatus)}
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
                      fullscreenActive
                        ? t(fullscreenFallback ? "Gjenopprett scena" : displayMode.restore)
                        : t(displayMode.expand)
                    }
                    title={
                      fullscreenActive
                        ? t(fullscreenFallback ? "Gjenopprett scena" : displayMode.restore)
                        : t(displayMode.expand)
                    }
                    onClick={fullscreenToggle}
                  >
                    {fullscreenActive ? (
                      <Minimize2 size={20} />
                    ) : (
                      <Maximize2 size={20} />
                    )}
                  </button>
                </div>
              </div>
              {!fullscreenActive && playerSettings}
              {room && !fullscreenActive && !tv && <ConcertSocial room={room} />}
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
                  <span className="tab-count">
                    {queueRoom?.queue.length ?? 0}
                  </span>
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
                    {room?.current && (
                      <article className="queue-current">
                        <TrackArtwork width={480} height={270}
                          video={room.current}
                          alt=""
                        />
                        <div>
                          <span>{t("Spelar no")}</span>
                          <strong>{room.current.title}</strong>
                          <small>{room.current.artist}</small>
                        </div>
                      </article>
                    )}
                    {queueRoom && (
                      <SocialQueue
                        room={queueRoom}
                        busy={
                          discordMode
                            ? concertQueue.busy || !concertQueue.data
                            : pending
                        }
                        onAction={queueAction}
                      />
                    )}
                    {discordMode && concertQueue.error && (
                      <p role="alert">{t(concertQueue.error)}</p>
                    )}
                    {!queueRoom?.queue.length && (
                      <div className="empty-queue">
                        <h3>{t("Køa er tom")}</h3>
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
                <MusicDiscovery
                  query={query}
                  searching={searching}
                  searched={searched}
                  historySort={historySort}
                  shown={shown}
                  adding={adding}
                  discordMode={discordMode}
                  discordConnected={Boolean(botOnline && discord?.connected)}
                  onQuery={setQuery}
                  onSearch={() => void find()}
                  onSort={setHistorySort}
                  onHistory={() => {
                    searchGeneration.current++;
                    setSearching(false);
                    setSearched(false);
                    setQuery("");
                  }}
                  onAdd={(video) => void add(video)}
                />
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
            {!activityRoomCode && <nav className="footer-links" aria-label={t("Snarveier")}>
              <a href="/install">
                {language === "en" ? "Install bot" : "Legg til bot"}
              </a>
              <a href="/terms">{language === "en" ? "Terms" : "Vilkår"}</a>
              <a href="/privacy">
                {language === "en" ? "Privacy" : "Personvern"}
              </a>
              <a href="/support">Support</a>
              <a href="/patch-notes" data-latest-release>
                {t("Patch notes")} · v{releases[0].version}
              </a>
              <a href="/admin" target="_top">
                Admin <ArrowUpRight size={13} />
              </a>
            </nav>}
          </div>
        </div>
      </main>
      <RoomDialog
        mode={activityRoomCode ? null : modal}
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
            Kø {queueRoom?.queue.length ?? 0}
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
