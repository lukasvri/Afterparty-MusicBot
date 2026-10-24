<script lang="ts">
  import { onMount } from 'svelte';
  import PlaylistImport from '#lib/PlaylistImport.svelte';
  import ConcertCatalog from '#lib/ConcertCatalog.svelte';
  import { browserStorage } from '../../../../lib/browser-storage.ts';
  import {
    emptyLibrary,
    readLibrary,
    uniqueEveningTracks,
    type EveningLibrary,
  } from '../../../../lib/evening-library.ts';
  import type { Video } from '../../../../lib/types.ts';
  let {
    tracks,
    history,
    busy,
    onAdd,
  }: {
    tracks: Video[];
    history: Video[];
    busy: boolean;
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
  const available = $derived(uniqueEveningTracks(history, tracks));
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
    adding = true;
    error = '';
    try {
      await onAdd(ids);
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
  <PlaylistImport
    busy={busy || adding}
    capacity={Math.max(0, 50 - tracks.length)}
    onAdd={(ids) => add(ids, true)}
  />
  <ConcertCatalog busy={busy || adding} onAdd={(ids) => add(ids, true)} />
  <section class="local-library" aria-labelledby="library-title">
    <p class="eyebrow red">GOOD NIGHTS, SAVED</p>
    <h2 id="library-title">Your collection</h2>
    <p>
      Favorites and evenings stay on this device. Your existing Afterparty library is available here
      too.
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
            disabled={busy || adding || !evening.tracks.length}
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
              disabled={busy || adding}
              aria-label={`Add ${video.title} to queue`}
              onclick={() => {
                void add([video.id]);
              }}>Add</button
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
</section>

<style>
  .music-library {
    margin-top: 32px;
  }
  .local-library {
    border-top: 1px solid var(--line);
    padding-top: 28px;
    margin-top: 32px;
  }
  h2 {
    font-size: 26px;
    letter-spacing: -0.8px;
    margin: 10px 0;
  }
  h3 {
    font-size: 17px;
    margin: 28px 0 14px;
  }
  h3 span {
    color: var(--muted);
    font-size: 12px;
    margin-left: 8px;
  }
  p {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.8;
    margin: 12px 0;
  }
  form {
    margin: 22px 0;
  }
  label {
    font-size: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin: 12px 0;
  }
  input:not([type='file']) {
    background: #161619;
    border: 1px solid #3c3a42;
    color: inherit;
    padding: 12px;
    min-height: 44px;
    min-width: 0;
    flex: 1;
  }
  button,
  .file-button {
    background: #1b1b1f;
    border: 1px solid #38383e;
    color: inherit;
    min-height: 44px;
    padding: 10px 14px;
    font-size: 12px;
  }
  .primary {
    background: var(--red);
    color: #0b0b0d;
    font-weight: 650;
  }
  .file-button {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    cursor: pointer;
  }
  .file-button input {
    max-width: 220px;
    font-size: 11px;
  }
  details {
    border-bottom: 1px solid var(--line);
    padding: 15px 0;
  }
  summary {
    cursor: pointer;
    min-height: 32px;
    font-size: 13px;
    line-height: 1.8;
    overflow-wrap: anywhere;
  }
  summary span {
    color: var(--muted);
    margin-left: 10px;
    font-size: 11px;
  }
  ol,
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 0;
    border-bottom: 1px solid #232327;
  }
  .track-title {
    min-width: 0;
    flex: 1;
    font-size: 12px;
    line-height: 1.7;
    overflow-wrap: anywhere;
  }
  small {
    display: block;
    color: var(--muted);
    font-size: 10px;
  }
  .empty {
    padding: 14px 0;
  }
  .error {
    color: #ff9cab;
  }
  @media (max-width: 500px) {
    .row input:not([type='file']) {
      flex-basis: 100%;
    }
    li button {
      padding: 10px;
    }
  }
</style>
