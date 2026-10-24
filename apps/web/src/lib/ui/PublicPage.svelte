<script lang="ts">
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
    <a class="brand" href="/v3" aria-label="Afterparty home">
      <img src="/afterparty-mark.svg" width="40" height="40" alt="" />
      <span>afterparty<span class="accent">.</span></span>
    </a>
    <a class="back" href="/v3">Back to music <span aria-hidden="true">↗</span></a>
  </header>
  <main id="content">
    <p class="eyebrow">{eyebrow}</p>
    <h1>{title}<span class="accent">.</span></h1>
    <div class="body">{@render children()}</div>
  </main>
  <footer>
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
  @font-face {
    font-family: 'Inter';
    src: url('/fonts/inter-latin-wght-normal.woff2') format('woff2');
    font-weight: 100 900;
    font-display: swap;
  }
  :global(html) {
    color-scheme: dark;
    background: #0b0b0d;
  }
  :global(body) {
    margin: 0;
  }
  .public-shell {
    min-height: 100dvh;
    background: #0b0b0d;
    color: #f2f2f4;
    font:
      15px/1.75 Inter,
      system-ui,
      sans-serif;
  }
  header,
  footer {
    max-width: 1200px;
    margin: auto;
    padding: 28px 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }
  header {
    border-bottom: 1px solid #252529;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    color: inherit;
    text-decoration: none;
    font-size: 22px;
    font-weight: 750;
    letter-spacing: -0.8px;
  }
  .accent {
    color: #ff263e;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    color: #dddde2;
    text-decoration: none;
    font-size: 13px;
  }
  main {
    width: min(800px, calc(100% - 80px));
    margin: 68px auto 96px;
  }
  .eyebrow {
    color: #ff6072;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 2px;
  }
  h1 {
    margin: 16px 0 40px;
    font-size: clamp(34px, 5.5vw, 62px);
    line-height: 1.08;
    letter-spacing: -2px;
    overflow-wrap: anywhere;
  }
  .body {
    color: #b5b5bf;
  }
  .body :global(h2) {
    margin: 40px 0 12px;
    color: #f2f2f4;
    font-size: 21px;
    letter-spacing: -0.4px;
    line-height: 1.4;
  }
  .body :global(h3) {
    color: #f2f2f4;
  }
  .body :global(strong) {
    color: #dddde4;
    font-weight: 650;
  }
  .body :global(a),
  footer a {
    color: #e2e2e8;
    text-underline-offset: 4px;
  }
  .body :global(a:hover),
  footer a:hover,
  .back:hover {
    color: #ff6072;
  }
  .body :global(code) {
    color: #f0f0f4;
    padding: 3px 6px;
    border-radius: 4px;
    background: #202025;
  }
  .body :global(li) {
    margin: 10px 0;
  }
  .body :global(.service-action) {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    padding: 0 22px;
    background: #ff263e;
    border-radius: 8px;
    text-decoration: none;
    color: white;
    font-weight: 650;
  }
  .body :global(.service-date) {
    font-size: 13px;
    color: #85858f;
  }
  footer {
    border-top: 1px solid #252529;
    color: #85858f;
    font-size: 12px;
  }
  footer nav {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
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
    background: #ff263e;
    color: white;
    font:
      14px system-ui,
      sans-serif;
  }
  .skip:focus {
    top: 12px;
  }
  .public-shell :global(:focus-visible) {
    outline: 2px solid #ff6072;
    outline-offset: 5px;
  }
  @media (max-width: 600px) {
    header,
    footer {
      padding: 20px;
    }
    .brand {
      font-size: 18px;
      gap: 8px;
    }
    main {
      width: calc(100% - 40px);
      margin-top: 44px;
      margin-bottom: 56px;
    }
    h1 {
      letter-spacing: -1.2px;
    }
    footer {
      align-items: flex-start;
      flex-direction: column;
      gap: 8px;
    }
  }
</style>
