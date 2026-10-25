<script lang="ts">
  import { onMount } from 'svelte';
  import { browserStorage } from '../../../../../lib/browser-storage.ts';
  import { motionEnabled, motionKey } from './motion.ts';
  let enabled = $state(true),
    ready = $state(false);
  onMount(() => {
    const read = () => {
      enabled = motionEnabled(browserStorage.get(motionKey));
    };
    read();
    ready = true;
    return browserStorage.subscribe(motionKey, read);
  });
</script>

<button
  type="button"
  class="motion-preference"
  aria-label="Page animations"
  aria-pressed={enabled}
  disabled={!ready}
  title="Saved on this device. Your system’s reduced-motion preference always applies."
  onclick={() => browserStorage.set(motionKey, enabled ? 'off' : 'on')}
>
  Animations {enabled ? 'on' : 'off'}
</button>

<style>
  .motion-preference {
    min-height: 44px;
    padding: 8px 12px;
    border: 1px solid #34343a;
    border-radius: 8px;
    background: #121214;
    color: #c6c4c9;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .motion-preference:focus-visible {
    outline: 2px solid #ff263e;
    outline-offset: 3px;
  }
</style>
