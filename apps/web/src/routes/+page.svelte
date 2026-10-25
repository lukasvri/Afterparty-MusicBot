<script lang="ts">
  import { roomQueueCapacity } from '../../../../services/core/src/protocol.ts';
  import MotionPreference from '#lib/ui/MotionPreference.svelte';
  import TrackThumbnail from '#lib/ui/TrackThumbnail.svelte';

  import { onMount, tick as afterRender } from 'svelte';
  import { createRoomClient, type RoomClientState } from '#lib/rooms/room-client.ts';
  import Icon from '#lib/ui/Icon.svelte';
  import MusicWorkspace from '#lib/ui/MusicWorkspace.svelte';
  import RoomAudio from '#lib/rooms/RoomAudio.svelte';
  import RoomSocial from '#lib/social/RoomSocial.svelte';
  import RoomDirectory from '#lib/rooms/RoomDirectory.svelte';
  import RoomSharing from '#lib/rooms/RoomSharing.svelte';
  import RoomQueue from '#lib/rooms/RoomQueue.svelte';
  import { browserStorage } from '../../../../lib/browser-storage.ts';
  import { time } from '../../../../lib/types.ts';
  import releases from '../../../../lib/releases.json';

  let client = $state<ReturnType<typeof createRoomClient>>();
  let view = $state<RoomClientState>({
    room: null,
    connection: 'idle',
    busy: false,
    error: '',
    searching: false,
    results: [],
    query: '',
    receivedAt: 0,
  });
  let roomName = $state(''),
    roomCode = $state(''),
    query = $state(''),
    invitationExpanded = $state(false);
  let panel = $state<'queue' | 'discover' | 'library'>('queue');
  let directory = $state(false),
    publicRoom = $state(false),
    displayName = $state('');
  let importing = $state(false),
    invitationLink = $state(''),
    invitationError = $state('');
  let tick = $state(0);
  let tv = $state(false);
  let welcomeScene = $state(false);
  async function findMusic() {
    panel = 'discover';
    await afterRender();
    document.getElementById('search')?.focus();
  }
  async function openMusic(value: 'player' | typeof panel) {
    if (value !== 'player') panel = value;
    await afterRender();
    const destination = document.getElementById(
      value === 'player' ? 'room-player' : 'room-workspace',
    );
    destination?.scrollIntoView({ block: 'start' });
    if (value === 'discover') document.getElementById('search')?.focus({ preventScroll: true });
    else if (value === 'player') destination?.focus({ preventScroll: true });
    else
      destination
        ?.querySelector<HTMLElement>(`[data-panel="${value}"]`)
        ?.focus({ preventScroll: true });
  }
  const room = $derived(view.room);
  const target = $derived.by(() => {
    void tick;
    void view.room;
    void view.receivedAt;
    void view.connection;
    return client?.playback() ?? { position: 0, playing: false, stale: false };
  });
  onMount(() => {
    displayName = browserStorage.get('afterparty-display-name') ?? '';
    directory = new URL(location.href).searchParams.get('view') === 'rooms';
    client = createRoomClient();
    const unsubscribe = client.subscribe((value) => {
      const changedRoom = value.room && value.room.code !== view.room?.code;
      if (changedRoom) invitationExpanded = false;
      if (view.room && !value.room) {
        invitationLink = '';
        invitationError = '';
        invitationExpanded = false;
      }
      view = value;
      // Initial reads can fail after creation. Keep the room recoverable when
      // polling eventually succeeds, even after the creating promise returned.
      if (
        changedRoom &&
        new URL(location.href).searchParams.get('room')?.toUpperCase() !== value.room?.code
      )
        rememberRoom();
    });
    const initialUrl = new URL(location.href);
    tv = initialUrl.searchParams.get('tv') === '1';
    const initial = initialUrl.searchParams.get('room');
    welcomeScene = !initial;
    const access = new URLSearchParams(initialUrl.hash.slice(1));
    const invitation = access.get('host') ?? undefined;
    const credential = access.get('access');
    if (initial && /^[A-Z0-9]{8}$/.test(initial) && credential && /^[a-f0-9]{64}$/.test(credential))
      browserStorage.set(`afterparty-host:${initial}`, credential);
    if (initialUrl.hash) {
      initialUrl.hash = '';
      history.replaceState(history.state, '', initialUrl);
    }
    if (initial) void client.join(initial, invitation);
    const timer = setInterval(() => {
      tick++;
    }, 250);
    return () => {
      clearInterval(timer);
      unsubscribe();
      client?.destroy();
    };
  });
  async function join() {
    if (await client?.join(roomCode)) rememberRoom();
  }
  async function create() {
    if (await client?.create(roomName.trim() || 'The listening room', publicRoom)) {
      panel = 'discover';
      rememberRoom();
    }
  }
  function rememberRoom() {
    if (!view.room) return;
    directory = false;
    const url = new URL(location.href);
    url.searchParams.delete('view');
    url.searchParams.set('room', view.room.code);
    history.replaceState(history.state, '', url);
  }
  async function invite(type: 'cohost' | 'transfer') {
    invitationError = '';
    invitationLink = '';
    const code = view.room?.code;
    const token = await client?.createInvitation(type);
    if (!token || view.room?.code !== code) return;
    const url = new URL('/', location.origin);
    url.searchParams.set('room', code!);
    url.hash = new URLSearchParams({ host: token }).toString();
    invitationLink = url.href;
    try {
      await navigator.clipboard.writeText(url.href);
    } catch {
      invitationError = 'Copy the invitation link below.';
    }
  }
  async function addTracks(ids: readonly string[]) {
    if (!client || importing) throw new Error('Another addition is still in progress.');
    importing = true;
    try {
      await client.append(ids);
    } finally {
      importing = false;
    }
  }
  function leave() {
    welcomeScene = true;
    tv = false;
    client?.leave();
    panel = 'queue';
    invitationLink = '';
    invitationError = '';
    invitationExpanded = false;
    history.replaceState(history.state, '', '/');
  }
  function toggleTV() {
    tv = !tv;
    const url = new URL(location.href);
    if (tv) url.searchParams.set('tv', '1');
    else url.searchParams.delete('tv');
    history.replaceState(history.state, '', url);
  }
  function goHome(event: MouseEvent) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    leave();
  }
  function goListening(event: MouseEvent) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (!room) return goHome(event);
    event.preventDefault();
    rememberRoom();
  }
  function toggleDirectory() {
    directory = !directory;
    const url = new URL(location.href);
    if (directory) url.searchParams.set('view', 'rooms');
    else url.searchParams.delete('view');
    history.replaceState(history.state, '', url);
  }
</script>

{#snippet scenery(composition: 'welcome' | 'room')}
  {#await import('#lib/ui/ConcertScenery.svelte') then { default: ConcertScenery }}
    <ConcertScenery {composition} />
  {/await}
{/snippet}

<svelte:head>
  <title>{room ? `${room.name} · Afterparty` : 'Your music. Your people. · Afterparty'}</title>
  <meta
    name="description"
    content="A listening room for your people. Find a song, build a queue and listen together with Afterparty."
  />
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<a class="skip-link" href="#main">Skip to music</a>
<div class="app-shell" class:tv-mode={tv && Boolean(room)}>
  <header class="app-header">
    <a class="brand" href="/" aria-label="Afterparty home" onclick={goHome}
      ><img src="/afterparty-mark.svg" width="42" height="42" alt="" /><span
        >afterparty<span class="red">.</span></span
      ></a
    >
    <nav aria-label="Main navigation">
      <a
        class="nav-link"
        class:active={!directory}
        href={room ? `/?room=${room.code}` : '/'}
        aria-current={directory ? undefined : 'page'}
        onclick={goListening}><Icon name="headphones" />Music</a
      >
      <button
        class="nav-link"
        class:active={directory}
        onclick={toggleDirectory}
        aria-current={directory ? 'page' : undefined}
        aria-pressed={directory}><Icon name="users" />Open rooms</button
      >
      <a class="nav-link" href="/discord"><Icon name="music" />Concerts</a>
      <a class="nav-link" href="/admin" data-sveltekit-reload><Icon name="settings" />DJ tools</a>
      <a class="nav-link" href={room ? `/games?room=${encodeURIComponent(room.code)}` : '/games'}
        ><Icon name="users" />Games</a
      >
    </nav>
  </header>

  <div class="workspace">
    <main id="main">
      {#if directory}
        <RoomDirectory
          busy={view.busy || view.connection === 'connecting'}
          onJoin={async (code) => {
            if (await client?.join(code)) rememberRoom();
          }}
          onCreate={() => {
            directory = false;
            leave();
          }}
        />
      {:else if !room}
        <section class="welcome">
          <div class="welcome-hero">
            <div class="welcome-copy">
              <p class="eyebrow red">GOOD MUSIC NEEDS GOOD COMPANY</p>
              <h1>afterparty<span class="red">.</span></h1>
              <p class="intro">Play music and video together. One room, one shared soundtrack.</p>
            </div>
            <div class="welcome-stage">
              <div class="stage-heading">
                <span class="eyebrow">THE AFTERPARTY STAGE</span><MotionPreference />
              </div>
              <div class="stage-visual">
                {#if welcomeScene}{@render scenery('welcome')}{/if}
              </div>
              <div class="stage-caption">
                <span>YOUR MUSIC. YOUR PEOPLE.</span><span>ONE SHARED SOUNDTRACK</span>
              </div>
            </div>
            <div class="room-forms">
              <form
                onsubmit={(event) => {
                  event.preventDefault();
                  void create();
                }}
              >
                <h2>Start something good</h2>
                <p>Create a private room and invite your people.</p>
                <label for="room-name">Room name</label><input
                  id="room-name"
                  bind:value={roomName}
                  placeholder="The listening room"
                  maxlength="48"
                  autocomplete="off"
                />
                <label class="checkbox-label"
                  ><input type="checkbox" bind:checked={publicRoom} /> List this room in Open rooms</label
                >
                <button
                  class="button primary"
                  disabled={!client || view.busy || view.connection === 'connecting'}
                  >{publicRoom ? 'Create public room' : 'Create private room'}
                  <Icon name="arrow" /></button
                >
              </form>
              <form
                onsubmit={(event) => {
                  event.preventDefault();
                  void join();
                }}
              >
                <h2>Already invited?</h2>
                <p>Your room code gets you straight to the music.</p>
                <label for="room-code">Room code</label><input
                  id="room-code"
                  bind:value={roomCode}
                  placeholder="8-character code"
                  maxlength="8"
                  minlength="8"
                  required
                  autocomplete="off"
                  autocapitalize="characters"
                  spellcheck="false"
                />
                <button
                  class="button secondary"
                  disabled={!client || view.busy || view.connection === 'connecting'}
                  >Join room <Icon name="arrow" /></button
                >
              </form>
            </div>
          </div>
          <div class="welcome-foot">
            <span>YOU CHOOSE WHO JOINS</span><span>SHARED IN REAL TIME</span><span
              >NO ACCOUNT NEEDED</span
            >
          </div>
        </section>
      {:else}
        <section class="room-heading">
          <div>
            <h1>{room.name}</h1>
          </div>
          <div class="room-actions">
            <button class="button secondary" aria-pressed={tv} onclick={toggleTV}
              >{tv ? 'Exit TV mode' : 'TV mode'}</button
            >
            <button class="button secondary" onclick={leave}>Leave room</button><button
              class="button secondary invite"
              aria-expanded={invitationExpanded || tv}
              aria-controls="room-invitation"
              onclick={() => (invitationExpanded = !invitationExpanded)}
              ><Icon name="link" />Invite friends<span class="room-code">{room.code}</span></button
            >
          </div>
        </section>
        <div class="room-share">
          {#key room.code}<RoomSharing
              code={room.code}
              {tv}
              bind:expanded={invitationExpanded}
              showToggle={false}
              id="room-invitation"
            />{/key}
        </div>
        {#snippet roomControls()}
          <section class="room-settings" aria-labelledby="settings-title">
            <h2 id="settings-title">Make it your room</h2>
            <label for="display-name">Your display name</label>
            <input
              id="display-name"
              maxlength="32"
              bind:value={displayName}
              oninput={() => browserStorage.set('afterparty-display-name', displayName)}
              placeholder="Guest"
            />
            {#if room.isHost}
              <label class="checkbox-label"
                ><input
                  type="checkbox"
                  checked={room.radio !== false}
                  disabled={view.busy || view.connection !== 'connected'}
                  onchange={(event) => {
                    void client?.action('radio', { enabled: event.currentTarget.checked });
                  }}
                /> Keep the music going with radio</label
              >
              <p class="permission-note">
                Radio skips declared AI, vlogs and song recreations. Matching music videos are
                preferred when available.
              </p>
              <label class="checkbox-label"
                ><input
                  type="checkbox"
                  checked={room.approvalRequired === true}
                  disabled={view.busy || view.connection !== 'connected'}
                  onchange={(event) => {
                    void client?.action('approval', {
                      enabled: event.currentTarget.checked,
                    });
                  }}
                /> Approve guest requests</label
              >
              {#if room.isOwner}<label class="checkbox-label"
                  ><input
                    type="checkbox"
                    checked={room.isPublic === true}
                    disabled={view.busy || view.connection !== 'connected'}
                    onchange={(event) => {
                      void client?.setVisibility(event.currentTarget.checked);
                    }}
                  /> List this room in Open rooms</label
                >{/if}
              <div class="room-actions">
                <button
                  class="button secondary"
                  disabled={view.busy || !room.queue.length || view.connection !== 'connected'}
                  onclick={() => {
                    if (confirm('Clear the upcoming queue?')) void client?.action('clear');
                  }}>Clear queue</button
                >
                <button
                  class="button secondary"
                  disabled={view.busy || view.connection !== 'connected'}
                  onclick={() => {
                    void client?.action('undo');
                  }}>Undo queue change</button
                >
              </div>
              {#if room.requests?.length}<h3>Guest requests</h3>
                <ul class="search-results">
                  {#each room.requests as video (video.id)}<li>
                      <div class="track-info">
                        <strong>{video.title}</strong><span
                          >{video.requestedBy ?? video.artist}</span
                        >
                      </div>
                      <button
                        class="button secondary"
                        disabled={view.busy || view.connection !== 'connected'}
                        onclick={() => {
                          void client?.action('approve', { videoId: video.id });
                        }}>Approve</button
                      ><button
                        class="button secondary"
                        disabled={view.busy || view.connection !== 'connected'}
                        onclick={() => {
                          void client?.action('reject', { videoId: video.id });
                        }}>Reject</button
                      >
                    </li>{/each}
                </ul>{/if}
            {:else}
              <p class="permission-note">
                The host manages the room. Vote for the next track in the queue or request a skip.
              </p>
              <button
                class="button secondary"
                disabled={view.busy || !room.current || view.connection !== 'connected'}
                onclick={() => {
                  void client?.action('skip-vote');
                }}>Vote to skip ({room.skipVotes ?? 0})</button
              >
              {#if room.approvalRequired}<p class="permission-note">
                  Your song requests need host approval.
                </p>{/if}
            {/if}
            {#if room.isOwner}
              <h3>Share hosting</h3>
              <p class="permission-note">
                One-use invitations grant room controls. An ownership transfer gives the recipient
                full ownership when accepted.
              </p>
              <div class="room-actions">
                <button
                  class="button secondary"
                  disabled={view.busy || view.connection !== 'connected'}
                  onclick={() => {
                    void invite('cohost');
                  }}>Invite a co-host</button
                ><button
                  class="button secondary"
                  disabled={view.busy || view.connection !== 'connected'}
                  onclick={() => {
                    if (confirm('Create a link that transfers room ownership when accepted?'))
                      void invite('transfer');
                  }}>Transfer ownership</button
                ><button
                  class="button secondary"
                  disabled={view.busy || view.connection !== 'connected'}
                  onclick={() => {
                    if (confirm('Revoke all co-host access and pending invitations?')) {
                      invitationLink = '';
                      void client?.revokeHosts();
                    }
                  }}>Revoke shared access</button
                >
              </div>
              {#if invitationLink}<label for="invitation-link">Private invitation link</label><input
                  id="invitation-link"
                  readonly
                  value={invitationLink}
                  onclick={(event) => event.currentTarget.select()}
                />
                <p role="status">
                  {invitationError ||
                    'Invitation copied. Share privately with the intended person.'}
                </p>{/if}
            {/if}
          </section>
        {/snippet}
        <div class="listening-grid">
          <section class="now-playing" aria-labelledby="now-title" id="room-player" tabindex="-1">
            <div class="player-bar section-heading">
              <h2 id="now-title" class="sr-only">Now playing</h2>
              <span
                ><Icon name="music" size={15} />{room.isPublic ? 'Public room' : 'Private room'} · {room.isHost
                  ? "You're the host"
                  : 'Listening together'}</span
              >
              <div class="top-status">
                <span class="status-dot" class:online={view.connection === 'connected'}
                ></span>{view.connection === 'connected'
                  ? 'Connected'
                  : view.connection === 'reconnecting'
                    ? 'Reconnecting…'
                    : view.connection === 'connecting'
                      ? 'Connecting…'
                      : 'Make yourself at home'}
              </div>
            </div>
            {#if room.current}
              {#snippet transportFooter()}
                {#if room.current}<div class="playback-footer">
                    <div class="track-meta">
                      <h2>{room.current.title}</h2>
                      <p>{room.current.artist}</p>
                    </div>
                    <div class="transport">
                      <button
                        class="button secondary next-track"
                        aria-label="Next track"
                        disabled={!room.isHost || view.busy || view.connection !== 'connected'}
                        onclick={() => {
                          void client?.control('next');
                        }}><Icon name="next" /><span>Next track</span></button
                      >
                    </div>
                    {#if !room.isHost}<p class="permission-note">
                        The host controls playback. Everyone can add to the queue.
                      </p>{/if}
                  </div>{/if}
              {/snippet}
              {#key room.code}<RoomAudio
                  {room}
                  settings={roomControls}
                  settingsLabel="Room settings"
                  footer={transportFooter}
                  position={target.position}
                  playing={target.playing}
                  canControl={room.isHost && view.connection === 'connected'}
                  controlBusy={view.busy}
                  onIntent={async (intent) => {
                    if (
                      !client ||
                      view.room?.code !== intent.code ||
                      view.room.current?.id !== intent.videoId ||
                      view.room.playbackKey !== intent.playbackKey ||
                      !view.room.isHost
                    )
                      return false;
                    return client.control(intent.action, intent.position);
                  }}
                />{/key}
            {:else}
              <div class="empty-stage">
                {@render scenery('room')}
                <div class="record" aria-hidden="true">
                  <span>ap<span class="red">.</span></span>
                </div>
                <h2>Every great night starts<br />with one song.</h2>
                <p>Choose a song and make this room your own.</p>
                <button class="button primary" onclick={() => void findMusic()}
                  ><Icon name="search" />Choose a song</button
                >
              </div>
              <details class="room-settings-empty">
                <summary>Room settings</summary>{@render roomControls()}
              </details>
            {/if}
            <div class="player-extras">
              {#key room.code}<RoomSocial {room} />{/key}
            </div>
          </section>
          <div class="room-side" id="room-workspace">
            {#key room.code}<MusicWorkspace
                bind:active={panel}
                searchInputId="search"
                queueCount={room.queue.length}
              >
                {#snippet search()}
                  <section class="discovery" aria-labelledby="discover-title">
                    <div class="section-heading">
                      <div>
                        <p class="eyebrow red">PASS THE AUX</p>
                        <h2 id="discover-title">What’s the next track?</h2>
                      </div>
                    </div>
                    <form
                      class="search-form"
                      role="search"
                      onsubmit={(event) => {
                        event.preventDefault();
                        void client?.search(query);
                      }}
                    >
                      <label class="sr-only" for="search">Search songs or artists</label><Icon
                        name="search"
                      /><input
                        id="search"
                        bind:value={query}
                        oninput={() => client?.cancelSearch()}
                        placeholder="A song, an artist, a whole mood…"
                        required
                        maxlength="120"
                        autocomplete="off"
                      /><button class="button primary" disabled={view.searching}
                        >{view.searching ? 'Searching…' : 'Find music'}</button
                      >
                    </form>
                    <div role="status" class="search-summary">
                      {#if view.searching}Looking for your soundtrack…{:else if view.query}{view
                          .results.length
                          ? `${view.results.length} results for “${view.query}”`
                          : `No songs found for “${view.query}”. Try an artist or a different title.`}{:else}Search
                        YouTube and add a track to the shared queue.{/if}
                    </div>
                    {#if view.results.length}<ul class="search-results">
                        {#each view.results as video, index (`${video.id}:${index}`)}<li>
                            <TrackThumbnail image={video.image} />
                            <div class="track-info">
                              <strong>{video.title}</strong><span>{video.artist}</span>
                            </div>
                            <span class="duration"
                              >{video.live ? 'LIVE' : time(video.duration)}</span
                            ><button
                              class="icon-button add-track"
                              aria-label={`Add ${video.title} to queue`}
                              disabled={view.busy ||
                                view.connection !== 'connected' ||
                                video.embeddable === false}
                              onclick={() => {
                                void client?.add(video.id);
                              }}><Icon name="add" /></button
                            >
                          </li>{/each}
                      </ul>{/if}
                  </section>
                {/snippet}
                {#snippet upNext()}
                  <RoomQueue
                    {room}
                    {client}
                    disabled={view.busy || view.connection !== 'connected'}
                  />
                {/snippet}
                {#snippet library()}
                  {#key room.code}
                    {#await import('#lib/library/MusicLibrary.svelte')}
                      <p class="search-summary" role="status">Opening your library…</p>
                    {:then { default: MusicLibrary }}
                      <MusicLibrary
                        tracks={[...(room.current ? [room.current] : []), ...room.queue]}
                        history={room.history ?? []}
                        capacity={roomQueueCapacity(room.queue.length, room.requests?.length)}
                        pendingIds={room.requests?.map((video) => video.id) ?? []}
                        busy={view.busy || importing || view.connection !== 'connected'}
                        onAdd={addTracks}
                      />
                    {:catch}
                      <div class="error-message" role="alert">
                        <p>
                          The library could not load. Check your connection and reload the page.
                        </p>
                        <button class="button secondary" onclick={() => location.reload()}
                          >Reload page</button
                        >
                      </div>
                    {/await}
                  {/key}
                {/snippet}
              </MusicWorkspace>{/key}
          </div>
        </div>
        <div class="room-tools">
          <div class="room-bottom">
            <span>KEEP THE GOOD MUSIC GOING.</span><a
              href={`/games?room=${encodeURIComponent(room.code)}`}
              >Play Guess the Song <Icon name="arrow" size={16} /></a
            >
          </div>
        </div>
      {/if}
      {#if view.error}<div class="error-message" role="alert">
          <span>{view.error}</span>{#if room}<button
              class="button secondary"
              onclick={() => {
                void client?.refresh();
              }}
              disabled={view.busy}>Reconnect</button
            >{/if}
        </div>{/if}
    </main>
    {#if room && !directory && !tv}
      <nav class="mobile-music-nav" aria-label="Quick music navigation">
        <button aria-label="Go to player" onclick={() => void openMusic('player')}
          ><Icon name="play" size={18} />Player</button
        >
        <button
          aria-label="Open search"
          class:chosen={panel === 'discover'}
          onclick={() => void openMusic('discover')}><Icon name="search" size={18} />Search</button
        >
        <button
          aria-label="Open queue"
          class:chosen={panel === 'queue'}
          onclick={() => void openMusic('queue')}><Icon name="music" size={18} />Queue</button
        >
        <button
          aria-label="Open library"
          class:chosen={panel === 'library'}
          onclick={() => void openMusic('library')}
          ><Icon name="headphones" size={18} />Library</button
        >
      </nav>
    {/if}
    <footer class="footer">
      {#if room || directory}<MotionPreference />{/if}
      <span>afterparty<span class="red">.</span></span><a
        href={`/patch-notes#v${releases[0].version}`}>v{releases[0].version} · Patch notes</a
      ><span>YOUR MUSIC. YOUR PEOPLE.</span>
    </footer>
  </div>
</div>

<style>
  .app-shell:has(.welcome) .workspace,
  .app-shell:has(.welcome) .app-header {
    max-width: 3200px;
  }
  .workspace > main:has(.welcome) {
    max-width: none;
    min-height: calc(100svh - 184px);
    display: grid;
    align-items: center;
  }
  .welcome {
    max-width: none;
    padding-top: clamp(12px, 2vh, 36px);
  }
  .welcome-hero {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    column-gap: clamp(28px, 3.5vw, 80px);
    row-gap: 30px;
    align-items: center;
  }
  .welcome-copy {
    grid-column: 1;
    align-self: end;
  }
  .welcome h1 {
    font-size: clamp(64px, 5.9vw, 184px);
    margin: 20px 0;
  }
  .welcome .intro {
    max-width: 520px;
    font-size: clamp(17px, 1.1vw, 28px);
  }
  .welcome-stage {
    grid-column: 2;
    grid-row: 1 / 3;
    min-width: 0;
    align-self: stretch;
    display: flex;
    flex-direction: column;
    justify-content: center;
    border: 1px solid #38252f;
    border-radius: 28px;
    background: radial-gradient(ellipse at 50% 50%, #33101e 0%, #110e15 50%, #0d0d10 85%);
    overflow: hidden;
  }
  .stage-heading,
  .stage-caption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 24px;
  }
  .stage-heading .eyebrow {
    color: #e5bbc8;
    font-size: clamp(10px, 0.45vw, 14px);
  }
  .stage-visual {
    width: 100%;
    aspect-ratio: 16 / 9;
    margin: auto 0;
  }
  .stage-caption {
    color: #b7a3af;
    font-size: clamp(9px, 0.4vw, 13px);
    font-weight: 650;
    letter-spacing: 1.5px;
  }
  .room-forms {
    grid-column: 1;
    margin: 0;
    gap: 14px;
    align-self: start;
  }
  .room-forms > form {
    padding: clamp(18px, 1.4vw, 30px);
    border-radius: 18px;
    background: linear-gradient(150deg, #19181e, #111216);
  }
  .room-forms h2 {
    font-size: clamp(20px, 1.2vw, 32px);
  }
  .room-forms p {
    font-size: clamp(13px, 0.55vw, 17px);
  }
  .room-forms label {
    margin-top: 20px;
    font-size: clamp(13px, 0.6vw, 18px);
  }
  .room-forms input:not([type='checkbox']) {
    height: clamp(50px, 2vw, 64px);
    font-size: clamp(16px, 0.7vw, 22px);
  }
  .room-forms .button {
    min-height: clamp(48px, 2vw, 64px);
    font-size: clamp(14px, 0.7vw, 20px);
  }
  .room-forms .checkbox-label {
    font-size: clamp(12px, 0.55vw, 17px);
    line-height: 1.5;
    min-height: 36px;
  }
  .welcome-foot {
    gap: 24px;
    margin: 28px 0 0;
    font-size: clamp(10px, 0.45vw, 14px);
  }
  @media (max-width: 1100px) {
    .welcome-hero {
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }
    .welcome-stage {
      grid-row: 1;
    }
    .room-forms {
      grid-column: 1 / -1;
    }
    .stage-heading,
    .stage-caption {
      padding: 14px;
      gap: 10px;
    }
    .stage-heading .eyebrow {
      font-size: 8px;
    }
    .stage-caption {
      font-size: 8px;
      letter-spacing: 0.8px;
    }
    .stage-caption span:last-child {
      display: none;
    }
  }
  @media (max-width: 650px) {
    .welcome-hero {
      grid-template-columns: 1fr;
      gap: 24px;
    }
    .welcome h1 {
      font-size: clamp(56px, 15vw, 82px);
      margin: 12px 0;
    }
    .welcome-copy {
      grid-column: 1;
    }
    .welcome-stage {
      grid-column: 1;
      grid-row: 2;
      border-radius: 18px;
    }
    .stage-caption {
      display: none;
    }
    .room-forms {
      grid-row: 3;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    .room-forms > form {
      padding: 22px;
    }
    .welcome-foot {
      gap: 12px 18px;
      line-height: 1.6;
    }
  }
  .next-track {
    flex-shrink: 0;
  }
  .app-shell {
    display: block;
    background: #09090b;
  }
  .app-header {
    max-width: 2400px;
    margin: auto;
    min-height: 88px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 18px 40px;
    border-bottom: 1px solid var(--line);
  }
  .app-header nav {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .app-header .nav-link {
    width: auto;
    flex: 0 0 auto;
    min-height: 44px;
    margin: 0;
    padding: 10px 12px;
    font-size: 13px;
    gap: 8px;
    border-radius: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
  }
  .app-header .nav-link.active {
    border-bottom-color: var(--red);
    color: var(--text);
  }
  .workspace {
    max-width: 2400px;
    margin-inline: auto;
  }
  .workspace > main {
    padding: clamp(20px, 2.8vw, 48px);
  }
  .room-heading {
    margin-bottom: 28px;
  }
  .room-heading h1 {
    margin: 0;
    font-size: clamp(30px, 3.6vw, 52px);
  }
  .listening-grid {
    grid-template-columns: minmax(0, 1fr) clamp(340px, 28vw, 520px);
    gap: 24px;
  }
  .now-playing {
    min-width: 0;
    overflow: clip;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: #111113;
  }
  .player-bar {
    min-height: 44px;
    margin: 0;
    padding: 12px 20px;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font-size: 12px;
  }
  .player-bar > span {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .now-playing :global(.audio-stage:not(.fullscreen)) {
    border: 0;
    border-radius: 0;
  }
  .now-playing :global(.player-status) {
    margin: 0;
    padding: 10px 20px;
    border-bottom: 1px solid var(--line);
    background: #0e0e11;
  }
  .now-playing :global(.local-sync) {
    margin: 0;
    padding: 18px 20px;
    border: 0;
    border-top: 1px solid var(--line);
    border-radius: 0;
    background: transparent;
  }
  .now-playing :global(.audio-message) {
    margin: 16px;
  }
  .playback-footer {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 18px 20px;
    flex-wrap: wrap;
  }
  .playback-footer .track-meta {
    padding: 0;
    flex: 1;
    min-width: 120px;
  }
  .playback-footer .track-meta h2 {
    margin: 0;
    font-size: 18px;
    letter-spacing: -0.4px;
  }
  .playback-footer .track-meta p {
    margin-top: 4px;
    font-size: 13px;
  }
  .playback-footer .permission-note {
    width: 100%;
    margin: 0;
  }
  .transport {
    flex-wrap: wrap;
  }
  .next-track {
    padding: 10px;
    min-width: 44px;
  }
  .next-track span {
    display: none;
  }
  .room-settings {
    border: 0;
    border-radius: 0;
    background: transparent;
    padding: 22px 0 0;
    display: grid;
    gap: 14px;
    border-top: 1px solid var(--line);
  }
  .room-settings > label:not(.checkbox-label) {
    font-size: 13px;
    color: var(--muted);
    margin-bottom: -6px;
  }
  .room-settings > input {
    width: 100%;
    min-height: 48px;
    border-radius: 10px;
    font-size: 16px;
  }
  .room-settings h3 {
    font-size: 15px;
    margin-top: 12px;
  }
  .room-settings .permission-note {
    font-size: 13px;
    line-height: 1.65;
  }
  .room-settings h2 {
    font-size: 18px;
  }
  .room-settings-empty {
    padding: 18px 20px;
    border-top: 1px solid var(--line);
  }
  .room-settings-empty > summary {
    cursor: pointer;
    color: var(--muted);
    font-weight: 650;
  }
  .player-extras :global(.room-social) {
    margin: 0;
    padding: 18px 20px;
    border: 0;
    border-top: 1px solid var(--line);
    border-radius: 0;
    background: transparent;
  }
  .player-extras :global(.social-heading h2) {
    font-size: 16px;
  }
  .player-extras :global(.social-heading .eyebrow) {
    display: none;
  }
  .room-side {
    min-width: 0;
    max-height: calc(100dvh - 48px);
    overflow: auto;
    scrollbar-width: thin;
    scrollbar-gutter: stable;
    position: sticky;
    top: 24px;
  }
  .now-playing:has(:global(.fullscreen-fallback)) {
    z-index: 1000;
  }
  .tv-mode .room-side,
  .tv-mode .player-extras,
  .tv-mode .room-settings-empty {
    display: none;
  }
  .tv-mode .workspace {
    max-width: none;
  }
  .tv-mode .now-playing {
    position: static;
    overflow: visible;
    border: 0;
    background: transparent;
  }
  .tv-mode .playback-footer {
    padding: 8px 0;
  }
  .mobile-music-nav {
    display: none;
  }
  #room-player,
  #room-workspace {
    scroll-margin-top: 16px;
  }
  @media (max-width: 900px) {
    .workspace:has(.mobile-music-nav) {
      padding-bottom: calc(74px + env(safe-area-inset-bottom));
    }
    .mobile-music-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 30;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      border-top: 1px solid var(--line);
      background: #111113;
      padding: 6px 12px calc(6px + env(safe-area-inset-bottom));
    }
    .mobile-music-nav button {
      min-height: 56px;
      border: 0;
      background: transparent;
      color: var(--muted);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      border-radius: 8px;
    }
    .mobile-music-nav button.chosen {
      color: var(--text);
      background: #222227;
      box-shadow: inset 0 2px var(--red);
    }
    .app-header {
      display: block;
      padding: 16px 20px;
    }
    .app-header nav {
      margin-top: 12px;
      justify-content: space-between;
    }
    .app-header .nav-link {
      font-size: 12px;
      padding: 10px 5px;
    }
    .app-header .nav-link :global(svg) {
      display: none;
    }
    .listening-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .room-side {
      position: static;
      max-height: none;
      overflow: visible;
    }
  }
  .tv-mode {
    grid-template-columns: 1fr;
  }
  .tv-mode .app-header,
  .tv-mode .footer {
    display: none;
  }
  .tv-mode main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--tv-sidebar);
    gap: var(--tv-gap);
    padding: var(--tv-space);
  }
  .tv-mode .room-heading {
    grid-column: 1 / -1;
    margin: 0;
  }
  .tv-mode .room-heading h1 {
    font-size: var(--tv-title);
  }
  .tv-mode .room-share {
    grid-column: 2;
    grid-row: 2;
  }
  .tv-mode .listening-grid {
    grid-column: 1;
    grid-row: 2;
    display: block;
  }
  .tv-mode :global(.playback-diagnostics) {
    display: none;
  }
  .tv-mode .section-heading,
  .tv-mode .track-meta p {
    display: none;
  }
  .tv-mode .room-tools {
    display: none;
  }
  .tv-mode .track-meta {
    margin: 0;
    padding: 8px 0;
  }
  .tv-mode .track-meta h2 {
    font-size: var(--tv-track);
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .tv-mode :global(.audio-stage:not(.fullscreen)) {
    width: min(100%, calc((100dvh - var(--tv-control-space)) * 16 / 9));
    margin-inline: auto;
  }
  @media (max-width: 700px) {
    .tv-mode main {
      display: block;
      padding: 16px;
    }
    .tv-mode .room-share {
      margin-block: 16px;
    }
    .tv-mode .listening-grid {
      margin-bottom: 20px;
    }
    .tv-mode :global(.audio-stage:not(.fullscreen)) {
      width: 100%;
    }
  }
</style>
