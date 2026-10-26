<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    title,
    description,
    eyebrow,
    actions,
    id,
    compact = false,
  }: {
    title: string;
    description?: string;
    eyebrow?: string;
    actions?: Snippet;
    id?: string;
    compact?: boolean;
  } = $props();
</script>

<header class="page-toolbar" class:compact>
  <div class="page-heading">
    {#if eyebrow}<p class="page-eyebrow">{eyebrow}</p>{/if}
    <h1 {id}>{title}</h1>
    {#if description && !compact}<p class="page-description">{description}</p>{/if}
  </div>
  {#if actions}<div class="page-actions" aria-label="Page actions">{@render actions()}</div>{/if}
</header>

<style>
  .page-toolbar {
    width: 100%;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 28px;
  }
  .page-heading {
    min-width: 0;
  }
  h1 {
    margin: 0;
    color: var(--text);
    font-size: var(--page-title);
    line-height: 1.15;
    letter-spacing: -0.045em;
    font-weight: 750;
    overflow-wrap: anywhere;
  }
  .page-eyebrow {
    margin: 0 0 8px;
    color: var(--red);
    font-size: 11px;
    letter-spacing: 1.5px;
    font-weight: 700;
  }
  .page-description {
    margin: 10px 0 0;
    max-width: 65ch;
    color: var(--muted);
    font-size: clamp(14px, 0.65vw, 18px);
    line-height: 1.65;
  }
  .page-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    flex-shrink: 0;
    max-width: 60%;
  }
  .page-actions :global(.button) {
    min-height: var(--control-height);
    border-radius: var(--control-radius);
    font-size: var(--control-font);
    line-height: 1.4;
  }
  .compact {
    margin-bottom: 0;
  }
  .compact h1 {
    font-size: var(--tv-title);
  }
  .compact .page-eyebrow {
    display: none;
  }
  @media (max-width: 900px) {
    .page-toolbar {
      flex-direction: column;
      align-items: stretch;
      gap: 18px;
    }
    .page-actions {
      justify-content: flex-start;
      max-width: none;
    }
  }
</style>
