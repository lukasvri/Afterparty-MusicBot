<script lang="ts">
  import Icon from './Icon.svelte';
  let {
    active,
    roomCode,
    guildId,
    onMusic,
    onRooms,
  }: {
    active: 'music' | 'rooms' | 'concerts' | 'admin' | 'games';
    roomCode?: string;
    guildId?: string;
    onMusic?: (event: MouseEvent) => void;
    onRooms?: () => void;
  } = $props();
  const roomLink = $derived(roomCode ? `/?room=${encodeURIComponent(roomCode)}` : '/');
  const serverQuery = $derived(guildId ? `?guildId=${encodeURIComponent(guildId)}` : '');
</script>

<nav class="site-navigation" aria-label="Main navigation">
  <a
    class="nav-link"
    class:active={active === 'music'}
    aria-current={active === 'music' ? 'page' : undefined}
    href={roomLink}
    onclick={onMusic}><Icon name="headphones" size={18} />Music</a
  >
  {#if onRooms}
    <button
      class="nav-link"
      class:active={active === 'rooms'}
      aria-current={active === 'rooms' ? 'page' : undefined}
      aria-pressed={active === 'rooms'}
      onclick={onRooms}><Icon name="users" size={18} />Open rooms</button
    >
  {:else}
    <a class="nav-link" href="/?view=rooms"><Icon name="users" size={18} />Open rooms</a>
  {/if}
  <a
    class="nav-link"
    class:active={active === 'concerts'}
    aria-current={active === 'concerts' ? 'page' : undefined}
    href={`/discord${serverQuery}`}><Icon name="music" size={18} />Concerts</a
  >
  <a
    class="nav-link"
    class:active={active === 'admin'}
    aria-current={active === 'admin' ? 'page' : undefined}
    href={`/admin${serverQuery}`}
    data-sveltekit-reload><Icon name="settings" size={18} />DJ tools</a
  >
  <a
    class="nav-link"
    class:active={active === 'games'}
    aria-current={active === 'games' ? 'page' : undefined}
    href={roomCode ? `/games?room=${encodeURIComponent(roomCode)}` : '/games'}
    ><Icon name="users" size={18} />Games</a
  >
</nav>

<style>
  .site-navigation {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }
  .nav-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: auto;
    margin: 0;
    gap: 8px;
    min-height: 44px;
    padding: 10px 12px;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 8px 8px 0 0;
    color: var(--muted);
    background: transparent;
    font-size: clamp(13px, 0.52vw, 18px);
    font-weight: 600;
    line-height: 1.5;
    text-decoration: none;
    white-space: nowrap;
  }
  .nav-link:hover {
    color: var(--text);
    background: var(--surface-raised);
  }
  .nav-link.active {
    color: var(--text);
    border-bottom-color: var(--red);
  }
  @media (max-width: 800px) {
    .site-navigation {
      width: 100%;
      justify-content: space-between;
      order: 3;
    }
    .nav-link {
      font-size: 12px;
      padding: 10px 5px;
      gap: 0;
    }
    .nav-link :global(svg) {
      display: none;
    }
  }
  @media (min-width: 2400px) {
    .nav-link {
      min-height: 52px;
      padding-inline: 16px;
    }
  }
</style>
