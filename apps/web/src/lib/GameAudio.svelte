<script lang="ts">
  import { onDestroy } from 'svelte';
  let {
    available,
    active,
    elapsed,
    fetchAudio,
  }: {
    available: boolean;
    active: boolean;
    elapsed: number;
    fetchAudio: (signal: AbortSignal) => Promise<Blob>;
  } = $props();
  let phase = $state('idle'),
    error = $state('');
  let audio: HTMLAudioElement | null = null,
    url = '',
    pending: AbortController | null = null,
    generation = 0;
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
    if (!active || !available) stop();
  });
  onDestroy(stop);
  function seek(value: HTMLAudioElement) {
    if (Number.isFinite(value.duration))
      value.currentTime = Math.min(Math.max(0, elapsed), Math.max(0, value.duration - 0.1));
  }
  async function listen() {
    if (pending || phase === 'playing') {
      stop();
      return;
    }
    if (!active || !available) return;
    error = '';
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
        audio.volume = 0.5;
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
            error = 'Preview audio is unavailable.';
          }
        };
      }
      const player = audio;
      seek(player);
      await player.play();
      if (current === generation && audio === player) phase = 'playing';
      else player.pause();
    } catch {
      if (current !== generation) return;
      pending = null;
      if (audio) {
        phase = 'ready';
        error = 'Tap again to allow audio in your browser.';
      } else {
        stop();
        error = 'Preview audio is unavailable. Try again.';
      }
    }
  }
</script>

<button type="button" disabled={!available || !active} onclick={() => void listen()}
  >{phase === 'loading'
    ? 'Cancel preview'
    : phase === 'playing'
      ? 'Stop preview'
      : 'Listen to preview'}</button
>
<p class="note">
  {available
    ? 'Private game audio. Mute music in other tabs or Discord locally.'
    : 'Quiz audio is not ready. Ask the host to load the songs.'}
</p>
{#if error}<p role="status">{error}</p>{/if}

<style>
  button {
    min-height: 48px;
    padding: 0 20px;
    background: #ff263e;
    border: 0;
    border-radius: 8px;
    color: white;
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button:focus-visible {
    outline: 2px solid white;
    outline-offset: 4px;
  }
  .note {
    color: #9898a5;
    font-size: 12px;
  }
</style>
