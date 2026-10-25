<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { browserStorage } from '../../../../../lib/browser-storage.ts';
  import Icon from './Icon.svelte';
  let { active = $bindable(false), controls }: { active?: boolean; controls: string } = $props();
  const key = 'afterparty-theater';
  onMount(() => {
    const read = () => (active = browserStorage.get(key) === 'on');
    read();
    return browserStorage.subscribe(key, read);
  });
</script>

<button
  class="button secondary"
  aria-pressed={active}
  aria-controls={controls}
  onclick={async (event) => {
    const button = event.currentTarget;
    const enable = !active;
    browserStorage.set(key, enable ? 'on' : 'off');
    await tick();
    if (enable) button.scrollIntoView({ block: 'start' });
  }}><Icon name="theater" size={16} />{active ? 'Exit theater mode' : 'Theater mode'}</button
>
