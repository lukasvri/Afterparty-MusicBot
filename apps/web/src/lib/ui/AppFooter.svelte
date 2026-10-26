<script lang="ts">
  import MotionPreference from './MotionPreference.svelte';
  let { hidden = false }: { hidden?: boolean } = $props();
</script>

<footer class="site-footer" {hidden}>
  <div class="site-footer-inner">
    <a class="footer-brand" href="/">afterparty<span class="red">.</span></a>
    <nav aria-label="Help and information">
      <a href="/support">Support</a><a href="/patch-notes">Patch notes</a><a href="/privacy"
        >Privacy</a
      >
    </nav>
    <MotionPreference />
  </div>
</footer>

<style>
  .site-footer {
    width: 100%;
    border-top: 1px solid var(--line);
    color: var(--muted);
  }
  .site-footer[hidden] {
    display: none;
  }
  .site-footer-inner {
    max-width: var(--app-width);
    margin-inline: auto;
    padding: 24px var(--app-space);
    padding-bottom: max(24px, env(safe-area-inset-bottom));
    padding-left: max(var(--app-space), env(safe-area-inset-left));
    padding-right: max(var(--app-space), env(safe-area-inset-right));
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
  }
  .footer-brand {
    font-size: 20px;
    font-weight: 750;
    letter-spacing: -0.8px;
    color: var(--text);
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 20px;
  }
  nav a {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    font-size: 13px;
  }
  nav a:hover {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  @media (max-width: 600px) {
    .site-footer-inner {
      flex-wrap: wrap;
      gap: 12px 20px;
    }
    nav {
      order: 3;
      width: 100%;
    }
  }
</style>
