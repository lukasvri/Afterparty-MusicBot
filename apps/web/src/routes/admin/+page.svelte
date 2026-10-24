<script lang="ts">
  import { onMount } from 'svelte';
  import {
    adminSettingGroups,
    createAdminClient,
    safeAdminLink,
    type AdminState,
  } from '#lib/admin/admin-client.ts';
  import { time } from '../../../../../lib/types.ts';
  import '../../app.css';

  let client: ReturnType<typeof createAdminClient> | undefined;
  let view = $state<AdminState>({
    checking: true,
    authenticated: false,
    globalAdmin: false,
    guilds: [],
    guildId: '',
    detail: null,
    busy: false,
    error: '',
    notice: '',
    invite: '',
    ownerUpdateUrl: '',
    coreUnavailable: false,
    channels: [],
    rooms: [],
  });
  let tab = $state('player'),
    password = $state(''),
    query = $state(''),
    channelId = $state(''),
    snapshotName = $state('');
  let settings = $state<Record<string, number | boolean>>({}),
    settingsGuild = $state('');
  let volume = $state(60),
    volumeDirty = $state(false),
    minutes = $state(30);
  const selected = $derived(view.guilds.find((guild) => guild.id === view.guildId));
  const detail = $derived(view.detail);
  const playback = $derived(detail?.state);
  const invite = $derived(safeAdminLink(view.invite, view.guildId || undefined));
  onMount(() => {
    client = createAdminClient();
    const unsubscribe = client.subscribe((value) => {
      if (value.guildId !== view.guildId) {
        settingsGuild = '';
        settings = {};
        channelId = '';
        volumeDirty = false;
      }
      view = value;
      if (value.detail && !volumeDirty) volume = value.detail.state.volume;
      if (tab === 'settings' && value.detail && settingsGuild !== value.guildId) {
        settings = { ...value.detail.settings };
        settingsGuild = value.guildId;
      }
      if (!value.globalAdmin && tab === 'rooms') tab = 'player';
    });
    const url = new URL(location.href);
    if (url.searchParams.has('login'))
      view.error =
        'Discord sign-in could not be completed. Check the application setup and try again.';
    void client.loadAccess(url.searchParams.get('guildId') ?? '');
    const refresh = () => {
      if (!document.hidden) {
        void client?.validateOwnerSession();
        if (!view.busy) void client?.refresh();
      }
    };
    const timer = setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      unsubscribe();
      client?.destroy();
    };
  });
  function select(id: string) {
    client?.select(id);
    const url = new URL(location.href);
    url.searchParams.set('guildId', id);
    history.replaceState(history.state, '', url);
  }
  function openTab(value: string) {
    tab = value;
    if (value === 'settings' && detail) {
      settings = { ...detail.settings };
      settingsGuild = view.guildId;
    }
    if (value === 'rooms') void client?.loadRooms();
  }
  async function login() {
    const value = password;
    password = '';
    await client?.login(value);
  }
  function command(action: string, extra: Record<string, unknown> = {}) {
    return client?.command(action, extra);
  }
  function saveSettings() {
    const values = Object.fromEntries(
      adminSettingGroups.flatMap((group) =>
        group.fields.map((field) => [
          field.key,
          settings[field.key] ?? detail?.settings[field.key],
        ]),
      ),
    );
    void client?.control('settings', { settings: values });
  }
  function confirmCommand(message: string, action: string, extra: Record<string, unknown> = {}) {
    if (confirm(message)) void command(action, extra);
  }
</script>

<svelte:head>
  <title>Server settings · Afterparty</title>
  <meta name="robots" content="noindex, nofollow" />
  <meta
    name="description"
    content="Manage Afterparty playback, queues and settings for your Discord servers."
  />
</svelte:head>

<a class="skip-link" href="#admin-main">Skip to server settings</a>
<div class="admin-page">
  <header class="admin-header">
    <a class="brand" href="/v3"
      ><img src="/afterparty-mark.svg" width="36" height="36" alt="" /><span
        >afterparty<span class="red">.</span></span
      ></a
    >
    <nav aria-label="Administration navigation">
      <a href="/v3">Listening rooms</a><a href="/v3/discord">Concerts</a><a
        href="/admin?classic=1"
        data-sveltekit-reload>Classic settings</a
      >
    </nav>
    {#if view.authenticated}<button
        class="button secondary"
        disabled={view.busy}
        onclick={() => void client?.logout()}>Sign out</button
      >{/if}
  </header>
  <main id="admin-main">
    <div class="heading">
      <div>
        <p class="eyebrow red">AFTERPARTY / CONTROL ROOM</p>
        <h1>Your server.<br />Your soundtrack.</h1>
        <p>Playback, queues and settings, scoped to the server you choose.</p>
      </div>
      {#if view.authenticated}<div class="heading-actions">
          <button
            class="button secondary"
            disabled={view.busy}
            onclick={() => void client?.loadAccess()}>Refresh access</button
          >{#if view.ownerUpdateUrl}<a
              class="button secondary"
              href={view.ownerUpdateUrl}
              target="_blank"
              rel="noopener noreferrer">Update bot and website ↗</a
            >{/if}
        </div>{/if}
    </div>
    {#if view.error}<p class="notice error" role="alert">{view.error}</p>{/if}
    {#if view.notice}<p class="notice" role="status">{view.notice}</p>{/if}
    {#if view.checking}<p role="status">Checking your access…</p>
    {:else if !view.authenticated}
      <section class="card login">
        <h2>Welcome to the control room</h2>
        <p>Sign in with Discord to manage servers where you have administration permissions.</p>
        <a class="button primary" href="/api/auth/discord" data-sveltekit-reload
          >Sign in with Discord ↗</a
        >{#if view.invite}<a
            class="button secondary"
            href={view.invite}
            target="_blank"
            rel="noreferrer">Add Afterparty</a
          >{/if}
        <details>
          <summary>Owner sign-in</summary>
          <form
            onsubmit={(event) => {
              event.preventDefault();
              void login();
            }}
          >
            <label for="owner-password">Afterparty administrator password</label><input
              id="owner-password"
              type="password"
              bind:value={password}
              autocomplete="current-password"
              maxlength="200"
              required
            /><button class="button secondary" disabled={view.busy}>Sign in</button>
          </form>
        </details>
      </section>
    {:else}
      <div class="server-picker">
        <label for="admin-guild">Discord server</label><select
          id="admin-guild"
          value={view.guildId}
          disabled={view.busy}
          onchange={(event) => select(event.currentTarget.value)}
          >{#each view.guilds as guild (guild.id)}<option value={guild.id}
              >{guild.name}{guild.installed ? '' : ' · add Afterparty'}</option
            >{/each}</select
        >
      </div>
      {#if view.coreUnavailable}<p class="notice" role="status">
          Core is unavailable. Owner recovery access is still available through the update link.
        </p>{/if}
      {#if !view.guilds.length}<section class="card">
          <h2>No servers available</h2>
          <p>Your account has no manageable servers here. Refresh access after adding the bot.</p>
          {#if view.invite}<a
              class="button primary"
              href={view.invite}
              target="_blank"
              rel="noreferrer">Add Afterparty ↗</a
            >{/if}
        </section>
      {:else if !selected?.installed}<section class="card">
          <h2>Add Afterparty to {selected?.name}</h2>
          {#if invite}<a class="button primary" href={invite} target="_blank" rel="noreferrer"
              >Add to this server ↗</a
            >{/if}
          <p>Refresh access after the bot has been added.</p>
        </section>
      {:else}
        <nav class="tabs" aria-label="Server administration">
          {#each [['player', 'Player and queue'], ['settings', 'Settings'], ['tools', 'Tools'], ...(view.globalAdmin ? [['rooms', 'Browser rooms']] : [])] as [key, label]}<button
              class:chosen={tab === key}
              aria-pressed={tab === key}
              onclick={() => openTab(key)}>{label}</button
            >{/each}
          <a href={'/v3/discord?guildId=' + view.guildId}>Watch concert ↗</a>
        </nav>
        {#if !detail}<p role="status">Loading {selected?.name}…</p>
          <button
            class="button secondary"
            disabled={view.busy}
            onclick={() => void client?.refresh()}>Retry</button
          >
        {:else if tab === 'player'}
          <section class="card deck">
            <div class="deck-status">
              <span class="eyebrow"
                >{playback?.ready
                  ? playback.connected
                    ? 'IN A VOICE CHANNEL'
                    : 'READY IN DISCORD'
                  : 'DISCORD OFFLINE'}</span
              ><span
                >{Math.round(detail.player.bitrate / 1000)} kbit/s · radio: {detail.player
                  .radioProvider || 'ready'}</span
              >
            </div>
            <div class="track">
              <div class="art">
                {#if playback?.current?.image}<img
                    src={playback.current.image}
                    alt=""
                    width="240"
                    height="240"
                    referrerpolicy="no-referrer"
                  />{:else}<img src="/afterparty-mark.svg" alt="" width="64" height="64" />{/if}
              </div>
              <div>
                <p class="eyebrow red">
                  {playback?.playing
                    ? 'NOW PLAYING'
                    : playback?.current
                      ? 'PAUSED'
                      : 'READY FOR MUSIC'}
                </p>
                <h2>{playback?.current?.title ?? 'Make this one a good night.'}</h2>
                <p>
                  {playback?.current?.artist ??
                    'Start with /play in Discord, or choose a voice channel under Tools.'}
                </p>
                <div class="actions">
                  <button
                    class="button primary"
                    disabled={view.busy || !playback?.current}
                    onclick={() => void command(playback?.playing ? 'pause' : 'resume')}
                    >{playback?.playing ? 'Pause' : 'Resume'}</button
                  ><button
                    class="button secondary"
                    disabled={view.busy || !playback?.current}
                    onclick={() => void command('skip')}>Next track</button
                  ><button
                    class="button secondary"
                    disabled={view.busy}
                    onclick={() => void command('shuffle')}>Shuffle</button
                  ><button
                    class="button secondary"
                    disabled={view.busy}
                    onclick={() =>
                      confirmCommand('Stop music and empty the queue on this server?', 'stop')}
                    >Stop</button
                  >
                </div>
              </div>
            </div>
            {#if playback?.current && !playback.current.live}<label class="seek"
                >Playback position <span
                  >{time(playback.position)} / {time(playback.current.duration)}</span
                ><input
                  aria-label="Playback position"
                  type="range"
                  min="0"
                  max={playback.current.duration}
                  value={playback.position}
                  disabled={view.busy}
                  onchange={(event) =>
                    void command('seek', { seconds: Number(event.currentTarget.value) })}
                /></label
              >{/if}
            {#if detail.player.radioError && detail.settings.radio}<p class="notice">
                {detail.player.radioError}
              </p>{/if}
            <form
              class="volume"
              onsubmit={(event) => {
                event.preventDefault();
                void command('volume', { value: volume })?.then((result) => {
                  if (result) volumeDirty = false;
                });
              }}
            >
              <label for="admin-volume">Discord volume · {volume}%</label><input
                id="admin-volume"
                type="range"
                min="0"
                max="100"
                bind:value={volume}
                oninput={() => (volumeDirty = true)}
                disabled={view.busy}
              /><button class="button secondary" disabled={view.busy}>Apply volume</button>
            </form>
            <form
              class="enqueue"
              onsubmit={(event) => {
                event.preventDefault();
                void command('enqueue', { query, concert: false });
              }}
            >
              <label class="sr-only" for="admin-query">Song or link</label><input
                id="admin-query"
                placeholder="Song, Spotify or SoundCloud link. sc: for SoundCloud"
                bind:value={query}
                maxlength="2000"
                required
              /><button class="button primary" disabled={view.busy || !playback?.connected}
                >Add to queue</button
              >
            </form>
            <h3>Up next <span class="muted">{playback?.queue.length ?? 0}</span></h3>
            <ol class="queue">
              {#each playback?.queue ?? [] as video, index (`${video.entryId ?? video.id}:${index}`)}<li
                >
                  <span class="muted">{index + 1}</span>
                  <div><strong>{video.title}</strong><small>{video.artist}</small></div>
                  <div class="queue-actions">
                    <button
                      disabled={view.busy || index === 0}
                      aria-label={`Move ${video.title} up`}
                      onclick={() => void command('move', { from: index + 1, to: index })}>↑</button
                    ><button
                      disabled={view.busy}
                      aria-label={`Play ${video.title} now`}
                      onclick={() => void command('jump', { position: index + 1 })}>▶</button
                    ><button
                      disabled={view.busy}
                      aria-label={`Remove ${video.title}`}
                      onclick={() => void command('remove', { index })}>×</button
                    >
                  </div>
                </li>{:else}<li class="muted">The next track is up to you.</li>{/each}
            </ol>
            <div class="actions">
              <button
                class="button secondary"
                disabled={view.busy}
                aria-pressed={detail.player.loopCurrentSong}
                onclick={() =>
                  void command('loop-sang', { value: !detail?.player.loopCurrentSong })}
                >Repeat song {detail.player.loopCurrentSong ? 'on' : 'off'}</button
              ><button
                class="button secondary"
                disabled={view.busy}
                aria-pressed={detail.player.loopCurrentQueue}
                onclick={() =>
                  void command('loop-queue', { value: !detail?.player.loopCurrentQueue })}
                >Repeat queue {detail.player.loopCurrentQueue ? 'on' : 'off'}</button
              ><button
                class="button secondary"
                disabled={view.busy}
                onclick={() => void command('replay')}>Restart song</button
              ><button
                class="button secondary"
                disabled={view.busy}
                onclick={() => void command('unskip')}>Previous song</button
              ><button
                class="button secondary"
                disabled={view.busy}
                onclick={() => confirmCommand('Clear the queue on this server?', 'clear')}
                >Clear queue</button
              >
            </div>
          </section>
          {#if detail.audio}<section class="card">
              <h2>Audio health</h2>
              <p>
                Interruptions: {detail.audio.interruptions} · longest: {detail.audio
                  .maxInterruptionMs} ms · missed frames: {detail.audio.missedFrames ?? 0}
              </p>
              <p>
                Event loop p95: {detail.performance?.eventLoopP95Ms?.toFixed(2) ?? '?'} ms · max: {detail.performance?.eventLoopMaxMs?.toFixed(
                  2,
                ) ?? '?'} ms
              </p>
              <details>
                <summary>Recent audio events</summary>
                <ul>
                  {#each detail.audio.events as event}<li>
                      {new Date(event.at).toLocaleTimeString()} · {event.reason} · {event.durationMs}
                      ms
                    </li>{/each}
                </ul>
              </details>
            </section>{/if}
        {:else if tab === 'settings'}
          <form
            class="card settings"
            onsubmit={(event) => {
              event.preventDefault();
              saveSettings();
            }}
          >
            <h2>Settings for {selected?.name}</h2>
            <p>Changes apply only to this server.</p>
            {#each adminSettingGroups as group}<fieldset disabled={view.busy}>
                <legend>{group.title}</legend>
                <p>{group.description}</p>
                {#each group.fields as field}<label class="setting-row" for={'setting-' + field.key}
                    ><span
                      ><strong>{field.label}</strong><small id={'help-' + field.key}
                        >{field.help}</small
                      ></span
                    >{#if 'toggle' in field}<input
                        id={'setting-' + field.key}
                        aria-label={field.label}
                        type="checkbox"
                        aria-describedby={'help-' + field.key}
                        checked={Boolean(settings[field.key] ?? detail?.settings[field.key])}
                        onchange={(event) =>
                          (settings = { ...settings, [field.key]: event.currentTarget.checked })}
                      />{:else}<input
                        id={'setting-' + field.key}
                        aria-label={field.label}
                        type="number"
                        aria-describedby={'help-' + field.key}
                        min={field.min}
                        max={field.max}
                        step="1"
                        required
                        value={Number(settings[field.key] ?? detail?.settings[field.key])}
                        oninput={(event) =>
                          (settings = {
                            ...settings,
                            [field.key]: Number(event.currentTarget.value),
                          })}
                      />{/if}</label
                  >{/each}
              </fieldset>{/each}<button class="button primary" disabled={view.busy}
              >Save server settings</button
            >
          </form>
        {:else if tab === 'rooms'}
          <section class="card">
            <h2>Browser rooms</h2>
            <button
              class="button secondary"
              disabled={view.busy}
              onclick={() => void client?.loadRooms()}>Refresh rooms</button
            >{#each view.rooms as room (room.code)}<article class="room-row">
                <div>
                  <h3>{room.name}</h3>
                  <p>{room.current?.title ?? 'No video'} · {room.viewers} in the room</p>
                </div>
                <a class="button secondary" href={'/v3?room=' + encodeURIComponent(room.code)}
                  >Open room ↗</a
                >{#if room.mode !== 'discord'}<button
                    class="button secondary"
                    disabled={view.busy}
                    onclick={() => {
                      if (confirm('Close this browser room for everyone?'))
                        void client?.closeRoom(room.code);
                    }}>Close room</button
                  >{/if}
              </article>{:else}<p>No browser rooms to show.</p>{/each}
          </section>
        {:else}
          <div class="tools">
            <section class="card">
              <h2>Voice and music channels</h2>
              <p>Choose where Afterparty connects and posts its player.</p>
              <button
                class="button secondary"
                disabled={view.busy}
                onclick={() => void client?.control('channels')}>Load channels</button
              ><label for="admin-channel">Channel</label><select
                id="admin-channel"
                bind:value={channelId}
                ><option value="">Select a channel</option>{#each view.channels as channel}<option
                    value={channel.id}>{channel.voice ? 'Voice ·' : '#'} {channel.name}</option
                  >{/each}</select
              >
              <div class="actions">
                <button
                  class="button secondary"
                  disabled={view.busy ||
                    !view.channels.find((channel) => channel.id === channelId)?.voice}
                  onclick={() => void client?.control('join', { channelId })}>Join voice</button
                ><button
                  class="button secondary"
                  disabled={view.busy ||
                    !channelId ||
                    view.channels.find((channel) => channel.id === channelId)?.voice}
                  onclick={() => void client?.control('music-channel', { channelId })}
                  >Set music channel</button
                ><button
                  class="button secondary"
                  disabled={view.busy}
                  onclick={() => void command('disconnect')}>Disconnect</button
                >
              </div>
            </section>
            <section class="card">
              <h2>Sleep timer</h2>
              <form
                onsubmit={(event) => {
                  event.preventDefault();
                  void command('sleep-timer', { minutes });
                }}
              >
                <label for="admin-minutes">Minutes until stop</label><input
                  id="admin-minutes"
                  type="number"
                  min="1"
                  max="1440"
                  bind:value={minutes}
                  required
                />
                <div class="actions">
                  <button class="button secondary" disabled={view.busy}>Start timer</button><button
                    type="button"
                    class="button secondary"
                    disabled={view.busy}
                    onclick={() => void command('cancel-sleep-timer')}>Cancel timer</button
                  >
                </div>
              </form>
              {#if detail.sleepTimerEndsAt}<p>
                  Stops at {new Date(detail.sleepTimerEndsAt).toLocaleTimeString()}
                </p>{/if}
            </section>
            <section class="card">
              <h2>Saved queues</h2>
              <form
                class="enqueue"
                onsubmit={(event) => {
                  event.preventDefault();
                  void command('snapshot-save', { name: snapshotName });
                }}
              >
                <label class="sr-only" for="snapshot-name">Saved queue name</label><input
                  id="snapshot-name"
                  placeholder="Name this queue"
                  bind:value={snapshotName}
                  maxlength="80"
                  required
                /><button class="button secondary" disabled={view.busy}>Save queue</button>
              </form>
              {#each detail.snapshots as snapshot (snapshot.id)}<article class="snapshot">
                  <strong>{snapshot.name} · {snapshot.songCount} tracks</strong>
                  <div class="actions">
                    <button
                      class="button secondary"
                      disabled={view.busy}
                      onclick={() =>
                        void command('snapshot-restore', { id: snapshot.id, replace: false })}
                      >Add tracks</button
                    ><button
                      class="button secondary"
                      disabled={view.busy}
                      onclick={() =>
                        confirmCommand('Replace this server’s queue?', 'snapshot-restore', {
                          id: snapshot.id,
                          replace: true,
                        })}>Replace queue</button
                    ><button
                      class="button secondary"
                      disabled={view.busy}
                      onclick={() =>
                        confirmCommand('Delete this saved queue?', 'snapshot-delete', {
                          id: snapshot.id,
                        })}>Delete</button
                    >
                  </div>
                </article>{:else}<p>No saved queues yet.</p>{/each}
            </section>
            <section class="card">
              <h2>Maintenance</h2>
              <p>Clean up this server’s queue or run diagnostics while disconnected.</p>
              <div class="actions">
                <button
                  class="button secondary"
                  disabled={view.busy}
                  onclick={() => void command('cleanup-duplicates')}>Remove duplicate tracks</button
                ><button
                  class="button secondary"
                  disabled={view.busy || Boolean(playback?.current) || Boolean(playback?.connected)}
                  onclick={() => void command('diagnostic')}>Run diagnostics</button
                >
              </div>
              <h3>Recent commands</h3>
              <ul class="jobs">
                {#each detail.commands.slice(0, 10) as job (job.id)}<li>
                    <strong>{job.payload.action}</strong><span>{job.status}</span
                    >{#if job.result}<small>{job.result}</small>{/if}
                  </li>{:else}<li>No recent commands.</li>{/each}
              </ul>
            </section>
          </div>
        {/if}
      {/if}
    {/if}
  </main>
  <footer>
    <a href="/support">Need a hand?</a><span>afterparty. / your music. your people.</span>
  </footer>
</div>

<style>
  .admin-page {
    min-height: 100vh;
    background: #0b0b0d;
  }
  .admin-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 24px 5vw;
    border-bottom: 1px solid var(--line);
  }
  .admin-header nav {
    display: flex;
    flex-wrap: wrap;
    gap: 22px;
    font-size: 12px;
    color: var(--muted);
  }
  .admin-header nav a:hover {
    color: white;
  }
  main {
    max-width: 1260px;
    margin: auto;
    padding: 50px 5vw 80px;
  }
  .heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 36px;
  }
  h1 {
    font-size: clamp(40px, 5vw, 70px);
    letter-spacing: -0.055em;
    line-height: 1.05;
    margin: 16px 0 20px;
  }
  h2 {
    font-size: 23px;
    letter-spacing: -0.035em;
    line-height: 1.3;
    margin-bottom: 12px;
  }
  h3 {
    font-size: 15px;
    margin: 24px 0 12px;
  }
  p {
    color: var(--muted);
    font-size: 13px;
    line-height: 1.8;
  }
  .eyebrow {
    font-size: 10px;
  }
  .heading-actions,
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 9px;
  }
  .card {
    padding: 28px;
    background: #111114;
    border: 1px solid var(--line);
    border-radius: 8px;
    margin: 20px 0;
    min-width: 0;
  }
  .login {
    max-width: 600px;
  }
  .login > .button {
    margin: 24px 8px 18px 0;
  }
  details {
    margin-top: 20px;
    font-size: 13px;
  }
  summary {
    cursor: pointer;
    padding: 10px 0;
  }
  form:not(.settings) > label,
  .card > label {
    display: block;
    font-size: 12px;
    margin: 16px 0 9px;
  }
  input:not([type='range']):not([type='checkbox']),
  select {
    min-width: 0;
    min-height: 44px;
    border: 1px solid #3c3c43;
    border-radius: 6px;
    background: #19191d;
    color: white;
    padding: 10px 13px;
    font: inherit;
    font-size: 13px;
  }
  .login input {
    display: block;
    width: 100%;
    margin: 12px 0;
  }
  .server-picker {
    display: flex;
    gap: 20px;
    align-items: center;
    padding: 20px 0;
  }
  .server-picker label {
    font-size: 12px;
    color: var(--muted);
  }
  .server-picker select {
    width: min(420px, 70%);
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    border-bottom: 1px solid var(--line);
    padding: 12px 0 20px;
    margin-bottom: 24px;
  }
  .tabs button,
  .tabs a {
    min-height: 44px;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 11px 15px;
    background: #19191d;
    color: #b9b7c0;
    font: inherit;
    font-size: 12px;
  }
  .tabs button.chosen {
    color: white;
    border-color: var(--red);
    background: #26171c;
  }
  .tabs a {
    margin-left: auto;
  }
  .notice {
    border: 1px solid #45434d;
    border-radius: 6px;
    background: #1a1a20;
    color: #eceaf0;
    padding: 16px 20px;
    margin: 15px 0;
  }
  .notice.error {
    border-color: #9e3446;
    background: #29151b;
  }
  .deck-status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
    color: var(--muted);
    font-size: 11px;
    border-bottom: 1px solid var(--line);
    padding-bottom: 20px;
    margin-bottom: 25px;
  }
  .track {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    align-items: center;
    gap: 28px;
  }
  .art {
    width: 180px;
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    background: #1b1a20;
    border-radius: 6px;
    overflow: hidden;
  }
  .art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .art img[src='/afterparty-mark.svg'] {
    width: 64px;
    height: 64px;
  }
  .track h2 {
    font-size: clamp(24px, 3vw, 38px);
    margin: 12px 0;
    overflow-wrap: anywhere;
  }
  .track .actions {
    margin-top: 22px;
  }
  .seek {
    display: block;
    font-size: 12px;
    margin: 25px 0;
    color: var(--muted);
  }
  .seek span {
    float: right;
    font-variant-numeric: tabular-nums;
  }
  input[type='range'] {
    display: block;
    width: 100%;
    accent-color: var(--red);
    margin-top: 10px;
    min-height: 32px;
  }
  .volume {
    display: grid;
    grid-template-columns: 150px minmax(80px, 1fr) auto;
    gap: 14px;
    align-items: center;
    margin: 25px 0;
  }
  .volume > label {
    margin: 0 !important;
  }
  .volume input {
    margin: 0;
  }
  .enqueue {
    display: flex;
    gap: 10px;
    margin: 22px 0;
  }
  .enqueue input {
    flex: 1;
    width: 0;
  }
  .queue {
    padding: 0;
    list-style: none;
    margin: 0 0 24px;
  }
  .queue li {
    display: flex;
    align-items: center;
    gap: 15px;
    border-bottom: 1px solid var(--line);
    padding: 14px 0;
    font-size: 12px;
  }
  .queue li > div:first-of-type {
    min-width: 0;
    flex: 1;
  }
  .queue strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.7;
  }
  small {
    display: block;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.7;
    margin-top: 5px;
    font-weight: 400;
  }
  .queue-actions {
    display: flex;
    gap: 4px;
  }
  .queue-actions button {
    width: 44px;
    height: 44px;
    border: 1px solid var(--line);
    background: #1c1b21;
    color: white;
    font-size: 17px;
  }
  .muted {
    color: var(--muted);
  }
  fieldset {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 18px 22px;
    margin: 28px 0;
    min-width: 0;
  }
  legend {
    padding: 0 10px;
    font-size: 17px;
    font-weight: 600;
  }
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 22px;
    padding: 18px 0;
    border-top: 1px solid var(--line);
    font-size: 13px;
  }
  fieldset > p {
    margin-bottom: 18px;
  }
  .setting-row > span {
    max-width: 560px;
  }
  .setting-row input[type='number'] {
    width: 95px;
    flex-shrink: 0;
  }
  .setting-row input[type='checkbox'] {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    accent-color: var(--red);
  }
  .tools {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }
  .tools .card {
    margin: 0;
  }
  .tools select {
    width: 100%;
  }
  .tools > .card > .actions {
    margin-top: 20px;
  }
  .snapshot {
    padding: 18px 0;
    border-bottom: 1px solid var(--line);
    font-size: 13px;
  }
  .snapshot .actions {
    margin-top: 14px;
  }
  .room-row {
    display: flex;
    align-items: center;
    gap: 12px;
    border-top: 1px solid var(--line);
    padding: 20px 0;
  }
  .room-row > div {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .room-row h3 {
    margin: 0;
  }
  .jobs {
    list-style: none;
    padding: 0;
    font-size: 12px;
  }
  .jobs li {
    padding: 14px 0;
    border-top: 1px solid var(--line);
  }
  .jobs li > span {
    margin-left: 16px;
    color: var(--muted);
  }
  footer {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding: 26px 5vw;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 11px;
  }
  @media (max-width: 800px) {
    .admin-header {
      padding: 20px;
      flex-wrap: wrap;
      gap: 18px;
    }
    .admin-header nav {
      order: 3;
      width: 100%;
      gap: 20px;
    }
    main {
      padding: 30px 20px 50px;
    }
    .heading {
      display: block;
    }
    .heading-actions {
      margin-top: 20px;
    }
    .card {
      padding: 22px 18px;
    }
    .tools {
      grid-template-columns: 1fr;
    }
    .track {
      grid-template-columns: 100px minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }
    .art {
      width: 100px;
    }
    .track .actions {
      margin-left: -118px;
      margin-top: 28px;
    }
    .volume {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .volume > label {
      grid-column: 1 / -1;
    }
    .deck-status {
      display: block;
      line-height: 2;
    }
    .deck-status > span {
      display: block;
    }
    .enqueue {
      flex-wrap: wrap;
    }
    .enqueue input {
      flex-basis: 100%;
    }
    .tabs a {
      margin-left: 0;
    }
    .setting-row {
      gap: 14px;
    }
    fieldset {
      padding: 15px;
    }
    .room-row {
      flex-wrap: wrap;
    }
    .room-row > div {
      flex-basis: 100%;
    }
    footer {
      flex-wrap: wrap;
      padding: 25px 20px;
    }
  }
</style>
