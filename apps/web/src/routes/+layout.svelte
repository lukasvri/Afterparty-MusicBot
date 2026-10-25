<script lang="ts">
  import { onMount } from 'svelte';
  import { initializeErrorReporting } from '../../../../lib/error-reporting.ts';
  let { children } = $props();
  onMount(() => {
    void initializeErrorReporting(import.meta.env.VITE_SENTRY_DSN, 'v3');
  });
</script>

{@render children()}
