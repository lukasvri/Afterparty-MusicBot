<script lang="ts">
  import { CONCERT_CATALOG } from '../../../../lib/concert-catalog.ts';
  let { busy, onAdd }: { busy: boolean; onAdd: (ids: readonly string[]) => Promise<void> | void } =
    $props();
  const events = [...new Map(CONCERT_CATALOG.map((entry) => [entry.eventId, entry.eventName]))];
  let eventId = $state(events[0]?.[0] ?? '');
  let selectionYear = $state(0);
  let adding = $state(false);
  let error = $state('');
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
  async function add(ids: readonly string[]) {
    if (busy || adding || !ids.length) return;
    error = '';
    adding = true;
    try {
      await onAdd(ids);
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
            error = '';
          }}
        >
          {#each years as value (value)}<option {value}>{value}</option>{/each}
        </select>
      </div>
    </div>
    <div class="year-summary">
      <p role="status" aria-live="polite" aria-atomic="true">
        {selected.length} festival sets from {year}
      </p>
      <button
        type="button"
        disabled={busy || adding || !selected.length}
        onclick={() => {
          void add(selected.map((entry) => entry.videoId));
        }}>Add selected year to queue</button
      >
    </div>
    <ol aria-labelledby="festival-title">
      {#each selected as entry (entry.id)}<li>
          <h3>{entry.artist}</h3>
          <p class="title">{entry.title}</p>
          <p class="source">Official upload by {entry.uploaderName}</p>
          <div class="actions">
            <button
              type="button"
              disabled={busy || adding}
              aria-label={`Add festival set: ${entry.title}`}
              onclick={() => {
                void add([entry.videoId]);
              }}>Add set to queue</button
            >
            <a
              href={`https://www.youtube.com/watch?v=${entry.videoId}`}
              target="_blank"
              rel="noopener noreferrer">Official video ↗</a
            >
          </div>
        </li>{/each}
    </ol>
  {:else}<p role="status">No festival sets are listed yet.</p>{/if}
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <p class="note">
    Video availability and browser playback depend on the uploader. Adding sets keeps your current
    playback and saved evenings.
  </p>
</section>

<style>
  .catalog {
    border-top: 1px solid var(--line);
    padding-top: 28px;
    margin-top: 32px;
  }
  h2 {
    font-size: 26px;
    letter-spacing: -0.8px;
    margin: 10px 0;
  }
  p {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.8;
    margin: 12px 0;
  }
  .filters {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: 14px;
    max-width: 600px;
    margin: 22px 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 12px;
    min-width: 0;
  }
  select {
    font: inherit;
    color: inherit;
    background: #161619;
    border: 1px solid #3c3a42;
    min-height: 44px;
    padding: 10px 12px;
    border-radius: 6px;
    width: 100%;
  }
  select:focus-visible {
    outline: 2px solid var(--red);
    outline-offset: 4px;
  }
  button {
    background: #1b1b1f;
    color: inherit;
    border: 1px solid #38383e;
    padding: 10px 14px;
    min-height: 44px;
    font-size: 12px;
  }
  .year-summary,
  .actions {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
    margin: 16px 0;
  }
  .year-summary {
    justify-content: space-between;
  }
  ol {
    list-style: none;
    padding: 0 14px 0 0;
    margin: 0;
    max-height: 470px;
    overflow-y: auto;
  }
  li {
    padding: 22px 0;
    border-top: 1px solid #232327;
  }
  h3 {
    font-size: 17px;
    letter-spacing: -0.4px;
  }
  .title {
    color: #dedce2;
    margin: 8px 0;
    overflow-wrap: anywhere;
  }
  .source,
  .note {
    font-size: 11px;
  }
  a {
    font-size: 11px;
    text-decoration: underline;
    text-underline-offset: 4px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }
  .error {
    color: #ff9cab;
  }
  @media (max-width: 500px) {
    .filters {
      grid-template-columns: minmax(0, 1.5fr) minmax(90px, 1fr);
      gap: 10px;
    }
  }
</style>
