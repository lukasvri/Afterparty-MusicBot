<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { publicRoomLink } from './room-links.ts';
  import { concertLink } from '../../../../../services/core/src/concert-links.ts';
  let { code, tv = false, guildId }: { code: string; tv?: boolean; guildId?: string } = $props();
  let expanded = $state(false),
    origin = $state(''),
    qr = $state(''),
    failed = $state(false);
  let generation = 0;
  const link = $derived(
    origin ? (guildId ? concertLink(origin, guildId) : publicRoomLink(origin, code)) : '',
  );
  onMount(() => {
    origin = location.origin;
  });
  onDestroy(() => {
    generation++;
  });
  $effect(() => {
    const current = ++generation;
    qr = '';
    failed = false;
    if ((!expanded && !tv) || !link) return;
    void import('qrcode')
      .then(({ default: qrcode }) =>
        qrcode.toDataURL(link, {
          width: 240,
          margin: 2,
          errorCorrectionLevel: 'M',
        }),
      )
      .then((value) => {
        if (current === generation) qr = value;
      })
      .catch(() => {
        if (current === generation) failed = true;
      });
  });
</script>

<section class="room-sharing" aria-label="Room invitation">
  {#if !tv}<button
      class="button secondary"
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      {expanded ? 'Hide QR invitation' : 'Show QR invitation'}
    </button>{/if}
  {#if expanded || tv}
    <div class="invitation">
      <p class="eyebrow">JOIN THE ROOM</p>
      {#if qr}<img src={qr} alt="QR code to join this listening room" width="240" height="240" />
      {:else}<p role="status">
          {failed ? 'Use the room link below.' : 'Preparing QR invitation…'}
        </p>{/if}
      <strong>{code}</strong>
      <p>Scan with your phone to join, search and add your songs.</p>
      <input
        aria-label="Public room invitation link"
        readonly
        value={link}
        onclick={(event) => event.currentTarget.select()}
      />
    </div>
  {/if}
</section>

<style>
  .room-sharing {
    margin-bottom: 20px;
  }
  .invitation {
    max-width: 320px;
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 18px;
    background: #121214;
    text-align: center;
  }
  img {
    display: block;
    width: 100%;
    max-width: 240px;
    height: auto;
    margin: 12px auto;
    border-radius: 8px;
  }
  strong {
    font-size: 24px;
    letter-spacing: 0.12em;
  }
  p {
    font-size: 13px;
    line-height: 1.5;
    color: var(--muted);
  }
  input {
    width: 100%;
    min-width: 0;
    font-size: 11px;
    padding: 10px;
  }
</style>
