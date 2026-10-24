<script lang="ts">
  import { onMount } from 'svelte';
  import { createDiscordClient, type ConcertView } from '#lib/discord-client.ts';
  import { request } from '../../../../../../lib/browser-api.ts';
  import { time } from '../../../../../../lib/types.ts';
  import Icon from '#lib/Icon.svelte';
  import RoomAudio from '#lib/RoomAudio.svelte';
  import RoomSocial from '#lib/RoomSocial.svelte';
  import '../../../app.css';

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
  });
  let tick = $state(0);
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
    client = createDiscordClient();
    const unsubscribe = client.subscribe((value) => {
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
<div class="concert-shell">
  <header class="concert-header">
    <a class="brand" href="/v3"
      ><img src="/afterparty-mark.svg" width="36" height="36" alt="" />afterparty<span class="red"
        >.</span
      ></a
    >
    <nav aria-label="Concert navigation">
      <a href="/v3">Listening rooms</a><a href="/admin" data-sveltekit-reload>Server settings</a>
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
        <button class="button secondary" disabled={view.loading || view.busy}
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
    <span>Music brings us here.</span><a href="/support">Need a hand?</a>
  </footer>
</div>

<style>
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
