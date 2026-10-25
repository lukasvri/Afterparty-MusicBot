<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { publicRoomLink } from './room-links.ts';
  import { concertLink } from '../../../../../services/core/src/concert-links.ts';
  let {
    code,
    tv = false,
    guildId,
    expanded = $bindable(false),
    showToggle = true,
    id,
  }: {
    code: string;
    tv?: boolean;
    guildId?: string;
    expanded?: boolean;
    showToggle?: boolean;
    id?: string;
  } = $props();
  let copied = $state(false),
    copyFailed = $state(false),
    copying = $state(false);
  let linkInput = $state<HTMLInputElement>();
  let origin = $state(''),
    qr = $state(''),
    failed = $state(false);
  let generation = 0;
  const link = $derived(
    origin ? (guildId ? concertLink(origin, guildId) : publicRoomLink(origin, code)) : '',
  );
  async function copy() {
    if (!link || copying) return;
    const shared = link,
      current = generation;
    copying = true;
    try {
      await navigator.clipboard.writeText(shared);
      if (current === generation) {
        copied = true;
        copyFailed = false;
      }
    } catch {
      if (current === generation) {
        copied = false;
        copyFailed = true;
        linkInput?.focus();
        linkInput?.select();
      }
    } finally {
      copying = false;
    }
  }
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

<section class="room-sharing" aria-label="Room invitation" {id}>
  {#if !tv && showToggle}<button
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
        bind:this={linkInput}
        aria-label="Public room invitation link"
        readonly
        value={link}
        onclick={(event) => event.currentTarget.select()}
      />
      {#if !tv}
        <button
          class="button secondary copy-link"
          disabled={!link || copying}
          onclick={() => void copy()}>{copied ? 'Link copied' : 'Copy room link'}</button
        >
        {#if copied || copyFailed}<p role="status">
            {copyFailed ? 'Copy the selected link above.' : 'Room link copied.'}
          </p>{/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .room-sharing:has(.invitation),
  .room-sharing:has(> button) {
    margin-bottom: 20px;
  }
  .copy-link {
    margin-top: 12px;
    width: 100%;
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
