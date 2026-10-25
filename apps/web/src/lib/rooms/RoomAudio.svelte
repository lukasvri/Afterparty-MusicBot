<script lang="ts">
  import { onDestroy, onMount, tick as afterRender } from 'svelte';
  import { loadYoutube, type Player, type PlayerEvent } from '../../../../../lib/youtube-player.ts';
  import {
    calibratedPlaybackPosition,
    canCorrectPlayback,
    MAX_SYNC_OFFSET_SECONDS,
    readSyncMode,
    readSyncOffset,
    shouldCorrect,
    syncRecoveryMs,
    SYNC_MODE_KEY,
    SYNC_OFFSET_KEY,
    type SyncMode,
  } from '../../../../../lib/playback-sync.ts';
  import type { Room } from '../../../../../lib/types.ts';
  import Icon from '../ui/Icon.svelte';
  import { browserStorage } from '../../../../../lib/browser-storage.ts';
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
    changeAudioLevel,
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
      fullscreen = fullscreenFallback || fullscreenElement(document) === stage;
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
  }: {
    room: Room;
    position: number;
    playing: boolean;
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

  function sync(force = false) {
    if (!ready || !player || !room.current) return;
    const localPosition = calibratedPlaybackPosition(room, position, syncOffset);
    const key = `${room.code}:${room.current.id}:${room.playbackKey ?? ''}`;
    if (loaded !== key) {
      loaded = key;
      writePlayerAudio(true);
      const video = { videoId: room.current.id, startSeconds: localPosition };
      if (playing) player.loadVideoById(video);
      else player.cueVideoById(video);
      lastPlaying = playing;
      settleUntil = performance.now() + syncRecoveryMs(syncMode);
      return;
    }
    if (playing !== lastPlaying) {
      if (playing) player.playVideo();
      else player.pauseVideo();
      lastPlaying = playing;
      force = true;
    }
    const now = performance.now();
    if (
      !room.current.live &&
      canCorrectPlayback(player.getPlayerState(), playing, now, settleUntil, force) &&
      shouldCorrect(localPosition, player.getCurrentTime(), now, correctedAt, force, syncMode)
    ) {
      player.seekTo(localPosition, true);
      notePlayerEvent('correction');
      correctedAt = now;
    }
  }

  async function activate() {
    if (disposed) return;
    message = '';
    if (player && ready) {
      if (playing) player.playVideo();
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
        playerVars: { playsinline: 1, controls: 1, disablekb: 1, rel: 0, origin: location.origin },
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
            // Official controls remain local; they cannot override a shared pause.
            if (event.data === 1 && !playing) player?.pauseVideo();
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
    if (ready) sync();
  });
  $effect(() => {
    void audio;
    if (ready) writePlayerAudio();
  });
  $effect(() => {
    if (!ready) return;
    const timer = setInterval(readPlayerAudio, 250);
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
<div class="local-audio" aria-label="Audio on this device">
  <button
    class="button secondary"
    aria-pressed={audio.muted}
    onclick={() => {
      audio = toggleAudioMute(audio);
      saveAudio();
    }}>{audio.muted ? 'Unmute' : 'Mute'}</button
  >
  <label for="local-volume">Volume on this device</label><input
    id="local-volume"
    aria-label="Volume on this device"
    type="range"
    min="0"
    max="100"
    value={audio.level}
    oninput={(event) => {
      audio = changeAudioLevel(audio, Number(event.currentTarget.value));
      saveAudio();
    }}
  />
  <button
    class="button secondary"
    onclick={() => {
      void toggleFullscreen();
    }}>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button
  >
</div>
<details class="local-sync">
  <summary>Playback settings</summary>
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
</details>
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
{#if message}
  <div class="audio-message" role="status">
    <p>{message}</p>
    <button class="button secondary" onclick={activate}>Enable audio</button>
  </div>
{/if}

<style>
  .player-mount,
  .player-mount > div {
    width: 100%;
    height: 100%;
  }
  .local-sync {
    margin-top: 12px;
    color: var(--muted);
    font-size: var(--tv-body, 12px);
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
  .local-audio {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 12px;
  }
  .local-audio label {
    font-size: var(--tv-body, 10px);
    color: var(--muted);
  }
  .local-audio input {
    min-width: 80px;
    max-width: clamp(180px, 9.375vw, 360px);
    flex: 1;
    accent-color: var(--red);
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
