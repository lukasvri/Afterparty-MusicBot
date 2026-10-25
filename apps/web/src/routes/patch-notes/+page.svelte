<script lang="ts">
  import PublicPage from '#lib/ui/PublicPage.svelte';
  import releases from '../../../../../lib/releases.json';
  import { legacyUpdates } from '../../../../../lib/legacy-updates.ts';

  const updates = [...releases, ...legacyUpdates];
</script>

<PublicPage title="Patch notes" eyebrow="AFTERPARTY / CHANGELOG">
  <p>
    New features, fixes and the little things that make your next evening better.
    <a href="https://github.com/lukasvri/Afterparty-MusicBot/releases">Release archive ↗</a>
  </p>
  <div class="timeline">
    {#each updates as update, index (update.version)}
      <article id={`v${update.version}`}>
        <div class="stamp">
          <span>v{update.version}</span>
          <time
            datetime={update.version.includes('.')
              ? update.date
              : update.date.startsWith('14')
                ? '2026-10-14'
                : '2026-10-13'}>{update.date}</time
          >
          {#if index === 0}<small>LATEST RECORDED BUILD</small>{/if}
        </div>
        <div>
          <h2>{update.title}</h2>
          <ul>
            {#each update.items as item}<li>{item}</li>{/each}
          </ul>
        </div>
      </article>
    {/each}
  </div>
</PublicPage>

<style>
  .timeline {
    margin-top: 44px;
  }
  article {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    gap: 24px;
    border-top: 1px solid #29292e;
    padding: 28px 0;
  }
  .stamp {
    display: flex;
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
  .stamp > span {
    color: #ff6072;
    font-weight: 700;
    font-size: 14px;
  }
  time {
    font-size: 12px;
    color: #94949f;
  }
  small {
    color: #94949f;
    font-size: 9px;
    letter-spacing: 1px;
  }
  h2 {
    margin: 0 0 16px !important;
  }
  ul {
    padding-left: 18px;
    margin: 0;
  }
  li {
    padding-left: 4px;
  }
  li::marker {
    color: #ff263e;
  }
  @media (max-width: 600px) {
    article {
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
    }
    .stamp {
      flex-direction: row;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px 14px;
    }
  }
</style>
