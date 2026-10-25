<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { initializeErrorReporting } from '../../../../lib/error-reporting.ts';
  import { browserStorage } from '../../../../lib/browser-storage.ts';
  import { motionEnabled, motionKey } from '#lib/ui/motion.ts';
  let { children }: { children: Snippet } = $props();
  onMount(() => {
    void initializeErrorReporting(import.meta.env.VITE_SENTRY_DSN, 'v3');
    const apply = () => {
      document.documentElement.dataset.motion = motionEnabled(browserStorage.get(motionKey))
        ? 'on'
        : 'off';
    };
    apply();
    return browserStorage.subscribe(motionKey, apply);
  });
</script>

{@render children()}

<style>
  :global(html[data-motion='off'] *),
  :global(html[data-motion='off'] *::before),
  :global(html[data-motion='off'] *::after) {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
  @media (prefers-reduced-motion: reduce) {
    :global(*),
    :global(*::before),
    :global(*::after) {
      animation: none !important;
      transition: none !important;
      scroll-behavior: auto !important;
    }
  }
</style>
