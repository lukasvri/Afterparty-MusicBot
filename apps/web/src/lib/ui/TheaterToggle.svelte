<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { browserStorage } from '../../../../../lib/browser-storage.ts';
  import Icon from './Icon.svelte';
  let { active = $bindable(false), controls }: { active?: boolean; controls: string } = $props();
  const key = 'afterparty-theater';
  let button: HTMLButtonElement;
  onMount(() => {
    const read = () => (active = browserStorage.get(key) === 'on');
    read();
    return browserStorage.subscribe(key, read);
  });
  $effect(() => {
    if (!active) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const scroll = { left: window.scrollX, top: window.scrollY };
    root.style.overflow = 'hidden';
    const surface = () =>
      document.getElementById(controls)?.querySelector('.audio-stage, .concert-art');
    const keepFocus = (event: FocusEvent) => {
      if (event.target !== button && !surface()?.contains(event.target as Node))
        button?.focus({ preventScroll: true });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.fullscreenElement) return;
      event.preventDefault();
      browserStorage.set(key, 'off');
    };
    document.addEventListener('focusin', keepFocus);
    document.addEventListener('keydown', escape);
    button?.focus({ preventScroll: true });
    return () => {
      root.style.overflow = previousOverflow;
      document.removeEventListener('focusin', keepFocus);
      document.removeEventListener('keydown', escape);
      window.scrollTo(scroll);
    };
  });
</script>

<button
  class="button secondary"
  class:expanded={active}
  bind:this={button}
  aria-pressed={active}
  aria-controls={controls}
  onclick={async (event) => {
    const button = event.currentTarget;
    const enable = !active;
    browserStorage.set(key, enable ? 'on' : 'off');
    await tick();
    button.focus({ preventScroll: true });
  }}><Icon name="theater" size={16} />{active ? 'Exit theater mode' : 'Theater mode'}</button
>

<style>
  .expanded {
    position: fixed;
    z-index: 102;
    top: max(16px, env(safe-area-inset-top));
    right: max(16px, env(safe-area-inset-right));
    background: #101216ee;
    color: white;
    box-shadow: 0 4px 20px #0008;
  }
</style>
