<script lang="ts">
  import { onDestroy } from 'svelte';
  import { loadYoutube, type Player } from '../../../../lib/youtube-player.ts';
  import { canCorrectPlayback, shouldCorrect } from '../../../../lib/playback-sync.ts';
  import type { Room } from '../../../../lib/types.ts';
  import Icon from './Icon.svelte';

  let {
    room,
    position,
    playing,
  }: {
    room: Room;
    position: number;
    playing: boolean;
  } = $props();
  let container: HTMLDivElement;
  let player: Player | null = null;
  let ready = $state(false),
    loading = $state(false),
    enabled = $state(false),
    message = $state('');
  let disposed = false,
    loaded = '',
    lastPlaying = false,
    correctedAt = 0,
    settleUntil = 0;

  function sync(force = false) {
    if (!ready || !player || !room.current) return;
    const key = `${room.code}:${room.current.id}:${room.playbackKey ?? ''}`;
    if (loaded !== key) {
      loaded = key;
      const video = { videoId: room.current.id, startSeconds: position };
      if (playing) player.loadVideoById(video);
      else player.cueVideoById(video);
      lastPlaying = playing;
      settleUntil = performance.now() + 2000;
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
      shouldCorrect(position, player.getCurrentTime(), now, correctedAt, force)
    ) {
      player.seekTo(position, true);
      correctedAt = now;
    }
  }

  async function activate() {
    message = '';
    if (player && ready) {
      if (playing) player.playVideo();
      return;
    }
    if (loading) return;
    loading = true;
    try {
      await loadYoutube();
      if (disposed || !container || !window.YT) return;
      enabled = true;
      player = new window.YT.Player(container, {
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0, origin: location.origin },
        events: {
          onReady: () => {
            if (!disposed) {
              ready = true;
              loading = false;
              sync(true);
            }
          },
          onAutoplayBlocked: () => {
            message = 'Your browser paused audio. Press Enable audio to listen.';
          },
          onError: () => {
            message = 'This source cannot play here. Try the next track or add another song.';
          },
          // Core, or the D1 room handler, advances the shared queue. A delayed
          // browser ENDED callback must never skip a newer playback instance.
        },
      });
    } catch {
      message = 'The audio source could not load. Check your connection and try again.';
      loading = false;
    }
  }

  $effect(() => {
    void position;
    void playing;
    void room;
    if (ready) sync();
  });
  onDestroy(() => {
    disposed = true;
    player?.destroy();
    player = null;
  });
</script>

<div class="audio-stage" class:enabled>
  <div bind:this={container}></div>
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
{#if message}
  <div class="audio-message" role="status">
    <p>{message}</p>
    <button class="button secondary" onclick={activate}>Enable audio</button>
  </div>
{/if}
