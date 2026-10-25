<script lang="ts">
  import { tick } from 'svelte';
  import type { createRoomClient } from './room-client.ts';
  import type { Room, Video } from '../../../../../lib/types.ts';
  import { time } from '../../../../../lib/types.ts';
  import Icon from '#lib/ui/Icon.svelte';
  let {
    room,
    client,
    disabled,
  }: {
    room: Room;
    client?: Pick<ReturnType<typeof createRoomClient>, 'playVideo' | 'move' | 'remove' | 'action'>;
    disabled: boolean;
  } = $props();
  const id = $props.id();
  let panel: HTMLElement;
  async function act(
    event: MouseEvent,
    video: Video,
    index: number,
    run: () => Promise<boolean> | undefined,
  ) {
    const trigger = event.currentTarget;
    const menu = trigger instanceof HTMLElement ? trigger.closest('details') : null;
    if (disabled) return;
    if (await run()) {
      menu?.removeAttribute('open');
      await tick();
      if (
        !panel?.isConnected ||
        (document.activeElement !== trigger && document.activeElement !== document.body)
      )
        return;
      const rows = [...panel.querySelectorAll<HTMLDetailsElement>('details[data-entry]')];
      const next =
        rows.find((row) => row.dataset.entry === (video.entryId ?? video.id)) ??
        rows[Math.min(index, rows.length - 1)];
      (next?.querySelector('summary') ?? panel.querySelector('h2'))?.focus();
    }
  }
  function closeMenu(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !(event.currentTarget instanceof HTMLElement)) return;
    const menu = event.currentTarget.closest('details');
    if (!menu?.open) return;
    event.preventDefault();
    event.stopPropagation();
    menu.open = false;
    menu.querySelector('summary')?.focus();
  }
</script>

{#snippet recording(video: Video, index: number)}
  <span class="track-number">{String(index + 1).padStart(2, '0')}</span>
  <div class="track-info">
    <strong title={video.title}>{video.title}</strong><span title={video.artist}
      >{video.artist}</span
    >
  </div>
  <span class="duration">{video.live ? 'LIVE' : time(video.duration)}</span>
{/snippet}

<section class="queue-panel" aria-labelledby={`${id}-title`} bind:this={panel}>
  <div class="section-heading">
    <h2 id={`${id}-title`} tabindex="-1">Up next</h2>
    <span class="count">{room.queue.length}</span>
  </div>
  {#if room.queue.length}
    <ol class="queue-list">
      {#each room.queue as video, index (`${video.entryId ?? video.id}:${index}`)}
        <li>
          {#if room.isHost}
            <details
              class="track-options"
              name={`${id}-options`}
              data-entry={video.entryId ?? video.id}
            >
              <summary
                class="queue-track"
                aria-label={`Track options for ${video.title}`}
                onkeydown={closeMenu}>{@render recording(video, index)}<Icon name="more" /></summary
              >
              <div class="track-menu" role="group" aria-label={`Actions for ${video.title}`}>
                <button
                  disabled={disabled || !client}
                  onkeydown={closeMenu}
                  onclick={(event) =>
                    void act(event, video, index, () => client?.playVideo(video.id))}
                  >Play now</button
                >
                <button
                  disabled={disabled || !client || index === 0}
                  onkeydown={closeMenu}
                  onclick={(event) =>
                    void act(event, video, index, () => client?.move(video.id, index - 1))}
                  >Move up</button
                >
                <button
                  class="remove"
                  disabled={disabled || !client}
                  onkeydown={closeMenu}
                  onclick={(event) => void act(event, video, index, () => client?.remove(video.id))}
                  >Remove</button
                >
              </div>
            </details>
          {:else}
            <div class="queue-track">
              {@render recording(video, index)}
              <button
                class="vote"
                aria-label={`Vote for ${video.title}`}
                disabled={disabled || !client}
                onclick={() => void client?.action('vote', { videoId: video.id })}
                >+{room.voteCounts?.[video.id] ?? 0}</button
              >
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <div class="empty-queue">
      <Icon name="music" size={30} />
      <h3>The next track is up to you</h3>
      <p>Open Search, or choose from your saved music and festival sets.</p>
    </div>
  {/if}
  <div class="queue-footer">
    <span class="status-dot online"></span>One queue. Everyone in sync.
  </div>
</section>

<style>
  .queue-panel {
    padding: clamp(18px, 1.5vw, 26px);
  }
  .queue-list li {
    display: block;
    padding: 0;
  }
  .queue-track {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto 44px;
    gap: 10px;
    min-height: 72px;
    padding: 12px 0;
    align-items: center;
  }
  .track-info {
    min-width: 0;
  }
  .track-info strong {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.4;
  }
  .track-info > span {
    line-height: 1.4;
  }
  .track-options {
    min-width: 0;
  }
  .vote {
    width: 44px;
    min-height: 44px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface-raised);
    color: var(--text);
  }
  .track-options summary {
    cursor: pointer;
    list-style: none;
    border-radius: 10px;
  }
  .track-options summary::-webkit-details-marker {
    display: none;
  }
  .track-options summary:hover {
    background: var(--surface-raised);
  }
  .track-options summary :global(svg) {
    justify-self: center;
  }
  .track-menu {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px;
    background: var(--surface-raised);
    border: 1px solid var(--line);
    border-radius: 12px;
    margin-bottom: 12px;
  }
  .track-menu button {
    flex: 1;
    min-height: 44px;
    padding: 8px 12px;
    background: var(--surface-hover);
    border: 1px solid var(--line);
    color: var(--text);
    border-radius: 8px;
    font-size: 13px;
    white-space: nowrap;
  }
  .track-menu button:hover {
    border-color: var(--muted);
  }
  .track-menu .remove {
    color: #ffb4bd;
  }
  .empty-queue {
    min-height: 160px;
    padding: 20px;
    gap: 12px;
  }
  .empty-queue p {
    max-width: 32ch;
  }
  .queue-footer {
    margin-top: 16px;
    padding-top: 16px;
  }
</style>
