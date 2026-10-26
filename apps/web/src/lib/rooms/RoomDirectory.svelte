<script lang="ts">
  import { onMount } from 'svelte';
  import { request } from '../../../../../lib/browser-api.ts';
  import type { OpenRoom } from '../../../../../lib/types.ts';
  import Icon from '../ui/Icon.svelte';
  import PageToolbar from '../ui/PageToolbar.svelte';
  let {
    busy,
    onJoin,
    onCreate,
  }: { busy: boolean; onJoin: (code: string) => void | Promise<void>; onCreate: () => void } =
    $props();
  let rooms = $state<OpenRoom[]>([]),
    loading = $state(true),
    loaded = $state(false),
    error = $state(''),
    query = $state('');
  let filterInput: HTMLInputElement | undefined;
  function clearSearch() {
    query = '';
    filterInput?.focus();
  }
  const term = $derived(query.trim().toLowerCase());
  const visible = $derived(
    rooms.filter((room) => !term || `${room.name} ${room.code}`.toLowerCase().includes(term)),
  );
  let controller: AbortController | undefined;
  let disposed = false;
  async function refresh() {
    // Slow reads keep their place; manual refresh and polls cannot race them.
    if (disposed || controller) return;
    const current = new AbortController();
    controller = current;
    loading = true;
    error = '';
    try {
      const result = await request<{ rooms: OpenRoom[] }>('/api/rooms', {
        cache: 'no-store',
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(12000)]),
      });
      if (disposed || current.signal.aborted || controller !== current) return;
      rooms = result.rooms;
      loaded = true;
    } catch {
      if (!disposed && !current.signal.aborted && controller === current) {
        error = loaded
          ? 'Rooms could not refresh. Showing the last available list. Try again.'
          : 'Open rooms could not load. Try again.';
      }
    } finally {
      if (!disposed && controller === current) {
        loading = false;
        controller = undefined;
      }
    }
  }
  onMount(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30000);
    return () => {
      disposed = true;
      clearInterval(timer);
      controller?.abort();
    };
  });
</script>

<section class="directory" aria-labelledby="directory-title">
  {#snippet directoryActions()}
    <button class="button secondary refresh-rooms" disabled={loading} onclick={() => void refresh()}
      >{loading ? 'Refreshing rooms…' : 'Refresh rooms'}</button
    >
    <button class="button primary" onclick={onCreate}>Create a room</button>
  {/snippet}
  <PageToolbar
    title="Open rooms"
    id="directory-title"
    description="A shared queue. A new crowd. Join a room its host has opened to everyone."
    actions={directoryActions}
  />
  <div class="directory-toolbar">
    <div class="room-filter">
      <label for="room-filter">Find an open room</label>
      <div class="filter-input">
        <Icon name="search" />
        <input
          id="room-filter"
          bind:this={filterInput}
          type="search"
          bind:value={query}
          placeholder="Room name or code"
          autocomplete="off"
          maxlength="120"
          aria-controls="directory-results"
        />
        {#if query}<button class="clear-filter" onclick={clearSearch}>Clear search</button>{/if}
      </div>
    </div>
    <p class="directory-count" role="status" aria-atomic="true">
      {#if loading && !loaded}Finding open rooms…{:else if loaded}{term
          ? `${visible.length} of ${rooms.length}`
          : rooms.length} open {rooms.length === 1 ? 'room' : 'rooms'}{:else}Rooms are unavailable{/if}
    </p>
  </div>
  {#if error}<div class="directory-error" role="alert">
      <strong>{loaded ? 'The list may have changed.' : 'A little quiet on the connection.'}</strong>
      <p>{error}</p>
    </div>{/if}
  <div id="directory-results" aria-busy={loading}>
    {#if !loaded && loading}<div class="directory-empty">
        <span class="empty-symbol"><Icon name="users" size={28} /></span>
        <h2>Finding your next listening room.</h2>
        <p>Checking which hosts have opened their doors.</p>
      </div>{:else if loaded && !rooms.length}<div class="directory-empty">
        <span class="empty-symbol"><Icon name="headphones" size={28} /></span>
        <h2>The next great room could be yours.</h2>
        <p>No open rooms right now. Create one and invite your people.</p>
      </div>{:else if loaded && !visible.length}<div class="directory-empty">
        <span class="empty-symbol"><Icon name="search" size={28} /></span>
        <h2>No rooms match your search.</h2>
        <p>Try another name or room code, or browse every open room.</p>
        <button class="button secondary" onclick={clearSearch}>Show all rooms</button>
      </div>{:else if loaded}<div class="room-cards">
        {#each visible as room (room.code)}<article aria-labelledby={`room-name-${room.code}`}>
            <div class="room-card-meta">
              <span class="open-label"><span></span>OPEN ROOM</span><span
                class="room-code"
                aria-label={`Room code ${room.code}`}>{room.code}</span
              >
            </div>
            <h2 id={`room-name-${room.code}`}>{room.name}</h2>
            <p class="room-listeners">
              <Icon name="users" size={18} />{room.viewers}
              {room.viewers === 1 ? 'person' : 'people'} listening
            </p>
            <button
              class="button secondary join-room"
              aria-label={`Join ${room.name} (${room.code})`}
              disabled={busy}
              onclick={() => void onJoin(room.code)}
              >Join room <Icon name="arrow" size={18} /></button
            >
          </article>{/each}
      </div>{/if}
  </div>
  <footer class="directory-footer">
    <div>
      <strong>Have a soundtrack in mind?</strong>
      <p>Start a room and make it your own.</p>
    </div>
    <div class="room-actions">
      <a class="button secondary" href="/discord"
        >Discord & concerts <Icon name="arrow" size={18} /></a
      >
    </div>
  </footer>
</section>

<style>
  .directory {
    max-width: none;
    margin-inline: auto;
  }
  .refresh-rooms {
    flex-shrink: 0;
  }
  .directory-toolbar {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 28px;
  }
  .room-filter {
    flex: 1;
    max-width: 580px;
    min-width: 0;
  }
  .room-filter label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 10px;
  }
  .filter-input {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 6px 8px 6px 16px;
    border: 1px solid var(--line-strong, #41444d);
    border-radius: 12px;
    background: var(--surface, #14161a);
  }
  .filter-input:focus-within {
    outline: 2px solid var(--red);
    outline-offset: 3px;
  }
  .filter-input :global(svg) {
    flex-shrink: 0;
    color: var(--muted);
  }
  .filter-input input {
    width: 100%;
    min-width: 0;
    padding: 8px 0;
    background: transparent;
    color: var(--text);
    border: 0;
    outline: 0;
    font: inherit;
    font-size: 16px;
  }
  .filter-input input:focus-visible {
    outline: 0;
  }
  .clear-filter {
    flex-shrink: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    padding: 9px 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .clear-filter:hover {
    background: var(--surface-raised, #20232a);
  }
  .clear-filter:focus-visible {
    outline: 2px solid var(--red);
    outline-offset: 3px;
  }
  .directory-count {
    color: var(--muted);
    font-size: 14px;
    line-height: 1.5;
    padding-bottom: 15px;
  }
  .directory-error {
    padding: 20px;
    margin-bottom: 24px;
    border: 1px solid #72414b;
    border-radius: 12px;
    background: #27171d;
  }
  .directory-error strong {
    font-size: 15px;
  }
  .directory-error p {
    color: #e4bcc5;
    line-height: 1.6;
    margin-top: 7px;
  }
  .room-cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 20px;
  }
  article {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: clamp(22px, 2vw, 30px);
    background: var(--surface, #14161a);
    border: 1px solid var(--line);
    border-radius: 18px;
  }
  article:focus-within {
    border-color: #87515e;
  }
  .room-card-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 28px;
  }
  .open-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 10px;
    letter-spacing: 0.1em;
    font-weight: 600;
  }
  .open-label span {
    width: 6px;
    height: 6px;
    background: var(--red);
    border-radius: 50%;
  }
  .room-code {
    color: var(--muted);
    font-family: ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.06em;
  }
  article h2 {
    font-size: clamp(21px, 1.7vw, 28px);
    letter-spacing: -0.035em;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .room-listeners {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.6;
    margin-top: 16px;
    margin-bottom: 30px;
  }
  .join-room {
    margin-top: auto;
    width: 100%;
    justify-content: space-between;
  }
  .directory-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: clamp(36px, 6vw, 72px) 24px;
    border: 1px dashed var(--line);
    border-radius: 18px;
  }
  .empty-symbol {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    color: #d2bec5;
    background: #251b23;
    border-radius: 20px;
    margin-bottom: 24px;
  }
  .directory-empty h2 {
    font-size: clamp(22px, 2.2vw, 32px);
    letter-spacing: -0.035em;
    line-height: 1.25;
  }
  .directory-empty p {
    max-width: 460px;
    color: var(--muted);
    line-height: 1.7;
    margin-top: 14px;
  }
  .directory-empty .button {
    margin-top: 24px;
  }
  .directory-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    margin-top: 36px;
    padding-top: 28px;
    border-top: 1px solid var(--line);
  }
  .directory-footer strong {
    font-size: 16px;
  }
  .directory-footer p {
    margin-top: 8px;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.6;
  }
  .room-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  @media (max-width: 1400px) {
    .room-cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 700px) {
    .room-cards {
      grid-template-columns: minmax(0, 1fr);
    }
    .directory-toolbar {
      align-items: stretch;
      flex-direction: column;
      gap: 12px;
    }
    .room-filter {
      max-width: none;
    }
    .directory-count {
      padding-bottom: 0;
    }
    .directory-footer {
      align-items: stretch;
      flex-direction: column;
    }
    .room-actions > .button {
      flex: 1 1 170px;
    }
  }
</style>
