<script lang="ts">
  import Icon from '#lib/ui/Icon.svelte';
  import MotionPreference from '#lib/ui/MotionPreference.svelte';

  import type { Snippet } from 'svelte';

  let {
    title,
    eyebrow = 'AFTERPARTY / INFORMATION',
    children,
  }: {
    title: string;
    eyebrow?: string;
    children: Snippet;
  } = $props();
</script>

<svelte:head>
  <title>{title} · Afterparty</title>
</svelte:head>

<a class="skip" href="#content">Skip to content</a>
<div class="public-shell">
  <header>
    <a class="brand" href="/" aria-label="Afterparty home">
      <img src="/afterparty-mark.svg" width="40" height="40" alt="" />
      <span>afterparty<span class="accent">.</span></span>
    </a>
    <a class="back" href="/">Back to music <Icon name="arrow" size={16} /></a>
  </header>
  <main id="content">
    <p class="eyebrow">{eyebrow}</p>
    <h1>{title}<span class="accent">.</span></h1>
    <div class="body">{@render children()}</div>
  </main>
  <footer>
    <MotionPreference />
    <span>Music brings us here.</span>
    <nav aria-label="Information">
      <a href="/install">Install bot</a>
      <a href="/support">Support</a>
      <a href="/patch-notes">Patch notes</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/copyright">Copyright</a>
    </nav>
  </footer>
</div>

<style>
  .public-shell {
    min-height: 100dvh;
    background: #0c0d10;
    color: var(--text);
    font:
      16px/1.8 Inter,
      system-ui,
      sans-serif;
  }
  header,
  footer {
    max-width: 1600px;
    margin: auto;
    padding: 28px var(--page-space);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    flex-wrap: wrap;
  }
  header {
    border-bottom: 1px solid var(--line);
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    color: inherit;
    text-decoration: none;
    font-size: 24px;
    font-weight: 750;
    letter-spacing: -1px;
  }
  .brand img {
    flex-shrink: 0;
  }
  .accent {
    color: var(--red);
  }
  .back {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 46px;
    padding: 10px 16px;
    border: 1px solid #3a3e49;
    border-radius: 12px;
    background: var(--surface);
    color: #eeeef3;
    text-decoration: none;
    font-size: 14px;
    font-weight: 550;
  }
  main {
    width: min(1000px, calc(100% - var(--page-space) * 2));
    padding: 0;
    margin: clamp(40px, 5vw, 88px) auto clamp(56px, 6vw, 104px);
  }
  .eyebrow {
    color: #ff7182;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1.7px;
  }
  h1 {
    margin: 18px 0 36px;
    font-size: clamp(42px, 5.5vw, 78px);
    line-height: 1.06;
    letter-spacing: -0.055em;
    overflow-wrap: anywhere;
    font-weight: 750;
  }
  .body {
    padding: clamp(24px, 4vw, 52px);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: #bfc0cb;
  }
  .body :global(p) {
    margin: 0 0 18px;
    max-width: 76ch;
    overflow-wrap: anywhere;
  }
  .body :global(h2) {
    margin: 36px 0 14px;
    color: var(--text);
    font-size: clamp(23px, 2vw, 29px);
    letter-spacing: -0.035em;
    line-height: 1.3;
  }
  .body :global(h2:first-child) {
    margin-top: 0;
  }
  .body :global(h3) {
    color: var(--text);
    font-size: 19px;
    line-height: 1.4;
    margin: 28px 0 12px;
  }
  .body :global(strong) {
    color: #ededf2;
    font-weight: 650;
  }
  .body :global(a),
  footer a {
    color: #f0c5cc;
    text-decoration: underline;
    text-decoration-color: #77545d;
    text-underline-offset: 4px;
  }
  .body :global(a:hover),
  footer a:hover,
  .back:hover {
    color: #ff8493;
  }
  .back:hover {
    border-color: #73525c;
    background: #24191f;
  }
  .body :global(code) {
    color: #f4f3ef;
    padding: 3px 7px;
    border: 1px solid #363a45;
    border-radius: 6px;
    background: #1e222a;
    font-size: 0.9em;
    overflow-wrap: anywhere;
  }
  .body :global(ul),
  .body :global(ol) {
    padding-left: 22px;
    margin: 16px 0 24px;
  }
  .body :global(li) {
    padding-left: 4px;
    margin: 10px 0;
    max-width: 76ch;
  }
  .body :global(.service-action) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 50px;
    padding: 12px 22px;
    background: var(--red);
    border-radius: 12px;
    text-decoration: none;
    color: #100b0e;
    font-weight: 700;
  }
  .body :global(.service-date) {
    font-size: 13px;
    color: var(--muted);
  }
  footer {
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 13px;
    flex-wrap: wrap;
  }
  footer nav {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 20px;
  }
  footer a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    text-decoration: none;
  }
  .skip {
    position: fixed;
    left: 20px;
    top: -100px;
    z-index: 5;
    padding: 12px 20px;
    border-radius: 12px;
    background: var(--red);
    color: #100b0e;
    font:
      14px system-ui,
      sans-serif;
  }
  .skip:focus {
    top: 12px;
  }
  .public-shell :global(:focus-visible) {
    outline: 2px solid #ff7182;
    outline-offset: 5px;
  }
  @media (max-width: 600px) {
    header,
    footer {
      padding: 20px;
    }
    .brand {
      font-size: 20px;
      gap: 8px;
    }
    .brand img {
      width: 34px;
      height: 34px;
    }
    .back {
      padding: 10px 12px;
      font-size: 12px;
      gap: 8px;
    }
    .body {
      padding: 24px 20px;
      border-radius: 18px;
      font-size: 15px;
    }
    footer {
      align-items: flex-start;
      flex-direction: column;
      gap: 12px;
    }
  }
</style>
