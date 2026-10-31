<script lang="ts">
  import Icon from '#lib/ui/Icon.svelte';
  import { ROOM_QUEUE_LIMIT } from '../../../../../services/core/src/protocol.ts';
  import { normalized } from '../../../../../services/core/src/matching.ts';
  import {
    CONCERT_CATALOG,
    CONCERT_SOURCES,
    CONCERT_PLAYLISTS,
  } from '../../../../../lib/concert-catalog.ts';
  let {
    busy,
    capacity = ROOM_QUEUE_LIMIT,
    queuedIds = [],
    onAdd,
    onPreviewPlaylist,
  }: {
    busy: boolean;
    capacity?: number;
    queuedIds?: readonly string[];
    onAdd: (ids: readonly string[]) => Promise<void> | void;
    onPreviewPlaylist?: (url: string) => void;
  } = $props();
  const limit = $derived(
    Math.max(0, Math.min(ROOM_QUEUE_LIMIT, Number.isFinite(capacity) ? Math.floor(capacity) : 0)),
  );
  const events = [...new Map(CONCERT_CATALOG.map((entry) => [entry.eventId, entry.eventName]))];
  let eventId = $state(events[0]?.[0] ?? '');
  let selectionYear = $state(0);
  let adding = $state(false);
  let error = $state('');
  let query = $state('');
  let page = $state(0);
  const years = $derived(
    [
      ...new Set(
        CONCERT_CATALOG.filter((entry) => entry.eventId === eventId).map((entry) => entry.year),
      ),
    ].sort((a, b) => b - a),
  );
  const year = $derived(years.includes(selectionYear) ? selectionYear : (years[0] ?? 0));
  const selected = $derived(
    CONCERT_CATALOG.filter((entry) => entry.eventId === eventId && entry.year === year).filter(
      (entry, index, all) =>
        all.findIndex((candidate) => candidate.videoId === entry.videoId) === index,
    ),
  );
  const coverage = $derived(
    CONCERT_SOURCES.find((source) => source.eventId === eventId && source.year === year),
  );
  const playlist = $derived(
    CONCERT_PLAYLISTS.find((source) => source.eventId === eventId && source.year === year),
  );
  const filtered = $derived(
    selected.filter((entry) =>
      normalized(`${entry.artist} ${entry.title} ${entry.stage ?? ''}`).includes(normalized(query)),
    ),
  );
  const pages = $derived(Math.max(1, Math.ceil(filtered.length / 20)));
  const currentPage = $derived(Math.min(page, pages - 1));
  const shown = $derived(filtered.slice(currentPage * 20, (currentPage + 1) * 20));
  const pendingSets = $derived(selected.filter((entry) => !queuedIds.includes(entry.videoId)));
  async function add(ids: readonly string[]) {
    if (busy || adding || !ids.length) return;
    const next = ids.filter((id) => !queuedIds.includes(id));
    if (!next.length) return;
    if (next.length > limit) {
      error = `The queue has room for ${limit} more sets. Add a single set or make room first.`;
      return;
    }
    error = '';
    adding = true;
    try {
      await onAdd(next);
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message
          : 'These sets could not be added. Check the queue before retrying.';
    } finally {
      adding = false;
    }
  }
</script>

<section class="catalog" aria-labelledby="festival-title" aria-busy={adding}>
  <p class="eyebrow red">THE BIGGER STAGE</p>
  <h2 id="festival-title">Festival concerts</h2>
  <p>
    Explore official festival uploads by event and year. Add a set or the selected year to your
    queue.
  </p>
  {#if events.length}
    <div class="filters">
      <div class="field">
        <label for="festival-event">Festival</label><select
          id="festival-event"
          bind:value={eventId}
          onchange={() => {
            selectionYear = 0;
            page = 0;
            query = '';
            error = '';
          }}
        >
          {#each events as [value, name] (value)}<option {value}>{name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="festival-year">Year</label><select
          id="festival-year"
          value={year}
          onchange={(event) => {
            selectionYear = Number(event.currentTarget.value);
            page = 0;
            query = '';
            error = '';
          }}
        >
          {#each years as value (value)}<option {value}>{value}</option>{/each}
        </select>
      </div>
    </div>
    {#if coverage}<p class="coverage">
        Includes all {coverage.videoIds.length} verified matching-year links in
        {coverage.publisherName}'s checked source snapshot. Checked {coverage.checkedAt}.{' '}
        <a
          href={coverage.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Festival source ↗">Festival source <Icon name="external" size={15} /></a
        >{' '}
        {#if coverage.excluded.length}
          {coverage.excluded.length} source {coverage.excluded.length === 1
            ? 'link was'
            : 'links were'}
          omitted: {[...new Set(coverage.excluded.map((entry) => entry.reason))].join(' ')}{/if}
        {#if coverage.duplicateCount}
          {coverage.duplicateCount} repeated source entries are listed once.
        {/if}
      </p>{:else}<p class="coverage">
        A curated selection of official uploads. The complete source archive has not been verified.
      </p>{/if}
    {#if playlist}<div class="source-playlist">
        <p>
          {playlist.label}. Preview the source's available entries before choosing sets to add.
          Loading keeps the current queue unchanged.
        </p>
        <div class="actions">
          {#if onPreviewPlaylist}<button
              type="button"
              disabled={busy || adding}
              onclick={() => onPreviewPlaylist?.(playlist.url)}>Preview source playlist</button
            >{/if}
          <a
            href={playlist.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open source playlist ↗"
            >Open source playlist <Icon name="external" size={15} /></a
          >
        </div>
      </div>{/if}
    <label for="festival-search">Find an artist or stage</label>
    <input
      id="festival-search"
      type="search"
      bind:value={query}
      maxlength="120"
      oninput={() => {
        page = 0;
      }}
      placeholder="Search this festival year"
    />
    <div class="year-summary">
      <p role="status" aria-live="polite" aria-atomic="true">
        {selected.length} festival sets from {year}
      </p>
      <button
        type="button"
        disabled={busy || adding || !pendingSets.length || pendingSets.length > limit}
        onclick={() => {
          void add(selected.map((entry) => entry.videoId));
        }}>Add selected year to queue</button
      >
    </div>
    {#if pendingSets.length > limit}<p class="note" role="status">
        The selected year has {pendingSets.length} new sets, but the queue has room for {limit}. Add
        individual sets or make room first.
      </p>{/if}
    {#if pendingSets.length > limit && limit > 0}<button
        type="button"
        disabled={busy || adding}
        onclick={() => {
          void add(pendingSets.slice(0, limit).map((entry) => entry.videoId));
        }}>Add next {limit} {limit === 1 ? 'set' : 'sets'} from {year}</button
      >{/if}
    {#if query.trim()}<p role="status">
        {filtered.length} matching {filtered.length === 1 ? 'set' : 'sets'}
      </p>{/if}
    <ol aria-labelledby="festival-title" start={currentPage * 20 + 1}>
      {#each shown as entry (entry.id)}<li>
          <h3>{entry.artist}</h3>
          <p class="title">{entry.title}</p>
          <p class="source">
            {entry.uploaderName
              ? `Official upload by ${entry.uploaderName}`
              : `Linked by ${entry.sourcePublisher}`}{entry.stage ? ` · ${entry.stage}` : ''}
          </p>
          <div class="actions">
            <button
              type="button"
              disabled={busy || adding || !limit || queuedIds.includes(entry.videoId)}
              aria-label={`Add festival set: ${entry.title}`}
              onclick={() => {
                void add([entry.videoId]);
              }}>{queuedIds.includes(entry.videoId) ? 'Already queued' : 'Add set to queue'}</button
            >
            <a
              href={`https://www.youtube.com/watch?v=${entry.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Official video ↗">Official video <Icon name="external" size={15} /></a
            >
          </div>
        </li>{/each}
    </ol>
    {#if !filtered.length}<p role="status">
        No sets match this search. Try another artist or clear the search.
      </p>{/if}
    {#if pages > 1}<nav class="actions" aria-label="Festival pages">
        <button
          type="button"
          disabled={currentPage === 0}
          onclick={() => {
            page = currentPage - 1;
          }}>Previous sets</button
        >
        <span>Page {currentPage + 1} of {pages}</span>
        <button
          type="button"
          disabled={currentPage >= pages - 1}
          onclick={() => {
            page = currentPage + 1;
          }}>Next sets</button
        >
      </nav>{/if}
  {:else}<p role="status">No festival sets are listed yet.</p>{/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <p class="note">
    Video availability and browser playback depend on the uploader. Adding sets keeps your current
    playback and saved evenings.
  </p>
</section>

<style>
  .catalog {
    border: 0;
    border-top: 1px solid var(--line);
    border-radius: 0;
    background: transparent;
    padding: 22px 20px;
    min-width: 0;
  }
  h2 {
    font-size: clamp(23px, 1.5vw, 28px);
    letter-spacing: -0.045em;
    line-height: 1.2;
    margin: 10px 0;
    scroll-margin-top: 82px;
  }
  p {
    font-size: 14px;
    color: var(--muted);
    line-height: 1.75;
    margin: 12px 0;
    max-width: 78ch;
  }
  .filters {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: 16px;
    max-width: 760px;
    margin: 24px 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 13px;
    min-width: 0;
  }
  label {
    display: block;
    color: #dedee6;
    font-size: 13px;
    font-weight: 550;
    margin-bottom: 10px;
  }
  .field label {
    margin: 0;
  }
  select,
  input[type='search'] {
    font: inherit;
    font-size: 16px;
    color: inherit;
    background: #101216;
    border: 1px solid #424753;
    min-height: 48px;
    padding: 12px 14px;
    border-radius: 10px;
    width: 100%;
  }
  input[type='search'] {
    max-width: 760px;
  }
  select:focus-visible,
  input[type='search']:focus-visible {
    outline: 2px solid var(--red);
    outline-offset: 4px;
  }
  button {
    background: var(--surface-raised);
    color: inherit;
    border: 1px solid #3b404c;
    border-radius: 10px;
    padding: 11px 15px;
    min-height: 44px;
    font-size: 13px;
    font-weight: 550;
    line-height: 1.4;
  }
  button:hover:not(:disabled) {
    background: var(--surface-hover);
    border-color: #656571;
  }
  .year-summary,
  .actions {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
    margin: 18px 0;
  }
  .year-summary {
    justify-content: space-between;
    border-top: 1px solid var(--line);
    padding-top: 18px;
    margin-top: 24px;
  }
  .year-summary p {
    color: #dddde5;
    font-size: 15px;
    font-weight: 550;
  }
  .coverage {
    font-size: 12px;
    padding-bottom: 10px;
  }
  .source-playlist {
    padding: 18px 20px;
    border: 1px solid #5c3744;
    border-radius: 14px;
    background: #21171f;
    margin: 18px 0 24px;
  }
  .source-playlist p {
    margin-top: 0;
    color: #d7c0c9;
    font-size: 13px;
  }
  .source-playlist .actions {
    margin-bottom: 0;
  }
  ol {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    list-style: none;
    padding: 0;
    margin: 22px 0;
    max-height: min(75vh, 740px);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #555a68 transparent;
    scrollbar-gutter: stable;
  }
  li {
    display: flex;
    flex-direction: column;
    padding: 22px;
    border: 1px solid #303540;
    border-radius: 14px;
    background: #101216;
    min-width: 0;
  }
  h3 {
    font-size: 19px;
    line-height: 1.35;
    letter-spacing: -0.03em;
    overflow-wrap: anywhere;
  }
  .title {
    color: #d3d5e0;
    font-size: 13px;
    line-height: 1.65;
    margin: 10px 0;
    overflow-wrap: anywhere;
  }
  .source,
  .note {
    font-size: 12px;
  }
  li .actions {
    margin-top: auto;
    padding-top: 14px;
    margin-bottom: 0;
  }
  a {
    font-size: 12px;
    color: #eed0d5;
    text-decoration: underline;
    text-underline-offset: 4px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  nav.actions {
    justify-content: flex-end;
    padding-top: 16px;
    border-top: 1px solid var(--line);
    font-size: 13px;
    color: var(--muted);
  }
  .error {
    color: #ff9cab;
    padding: 12px 16px;
    background: #2a171f;
    border: 1px solid #713a4a;
    border-radius: 10px;
  }
  @media (max-width: 700px) {
    .catalog {
      padding: 22px 18px;
      border-radius: 0;
    }
    .filters {
      grid-template-columns: minmax(0, 1.5fr) minmax(90px, 1fr);
      gap: 12px;
    }
    ol {
      grid-template-columns: minmax(0, 1fr);
      max-height: min(70vh, 640px);
    }
    li {
      padding: 20px;
    }
    nav.actions {
      justify-content: space-between;
      gap: 8px;
    }
    nav button {
      padding: 10px 12px;
      font-size: 12px;
    }
  }
</style>
