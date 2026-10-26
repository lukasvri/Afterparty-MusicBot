<script lang="ts">
  import { onMount } from 'svelte';
  import { browserStorage } from '../../../../../lib/browser-storage.ts';
  import { motionEnabled, motionKey } from './motion.ts';
  let enabled = $state(true),
    ready = $state(false),
    reduced = $state(false);
  onMount(() => {
    const read = () => {
      enabled = motionEnabled(browserStorage.get(motionKey));
    };
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const readSystem = () => (reduced = media.matches);
    read();
    readSystem();
    media.addEventListener('change', readSystem);
    ready = true;
    const unsubscribe = browserStorage.subscribe(motionKey, read);
    return () => {
      unsubscribe();
      media.removeEventListener('change', readSystem);
    };
  });
</script>

<button
  type="button"
  class="motion-preference"
  aria-label="Page animations"
  aria-pressed={enabled}
  disabled={!ready}
  title={reduced
    ? 'Your system requests reduced motion. Animations stay still; the saved preference applies when reduced motion is off.'
    : 'Saved on this device. Your system’s reduced-motion preference always applies.'}
  onclick={() => browserStorage.set(motionKey, enabled ? 'off' : 'on')}
>
  {enabled && reduced ? 'Reduced motion' : `Animations ${enabled ? 'on' : 'off'}`}
</button>

<style>
  .motion-preference {
    min-height: 44px;
    padding: 8px 12px;
    border: 1px solid #3a3e49;
    border-radius: 10px;
    background: var(--surface);
    color: #c8c9d3;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .motion-preference:focus-visible {
    outline: 2px solid #ff263e;
    outline-offset: 3px;
  }
</style>
