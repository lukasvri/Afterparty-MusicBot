<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import AppNavigation from './AppNavigation.svelte';
  let {
    active,
    roomCode,
    guildId,
    onMusic,
    onRooms,
    onHome,
    hidden = false,
  }: ComponentProps<typeof AppNavigation> & {
    onHome?: (event: MouseEvent) => void;
    hidden?: boolean;
  } = $props();
</script>

<header class="site-header" {hidden}>
  <div class="site-header-inner">
    <a class="site-brand" href="/" aria-label="Afterparty home" onclick={onHome}>
      <img src="/afterparty-mark.svg" width="36" height="36" alt="" />
      <span>afterparty<span class="red">.</span></span>
    </a>
    <AppNavigation {active} {roomCode} {guildId} {onMusic} {onRooms} />
  </div>
</header>

<style>
  .site-header {
    background: var(--app-background);
    border-bottom: 1px solid var(--line);
  }
  .site-header[hidden] {
    display: none;
  }
  .site-header-inner {
    width: 100%;
    max-width: var(--app-width);
    min-height: 88px;
    margin-inline: auto;
    padding: 16px var(--app-space);
    padding-top: max(16px, env(safe-area-inset-top));
    padding-left: max(var(--app-space), env(safe-area-inset-left));
    padding-right: max(var(--app-space), env(safe-area-inset-right));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }
  .site-brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--text);
    font-size: 24px;
    font-weight: 750;
    letter-spacing: -1px;
    white-space: nowrap;
    text-decoration: none;
  }
  .site-brand img {
    flex-shrink: 0;
  }
  @media (max-width: 800px) {
    .site-header-inner {
      flex-wrap: wrap;
      gap: 8px;
    }
    .site-brand {
      font-size: 22px;
    }
  }
</style>
