<script lang="ts">
  import { onMount } from 'svelte';
  import { request } from '../../../../lib/browser-api.ts';
  import type { OpenRoom } from '../../../../lib/types.ts';
  let {
    busy,
    onJoin,
    onCreate,
  }: { busy: boolean; onJoin: (code: string) => void | Promise<void>; onCreate: () => void } =
    $props();
  let rooms = $state<OpenRoom[]>([]),
    loading = $state(true),
    error = $state('');
  let controller: AbortController | undefined;
  async function refresh() {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    loading = true;
    error = '';
    try {
      const result = await request<{ rooms: OpenRoom[] }>('/api/rooms', {
        cache: 'no-store',
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(12000)]),
      });
      if (!current.signal.aborted) rooms = result.rooms;
    } catch {
      if (!current.signal.aborted) error = 'Open rooms could not load. Try again.';
    } finally {
      if (!current.signal.aborted) loading = false;
    }
  }
  onMount(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30000);
    return () => {
      clearInterval(timer);
      controller?.abort();
    };
  });
</script>

<section class="directory" aria-labelledby="directory-title">
  <p class="eyebrow red">THERE'S ROOM FOR YOU</p>
  <div class="section-heading">
    <h1 id="directory-title">Find your people.</h1>
    <button
      class="button secondary"
      disabled={loading}
      onclick={() => {
        void refresh();
      }}>Refresh rooms</button
    >
  </div>
  <p>Rooms their hosts have opened to everyone. Pick a soundtrack and join in.</p>
  {#if error}<p class="error-message" role="alert">{error}</p>{:else if loading && !rooms.length}<p
      role="status"
    >
      Finding open rooms…
    </p>{:else if !rooms.length}<div class="empty-stage">
      <h2>The next great room could be yours.</h2>
      <p>No open rooms right now. Create one and invite your people.</p>
    </div>{:else}<div class="room-cards">
      {#each rooms as room (room.code)}<article>
          <span class="eyebrow">LISTEN TOGETHER</span>
          <h2>{room.name}</h2>
          <p>{room.viewers} listening</p>
          <button
            class="button primary"
            disabled={busy}
            onclick={() => {
              void onJoin(room.code);
            }}>Join room</button
          >
        </article>{/each}
    </div>{/if}
  <div class="room-actions">
    <button class="button secondary" onclick={onCreate}>Create a room</button><a
      class="button secondary"
      href="/v3/discord">Discord & concerts</a
    >
  </div>
</section>

<style>
  .directory > p {
    color: var(--muted);
    line-height: 1.8;
    margin-bottom: 26px;
  }
  .directory h1 {
    font-size: clamp(32px, 5vw, 64px);
    letter-spacing: -2px;
  }
  .directory > .room-actions {
    margin-top: 26px;
  }
  .room-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
    gap: 18px;
  }
  article {
    padding: 26px;
    background: #151517;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  article h2 {
    margin: 18px 0 12px;
    overflow-wrap: anywhere;
  }
  article p {
    color: var(--muted);
    margin-bottom: 24px;
  }
</style>
