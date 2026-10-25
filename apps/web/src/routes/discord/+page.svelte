<script lang="ts">
  import { onMount } from 'svelte';
  import { createDiscordClient, type ConcertView } from '#lib/concert/discord-client.ts';
  import { request } from '../../../../../lib/browser-api.ts';
  import { time } from '../../../../../lib/types.ts';
  import Icon from '#lib/ui/Icon.svelte';
  import RoomAudio from '#lib/rooms/RoomAudio.svelte';
  import RoomSocial from '#lib/social/RoomSocial.svelte';
  import RoomSharing from '#lib/rooms/RoomSharing.svelte';
  import MotionPreference from '#lib/ui/MotionPreference.svelte';
  import '../../app.css';

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
  let panel = $state<'search' | 'library'>('search');
  let query = $state(''),
    resultPage = $state(0),
    seekSeconds = $state<number | null>(null);
  const shownResults = $derived(view.results.slice(resultPage * 10, (resultPage + 1) * 10));
  const resultPages = $derived(Math.max(1, Math.ceil(view.results.length / 10)));
  let tick = $state(0);
  let tv = $state(false);
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
      if (value.loading || value.guildId !== view.guildId) {
        panel = 'search';
        query = '';
        resultPage = 0;
        seekSeconds = null;
      }
      if (value.state?.playbackKey !== view.state?.playbackKey) seekSeconds = null;
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
<div class="concert-shell" class:tv-mode={tv && Boolean(concert?.current)}>
  <header class="concert-header">
    <a class="brand" href="/"
      ><img src="/afterparty-mark.svg" width="36" height="36" alt="" />afterparty<span class="red"
        >.</span
      ></a
    >
    <nav aria-label="Concert navigation">
      {#if view.guildId}<button class="button secondary" aria-pressed={tv} onclick={toggleTV}
          >{tv ? 'Exit TV mode' : 'TV mode'}</button
        >{/if}
      <a href="/">Listening rooms</a><a href="/admin" data-sveltekit-reload>Server settings</a>
    </nav>
  </header>
  <main id="concert">
    <div class="concert-title">
      <div>
        <p class="eyebrow red">THE DISCORD STAGE</p>
        <h1>Bring your people.<br />We’ll bring the music<span class="red">.</span></h1>
        <p class="intro">
          Public concerts, one shared queue. Listen in Discord or enable synchronized audio here.
        </p>
      </div>
      <Icon name="music" size={70} />
    </div>
    <section class="server-picker" aria-labelledby="server-heading">
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
        <div class="current-track">
          <div class="section-heading">
            <h2>{concert?.guildName ?? 'Discord concert'}</h2>
            <span class="eyebrow"
              >{view.connected && concert?.online ? 'CORE ONLINE' : 'OFFLINE'}</span
            >
          </div>
          {#if concert?.current}
            {#if view.audioRoom?.current && view.audioLive && view.audioRoom.current.embeddable !== false && view.audioRoom.current.source !== 'soundcloud'}
              {#key view.guildId}<RoomAudio
                  room={view.audioRoom}
                  position={target.position}
                  playing={target.playing}
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
                class="button primary"
                disabled={controlsDisabled}
                onclick={() => {
                  void client?.control(concert?.playing ? 'pause' : 'resume');
                }}
                ><Icon name={concert.playing ? 'pause' : 'play'} />{concert.playing
                  ? 'Pause'
                  : 'Resume'}</button
              ><button
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
            <p class="permission-note">
              Controls update the shared Discord concert. The bot must already be connected to a
              voice channel.
            </p>
            {#if canManage && !concert.current.live}
              <form
                class="shared-seek"
                onsubmit={(event) => {
                  event.preventDefault();
                  if (seekSeconds !== null)
                    void client?.seek(seekSeconds).then((confirmed) => {
                      if (confirmed) seekSeconds = null;
                    });
                }}
              >
                <label for="concert-seek">Shared concert position</label>
                <input
                  id="concert-seek"
                  type="range"
                  min="0"
                  max={Math.max(0, concert.current.duration - 0.1)}
                  step="1"
                  value={seekSeconds ??
                    Math.min(
                      concert.current.duration - 0.1,
                      target.stale ? concert.position : target.position,
                    )}
                  disabled={controlsDisabled}
                  oninput={(event) => (seekSeconds = Number(event.currentTarget.value))}
                />
                <output
                  >{time(
                    seekSeconds ?? (target.stale ? concert.position : target.position),
                  )}</output
                >
                <button class="button secondary" disabled={controlsDisabled || seekSeconds === null}
                  >Seek concert</button
                >
                <p>
                  Administrator action for everyone in this concert. Moving the video’s own controls
                  only affects your browser.
                </p>
              </form>
            {/if}
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
        {#if view.guildId}<div class="concert-share">
            {#key view.guildId}<RoomSharing
                code={concert?.roomCode ?? 'DISCORD1'}
                guildId={view.guildId}
                {tv}
              />{/key}
          </div>{/if}
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
        <section class="concert-discovery" aria-label="Concert music tools">
          <nav class="music-tabs" aria-label="Concert music tools">
            <button
              class="button"
              class:primary={panel === 'search'}
              class:secondary={panel !== 'search'}
              aria-pressed={panel === 'search'}
              onclick={() => (panel = 'search')}>Find music</button
            >
            <button
              class="button"
              class:primary={panel === 'library'}
              class:secondary={panel !== 'library'}
              aria-pressed={panel === 'library'}
              onclick={() => (panel = 'library')}>Library & playlists</button
            >
            {#if view.adding}<button
                class="button secondary"
                onclick={() => client?.cancelAdditions()}>Cancel additions</button
              >{/if}
          </nav>
          {#if panel === 'library'}
            {#key view.guildId}
              {#await import('#lib/library/MusicLibrary.svelte')}
                <p role="status">Opening your library…</p>
              {:then { default: MusicLibrary }}
                <MusicLibrary
                  tracks={[...(concert?.current ? [concert.current] : []), ...queue]}
                  history={view.history}
                  busy={view.busy || !view.connected || !concert?.online || !concert?.connected}
                  onAdd={(ids) => addTracks(ids, true)}
                />
              {:catch}<p class="error-message" role="alert">
                  The library could not load. Check your connection and open it again.
                </p>{/await}
            {/key}
          {:else}
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
                    <span class="track-number"
                      >{String(resultPage * 10 + index + 1).padStart(2, '0')}</span
                    >
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
          {/if}
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
  <footer class="concert-footer">
    <span>Music brings us here.</span><MotionPreference /><a href="/support">Need a hand?</a>
  </footer>
</div>

<style>
  .concert-share {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .tv-mode .concert-title,
  .tv-mode .server-picker,
  .tv-mode .concert-footer,
  .tv-mode .concert-queue {
    display: none;
  }
  .tv-mode .concert-discovery,
  .tv-mode .shared-seek {
    display: none;
  }
  .concert-discovery {
    grid-column: 1 / -1;
    min-width: 0;
    border-top: 1px solid var(--line);
    padding-top: 26px;
  }
  .music-tabs,
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
  .shared-seek {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    margin-top: 16px;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .shared-seek label,
  .shared-seek p {
    grid-column: 1 / -1;
    font-size: 11px;
  }
  .shared-seek input {
    min-width: 0;
    padding: 0;
  }
  .shared-seek button {
    grid-column: 1 / -1;
  }
  .shared-seek output {
    align-self: center;
    font-size: 12px;
  }
  .tv-mode :global(.playback-diagnostics),
  .tv-mode .permission-note {
    display: none;
  }
  .tv-mode main {
    padding: 20px 24px;
  }
  .tv-mode .concert-content {
    grid-template-columns: minmax(0, 1fr) 270px;
    gap: 24px;
  }
  .tv-mode .concert-share {
    grid-column: 2;
    grid-row: 1;
  }
  .tv-mode :global(.audio-stage:not(.fullscreen)) {
    width: min(100%, calc((100dvh - 330px) * 16 / 9));
    margin-inline: auto;
  }
  .tv-mode .track-meta {
    padding-block: 8px;
  }
  .tv-mode .track-meta h2 {
    font-size: 24px;
  }
  @media (max-width: 700px) {
    .tv-mode .concert-content {
      grid-template-columns: 1fr;
    }
    .tv-mode .concert-share {
      grid-column: 1;
      grid-row: auto;
    }
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
    max-width: 1380px;
    margin: auto;
    min-height: 100vh;
  }
  .concert-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
    padding: 26px 44px;
    border-bottom: 1px solid var(--line);
  }
  nav {
    display: flex;
    gap: 26px;
    font-size: 12px;
  }
  nav a:hover,
  .server-picker a:hover {
    color: var(--red);
  }
  .concert-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 32px;
    margin: 20px 0 45px;
  }
  .concert-title > :global(svg) {
    color: var(--red);
    flex-shrink: 0;
  }
  h1 {
    font-size: clamp(34px, 4.5vw, 64px);
    letter-spacing: -2.5px;
    line-height: 1.08;
    margin: 18px 0 22px;
  }
  .server-picker {
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    padding: 26px 0;
    margin-bottom: 34px;
  }
  .server-picker h2 {
    font-size: 17px;
    margin-bottom: 18px;
  }
  .server-picker form {
    display: flex;
    align-items: end;
    gap: 12px;
    flex-wrap: wrap;
  }
  .server-picker label {
    font-size: 12px;
    align-self: center;
  }
  .server-picker label span {
    color: var(--muted);
  }
  input,
  select {
    font: inherit;
    min-height: 44px;
    background: #19191d;
    color: inherit;
    border: 1px solid #3b3b42;
    border-radius: 6px;
    padding: 10px 14px;
    max-width: 100%;
    font-size: 12px;
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
  .concert-footer {
    display: flex;
    justify-content: space-between;
    padding: 26px 44px;
    border-top: 1px solid var(--line);
    font-size: 11px;
    color: var(--muted);
  }
  select:focus-visible {
    outline: 2px solid var(--red);
    outline-offset: 4px;
  }
  @media (max-width: 800px) {
    .concert-header {
      padding: 20px 22px;
      flex-wrap: wrap;
    }
    .concert-header nav {
      gap: 18px;
    }
    .concert-title > :global(svg) {
      display: none;
    }
    .concert-title {
      margin: 10px 0 30px;
    }
    h1 {
      letter-spacing: -1.5px;
    }
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
    .concert-footer {
      padding: 24px 22px;
    }
    .concert-queue .queue-list {
      max-height: none;
    }
  }
</style>
