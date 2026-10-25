<script lang="ts">
  import { ROOM_QUEUE_LIMIT } from '../../../../../services/core/src/protocol.ts';
  import { onMount } from 'svelte';
  import PlaylistImport from '#lib/library/PlaylistImport.svelte';
  import ConcertCatalog from '#lib/library/ConcertCatalog.svelte';
  import { browserStorage } from '../../../../../lib/browser-storage.ts';
  import {
    emptyLibrary,
    readLibrary,
    uniqueEveningTracks,
    type EveningLibrary,
  } from '../../../../../lib/evening-library.ts';
  import type { Video } from '../../../../../lib/types.ts';
  let {
    tracks,
    history,
    busy,
    capacity = Math.max(0, ROOM_QUEUE_LIMIT - tracks.length),
    pendingIds = [],
    onAdd,
  }: {
    tracks: Video[];
    history: Video[];
    busy: boolean;
    capacity?: number;
    pendingIds?: readonly string[];
    onAdd: (ids: readonly string[]) => Promise<void> | void;
  } = $props();
  const key = 'afterparty-library-v1';
  let library = $state<EveningLibrary>(emptyLibrary());
  let name = $state('Our evening');
  let error = $state('');
  let notice = $state('');
  let adding = $state(false);
  let ready = $state(false);
  let invalidStored = $state(false);
  let playlistImport = $state<{ preview: (url: string) => void }>();
  const available = $derived(uniqueEveningTracks(history, tracks));
  const limit = $derived(
    Math.max(0, Math.min(ROOM_QUEUE_LIMIT, Number.isFinite(capacity) ? Math.floor(capacity) : 0)),
  );
  const queuedIds = $derived([...tracks.map((track) => track.id), ...pendingIds]);
  function additions(ids: readonly string[]) {
    return [...new Set(ids)].filter((id) => !queuedIds.includes(id));
  }
  onMount(() => {
    const read = () => {
      try {
        library = readLibrary(browserStorage.get(key));
        error = '';
        invalidStored = false;
      } catch (caught) {
        error = caught instanceof Error ? caught.message : 'The saved library could not be read.';
        invalidStored = true;
      }
      ready = true;
    };
    read();
    return browserStorage.subscribe(key, read);
  });
  function update(next: EveningLibrary) {
    if (!ready || invalidStored) return;
    try {
      const valid = readLibrary(JSON.stringify(next));
      library = valid;
      error = browserStorage.set(key, JSON.stringify(valid))
        ? ''
        : 'Your browser blocks storage. Download a backup before closing this page.';
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'The library could not be saved.';
    }
  }
  function save(source: Video[]) {
    if (!source.length) return;
    update({
      ...library,
      evenings: [
        {
          id: crypto.randomUUID(),
          name: name.trim().slice(0, 80) || 'Our evening',
          tracks: uniqueEveningTracks([], source).slice(0, 50),
          savedAt: Date.now(),
        },
        ...library.evenings,
      ].slice(0, 30),
    });
    if (!error) notice = 'Your evening is saved on this device.';
  }
  function favorite(video: Video) {
    update({
      ...library,
      favorites: library.favorites.some((item) => item.id === video.id)
        ? library.favorites.filter((item) => item.id !== video.id)
        : [video, ...library.favorites].slice(0, 200),
    });
  }
  function backup() {
    // Preserve even an unreadable stored file so it can be repaired without data loss.
    const raw = invalidStored ? (browserStorage.get(key) ?? '') : JSON.stringify(library, null, 2);
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'afterparty-library.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1000000)
        throw new Error('The file is too large. Choose a library smaller than 1 MB.');
      const next = readLibrary(await file.text());
      if (
        !confirm(
          'Replace the library on this device? Download a backup first to keep the current library.',
        )
      )
        return;
      invalidStored = false;
      update(next);
      if (!error) notice = 'Your library has been imported.';
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'The library could not be imported.';
    } finally {
      input.value = '';
    }
  }
  async function add(ids: readonly string[], rethrow = false) {
    if (busy || adding || !ids.length) return;
    const next = additions(ids);
    if (!next.length) {
      notice = 'Those tracks are already in this queue.';
      return;
    }
    if (next.length > limit) {
      error = `The queue has room for ${limit} more tracks. Choose fewer tracks or make room first.`;
      if (rethrow) throw new Error(error);
      return;
    }
    adding = true;
    error = '';
    notice = '';
    try {
      await onAdd(next);
    } catch (caught) {
      error =
        caught instanceof Error ? caught.message : 'The tracks could not be added to this room.';
      if (rethrow) throw caught;
    } finally {
      adding = false;
    }
  }
</script>

<section class="music-library" aria-label="Your music library">
  <nav class="library-nav" aria-label="Library sections">
    <a href="#library-title">Your collection</a>
    <a href="#playlist-import-title">Playlist import</a>
    <a href="#festival-title">Festival sets</a>
  </nav>
  <section class="local-library" aria-labelledby="library-title">
    <p class="eyebrow red">GOOD NIGHTS, SAVED</p>
    <h2 id="library-title">Your collection</h2>
    <p>
      Favorites and evenings stay on this device. Your existing Afterparty library is available here
      too.
    </p>
    <p class="queue-capacity" role="status">
      {limit
        ? `${limit} queue spaces available.`
        : 'The queue is full. Make room before adding tracks.'}
    </p>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        save(tracks);
      }}
    >
      <label for="evening-name">Name this evening</label>
      <div class="row">
        <input id="evening-name" bind:value={name} maxlength="80" required />
        <button class="primary" disabled={!ready || invalidStored || !tracks.length}
          >Save current queue</button
        >
        <button
          type="button"
          disabled={!ready || invalidStored || !history.length}
          onclick={() => save(history)}>Save played tracks</button
        >
      </div>
    </form>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if notice}<p role="status">{notice}</p>{/if}
    <details class="transfer">
      <summary>Library backup and import</summary>
      <div class="row">
        <button type="button" onclick={backup}>Download library</button>
        <label class="file-button"
          >Import library<input
            type="file"
            accept="application/json,.json"
            onchange={(event) => {
              void importFile(event);
            }}
          /></label
        >
      </div>
    </details>
    {#each library.evenings as evening, eveningIndex (`${evening.id}:${eveningIndex}`)}
      <details class="evening">
        <summary>{evening.name} <span>{evening.tracks.length} tracks</span></summary>
        <div class="row">
          <input
            aria-label={`Rename ${evening.name}`}
            value={evening.name}
            maxlength="80"
            disabled={invalidStored}
            onchange={(event) =>
              update({
                ...library,
                evenings: library.evenings.map((item) =>
                  item.id === evening.id
                    ? {
                        ...item,
                        name: event.currentTarget.value.trim().slice(0, 80) || 'Our evening',
                      }
                    : item,
                ),
              })}
          />
          <button
            type="button"
            disabled={busy ||
              adding ||
              !evening.tracks.length ||
              additions(evening.tracks.map((video) => video.id)).length > limit}
            onclick={() => {
              void add(evening.tracks.map((video) => video.id));
            }}>Add evening to queue</button
          >
          <button
            type="button"
            disabled={invalidStored}
            onclick={() => {
              if (confirm(`Delete “${evening.name}” from this device?`))
                update({
                  ...library,
                  evenings: library.evenings.filter((item) => item.id !== evening.id),
                });
            }}>Delete evening</button
          >
        </div>
        <ol>
          {#each evening.tracks as video, index (`${video.id}:${index}`)}<li>
              <span class="track-title">{video.title}<small>{video.artist}</small></span>
              <button
                type="button"
                aria-label={`Move ${video.title} up`}
                disabled={index === 0 || invalidStored}
                onclick={() => {
                  const reordered = [...evening.tracks];
                  [reordered[index - 1], reordered[index]] = [
                    reordered[index],
                    reordered[index - 1],
                  ];
                  update({
                    ...library,
                    evenings: library.evenings.map((item) =>
                      item.id === evening.id ? { ...item, tracks: reordered } : item,
                    ),
                  });
                }}>↑</button
              >
              <button
                type="button"
                aria-label={`Remove ${video.title} from ${evening.name}`}
                disabled={invalidStored}
                onclick={() =>
                  update({
                    ...library,
                    evenings: library.evenings.map((item) =>
                      item.id === evening.id
                        ? { ...item, tracks: item.tracks.filter((_, i) => i !== index) }
                        : item,
                    ),
                  })}>Remove</button
              >
            </li>{/each}
        </ol>
      </details>
    {/each}
    {#if !library.evenings.length}<p class="empty">
        Save a queue to keep the soundtrack for another night.
      </p>{/if}
    <h3>Favorites <span>{library.favorites.length}</span></h3>
    {#if library.favorites.length}<ul>
        {#each library.favorites as video, favoriteIndex (`${video.id}:${favoriteIndex}`)}<li>
            <span class="track-title">{video.title}<small>{video.artist}</small></span>
            <button
              type="button"
              disabled={busy || adding || !limit || queuedIds.includes(video.id)}
              aria-label={`Add ${video.title} to queue`}
              onclick={() => {
                void add([video.id]);
              }}>{queuedIds.includes(video.id) ? 'Queued' : 'Add'}</button
            >
            <button
              type="button"
              disabled={invalidStored}
              aria-label={`Unfavorite ${video.title}`}
              onclick={() => favorite(video)}>♥</button
            >
          </li>{/each}
      </ul>{:else}<p class="empty">Mark favorites below to keep them close.</p>{/if}
    {#if available.length}<h3>This evening</h3>
      <ul>
        {#each available as video (video.id)}<li>
            <span class="track-title">{video.title}<small>{video.artist}</small></span>
            <button
              type="button"
              disabled={!ready || invalidStored}
              aria-pressed={library.favorites.some((item) => item.id === video.id)}
              aria-label={`Favorite ${video.title}`}
              onclick={() => favorite(video)}
              >{library.favorites.some((item) => item.id === video.id) ? '♥' : '♡'}</button
            >
          </li>{/each}
      </ul>{/if}
  </section>
  <PlaylistImport
    bind:this={playlistImport}
    busy={busy || adding}
    capacity={limit}
    {queuedIds}
    onAdd={(ids) => add(ids, true)}
  />
  <ConcertCatalog
    onPreviewPlaylist={(url) => playlistImport?.preview(url)}
    busy={busy || adding}
    capacity={limit}
    {queuedIds}
    onAdd={(ids) => add(ids, true)}
  />
</section>

<style>
  .music-library {
    display: grid;
    gap: 0;
    margin-top: 0;
    min-width: 0;
  }
  .library-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--line);
    background: #111113;
  }
  .library-nav a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: #d8d9e2;
    font-size: 13px;
    font-weight: 550;
  }
  .library-nav a:hover {
    border-color: #6b4651;
    background: #281b22;
    color: #fff;
  }
  .local-library {
    border: 0;
    border-radius: 0;
    background: transparent;
    padding: 22px 20px;
    min-width: 0;
  }
  h2 {
    font-size: clamp(23px, 1.5vw, 28px);
    line-height: 1.2;
    letter-spacing: -0.045em;
    margin: 10px 0;
    scroll-margin-top: 82px;
  }
  h3 {
    font-size: 20px;
    letter-spacing: -0.025em;
    margin: 30px 0 16px;
  }
  h3 span {
    color: #c8c8d3;
    font-size: 12px;
    margin-left: 8px;
    padding: 4px 9px;
    border-radius: 999px;
    background: #282c35;
    font-variant-numeric: tabular-nums;
  }
  p {
    font-size: 14px;
    color: var(--muted);
    line-height: 1.75;
    margin: 12px 0;
    max-width: 74ch;
  }
  .queue-capacity {
    display: inline-block;
    color: #d7d8e2;
    border: 1px solid #3b3f4a;
    padding: 7px 12px;
    border-radius: 9px;
    font-size: 12px;
    margin-top: 10px;
  }
  form {
    margin: 24px 0;
    padding: 22px 0;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }
  label {
    font-size: 13px;
    color: #dedee6;
    font-weight: 550;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin: 12px 0;
  }
  input:not([type='file']) {
    background: #101216;
    border: 1px solid #424753;
    border-radius: 10px;
    color: inherit;
    padding: 12px 14px;
    min-height: 48px;
    min-width: 0;
    flex: 1;
    font-size: 16px;
  }
  button,
  .file-button {
    background: var(--surface-raised);
    border: 1px solid #3b404c;
    border-radius: 10px;
    color: #eeeef4;
    min-height: 44px;
    padding: 11px 15px;
    font-size: 13px;
    line-height: 1.4;
    font-weight: 550;
  }
  button:hover:not(:disabled),
  .file-button:hover {
    background: var(--surface-hover);
    border-color: #656571;
  }
  button[aria-pressed='true'] {
    color: #ff7a8b;
    border-color: #925062;
    background: #2a1a23;
  }
  .primary {
    background: var(--red);
    color: #100b0e;
    border-color: var(--red);
    font-weight: 700;
  }
  .primary:hover:not(:disabled) {
    background: #ff6578;
    border-color: #ff6578;
  }
  .file-button {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    cursor: pointer;
  }
  .file-button input {
    max-width: min(220px, 100%);
    font-size: 12px;
  }
  details {
    border-bottom: 1px solid var(--line);
    padding: 16px 0;
  }
  .evening[open] {
    margin-top: 12px;
    border: 1px solid #3a3f4a;
    border-radius: 14px;
    padding: 16px;
    background: #101216;
  }
  summary {
    cursor: pointer;
    min-height: 44px;
    font-size: 15px;
    font-weight: 550;
    line-height: 1.65;
    overflow-wrap: anywhere;
    padding: 8px 0;
  }
  summary span {
    color: var(--muted);
    margin-left: 10px;
    font-size: 12px;
    font-weight: 400;
  }
  ol,
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: min(65vh, 600px);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #555a68 transparent;
    scrollbar-gutter: stable;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 0;
    border-bottom: 1px solid var(--line);
  }
  .track-title {
    min-width: 0;
    flex: 1;
    font-size: 14px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  small {
    display: block;
    color: var(--muted);
    font-size: 12px;
    margin-top: 4px;
  }
  .empty {
    padding: 22px;
    border: 1px dashed #3a3e49;
    border-radius: 12px;
    background: #101216;
  }
  .error {
    color: #ff9cab;
    padding: 12px 16px;
    background: #2a171f;
    border: 1px solid #713a4a;
    border-radius: 10px;
  }
  @media (max-width: 600px) {
    .library-nav {
      gap: 6px;
    }
    .library-nav a {
      padding: 10px 12px;
      font-size: 12px;
    }
    .row input:not([type='file']) {
      flex-basis: 100%;
    }
    li button {
      padding: 10px;
      flex-shrink: 0;
    }
    .local-library {
      padding: 22px 18px;
      border-radius: 18px;
    }
  }
</style>
