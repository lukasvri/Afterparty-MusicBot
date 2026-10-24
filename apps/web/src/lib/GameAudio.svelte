<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { browserStorage } from '../../../../lib/browser-storage.ts';
  let {
    available,
    active,
    elapsed,
    fetchAudio,
    autoPlay = false,
    onEnabled,
    onDisabled,
  }: {
    available: boolean;
    active: boolean;
    elapsed: number;
    fetchAudio: (signal: AbortSignal) => Promise<Blob>;
    autoPlay?: boolean;
    onEnabled?: () => void;
    onDisabled?: () => void;
  } = $props();
  let phase = $state<'idle' | 'loading' | 'ready' | 'playing'>('idle'),
    error = $state(''),
    volume = $state(50),
    preferencesReady = $state(false);
  let audio: HTMLAudioElement | null = null,
    url = '',
    pending: AbortController | null = null,
    generation = 0,
    attempted = false;
  const volumeKey = 'afterparty-guess-audio-volume';
  onMount(() => {
    const saved = browserStorage.get(volumeKey),
      value = saved?.trim() ? Number(saved) : NaN;
    if (Number.isFinite(value) && value >= 0 && value <= 100) volume = Math.round(value);
    preferencesReady = true;
  });
  // Teardown preserves consent for the next keyed round. Only a deliberate stop
  // or cancellation revokes consent through onDisabled.
  function stop() {
    generation++;
    pending?.abort();
    pending = null;
    if (audio) {
      audio.onloadedmetadata = audio.onended = audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio = null;
    }
    if (url) URL.revokeObjectURL(url);
    url = '';
    phase = 'idle';
  }
  $effect(() => {
    if (!active || !available) {
      stop();
      return;
    }
    if (!preferencesReady) return;
    // Never reset this flag for ticks, read loss, natural end or manual stop.
    if (autoPlay && !attempted) {
      attempted = true;
      void listen(false);
    }
  });
  onDestroy(stop);
  function seek(value: HTMLAudioElement) {
    if (Number.isFinite(value.duration))
      value.currentTime = Math.min(Math.max(0, elapsed), Math.max(0, value.duration - 0.1));
  }
  function changeVolume(event: Event) {
    volume = Number((event.currentTarget as HTMLInputElement).value);
    browserStorage.set(volumeKey, String(volume));
    if (audio) audio.volume = volume / 100;
  }
  function toggle() {
    attempted = true;
    if (pending || phase === 'loading' || phase === 'playing') {
      stop();
      error = '';
      onDisabled?.();
    } else void listen(true);
  }
  async function listen(explicit: boolean) {
    if (!active || !available || pending || phase === 'loading' || phase === 'playing') return;
    error = '';
    phase = 'loading';
    const current = generation;
    try {
      if (!audio) {
        const controller = new AbortController();
        pending = controller;
        phase = 'loading';
        const blob = await fetchAudio(controller.signal);
        if (controller.signal.aborted || current !== generation) return;
        pending = null;
        url = URL.createObjectURL(blob);
        audio = new Audio(url);
        audio.volume = volume / 100;
        const player = audio;
        player.onloadedmetadata = () => {
          if (audio === player) seek(player);
        };
        player.onended = () => {
          if (audio === player) stop();
        };
        player.onerror = () => {
          if (audio === player) {
            stop();
            error = 'Audio could not load. Enable it again to retry.';
          }
        };
      }
      const player = audio;
      seek(player);
      await player.play();
      if (current === generation && audio === player) {
        phase = 'playing';
        if (explicit) onEnabled?.();
      } else player.pause();
    } catch {
      if (current !== generation) return;
      pending = null;
      if (audio) {
        phase = 'ready';
        error = 'Your browser needs a tap. Enable game audio to listen.';
      } else {
        stop();
        error = 'Audio is unavailable. Enable it again to retry.';
      }
    }
  }
</script>

<div class="game-audio" class:playing={phase === 'playing'}>
  <div class="audio-action">
    <button type="button" disabled={!available || !active} onclick={toggle}
      ><span class="audio-icon" aria-hidden="true">{phase === 'playing' ? 'Ⅱ' : '▶'}</span
      >{phase === 'loading'
        ? 'Cancel audio'
        : phase === 'playing'
          ? 'Stop game audio'
          : 'Enable game audio'}</button
    >
    <span class="audio-status" role="status"
      >{phase === 'loading'
        ? 'Loading this round…'
        : phase === 'playing'
          ? 'Listening now'
          : !available
            ? 'Audio is unavailable for this round'
            : !active
              ? 'Audio paused'
              : 'Listen here with your group'}</span
    >
  </div>
  <label class="volume"
    >Volume<input
      type="range"
      aria-label="Game audio volume"
      min="0"
      max="100"
      step="1"
      value={volume}
      oninput={changeVolume}
    /><output>{volume}%</output></label
  >
  {#if error}<p class="audio-error" role="status">{error}</p>{/if}
  <p class="note">Audio follows new rounds. Stop turns it off. Other music stays separate.</p>
</div>

<style>
  .game-audio {
    padding: 18px;
    border: 1px solid #32323a;
    border-radius: 14px;
    background: #17171c;
  }
  .playing {
    border-color: #743743;
    background: #21161b;
  }
  .audio-action {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 0 18px;
    background: #ff263e;
    border: 0;
    border-radius: 8px;
    color: #100b0e;
    font: inherit;
    font-weight: 650;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid white;
    outline-offset: 4px;
  }
  .audio-icon {
    font-size: 13px;
  }
  .audio-status {
    color: #b9b9c4;
    font-size: 12px;
  }
  .playing .audio-status {
    color: #ff9caa;
  }
  .volume {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
    font-size: 12px;
    color: #c7c7d1;
  }
  input {
    width: min(100%, 220px);
    min-width: 0;
    min-height: 32px;
    margin: 0;
    accent-color: #ff6072;
  }
  output {
    width: 36px;
    flex-shrink: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .audio-error {
    color: #ff9caa;
    font-size: 13px;
  }
  .note {
    color: #9898a5;
    font-size: 11px;
    line-height: 1.5;
    margin: 10px 0 0;
  }
</style>
