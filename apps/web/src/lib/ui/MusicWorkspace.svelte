<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  let {
    active = $bindable<'queue' | 'discover' | 'library'>('queue'),
    search,
    library,
    upNext,
    queueCount = 0,
    searchInputId,
  }: {
    active?: 'queue' | 'discover' | 'library';
    search: Snippet;
    library: Snippet;
    upNext: Snippet;
    queueCount?: number;
    searchInputId: string;
  } = $props();
  const id = $props.id();
  let libraryOpened = $state(false);
  let workspace: HTMLElement;
  $effect(() => {
    if (active === 'library') libraryOpened = true;
  });
  async function select(value: typeof active) {
    active = value;
    await tick();
    if (value === 'discover') document.getElementById(searchInputId)?.focus();
    else
      workspace
        .querySelector<HTMLElement>(`[data-panel="${value}"]`)
        ?.focus({ preventScroll: true });
  }
</script>

<div class="music-workspace" bind:this={workspace}>
  <nav class="workspace-nav" aria-label="Music workspace">
    <button
      id={`${id}-queue-button`}
      class:chosen={active === 'queue'}
      aria-pressed={active === 'queue'}
      aria-controls={`${id}-queue`}
      onclick={() => void select('queue')}>Queue <span class="count">{queueCount}</span></button
    >
    <button
      id={`${id}-search-button`}
      class:chosen={active === 'discover'}
      aria-pressed={active === 'discover'}
      aria-controls={`${id}-search`}
      onclick={() => void select('discover')}>Search</button
    >
    <button
      id={`${id}-library-button`}
      class:chosen={active === 'library'}
      aria-pressed={active === 'library'}
      aria-controls={`${id}-library`}
      onclick={() => void select('library')}>Library & playlists</button
    >
  </nav>
  <section
    id={`${id}-queue`}
    class="workspace-panel"
    data-panel="queue"
    tabindex="-1"
    aria-labelledby={`${id}-queue-button`}
    hidden={active !== 'queue'}
    inert={active !== 'queue'}
  >
    {@render upNext()}
  </section>
  <section
    id={`${id}-search`}
    class="workspace-panel workspace-search"
    data-panel="discover"
    tabindex="-1"
    aria-labelledby={`${id}-search-button`}
    hidden={active !== 'discover'}
    inert={active !== 'discover'}
  >
    {@render search()}
  </section>
  <section
    id={`${id}-library`}
    class="workspace-panel"
    data-panel="library"
    tabindex="-1"
    aria-labelledby={`${id}-library-button`}
    hidden={active !== 'library'}
    inert={active !== 'library'}
  >
    {#if libraryOpened}{@render library()}{/if}
  </section>
</div>

<style>
  .music-workspace {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: #111113;
    overflow: clip;
  }
  .workspace-nav {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr);
    align-items: stretch;
    position: sticky;
    top: 0;
    z-index: 4;
    padding: 6px;
    gap: 4px;
    background: #111113;
    border-bottom: 1px solid var(--line);
  }
  .workspace-nav button {
    min-height: 48px;
    padding: 10px 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--muted);
    font-size: 13px;
    font-weight: 650;
    border-radius: 8px;
  }
  .workspace-nav button:hover {
    background: #1b1b20;
    color: var(--text);
  }
  .workspace-nav button.chosen {
    background: #222227;
    color: var(--text);
    border-bottom-color: var(--red);
  }
  .count {
    padding: 2px 6px;
    border-radius: 4px;
    background: #08080a;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .workspace-panel {
    min-width: 0;
    min-height: 340px;
    scroll-margin-top: 80px;
  }
  [hidden] {
    display: none !important;
  }
  .workspace-panel:focus-visible {
    outline: 2px solid var(--red);
    outline-offset: -3px;
  }
  .workspace-panel :global(.queue-panel) {
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .workspace-search :global(.discovery),
  .workspace-search :global(.concert-search) {
    border: 0;
    border-radius: 0;
    margin: 0;
    padding: 18px;
    background: transparent;
  }
  .workspace-search :global(.section-heading) {
    display: none;
  }
  .workspace-search :global(.search-results) {
    max-height: min(54dvh, 620px);
    overflow: auto;
    scrollbar-width: thin;
    scrollbar-gutter: stable;
  }
  .workspace-panel :global(.queue-list) {
    max-height: min(54dvh, 620px);
  }
  .workspace-panel[data-panel='library'] {
    padding: 14px;
  }
  @media (max-width: 600px) {
    .workspace-nav button {
      font-size: 12px;
    }
  }
</style>
