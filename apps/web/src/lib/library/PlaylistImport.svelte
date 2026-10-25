<script lang="ts">
  import Icon from '#lib/ui/Icon.svelte';
  import { ROOM_QUEUE_LIMIT } from '../../../../../services/core/src/protocol.ts';
  import { onMount } from 'svelte';
  import { createPlaylistImport, type PlaylistState } from '#lib/library/playlist-import-client.ts';
  let {
    busy,
    capacity = ROOM_QUEUE_LIMIT,
    queuedIds = [],
    onAdd,
  }: {
    busy: boolean;
    capacity?: number;
    queuedIds?: readonly string[];
    onAdd: (ids: readonly string[]) => Promise<void> | void;
  } = $props();
  let client: ReturnType<typeof createPlaylistImport> | undefined;
  let view = $state<PlaylistState>({
    loading: false,
    job: null,
    error: '',
    notice: '',
    sourceUrl: '',
  });
  let query = $state('');
  let input = $state<HTMLInputElement>();
  let selected = $state<string[]>([]);
  let page = $state(0);
  let adding = $state(false);
  let addError = $state('');
  const limit = $derived(
    Math.max(0, Math.min(ROOM_QUEUE_LIMIT, Number.isFinite(capacity) ? Math.floor(capacity) : 0)),
  );
  const videos = $derived(
    view.job?.status === 'done'
      ? view.job.videos.filter(
          (video, index, all) =>
            video.embeddable && all.findIndex((candidate) => candidate.id === video.id) === index,
        )
      : [],
  );
  const available = $derived(videos.filter((video) => !queuedIds.includes(video.id)));
  const pendingSelected = $derived(selected.filter((id) => !queuedIds.includes(id)));
  const pages = $derived(Math.max(1, Math.ceil(videos.length / 20)));
  const currentPage = $derived(Math.min(page, pages - 1));
  const shown = $derived(videos.slice(currentPage * 20, (currentPage + 1) * 20));
  onMount(() => {
    client = createPlaylistImport({ hidden: () => document.hidden });
    const unsubscribe = client.subscribe((value) => {
      view = value;
    });
    const visibility = () => client?.visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      unsubscribe();
      client?.destroy();
    };
  });
  export function preview(url: string) {
    if (adding) return;
    query = url;
    selected = [];
    page = 0;
    addError = '';
    input?.focus();
    input?.scrollIntoView({ block: 'center' });
    void client?.load(url);
  }
  async function add() {
    if (busy || adding || !pendingSelected.length || pendingSelected.length > limit) return;
    adding = true;
    addError = '';
    try {
      await onAdd([...pendingSelected]);
      selected = [];
    } catch (error) {
      addError = error instanceof Error ? error.message : 'The selected tracks could not be added.';
    } finally {
      adding = false;
    }
  }
</script>

<section class="playlist" aria-label="Import a playlist" aria-busy={view.loading || adding}>
  <h2 id="playlist-import-title">Bring your playlist</h2>
  <p>Load a YouTube or Spotify playlist, then choose the songs for this room.</p>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      selected = [];
      page = 0;
      addError = '';
      void client?.load(query);
    }}
  >
    <label for="playlist-link">Playlist link</label>
    <div class="row">
      <input
        id="playlist-link"
        bind:this={input}
        type="url"
        bind:value={query}
        maxlength="2000"
        required
        placeholder="https://www.youtube.com/playlist?list=…"
        oninput={() => {
          client?.reset();
          selected = [];
          page = 0;
          addError = '';
        }}
      />
      <button type="submit" disabled={!query.trim() || adding}>Load playlist</button>
      {#if view.loading}<button type="button" onclick={() => client?.cancel()}>Cancel</button>{/if}
    </div>
  </form>
  <p class="note">
    Spotify metadata is matched to available playback sources. Spotify audio is not streamed.
  </p>
  {#if view.loading}<p role="status">Loading playlist…</p>{/if}
  {#if view.error || addError}<p role="alert" class="error">{view.error || addError}</p>{/if}
  {#if view.notice}<p role="status">{view.notice}</p>{/if}
  {#if view.job?.status === 'done'}
    <div class="row summary">
      <p role="status">
        {videos.length} available tracks{view.job.total === undefined
          ? ''
          : ` · ${view.job.total} playlist entries`}
      </p>
      {#if view.sourceUrl}<a
          href={view.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open original playlist ↗"
          >Open original playlist <Icon name="external" size={15} /></a
        >{/if}
    </div>
    {#if view.job.skipped}<p>
        {view.job.skipped} unavailable or unmatched entries were skipped.
      </p>{/if}
    {#if view.job.limited}<p>
        This is a partial preview. Source or import limits may exclude entries.
      </p>{/if}
    <p>
      {limit
        ? `Select up to ${limit} tracks for the queue.`
        : 'The queue is full. Make room before adding tracks.'}
    </p>
    {#if videos.length}
      <div class="row">
        <button
          type="button"
          disabled={!limit || adding || !available.length}
          onclick={() => {
            selected = available.slice(0, limit).map((video) => video.id);
          }}>Select first {Math.min(limit, available.length)}</button
        >
        <button
          type="button"
          disabled={!selected.length || adding}
          onclick={() => {
            selected = [];
          }}>Clear selection</button
        ><span role="status">{pendingSelected.length} selected</span>
      </div>
      <ol start={currentPage * 20 + 1}>
        {#each shown as video (video.id)}<li>
            <label class="track"
              ><input
                type="checkbox"
                checked={selected.includes(video.id) || queuedIds.includes(video.id)}
                disabled={adding ||
                  queuedIds.includes(video.id) ||
                  (!selected.includes(video.id) && pendingSelected.length >= limit)}
                onchange={(event) => {
                  selected = event.currentTarget.checked
                    ? [...selected, video.id]
                    : selected.filter((id) => id !== video.id);
                }}
              />
              <span
                ><strong>{video.title}</strong><small>{video.artist}</small
                >{#if queuedIds.includes(video.id)}<small>Already queued</small>{/if}</span
              ></label
            >
          </li>{/each}
      </ol>
      <nav class="row" aria-label="Playlist pages">
        <button
          type="button"
          disabled={currentPage === 0}
          onclick={() => {
            page = currentPage - 1;
          }}>Previous page</button
        >
        <span>Page {currentPage + 1} of {pages}</span><button
          type="button"
          disabled={currentPage >= pages - 1}
          onclick={() => {
            page = currentPage + 1;
          }}>Next page</button
        >
      </nav>
      <button
        type="button"
        class="primary"
        disabled={busy || adding || !pendingSelected.length || pendingSelected.length > limit}
        onclick={() => {
          void add();
        }}>{adding ? 'Adding tracks…' : `Add ${pendingSelected.length} selected to queue`}</button
      >
    {/if}
  {/if}
</section>

<style>
  .playlist {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    padding: clamp(22px, 2.2vw, 36px);
    min-width: 0;
  }
  h2 {
    font-size: clamp(25px, 2.2vw, 33px);
    letter-spacing: -0.045em;
    line-height: 1.2;
    margin-bottom: 14px;
    scroll-margin-top: 24px;
  }
  p {
    color: var(--muted);
    font-size: 14px;
    line-height: 1.75;
    margin: 12px 0;
    max-width: 74ch;
  }
  form {
    margin-top: 24px;
  }
  label {
    font-size: 13px;
    color: #dedee6;
    font-weight: 550;
    display: block;
    margin-bottom: 10px;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin: 16px 0;
  }
  .row input {
    flex: 1;
    min-width: min(260px, 100%);
  }
  input {
    padding: 12px 14px;
    color: inherit;
    background: #101216;
    border: 1px solid #424753;
    border-radius: 10px;
    min-height: 48px;
    font-size: 16px;
  }
  button {
    min-height: 46px;
    border: 1px solid #3b404c;
    border-radius: 10px;
    padding: 11px 15px;
    background: var(--surface-raised);
    color: inherit;
    font-size: 13px;
    font-weight: 550;
    line-height: 1.4;
  }
  button:hover:not(:disabled) {
    background: var(--surface-hover);
    border-color: #656571;
  }
  .primary {
    background: var(--red);
    color: #100b0e;
    border-color: var(--red);
    font-weight: 700;
  }
  .primary:hover:not(:disabled) {
    background: #ff6578;
  }
  .note,
  .row span,
  a {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.7;
  }
  a {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: #eed0d5;
    text-decoration: underline;
    text-underline-offset: 4px;
    padding: 10px 0;
  }
  .summary {
    border-top: 1px solid var(--line);
    padding-top: 14px;
    justify-content: space-between;
  }
  .error {
    color: #ff9cab;
    border: 1px solid #713a4a;
    border-radius: 10px;
    background: #2a171f;
    padding: 12px 16px;
  }
  ol {
    padding: 0 0 0 28px;
    margin: 20px 0;
    max-height: min(65vh, 600px);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #555a68 transparent;
    scrollbar-gutter: stable;
  }
  li {
    padding: 14px 4px;
    border-bottom: 1px solid var(--line);
  }
  li::marker {
    color: #7e8493;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .track {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 0;
    min-height: 44px;
    cursor: pointer;
  }
  .track input {
    accent-color: var(--red);
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    min-height: 22px;
  }
  .track span {
    min-width: 0;
  }
  strong,
  small {
    display: block;
    overflow-wrap: anywhere;
  }
  strong {
    font-size: 14px;
    font-weight: 550;
    line-height: 1.6;
  }
  small {
    color: var(--muted);
    font-size: 12px;
    font-weight: 400;
    margin-top: 4px;
  }
  @media (max-width: 600px) {
    .playlist {
      padding: 22px 18px;
      border-radius: 18px;
    }
    .row input {
      flex-basis: 100%;
    }
    nav.row {
      justify-content: space-between;
      gap: 8px;
    }
    nav button {
      padding: 10px 12px;
      font-size: 12px;
    }
  }
</style>
