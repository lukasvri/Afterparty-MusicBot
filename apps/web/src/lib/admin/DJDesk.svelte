<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { AdminDetail } from './admin-client.ts';
  import {
    canDJSeek,
    djCuePosition,
    djSettingsPatch,
    djTrackIdentity,
    readDJSettings,
    type DJSettings,
  } from './dj-controls.ts';
  import { numericSettingBounds } from '../../../../../services/core/src/settings.ts';
  import { time } from '../../../../../lib/types.ts';

  let {
    detail,
    busy,
    onCommand,
    onSettings,
  }: {
    detail: AdminDetail;
    busy: boolean;
    onCommand: (action: string, extra?: Record<string, unknown>) => Promise<unknown>;
    onSettings: (settings: Record<string, number | boolean>) => Promise<unknown>;
  } = $props();
  let guild = $state('');
  let baseline = $state<DJSettings>({ crossfade: 0, radio: false });
  let draft = $state<DJSettings>({ crossfade: 0, radio: false });
  let dirty = $state(false);
  let pending = $state(false);
  let error = $state('');
  let cue = $state<{ identity: string; position: number } | null>(null);
  let disposed = false;
  let operation = 0;
  const liveSettings = $derived(readDJSettings(detail.settings));
  const settingsChanged = $derived(
    dirty &&
      (liveSettings.crossfade !== baseline.crossfade || liveSettings.radio !== baseline.radio),
  );
  const available = $derived(detail.state.online && detail.state.ready);
  const online = $derived(available && detail.state.connected);
  const disabled = $derived(busy || pending || !available || guild !== detail.guildId);
  const playbackDisabled = $derived(disabled || !online);
  const seekable = $derived(canDJSeek(detail));
  const trackKey = $derived(djTrackIdentity(detail));
  const cuePoints = $derived(
    seekable && detail.state.current
      ? [0, 0.25, 0.5, 0.75].map((fraction) => ({
          label: fraction === 0 ? 'Start' : `${fraction * 100}%`,
          seconds: djCuePosition(
            detail.state.current!.duration * fraction,
            detail.state.current!.duration,
          )!,
        }))
      : [],
  );
  $effect(() => {
    const next = readDJSettings(detail.settings);
    if (guild !== detail.guildId) {
      operation++;
      guild = detail.guildId;
      baseline = next;
      draft = { ...next };
      dirty = false;
      pending = false;
      error = '';
      cue = null;
    } else if (!dirty) {
      baseline = next;
      draft = { ...next };
    }
  });
  $effect(() => {
    if (cue && cue.identity !== trackKey) cue = null;
  });
  onDestroy(() => {
    disposed = true;
    operation++;
  });

  const current = (id: number, server: string) =>
    !disposed && operation === id && detail.guildId === server;

  function useCurrentSettings() {
    baseline = readDJSettings(detail.settings);
    draft = { ...baseline };
    dirty = false;
    error = '';
  }
  async function applySettings() {
    if (disabled || !dirty || settingsChanged) return;
    const currentGuild = detail.guildId;
    let patch: Record<string, number | boolean>;
    try {
      patch = djSettingsPatch(baseline, draft);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Check your DJ settings.';
      return;
    }
    if (!Object.keys(patch).length) {
      dirty = false;
      return;
    }
    pending = true;
    const id = ++operation;
    error = '';
    try {
      const result = await onSettings(patch);
      if (!current(id, currentGuild)) return;
      if (result === null || result === undefined || result === false)
        throw Error('The server did not confirm these settings. Your changes are kept here.');
      dirty = false;
    } catch (caught) {
      if (current(id, currentGuild))
        error = caught instanceof Error ? caught.message : 'DJ settings could not be saved.';
    } finally {
      if (current(id, currentGuild)) pending = false;
    }
  }
  async function command(action: string, extra: Record<string, unknown>, recording = false) {
    if (playbackDisabled || (recording && !seekable)) return;
    const currentGuild = detail.guildId;
    pending = true;
    const id = ++operation;
    error = '';
    try {
      const result = await onCommand(action, extra);
      if (
        current(id, currentGuild) &&
        (result === null || result === undefined || result === false)
      )
        error = 'The action was not confirmed. Check the current track before trying again.';
    } catch (caught) {
      if (current(id, currentGuild))
        error = caught instanceof Error ? caught.message : 'The DJ action could not be completed.';
    } finally {
      if (current(id, currentGuild)) pending = false;
    }
  }
  function seek(seconds: number) {
    if (playbackDisabled || !seekable || !detail.state.current) return;
    const position = djCuePosition(seconds, detail.state.current.duration);
    if (position !== null) void command('seek', { seconds: position }, true);
  }
  function markCue() {
    if (playbackDisabled || !seekable || !detail.state.current) return;
    const position = djCuePosition(detail.state.position, detail.state.current.duration);
    if (position !== null) cue = { identity: trackKey, position };
  }
</script>

<section class="dj-desk" aria-labelledby="dj-title">
  <header>
    <div>
      <p class="eyebrow">SHAPE THE NEXT TRANSITION</p>
      <h2 id="dj-title">DJ desk</h2>
    </div>
    <span class="live-status" class:connected={online}
      >{online
        ? 'Live in Discord'
        : available
          ? 'Ready for a voice channel'
          : 'Core is offline'}</span
    >
  </header>
  <div class="dj-grid">
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void applySettings();
      }}
    >
      <h3>Transition</h3>
      <label for="dj-crossfade">Crossfade <output>{draft.crossfade}s</output></label>
      <input
        id="dj-crossfade"
        aria-label="Crossfade"
        type="range"
        min={numericSettingBounds.crossfade.min}
        max={numericSettingBounds.crossfade.max}
        step="1"
        bind:value={draft.crossfade}
        {disabled}
        oninput={() => {
          dirty = true;
        }}
      />
      <p>Fade the outgoing track into the next. Set 0 for a direct transition.</p>
      <label class="radio"
        ><input
          type="checkbox"
          bind:checked={draft.radio}
          {disabled}
          onchange={() => {
            dirty = true;
          }}
        />Fill an empty queue with related music</label
      >
      {#if settingsChanged}<p class="conflict" role="status">
          DJ settings changed on this server. Your edits are kept until you reload the current
          values.
        </p>{/if}
      <div class="actions">
        <button type="submit" class="apply" disabled={disabled || !dirty || settingsChanged}>
          {pending ? 'Applying…' : 'Apply DJ settings'}</button
        >
        <button type="button" disabled={disabled || !dirty} onclick={useCurrentSettings}
          >Reload current settings</button
        >
      </div>
    </form>
    <div class="performance-tools">
      <h3>Repeat & cue</h3>
      <div class="loops" role="group" aria-label="DJ loop controls">
        <button
          type="button"
          aria-pressed={detail.player.loopCurrentSong}
          disabled={playbackDisabled || !detail.state.current}
          onclick={() => void command('loop', { value: !detail.player.loopCurrentSong })}
        >
          Repeat track <span>{detail.player.loopCurrentSong ? 'On' : 'Off'}</span></button
        >
        <button
          type="button"
          aria-pressed={detail.player.loopCurrentQueue}
          disabled={playbackDisabled || !detail.state.current}
          onclick={() => void command('loop-queue', { value: !detail.player.loopCurrentQueue })}
        >
          Repeat queue <span>{detail.player.loopCurrentQueue ? 'On' : 'Off'}</span></button
        >
      </div>
      <div class="actions">
        <button
          type="button"
          disabled={playbackDisabled || !detail.state.current}
          onclick={() => void command('unskip', {})}>Previous song</button
        >
      </div>
      <p>Track repeat takes priority over queue repeat. Radio waits while repeat is on.</p>
      <div class="cue-points" role="group" aria-label="Track cue points">
        {#each cuePoints as point}<button
            type="button"
            disabled={playbackDisabled}
            onclick={() => seek(point.seconds)}
            title={`Seek to ${time(point.seconds)}`}
            >{point.label}<small>{time(point.seconds)}</small></button
          >{/each}
      </div>
      <div class="actions">
        <button
          type="button"
          disabled={playbackDisabled || !seekable || detail.state.position <= 0}
          onclick={() => void command('seek-relative', { seconds: -15 }, true)}>−15s</button
        >
        <button
          type="button"
          disabled={playbackDisabled ||
            !seekable ||
            !detail.state.current ||
            detail.state.position + 15 >= detail.state.current.duration}
          onclick={() => void command('seek-relative', { seconds: 15 }, true)}>+15s</button
        >
        <button type="button" disabled={playbackDisabled || !seekable} onclick={markCue}
          >Mark cue here</button
        >
        <button
          type="button"
          disabled={playbackDisabled || !seekable || !cue || cue.identity !== trackKey}
          onclick={() => {
            if (cue?.identity === trackKey) seek(cue.position);
          }}
          >Return to cue{cue && cue.identity === trackKey ? ` · ${time(cue.position)}` : ''}</button
        >
      </div>
      <p>
        Cue points follow this recording only. Marked cues stay in this view and clear when the
        server or recording changes.
      </p>
      {#if !seekable}<p class="availability">
          Cue tools need a track with a known length. Live streams cannot seek.
        </p>{/if}
    </div>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <p class="scope-note">
    Changes affect this server's Discord playback. Cue jumps keep the existing play or pause state.
  </p>
</section>

<style>
  .dj-desk {
    border: 1px solid #333740;
    border-radius: 16px;
    padding: clamp(18px, 2.2vw, 32px);
    background: #14171c;
    color: #f2f2f4;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 16px;
    align-items: center;
    margin-bottom: 24px;
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  h2 {
    font-size: clamp(24px, 2vw, 34px);
    letter-spacing: -0.04em;
    margin-top: 6px;
  }
  h3 {
    font-size: 16px;
    margin-bottom: 18px;
  }
  .eyebrow {
    color: #ff6575;
    font-size: 10px;
    letter-spacing: 0.12em;
    font-weight: 700;
  }
  .live-status {
    font-size: 11px;
    color: #b8bdc8;
    border: 1px solid #414650;
    border-radius: 30px;
    padding: 7px 11px;
  }
  .live-status.connected {
    color: #add4c0;
    border-color: #3e6253;
  }
  .dj-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
    gap: clamp(24px, 3vw, 48px);
  }
  form,
  .performance-tools {
    min-width: 0;
  }
  label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
  }
  output {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  input[type='range'] {
    width: 100%;
    min-height: 36px;
    accent-color: #ff4058;
  }
  p {
    font-size: 12px;
    line-height: 1.65;
    color: #a9afbd;
  }
  .radio {
    justify-content: flex-start;
    margin: 18px 0;
    line-height: 1.5;
  }
  .radio input {
    width: 18px;
    height: 18px;
    accent-color: #ff4058;
    flex: 0 0 auto;
  }
  .actions,
  .loops,
  .cue-points {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .actions {
    margin-top: 14px;
  }
  button {
    border: 1px solid #3a404b;
    border-radius: 8px;
    background: #20252d;
    color: #f2f2f4;
    font: inherit;
    font-size: 12px;
    padding: 10px 13px;
    min-height: 44px;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: #2b323d;
    border-color: #6b7689;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid #ff6575;
    outline-offset: 3px;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button[aria-pressed='true'] {
    background: #41212a;
    border-color: #bd4c61;
  }
  button span {
    margin-left: 12px;
    color: #ff8c9b;
  }
  .apply {
    background: #d82b44;
    border-color: #d82b44;
    font-weight: 650;
  }
  .cue-points {
    margin-top: 16px;
  }
  .cue-points button {
    flex: 1 1 64px;
    text-align: left;
  }
  .cue-points small {
    display: block;
    color: #a9afbd;
    margin-top: 4px;
    font-variant-numeric: tabular-nums;
  }
  .performance-tools > p {
    margin-top: 14px;
  }
  .error,
  .conflict {
    color: #ff9aaa;
    margin-top: 12px;
  }
  .scope-note {
    border-top: 1px solid #30353e;
    margin-top: 24px;
    padding-top: 14px;
  }
  .availability {
    color: #d6bd91;
  }
  @media (max-width: 720px) {
    .dj-grid {
      grid-template-columns: 1fr;
    }
    .performance-tools {
      border-top: 1px solid #30353e;
      padding-top: 22px;
    }
    .actions button {
      flex: 1 1 auto;
    }
  }
</style>
