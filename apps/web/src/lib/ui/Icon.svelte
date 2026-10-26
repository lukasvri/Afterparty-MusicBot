<script lang="ts">
  let { name, size = 20 }: { name: string; size?: number } = $props();
  const paths: Record<string, string> = {
    theater: 'M3 6h18v12H3zM7 10l-2 2 2 2M17 10l2 2-2 2M5 12h14',
    play: 'm9 5 11 7-11 7z',
    pause: 'M8 5v14M16 5v14',
    next: 'm5 5 10 7-10 7zM19 5v14',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    add: 'M12 5v14M5 12h14',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    external: 'M14 3h7v7M10 14 21 3M21 14v7H3V3h7',
    music:
      'M9 18V5l12-2v13M9 8l12-2M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3M21 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3',
    users:
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    link: 'm10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
    headphones: 'M3 14v-3a9 9 0 0 1 18 0v3M3 13h4v8H3zM17 13h4v8h-4z',
    settings:
      'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 5l3 2m10 10 3 2M5 20l2-3M17 7l2-3M2 12h4m12 0h4M12 2v4m0 12v4',
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={paths[name] ?? paths.music} /></svg
>
