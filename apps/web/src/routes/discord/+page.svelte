<script lang="ts">
  import AppHeader from '#lib/ui/AppHeader.svelte';
  import AppFooter from '#lib/ui/AppFooter.svelte';
  import PageToolbar from '#lib/ui/PageToolbar.svelte';
  import TheaterToggle from '#lib/ui/TheaterToggle.svelte';
  import TrackThumbnail from '#lib/ui/TrackThumbnail.svelte';
  import { roomQueueCapacity } from '../../../../../services/core/src/protocol.ts';
  import { onMount } from 'svelte';
  import { createDiscordClient, type ConcertView } from '#lib/concert/discord-client.ts';
  import { request } from '../../../../../lib/browser-api.ts';
  import { time } from '../../../../../lib/types.ts';
  import Icon from '#lib/ui/Icon.svelte';
  import RoomAudio from '#lib/rooms/RoomAudio.svelte';
  import RoomSocial from '#lib/social/RoomSocial.svelte';
  import RoomSharing from '#lib/rooms/RoomSharing.svelte';
  import MusicWorkspace from '#lib/ui/MusicWorkspace.svelte';

  let client: ReturnType<typeof createDiscordClient> | undefined;
  let view = $state<ConcertView>({
    guildId: undefined,
    state: null,
    queue: null,
    connected: false,
    loading: true,
    busy: false,
    error: '',
    notice: '',
    audioRoom: null,
    audioLive: false,
    audioPhase: 'Connecting shared clock…',
    adding: false,
    searching: false,
    query: '',
    results: [],
    history: [],
  });
  let panel = $state<'queue' | 'discover' | 'library'>('queue');
  let query = $state(''),
    resultPage = $state(0);
  const shownResults = $derived(view.results.slice(resultPage * 10, (resultPage + 1) * 10));
  const resultPages = $derived(Math.max(1, Math.ceil(view.results.length / 10)));
  let invitationExpanded = $state(false);
  let theater = $state(false);
  let tick = $state(0);
  let tv = $state(false);
  let playerFailed = $state(false);
  function toggleTV() {
    tv = !tv;
    const url = new URL(location.href);
    if (tv) url.searchParams.set('tv', '1');
    else url.searchParams.delete('tv');
    history.replaceState(history.state, '', url);
  }
  const target = $derived.by(() => {
    void tick;
    void view.audioRoom;
    void view.connected;
    return client?.playback() ?? { position: 0, playing: false, stale: true };
  });
  let guildId = $state('');
  let guilds = $state<Array<{ id: string; name: string; installed: boolean }>>([]);
  const concert = $derived(view.state);
  const queue = $derived(view.queue?.state.queue ?? concert?.queue ?? []);
  const canManage = $derived(view.queue?.canManage === true);
  const browserPlayerAvailable = $derived(
    Boolean(
      view.audioRoom?.current &&
      view.audioLive &&
      view.audioRoom.current.embeddable !== false &&
      view.audioRoom.current.source !== 'soundcloud',
    ),
  );
  const controlsDisabled = $derived(
    view.busy ||
      !view.connected ||
      !view.guildId ||
      !concert?.online ||
      !concert?.ready ||
      !concert?.connected ||
      !concert?.current ||
      !concert?.playbackKey,
  );
  onMount(() => {
    tv = new URL(location.href).searchParams.get('tv') === '1';
    client = createDiscordClient();
    const unsubscribe = client.subscribe((value) => {
      if (value.guildId !== view.guildId) invitationExpanded = false;
      if (value.loading || value.guildId !== view.guildId) {
        playerFailed = false;
        panel = 'queue';
        query = '';
        resultPage = 0;
      }
      view = value;
    });
    const controller = new AbortController();
    guildId = new URL(location.href).searchParams.get('guildId') ?? '';
    void client.connect(guildId || undefined);
    const ticker = setInterval(() => {
      tick++;
    }, 250);
    void request<{ guilds: typeof guilds }>('/api/admin/guilds', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) guilds = result.guilds.filter((guild) => guild.installed);
      })
      .catch(() => {
        /* Public concerts do not require a Discord session. */
      });
    return () => {
      clearInterval(ticker);
      controller.abort();
      unsubscribe();
      client?.destroy();
    };
  });
  async function selectServer() {
    if (await client?.connect(guildId || undefined)) {
      const url = new URL(location.href);
      if (view.guildId) url.searchParams.set('guildId', view.guildId);
      else url.searchParams.delete('guildId');
      history.replaceState(history.state, '', url);
    }
  }
  async function addTracks(ids: readonly string[], rethrow = false) {
    try {
      await client?.append(ids);
    } catch (error) {
      if (rethrow) throw error;
    }
  }
</script>

<svelte:head>
  <title>Discord concerts · Afterparty</title>
  <meta
    name="description"
    content="Follow the public concert queue on your Discord server with Afterparty."
  />
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<a class="skip-link" href="#concert">Skip to concert</a>
<div
  class="concert-shell app-page"
  class:tv-mode={tv && Boolean(concert?.current)}
  class:theater-mode={theater && !tv && Boolean(concert?.current)}
>
  <AppHeader active="concerts" guildId={view.guildId} hidden={tv && Boolean(concert?.current)} />
  <main class="app-main" id="concert">
    {#snippet concertPageActions()}
      {#if concert?.current && !tv}<TheaterToggle
          bind:active={theater}
          controls="concert-player"
        />{/if}
      {#if view.guildId}<button class="button secondary" aria-pressed={tv} onclick={toggleTV}
          >{tv ? 'Exit TV mode' : 'TV mode'}</button
        >{/if}
      {#if concert?.current}<button
          class="button primary"
          aria-expanded={invitationExpanded || tv}
          onclick={() => (invitationExpanded = !invitationExpanded)}>Invite friends</button
        >{/if}
    {/snippet}
    <PageToolbar
      title="Concerts"
      description="One shared queue. Listen in Discord or enable synchronized video here."
      actions={concertPageActions}
      compact={tv && Boolean(concert?.current)}
    />
    <section class="server-picker context-bar" aria-labelledby="server-heading">
      <h2 id="server-heading">Your stage</h2>
      <form
        onsubmit={(event) => {
          event.preventDefault();
          void selectServer();
        }}
      >
        {#if guilds.length}
          <label for="concert-server">Discord server</label>
          <select id="concert-server" bind:value={guildId}>
            <option value="">Default concert</option>
            {#each guilds as guild (guild.id)}<option value={guild.id}>{guild.name}</option>{/each}
          </select>
        {:else}
          <label for="concert-server">Discord server ID <span>(optional)</span></label>
          <input
            id="concert-server"
            bind:value={guildId}
            inputmode="numeric"
            pattern={'[0-9]{14,22}'}
            placeholder="Default concert"
            maxlength="22"
          />
        {/if}
        <button class="button secondary" disabled={view.loading}
          >Open concert <Icon name="arrow" size={16} /></button
        >
      </form>
      <p>
        <a href="/api/auth/discord" data-sveltekit-reload>Sign in with Discord</a> to choose servers
        you manage. <a href="/api/bot/install" data-sveltekit-reload>Invite Afterparty</a>
      </p>
    </section>

    {#if view.loading}<p class="empty-stage" role="status">Connecting to the stage…</p>
    {:else}
      <section class="concert-content" aria-label="Concert state">
        <div class="current-track" id="concert-player">
          <div class="section-heading">
            <h2>{concert?.guildName ?? 'Discord concert'}</h2>
            <span class="eyebrow"
              >{view.connected && concert?.online ? 'CORE ONLINE' : 'OFFLINE'}</span
            >
          </div>
          {#if concert?.current}
            {#if browserPlayerAvailable && view.audioRoom}
              {#key view.guildId}<RoomAudio
                  room={view.audioRoom}
                  position={target.position}
                  playing={target.playing}
                  canControl={!controlsDisabled}
                  canSeek={!controlsDisabled && canManage}
                  controlBusy={view.busy}
                  onPlaybackError={(failed) => (playerFailed = failed)}
                  onIntent={async (intent) => {
                    if (
                      !client ||
                      view.audioRoom?.code !== intent.code ||
                      concert?.current?.id !== intent.videoId ||
                      concert.playbackKey !== intent.playbackKey ||
                      controlsDisabled
                    )
                      return false;
                    return intent.action === 'seek'
                      ? canManage
                        ? client.seek(intent.position!)
                        : false
                      : client.control(intent.action === 'play' ? 'resume' : 'pause');
                  }}
                />{/key}
            {:else}
              <div class="concert-art">
                <img
                  src={concert.current.image}
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                /><span class="eyebrow">{concert.playing ? 'ON AIR' : 'PAUSED'}</span>
              </div>
            {/if}
            <p class="clock-phase" role="status">
              {view.audioPhase}{!view.audioLive
                ? ' Browser audio requires a fresh Core stream.'
                : ''}
            </p>
            <div class="track-meta">
              <p class="eyebrow red">NOW PLAYING</p>
              <h2>{concert.current.title}</h2>
              <p>{concert.current.artist}</p>
            </div>
            <div class="concert-controls">
              <button
                class="button secondary"
                disabled={controlsDisabled}
                onclick={() => {
                  void client?.control('skip');
                }}><Icon name="next" />Next track</button
              ><span class="duration"
                >{concert.current.live
                  ? 'LIVE'
                  : `${time(view.audioLive ? target.position : concert.position)} / ${time(concert.current.duration)}`}</span
              >
            </div>
            {#if !browserPlayerAvailable || playerFailed}
              <details class="concert-recovery">
                <summary>Discord playback controls</summary>
                <p>
                  Browser playback is unavailable. These controls manage the shared Discord concert.
                </p>
                <button
                  class="button secondary"
                  disabled={controlsDisabled}
                  onclick={() => void client?.control(concert?.playing ? 'pause' : 'resume')}
                  >{concert.playing ? 'Pause Discord concert' : 'Resume Discord concert'}</button
                >
                {#if canManage && view.guildId}<a
                    class="button secondary"
                    href={`/admin?guildId=${encodeURIComponent(view.guildId)}`}>Open DJ controls</a
                  >{/if}
              </details>
            {/if}
            <p class="permission-note">
              Controls update the shared Discord concert. The bot must already be connected to a
              voice channel.
            </p>
            {#if view.audioRoom?.current && view.audioLive}
              {#key `${view.audioRoom.guildId ?? ''}:${view.audioRoom.code}`}<RoomSocial
                  room={view.audioRoom}
                />{/key}
            {/if}
          {:else}
            <div class="empty-stage">
              <div class="record" aria-hidden="true"><span>ap<span class="red">.</span></span></div>
              <h2>The stage is waiting.</h2>
              <p>
                Start a concert with Afterparty in Discord.<br />The shared concert will appear
                here.
              </p>
            </div>
          {/if}
          {#if view.notice}<p class="search-summary" role="status">{view.notice}</p>{/if}
        </div>
        {#if view.guildId && (invitationExpanded || tv)}<div class="concert-share">
            {#key view.guildId}<RoomSharing
                code={concert?.roomCode ?? 'DISCORD1'}
                guildId={view.guildId}
                {tv}
                bind:expanded={invitationExpanded}
                showToggle={false}
              />{/key}
          </div>{/if}
        <section class="concert-workspace" aria-label="Concert music tools">
          {#if view.adding}<button
              class="button secondary"
              onclick={() => client?.cancelAdditions()}>Cancel additions</button
            >{/if}
          {#key view.guildId}<MusicWorkspace
              bind:active={panel}
              searchInputId="concert-search"
              queueCount={queue.length}
            >
              {#snippet search()}
                <div class="concert-search">
                  <form
                    class="search-form"
                    role="search"
                    onsubmit={(event) => {
                      event.preventDefault();
                      resultPage = 0;
                      void client?.search(query);
                    }}
                  >
                    <label class="sr-only" for="concert-search">Search songs or artists</label>
                    <Icon name="search" />
                    <input
                      id="concert-search"
                      bind:value={query}
                      oninput={() => {
                        resultPage = 0;
                        client?.cancelSearch();
                      }}
                      minlength="2"
                      maxlength="120"
                      required
                      autocomplete="off"
                      placeholder="A song, an artist, a whole mood…"
                    />
                    <button class="button primary" disabled={view.searching}
                      >{view.searching ? 'Searching…' : 'Search music'}</button
                    >
                  </form>
                  <p class="search-summary" role="status">
                    {view.searching
                      ? 'Looking for your next concert track…'
                      : view.query
                        ? `${view.results.length} results for “${view.query}”`
                        : 'Search YouTube and add music to this server’s concert queue.'}
                  </p>
                  {#if shownResults.length}<ul class="search-results">
                      {#each shownResults as video, index (`${video.id}:${index}`)}<li>
                          <TrackThumbnail image={video.image} />
                          <div class="track-info">
                            <strong>{video.title}</strong><span>{video.artist}</span>
                          </div>
                          <span class="duration">{video.live ? 'LIVE' : time(video.duration)}</span>
                          <button
                            class="icon-button"
                            aria-label={`Add ${video.title} to queue`}
                            disabled={view.busy ||
                              !view.connected ||
                              !concert?.online ||
                              !concert?.connected ||
                              video.embeddable === false ||
                              video.source === 'soundcloud'}
                            onclick={() => void addTracks([video.id])}><Icon name="add" /></button
                          >
                        </li>{/each}
                    </ul>{/if}
                  {#if resultPages > 1}<nav class="result-pages" aria-label="Concert search pages">
                      <button
                        class="button secondary"
                        disabled={resultPage === 0}
                        onclick={() => resultPage--}>Previous results</button
                      >
                      <span>Page {resultPage + 1} of {resultPages}</span>
                      <button
                        class="button secondary"
                        disabled={resultPage >= resultPages - 1}
                        onclick={() => resultPage++}>Next results</button
                      >
                    </nav>{/if}
                </div>
              {/snippet}
              {#snippet upNext()}
                <section class="concert-queue" aria-labelledby="concert-queue-heading">
                  <div class="section-heading">
                    <h2 id="concert-queue-heading">Up next</h2>
                    <span class="count">{queue.length}</span>
                  </div>
                  {#if queue.length}
                    <ol class="queue-list">
                      {#each queue as video, index (video.entryId ?? video.id)}
                        <li>
                          <span class="track-number">{String(index + 1).padStart(2, '0')}</span>
                          <div class="track-info">
                            <strong>{video.title}</strong><span>{video.artist}</span>
                          </div>
                          <button
                            class="button secondary small"
                            aria-label={`Vote for ${video.title}`}
                            disabled={view.busy || !view.connected || !view.queue || !video.entryId}
                            onclick={() => {
                              void client?.queueAction('vote', { videoId: video.entryId });
                            }}>+{view.queue?.state.voteCounts?.[video.entryId ?? ''] ?? 0}</button
                          >
                          {#if canManage}<button
                              class="icon-button"
                              aria-label={`Remove ${video.title}`}
                              disabled={view.busy || !view.connected}
                              onclick={() => {
                                void client?.queueAction('remove', { videoId: video.entryId });
                              }}>×</button
                            >{/if}
                        </li>
                      {/each}
                    </ol>
                  {:else}<div class="empty-queue">
                      <Icon name="music" size={30} />
                      <h3>Room for the next favourite</h3>
                      <p>Add concert music using the bot in Discord.</p>
                    </div>{/if}
                  {#if concert?.current && view.queue}<button
                      class="button secondary"
                      disabled={controlsDisabled}
                      onclick={() => {
                        void client?.queueAction('skip-vote');
                      }}>Vote to skip · {view.queue.state.skipVotes ?? 0}</button
                    >{/if}
                  {#if canManage}
                    <div class="moderation">
                      <h3>Queue moderation</h3>
                      <button
                        class="button secondary"
                        disabled={view.busy || !view.connected}
                        onclick={() => {
                          void client?.queueAction('approval', {
                            enabled: !view.queue?.state.approvalRequired,
                          });
                        }}
                        >{view.queue?.state.approvalRequired
                          ? 'Disable approval'
                          : 'Require approval'}</button
                      ><button
                        class="button secondary"
                        disabled={view.busy || !view.connected}
                        onclick={() => {
                          void client?.queueAction('undo');
                        }}>Undo queue edit</button
                      >
                    </div>
                    {#if view.queue?.state.requests?.length}<h3 class="requests-heading">
                        Waiting for approval
                      </h3>
                      <ul class="queue-list">
                        {#each view.queue.state.requests as video (video.entryId ?? video.id)}<li>
                            <div class="track-info">
                              <strong>{video.title}</strong><span>{video.artist}</span>
                            </div>
                            <button
                              class="button secondary small"
                              disabled={view.busy || !view.connected}
                              onclick={() => {
                                void client?.queueAction('approve', { videoId: video.entryId });
                              }}>Approve</button
                            ><button
                              class="icon-button"
                              aria-label={`Reject ${video.title}`}
                              disabled={view.busy || !view.connected}
                              onclick={() => {
                                void client?.queueAction('reject', { videoId: video.entryId });
                              }}>×</button
                            >
                          </li>{/each}
                      </ul>{/if}
                  {/if}
                </section>
              {/snippet}
              {#snippet library()}
                {#key view.guildId}
                  {#await import('#lib/library/MusicLibrary.svelte')}
                    <p role="status">Opening your library…</p>
                  {:then { default: MusicLibrary }}
                    <MusicLibrary
                      tracks={[...(concert?.current ? [concert.current] : []), ...queue]}
                      capacity={roomQueueCapacity(queue.length, view.queue?.state.requests?.length)}
                      pendingIds={view.queue?.state.requests?.map((video) => video.id) ?? []}
                      history={view.history}
                      busy={view.busy || !view.connected || !concert?.online || !concert?.connected}
                      onAdd={(ids) => addTracks(ids, true)}
                    />
                  {:catch}<p class="error-message" role="alert">
                      The library could not load. Check your connection and open it again.
                    </p>{/await}
                {/key}
              {/snippet}
            </MusicWorkspace>{/key}
        </section>
      </section>
    {/if}
    {#if view.error}<div class="error-message" role="alert">
        <span>{view.error}</span><button
          class="button secondary"
          disabled={view.loading || view.busy}
          onclick={() => {
            void client?.refresh();
          }}>Reconnect</button
        >
      </div>{/if}
  </main>
  <AppFooter hidden={tv && Boolean(concert?.current)} />
</div>

<style>
  .concert-recovery {
    margin-top: 16px;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: 12px;
  }
  .concert-recovery summary {
    cursor: pointer;
    font-weight: 650;
  }
  .concert-recovery p {
    margin: 12px 0;
    color: var(--muted);
  }
  .concert-recovery .button {
    margin: 4px 8px 4px 0;
  }
  .concert-share {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .tv-mode .server-picker,
  .tv-mode .concert-queue {
    display: none;
  }
  .tv-mode .concert-workspace {
    display: none;
  }
  .concert-workspace {
    min-width: 0;
    max-height: calc(100dvh - 48px);
    overflow: auto;
    scrollbar-width: thin;
    scrollbar-gutter: stable;
    position: sticky;
    top: 24px;
    padding: 6px;
    margin: -6px;
  }
  .concert-search {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    padding: clamp(18px, 1.5vw, 26px);
    background: var(--surface);
  }
  .result-pages {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    margin-bottom: 20px;
  }
  .result-pages {
    justify-content: space-between;
    font-size: 12px;
    margin-top: 18px;
  }
  .tv-mode :global(.playback-diagnostics),
  .tv-mode .permission-note {
    display: none;
  }
  .concert-shell.tv-mode {
    max-width: none;
  }
  .tv-mode main {
    padding: var(--tv-gap) var(--tv-space);
  }
  .tv-mode .concert-content {
    grid-template-columns: minmax(0, 1fr) var(--tv-sidebar);
    gap: var(--tv-space);
  }
  .tv-mode .concert-share {
    grid-column: 2;
    grid-row: 1;
  }
  .tv-mode .current-track:has(.concert-recovery) {
    --concert-recovery-space: 80px;
  }
  .tv-mode .current-track:has(.concert-recovery[open]) {
    --concert-recovery-space: 200px;
  }
  .tv-mode .concert-art,
  .tv-mode :global(.audio-stage:not(.fullscreen)) {
    width: min(
      100%,
      calc((100dvh - var(--tv-control-space) - 90px - var(--concert-recovery-space, 0px)) * 16 / 9)
    );
    margin-inline: auto;
  }
  .tv-mode .track-meta {
    padding-block: 8px;
  }
  .tv-mode .track-meta h2 {
    font-size: var(--tv-track);
  }
  @media (max-width: 700px) {
    .tv-mode .concert-content {
      grid-template-columns: 1fr;
    }
    .tv-mode .concert-share {
      grid-column: 1;
      grid-row: auto;
    }
    .tv-mode .concert-art,
    .tv-mode :global(.audio-stage:not(.fullscreen)) {
      width: 100%;
    }
  }

  .clock-phase {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.7;
    margin-top: 14px;
  }
  .concert-shell {
    width: 100%;
    min-height: 100vh;
  }
  nav {
    display: flex;
    gap: 26px;
    font-size: 12px;
  }
  .server-picker a:hover {
    color: var(--red);
  }
  .server-picker h2 {
    font-size: var(--panel-title);
    margin: 0 0 18px;
  }
  .server-picker form {
    display: flex;
    align-items: end;
    gap: 12px;
    flex-wrap: wrap;
  }
  .server-picker label {
    font-size: var(--control-font);
    align-self: center;
  }
  .server-picker label span {
    color: var(--muted);
  }
  .server-picker p {
    font-size: 11px;
    line-height: 1.8;
    color: var(--muted);
    margin-top: 15px;
  }
  .server-picker p a {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .concert-content {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(280px, 1fr);
    gap: 36px;
  }
  .concert-queue {
    border-left: 1px solid var(--line);
    padding-left: 28px;
    min-width: 0;
  }
  .current-track {
    min-width: 0;
  }
  .concert-art {
    position: relative;
    aspect-ratio: 16/9;
    overflow: hidden;
    border-radius: 8px;
    background: #19191d;
  }
  .concert-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.75;
  }
  .concert-art > span {
    position: absolute;
    bottom: 18px;
    left: 20px;
    background: #111d;
    padding: 10px;
  }
  .concert-controls {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .small {
    min-height: 44px;
    padding: 8px 12px;
  }
  .concert-queue .queue-list {
    max-height: 520px;
  }
  .moderation {
    border-top: 1px solid var(--line);
    margin-top: 22px;
    padding-top: 20px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .moderation h3 {
    font-size: 12px;
    width: 100%;
    margin-bottom: 8px;
  }
  .requests-heading {
    font-size: 13px;
    margin: 26px 0 14px;
  }
  select:focus-visible {
    outline: 2px solid var(--red);
    outline-offset: 4px;
  }
  @media (max-width: 800px) {
    .concert-content {
      grid-template-columns: 1fr;
      gap: 34px;
    }
    .concert-queue {
      border-left: 0;
      padding-left: 0;
    }
    .server-picker form {
      align-items: stretch;
    }
    .server-picker label {
      width: 100%;
    }
    .server-picker input,
    .server-picker select {
      flex: 1;
      min-width: 0;
    }
    .concert-queue .queue-list {
      max-height: none;
    }
  }
  .concert-content {
    grid-template-columns: minmax(0, 1fr) clamp(340px, 28vw, 520px);
    align-items: start;
  }
  .current-track {
    position: sticky;
    top: 24px;
  }
  .current-track:has(:global(.fullscreen-fallback)) {
    z-index: 1000;
  }
  .tv-mode .current-track {
    position: static;
  }
  .concert-workspace .concert-queue {
    border: 0;
    padding: 18px;
    border-radius: 0;
    background: transparent;
  }
  .tv-mode .concert-content {
    grid-template-columns: minmax(0, 1fr) var(--tv-sidebar);
  }
  @media (max-width: 900px) {
    .concert-content {
      grid-template-columns: minmax(0, 1fr);
    }
    .concert-workspace {
      position: static;
      max-height: none;
      overflow: visible;
    }
    .current-track {
      position: static;
    }
  }
  @media (max-width: 700px) {
    .tv-mode .concert-content {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
