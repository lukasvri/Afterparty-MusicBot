<script lang="ts">
  import { onDestroy, onMount, tick as afterRender, type Snippet } from 'svelte';
  import { loadYoutube, type Player, type PlayerEvent } from '../../../../../lib/youtube-player.ts';
  import {
    calibratedPlaybackPosition,
    canCorrectPlayback,
    MAX_SYNC_OFFSET_SECONDS,
    readSyncMode,
    readSyncOffset,
    createPlaybackCorrection,
    shouldCorrect,
    syncRecoveryMs,
    SYNC_MODE_KEY,
    SYNC_OFFSET_KEY,
    type SyncMode,
  } from '../../../../../lib/playback-sync.ts';
  import type { Room } from '../../../../../lib/types.ts';
  import Icon from '../ui/Icon.svelte';
  import { browserStorage } from '../../../../../lib/browser-storage.ts';
  import { confirmsPlayerIntent, createPlayerIntent, type PlayerIntent } from './player-intent.ts';
  export type SharedPlayerIntent = PlayerIntent & {
    code: string;
    videoId: string;
    playbackKey?: string;
  };
  import {
    notePlayerError,
    notePlayerEvent,
    playerDiagnostics,
    resetPlayerError,
  } from '../../../../../lib/player-diagnostics.ts';
  import {
    enterFullscreen,
    fullscreenElement,
    leaveFullscreen,
  } from '../../../../../lib/fullscreen.ts';
  import {
    adoptPlayerAudio,
    applyAudioPreferences,
    defaultAudio,
    readAudioPreferences,
    toggleAudioMute,
  } from '../../../../../lib/audio-preferences.ts';
  let audio = $state({ ...defaultAudio });
  let syncOffset = $state(0),
    syncMode = $state<SyncMode>('precise'),
    playerEpoch = $state(0);
  let stage: HTMLDivElement;
  let fullscreen = $state(false);
  let fullscreenFallback = $state(false);
  let diagnostics = $state<ReturnType<typeof playerDiagnostics> | null>(null);
  let bufferingAt: number | null = null;
  function saveAudio() {
    browserStorage.set('afterparty-audio', JSON.stringify(audio));
  }
  let audioWriteUntil = 0,
    appliedAudio = '';
  function writePlayerAudio(force = false) {
    if (!ready || !player) return;
    const key = `${generation}:${audio.level}:${audio.muted}:${audio.lastAudible}`;
    if (!force && appliedAudio === key) return;
    appliedAudio = key;
    audioWriteUntil = performance.now() + 1000;
    applyAudioPreferences(player, audio);
  }
  function readPlayerAudio() {
    if (disposed || !ready || !player || performance.now() < audioWriteUntil) return;
    const current = player;
    try {
      const next = adoptPlayerAudio(audio, current.getVolume(), current.isMuted());
      if (current === player && ready && next !== audio) {
        audio = next;
        saveAudio();
      }
    } catch {
      /* Iframe RPC can briefly disappear while a source is replaced. */
    }
  }
  async function toggleFullscreen() {
    try {
      if (fullscreen) {
        await leaveFullscreen(stage);
        fullscreenFallback = false;
        fullscreen = false;
      } else {
        fullscreenFallback = !(await enterFullscreen(stage));
        fullscreen = true;
      }
    } catch {
      message = 'Fullscreen is unavailable in this browser.';
    }
  }
  onMount(() => {
    const read = () => {
      audio = readAudioPreferences(
        browserStorage.get('afterparty-audio'),
        browserStorage.get('afterparty-volume'),
      );
    };
    read();
    const readSync = () => {
      const nextOffset = readSyncOffset(browserStorage.get(SYNC_OFFSET_KEY));
      const adjusted = nextOffset !== syncOffset;
      syncOffset = nextOffset;
      syncMode = readSyncMode(browserStorage.get(SYNC_MODE_KEY));
      if (adjusted && ready) sync(true);
    };
    readSync();
    const subscriptions = [
      browserStorage.subscribe('afterparty-audio', read),
      browserStorage.subscribe('afterparty-volume', read),
      browserStorage.subscribe(SYNC_OFFSET_KEY, readSync),
      browserStorage.subscribe(SYNC_MODE_KEY, readSync),
    ];
    const changed = () => {
      const active = fullscreenElement(document);
      fullscreen =
        fullscreenFallback || active === stage || Boolean(active && stage.contains(active));
    };
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
      )
        return;
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        void toggleFullscreen();
      } else if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        audio = toggleAudioMute(audio);
        saveAudio();
      } else if (event.key === 'Escape' && fullscreenFallback) {
        event.preventDefault();
        void toggleFullscreen();
      }
    };
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('webkitfullscreenchange', changed);
    window.addEventListener('keydown', keyboard);
    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('webkitfullscreenchange', changed);
      window.removeEventListener('keydown', keyboard);
    };
  });

  let {
    room,
    position,
    playing,
    canControl = false,
    canSeek = canControl,
    controlBusy = false,
    onIntent,
    settings,
    settingsLabel = 'Playback settings',
    footer,
  }: {
    room: Room;
    position: number;
    playing: boolean;
    canControl?: boolean;
    canSeek?: boolean;
    controlBusy?: boolean;
    onIntent?: (intent: SharedPlayerIntent) => Promise<boolean>;
    settings?: Snippet;
    settingsLabel?: string;
    footer?: Snippet;
  } = $props();
  let container = $state<HTMLDivElement>();
  let player: Player | null = null;
  let ready = $state(false),
    loading = $state(false),
    enabled = $state(false),
    message = $state('');
  let disposed = false,
    loaded = '',
    lastPlaying = false,
    correctedAt = -Infinity,
    settleUntil = 0,
    generation = 0;
  const native = createPlayerIntent();
  const correction = createPlaybackCorrection();
  let localPaused = $state(false);
  let nativePending = $state<{
    identity: string;
    intent: PlayerIntent;
    settled: boolean;
    deadline: number;
    version: number;
    issuedAt: number;
    pausePinned: boolean;
  } | null>(null);
  const identity = () => `${room.code}:${room.current?.id ?? ''}:${room.playbackKey ?? ''}`;
  function command(action: 'load' | 'cue' | 'play' | 'pause' | 'seek', position?: number) {
    native.command(identity(), action, performance.now(), position);
  }
  function observation(state = player?.getPlayerState() ?? -1) {
    let sourceMatches = false;
    try {
      const url = new URL(player?.getVideoUrl?.() ?? '');
      sourceMatches =
        ['www.youtube.com', 'youtube.com', 'youtu.be'].includes(url.hostname) &&
        (url.searchParams.get('v') ?? url.pathname.slice(1)) === room.current?.id;
    } catch {
      /* Only the loaded, identified video can control shared playback. */
    }
    const iframe = player?.getIframe?.() ?? stage?.querySelector('iframe');
    return {
      identity: identity(),
      state,
      position: player?.getCurrentTime() ?? 0,
      now: performance.now(),
      gesture: Boolean(
        sourceMatches &&
        iframe &&
        document.activeElement === iframe &&
        document.hasFocus() &&
        document.visibilityState === 'visible' &&
        navigator.userActivation?.isActive,
      ),
    };
  }
  async function nativeIntent(intent: PlayerIntent) {
    if (!ready || !player || !room.current || loaded !== identity()) return;
    if (intent.action === 'pause') {
      localPaused = true;
      if (nativePending) nativePending = { ...nativePending, pausePinned: true };
    }
    if (nativePending || controlBusy) return;
    if (
      intent.action === 'seek' &&
      (room.current.live ||
        !Number.isFinite(intent.position) ||
        intent.position! < 0 ||
        intent.position! >= room.current.duration)
    ) {
      sync(true);
      return;
    }
    if (intent.action === 'pause') localPaused = true;
    if (intent.action === 'play') localPaused = false;
    const shared = !intent.local && onIntent && (intent.action === 'seek' ? canSeek : canControl);
    const needed =
      intent.action === 'seek' || (intent.action === 'play' ? !room.playing : room.playing);
    if (!shared || !needed) {
      if (intent.action === 'play' && !playing) message = 'The host has paused shared playback.';
      sync(true);
      return;
    }
    const issuedAt = performance.now();
    const pending = {
      identity: identity(),
      intent,
      settled: false,
      deadline: issuedAt + 40000,
      version: room.version,
      issuedAt,
      pausePinned: false,
    };
    nativePending = pending;
    if (intent.action === 'seek' && player.getPlayerState() === 1) {
      command('pause');
      player.pauseVideo();
      lastPlaying = false;
    }
    const epoch = generation;
    message = '';
    let accepted = false;
    try {
      accepted = await onIntent!({
        ...intent,
        ...(intent.action === 'seek'
          ? { position: calibratedPlaybackPosition(room, intent.position!, -syncOffset) }
          : {}),
        code: room.code,
        videoId: room.current.id,
        playbackKey: room.playbackKey,
      });
    } catch {
      /* The existing client reports the scoped command failure. */
    }
    if (disposed || generation !== epoch || nativePending?.identity !== pending.identity) return;
    if (!accepted) {
      nativePending = null;
      message = 'Shared playback could not be updated. Reconnect before trying again.';
    } else nativePending = { ...pending, ...nativePending, settled: true };
    await afterRender();
    if (!disposed && generation === epoch) sync(true);
  }
  function readNativePosition() {
    if (!ready || !player || nativePending || controlBusy || loaded !== identity()) return;
    try {
      const intent = native.time(observation());
      if (intent) void nativeIntent(intent);
    } catch {
      /* A replacing iframe cannot issue a command. */
    }
  }

  function sync(force = false) {
    if (!ready || !player || !room.current) return;
    const localPosition = calibratedPlaybackPosition(room, position, syncOffset);
    const key = `${room.code}:${room.current.id}:${room.playbackKey ?? ''}`;
    if (nativePending && nativePending.identity !== key) nativePending = null;
    if (nativePending) {
      if (!nativePending.settled || controlBusy) {
        correction.reset();
        return;
      }
      const confirmed = confirmsPlayerIntent(nativePending.intent, {
        version: room.version,
        previousVersion: nativePending.version,
        playing: room.playing,
        position: localPosition,
        elapsed: room.buffering ? 0 : performance.now() - nativePending.issuedAt,
      });
      if (!confirmed && performance.now() < nativePending.deadline) return;
      if (confirmed && nativePending.intent.action !== 'seek' && !nativePending.pausePinned)
        localPaused = false;
      if (!confirmed) {
        if (nativePending.intent.action === 'seek') localPaused = true;
        message = 'Shared playback has not caught up. Reconnect before trying again.';
      }
      nativePending = null;
    }
    const audible = playing && !localPaused;
    if (loaded !== key) {
      correction.reset();
      correctedAt = -Infinity;
      loaded = key;
      writePlayerAudio(true);
      const video = { videoId: room.current.id, startSeconds: localPosition };
      command(audible ? 'load' : 'cue', localPosition);
      if (audible) player.loadVideoById(video);
      else player.cueVideoById(video);
      lastPlaying = audible;
      settleUntil = performance.now() + syncRecoveryMs(syncMode);
      return;
    }
    if (audible !== lastPlaying || (force && !audible && player.getPlayerState() === 1)) {
      const state = player.getPlayerState();
      if (audible && state !== 1) {
        command('play');
        player.playVideo();
      } else if (!audible && state !== 2) {
        command('pause');
        player.pauseVideo();
      }
      lastPlaying = audible;
      force = true;
    }
    const now = performance.now();
    const correctable =
      !localPaused && canCorrectPlayback(player.getPlayerState(), audible, now, settleUntil, force);
    if (!correctable || !audible || room.current.live) correction.reset();
    if (
      !room.current.live &&
      correctable &&
      (audible
        ? correction.shouldCorrect(
            localPosition,
            player.getCurrentTime(),
            now,
            correctedAt,
            force,
            syncMode,
          )
        : shouldCorrect(localPosition, player.getCurrentTime(), now, correctedAt, force, syncMode))
    ) {
      // seekTo starts playback from a cued state. Re-cue a paused target so a
      // clock correction never masquerades as a deliberate native Play action.
      if (!audible && player.getPlayerState() !== 2) {
        command('cue', localPosition);
        player.cueVideoById({ videoId: room.current.id, startSeconds: localPosition });
      } else {
        command('seek', localPosition);
        player.seekTo(localPosition, true);
      }
      notePlayerEvent('correction');
      correctedAt = now;
    }
  }

  async function activate() {
    if (disposed) return;
    message = '';
    if (player && ready) {
      localPaused = false;
      if (playing && player.getPlayerState() !== 1) {
        command('play');
        player.playVideo();
      }
      sync(true);
      return;
    }
    if (player && !loading) {
      await reload();
      return;
    }
    if (loading) return;
    loading = true;
    const current = ++generation;
    resetPlayerError();
    try {
      await loadYoutube();
      if (disposed || current !== generation || !container || !window.YT) return;
      enabled = true;
      player = new window.YT.Player(container, {
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, controls: 1, disablekb: 0, rel: 0, origin: location.origin },
        events: {
          onReady: () => {
            if (!disposed && current === generation) {
              ready = true;
              loading = false;
              sync(true);
            }
          },
          onAutoplayBlocked: () => {
            if (!disposed && current === generation)
              message = 'Your browser paused audio. Press Enable audio to listen.';
          },
          onError: (event: PlayerEvent) => {
            if (disposed || current !== generation) return;
            loading = false;
            ready = false;
            notePlayerError(Number(event.data));
            message = 'This source cannot play here. Try the next track or add another song.';
          },
          onPlaybackRateChange: (event: PlayerEvent) => {
            if (
              !disposed &&
              current === generation &&
              typeof event.data === 'number' &&
              event.data !== 1
            )
              player?.setPlaybackRate(1);
          },
          onStateChange: (event: PlayerEvent) => {
            if (disposed || current !== generation) return;
            if (typeof event.data !== 'number' || !Number.isFinite(event.data)) return;
            if (event.data === 3 && bufferingAt === null) {
              bufferingAt = performance.now();
              notePlayerEvent('buffer-start');
            } else if (event.data !== 3 && bufferingAt !== null) {
              notePlayerEvent('buffer-end', performance.now() - bufferingAt);
              bufferingAt = null;
              settleUntil = performance.now() + syncRecoveryMs(syncMode);
            }
            // Only a freshly activated, focused current iframe can issue a shared intent.
            const value = observation(event.data);
            if (player?.getPlayerState() === event.data) {
              // Native scrubbing usually emits BUFFERING/PLAYING before the next
              // position sample. Use that event immediately; periodic sampling
              // remains the fallback for seeks without a state transition.
              const intent =
                native.state(value) ?? (!nativePending && !controlBusy ? native.time(value) : null);
              if (intent) {
                void nativeIntent(intent);
                if (
                  event.data === 1 &&
                  (!playing || localPaused || nativePending?.intent.action === 'seek') &&
                  player?.getPlayerState() === 1
                ) {
                  command('pause');
                  player?.pauseVideo();
                }
                return;
              }
            }
            if (
              event.data === 1 &&
              (!playing || localPaused || nativePending?.intent.action === 'seek') &&
              player?.getPlayerState() === 1
            ) {
              command('pause');
              player?.pauseVideo();
            }
          },
          // Core, or the D1 room handler, advances the shared queue. A delayed
          // browser ENDED callback must never skip a newer playback instance.
        },
      });
    } catch {
      if (!disposed && current === generation) {
        message = 'The audio source could not load. Check your connection and try again.';
        loading = false;
      }
    }
  }

  function adjustOffset(value: string) {
    browserStorage.set(SYNC_OFFSET_KEY, String(readSyncOffset(value)));
  }
  async function reload() {
    if (!enabled || loading || disposed) return;
    generation++;
    ready = false;
    const previous = player;
    player = null;
    try {
      previous?.destroy();
    } catch {
      /* The keyed mount also removes the previous iframe. */
    }
    loaded = '';
    nativePending = null;
    native.reset('');
    correction.reset();
    correctedAt = -Infinity;
    settleUntil = 0;
    bufferingAt = null;
    playerEpoch++;
    await afterRender();
    if (!disposed) await activate();
  }

  $effect(() => {
    void position;
    void playing;
    void room;
    void syncMode;
    void controlBusy;
    if (ready) sync();
  });
  $effect(() => {
    void audio;
    if (ready) writePlayerAudio();
  });
  $effect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      readPlayerAudio();
      readNativePosition();
    }, 250);
    return () => clearInterval(timer);
  });
  onDestroy(() => {
    disposed = true;
    generation++;
    try {
      player?.destroy();
    } catch {
      /* Removing the stage ends a stale iframe context. */
    }
    player = null;
  });
</script>

<div
  class="audio-stage"
  class:enabled
  class:fullscreen
  class:fullscreen-fallback={fullscreenFallback}
  bind:this={stage}
>
  {#key playerEpoch}<div class="player-mount"><div bind:this={container}></div></div>{/key}
  {#if fullscreen}<button
      class="button secondary exit-fullscreen"
      onclick={() => {
        void toggleFullscreen();
      }}>Exit fullscreen</button
    >{/if}
  {#if !enabled}
    <div class="audio-prompt">
      <div class="record" aria-hidden="true"><span>ap<span class="red">.</span></span></div>
      <button class="button primary" onclick={activate} disabled={loading}
        ><Icon name="headphones" />{loading ? 'Connecting audio…' : 'Enable room audio'}</button
      >
      <p>Listen together. Audio starts when you choose.</p>
    </div>
  {/if}
</div>
<div class="player-status" role="status">
  <span class="status-dot" class:online={enabled && ready && playing && !localPaused}></span>
  <span
    >{!enabled
      ? 'Audio is off on this device'
      : !ready
        ? 'The video player is unavailable'
        : nativePending
          ? 'Updating shared playback…'
          : localPaused
            ? 'Paused on this device'
            : playing
              ? 'Following the shared clock'
              : room.playing
                ? 'Waiting for the shared clock'
                : 'Shared playback is paused'}</span
  >
  <span class="control-scope"
    >{!enabled
      ? 'Enable audio to use the video controls'
      : canControl
        ? canSeek
          ? 'Your YouTube controls update the room'
          : 'Play and pause update the concert; seeking is local'
        : 'Volume and pause are local to you'}</span
  >
</div>
{@render footer?.()}
<details class="local-sync">
  <summary>{settingsLabel}</summary>
  <p>Use YouTube's controls for volume, playback, quality, captions and fullscreen.</p>
  <p>These settings affect this device. The shared music and queue stay unchanged.</p>
  <label
    >Synchronization mode<select
      aria-label="Synchronization mode"
      value={syncMode}
      onchange={(event) => browserStorage.set(SYNC_MODE_KEY, event.currentTarget.value)}
      ><option value="precise">Precise alignment</option><option value="stable"
        >Stable connection</option
      ></select
    ></label
  >
  <p>
    Precise follows the shared clock closely. Stable makes fewer adjustments on uneven connections.
  </p>
  {#if room.mode === 'discord'}<div class="calibration">
      <label for="local-sync-offset"
        >Video timing adjustment <output
          >{syncOffset > 0 ? '+' : ''}{syncOffset.toFixed(1)} s</output
        ></label
      >
      <input
        id="local-sync-offset"
        aria-label="Video timing adjustment"
        type="range"
        min={-MAX_SYNC_OFFSET_SECONDS}
        max={MAX_SYNC_OFFSET_SECONDS}
        step="0.1"
        value={syncOffset}
        oninput={(event) => adjustOffset(event.currentTarget.value)}
      />
      <button class="button secondary" onclick={() => adjustOffset('0')}>Reset video timing</button>
      <p>If video runs ahead of Discord audio, move left.</p>
    </div>{/if}
  <div class="sync-actions">
    <button class="button secondary" disabled={!ready} onclick={() => sync(true)}>Sync now</button>
    <button class="button secondary" disabled={!enabled || loading} onclick={() => void reload()}
      >Reload video</button
    >
  </div>
  <p>Use the video's controls for quality and captions when the source supports them.</p>
  {@render settings?.()}
  <details
    class="playback-diagnostics"
    ontoggle={(event) => {
      diagnostics = event.currentTarget.open ? playerDiagnostics() : null;
    }}
  >
    <summary>Playback diagnostics</summary>
    <p>Anonymous counters on this device. No song, room or account details are recorded.</p>
    <button class="button secondary" onclick={() => (diagnostics = playerDiagnostics())}
      >Refresh diagnostics</button
    >
    {#if diagnostics}<pre>{JSON.stringify(diagnostics, null, 2)}</pre>{/if}
  </details>
</details>
{#if message}
  <div class="audio-message" role="status">
    <p>{message}</p>
    <button class="button secondary" onclick={activate}>Enable audio</button>
  </div>
{/if}

<style>
  .player-status {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 9px;
    margin-top: 14px;
    color: var(--muted);
    font-size: var(--tv-body, 13px);
  }
  .control-scope {
    margin-left: auto;
    color: var(--muted);
    font-size: 0.9em;
  }
  .local-sync {
    border: 1px solid var(--line);
    border-radius: var(--radius, 12px);
    padding: 12px 16px;
    background: var(--surface, #14161a);
  }
  .local-sync[open] {
    display: grid;
    gap: 12px;
  }
  .local-sync summary {
    font-weight: 650;
  }
  @media (max-width: 600px) {
    .control-scope {
      width: 100%;
      margin-left: 0;
    }
  }
  .player-mount,
  .player-mount > div {
    width: 100%;
    height: 100%;
  }
  .local-sync {
    margin-top: 12px;
    color: var(--muted);
    font-size: var(--tv-body, 13px);
  }
  .local-sync summary {
    cursor: pointer;
    color: inherit;
  }
  .local-sync label,
  .sync-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }
  .local-sync select {
    max-width: 100%;
  }
  .calibration input {
    width: 100%;
    accent-color: var(--red);
  }
  .calibration output {
    font-variant-numeric: tabular-nums;
  }
  .exit-fullscreen {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 2;
  }
  .audio-stage:fullscreen,
  .audio-stage.fullscreen {
    width: 100vw;
    height: 100vh;
    border: 0;
    border-radius: 0;
    background: #000;
  }
  .audio-stage.fullscreen-fallback {
    position: fixed;
    inset: 0;
    z-index: 1000;
  }
</style>
