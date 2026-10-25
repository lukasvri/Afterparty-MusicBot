<script lang="ts">
  import Icon from './Icon.svelte';
  let { image }: { image: string } = $props();
  let failed = $state('');
  const source = $derived.by(() => {
    if (!image) return '';
    if (image.startsWith('/') && !image.startsWith('//') && !image.includes('\\')) return image;
    try {
      const url = new URL(image);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
        ? url.href
        : '';
    } catch {
      return '';
    }
  });
</script>

<span
  class="track-thumbnail"
  data-state={source && failed !== source ? 'image' : 'missing'}
  aria-hidden="true"
>
  {#if source && failed !== source}
    <img
      src={source}
      alt=""
      width="96"
      height="54"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      onerror={() => (failed = source)}
    />
  {:else}
    <Icon name="music" size={20} />
  {/if}
</span>

<style>
  .track-thumbnail {
    flex: 0 0 auto;
    width: clamp(64px, 4.5vw, 96px);
    aspect-ratio: 16 / 9;
    display: grid;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--surface-raised);
    color: var(--muted);
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
