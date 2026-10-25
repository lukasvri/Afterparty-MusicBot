<script lang="ts">
  import { roomQueueCapacity } from '../../../../services/core/src/protocol.ts';
  import MotionPreference from '#lib/ui/MotionPreference.svelte';

  import { onMount, tick as afterRender } from 'svelte';
  import { createRoomClient, type RoomClientState } from '#lib/rooms/room-client.ts';
  import Icon from '#lib/ui/Icon.svelte';
  import RoomAudio from '#lib/rooms/RoomAudio.svelte';
  import RoomSocial from '#lib/social/RoomSocial.svelte';
  import RoomDirectory from '#lib/rooms/RoomDirectory.svelte';
  import RoomSharing from '#lib/rooms/RoomSharing.svelte';
  import { publicRoomLink } from '#lib/rooms/room-links.ts';
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
    copied = $state(false);
  let panel = $state<'discover' | 'library' | 'settings'>('discover');
  let directory = $state(false),
    publicRoom = $state(false),
    displayName = $state('');
  let importing = $state(false),
    invitationLink = $state(''),
    invitationError = $state('');
  let seekValue = $state<number | null>(null);
  let tick = $state(0);
  let tv = $state(false);
  let playerActive = $state(false);
  let welcomeScene = $state(false);
  async function findMusic() {
    panel = 'discover';
    await afterRender();
    document.getElementById('search')?.focus();
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
      if (view.room && !value.room) {
        playerActive = false;
        invitationLink = '';
        invitationError = '';
        copied = false;
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
    if (await client?.create(roomName.trim() || 'The listening room', publicRoom)) rememberRoom();
  }
  function rememberRoom() {
    if (!view.room) return;
    directory = false;
    const url = new URL(location.href);
    url.searchParams.set('room', view.room.code);
    history.replaceState(history.state, '', url);
  }
  async function share() {
    try {
      if (!room) return;
      await navigator.clipboard.writeText(publicRoomLink(location.origin, room.code));
      copied = true;
    } catch {
      copied = false;
    }
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
    panel = 'discover';
    invitationLink = '';
    invitationError = '';
    copied = false;
    seekValue = null;
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
  <aside class="sidebar">
    <a class="brand" href="/" aria-label="Afterparty home" onclick={goHome}
      ><img src="/afterparty-mark.svg" width="42" height="42" alt="" /><span
        >afterparty<span class="red">.</span></span
      ></a
    >
    <p class="nav-label">YOUR SPACE</p>
    <nav aria-label="Main navigation">
      <a class="nav-link active" href="/" aria-current="page" onclick={goHome}
        ><Icon name="headphones" />Listening room</a
      >
      <button
        class="nav-link"
        class:active={directory}
        onclick={() => {
          directory = !directory;
        }}
        aria-pressed={directory}><Icon name="users" />Open rooms</button
      >
      <a class="nav-link" href="/discord"><Icon name="music" />Discord & concerts</a>
      <a class="nav-link" href="/admin" data-sveltekit-reload
        ><Icon name="settings" />DJ & server tools</a
      >
      <a class="nav-link" href={room ? `/games?room=${encodeURIComponent(room.code)}` : '/games'}
        ><Icon name="users" />Games</a
      >
    </nav>
    <div class="sidebar-bottom">
      <div class="brand-line"></div>
      <p>Music brings us here.<br />You make it a party.</p>
      <a href="/patch-notes" data-sveltekit-reload>What’s new <Icon name="arrow" size={16} /></a>
    </div>
  </aside>

  <div class="workspace">
    <header class="topbar">
      <span class="eyebrow">THE LISTENING ROOM</span>
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
    </header>
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
              <h1>Your music.<br />Your people<span class="red">.</span></h1>
              <p class="intro">One room. One shared queue. A soundtrack you make together.</p>
            </div>
            <div class="welcome-stage">
              {#if welcomeScene}{@render scenery('welcome')}{/if}
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
          <div class="welcome-foot">
            <span>YOU CHOOSE WHO JOINS</span><span>SHARED IN REAL TIME</span><span
              >NO ACCOUNT NEEDED</span
            >
          </div>
        </section>
      {:else}
        <section class="room-heading">
          <div>
            <p class="eyebrow">
              <Icon name="users" size={15} />{room.isPublic ? 'PUBLIC ROOM' : 'PRIVATE ROOM'}
              <span> / </span>{room.isHost ? 'YOU’RE THE HOST' : 'LISTENING TOGETHER'}
            </p>
            <h1>{room.name}</h1>
          </div>
          <div class="room-actions">
            <button class="button secondary" aria-pressed={tv} onclick={toggleTV}
              >{tv ? 'Exit TV mode' : 'TV mode'}</button
            >
            <button class="button secondary" onclick={leave}>Leave room</button><button
              class="button secondary invite"
              onclick={share}
              ><Icon name="link" />{copied ? 'Link copied' : 'Invite friends'}<span
                class="room-code">{room.code}</span
              ></button
            >
          </div>
        </section>
        <div class="room-share">
          {#key room.code}<RoomSharing code={room.code} {tv} />{/key}
        </div>
        <div class="listening-grid">
          <section class="now-playing" aria-labelledby="now-title">
            <div class="section-heading">
              <h2 id="now-title">Now playing</h2>
              <span class="eyebrow">{target.playing ? 'ON AIR' : 'TAKE YOUR TIME'}</span>
            </div>
            {#if room.current}
              {#key room.code}<RoomAudio
                  {room}
                  position={target.position}
                  playing={target.playing}
                  canControl={room.isHost && view.connection === 'connected'}
                  controlBusy={view.busy}
                  onActiveChange={(active) => (playerActive = active)}
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
              <div class="track-meta">
                <span class="eyebrow red"
                  >{room.current.live ? 'LIVE' : 'THE CURRENT SOUNDTRACK'}</span
                >
                <h2>{room.current.title}</h2>
                <p>{room.current.artist}</p>
              </div>
              <div class="transport">
                {#if !playerActive}
                  <button
                    class="play-control"
                    aria-label={room.playing ? 'Pause playback' : 'Resume playback'}
                    disabled={!room.isHost || view.busy || view.connection !== 'connected'}
                    onclick={() => {
                      void client?.control(room.playing ? 'pause' : 'play');
                    }}><Icon name={room.playing ? 'pause' : 'play'} size={24} /></button
                  >
                {/if}
                <button
                  class="button secondary next-track"
                  aria-label="Next track"
                  disabled={!room.isHost || view.busy || view.connection !== 'connected'}
                  onclick={() => {
                    void client?.control('next');
                  }}><Icon name="next" /><span>Next track</span></button
                >
                {#if !playerActive}<div class="timeline">
                    <label class="sr-only" for="seek">Playback position</label><input
                      id="seek"
                      type="range"
                      min="0"
                      max={Math.max(1, room.current.duration)}
                      step="1"
                      value={seekValue ?? Math.min(target.position, room.current.duration)}
                      disabled={!room.isHost ||
                        room.current.live ||
                        view.busy ||
                        view.connection !== 'connected'}
                      oninput={(event) => {
                        seekValue = Number(event.currentTarget.value);
                      }}
                      onchange={(event) => {
                        void client
                          ?.control('seek', Number(event.currentTarget.value))
                          .finally(() => {
                            seekValue = null;
                          });
                      }}
                    />
                    <div class="timecodes">
                      <span>{time(target.position)}</span><span
                        >{room.current.live ? 'LIVE' : time(room.current.duration)}</span
                      >
                    </div>
                  </div>{:else}<p class="native-control-note">
                    Use the video controls to {room.isHost
                      ? 'play, pause or seek for everyone'
                      : 'listen on this device'}.
                  </p>{/if}
              </div>
              {#if !room.isHost}<p class="permission-note">
                  The host controls playback. Everyone can add to the queue.
                </p>{/if}
            {:else}
              <div class="empty-stage">
                {@render scenery('room')}
                <div class="record" aria-hidden="true">
                  <span>ap<span class="red">.</span></span>
                </div>
                <h2>Every great night starts<br />with one song.</h2>
                <p>Find your first track below. We’ll take it from there.</p>
              </div>
            {/if}
          </section>
          <section class="queue-panel" aria-labelledby="queue-title">
            <div class="section-heading">
              <h2 id="queue-title">Up next</h2>
              <span class="count">{room.queue.length}</span>
            </div>
            {#if room.queue.length}<ol class="queue-list">
                {#each room.queue as video, index (`${video.entryId ?? video.id}:${index}`)}<li>
                    <span class="track-number">{String(index + 1).padStart(2, '0')}</span>
                    <div class="track-info">
                      <strong>{video.title}</strong><span>{video.artist}</span>
                    </div>
                    <span class="duration">{video.live ? 'LIVE' : time(video.duration)}</span>
                    <div class="queue-actions">
                      {#if room.isHost}
                        <button
                          class="icon-button"
                          aria-label={`Play ${video.title} now`}
                          disabled={view.busy || view.connection !== 'connected'}
                          onclick={() => {
                            void client?.playVideo(video.id);
                          }}><Icon name="play" size={16} /></button
                        >
                        <button
                          class="icon-button"
                          aria-label={`Move ${video.title} up`}
                          disabled={index === 0 || view.busy || view.connection !== 'connected'}
                          onclick={() => {
                            void client?.move(video.id, index - 1);
                          }}>↑</button
                        >
                        <button
                          class="icon-button"
                          aria-label={`Remove ${video.title}`}
                          disabled={view.busy || view.connection !== 'connected'}
                          onclick={() => {
                            void client?.remove(video.id);
                          }}>×</button
                        >
                      {:else}
                        <button
                          class="icon-button"
                          aria-label={`Vote for ${video.title}`}
                          disabled={view.busy || view.connection !== 'connected'}
                          onclick={() => {
                            void client?.action('vote', { videoId: video.id });
                          }}>↑ {room.voteCounts?.[video.id] ?? 0}</button
                        >
                      {/if}
                    </div>
                  </li>{/each}
              </ol>
            {:else}<div class="empty-queue">
                <Icon name="music" size={30} />
                <h3>Room for your next favourite</h3>
                <p>Add a song below.<br />The best queues are a group effort.</p>
                <button class="button secondary" onclick={() => void findMusic()}
                  >Find a song</button
                >
              </div>{/if}
            <div class="queue-footer">
              <span class="status-dot online"></span>One queue. Everyone in sync.
            </div>
          </section>
        </div>
        <div class="room-tools" class:workspace-expanded={panel !== 'discover'} id="room-workspace">
          <nav class="room-tabs" aria-label="Room tools">
            <button
              class="button"
              class:primary={panel === 'discover'}
              class:secondary={panel !== 'discover'}
              onclick={() => {
                void findMusic();
              }}
              aria-pressed={panel === 'discover'}>Discover</button
            >
            <button
              class="button"
              class:primary={panel === 'library'}
              class:secondary={panel !== 'library'}
              onclick={() => {
                panel = 'library';
              }}
              aria-pressed={panel === 'library'}>Library & playlists</button
            >
            <button
              class="button"
              class:primary={panel === 'settings'}
              class:secondary={panel !== 'settings'}
              onclick={() => {
                panel = 'settings';
              }}
              aria-pressed={panel === 'settings'}>Room settings</button
            >
          </nav>
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
              {#if view.searching}Looking for your soundtrack…{:else if view.query}{view.results
                  .length
                  ? `${view.results.length} results for “${view.query}”`
                  : `No songs found for “${view.query}”. Try an artist or a different title.`}{:else}Search
                YouTube and add a track to the shared queue.{/if}
            </div>
            {#if view.results.length}<ul class="search-results">
                {#each view.results as video, index (`${video.id}:${index}`)}<li>
                    <span class="track-number">{String(index + 1).padStart(2, '0')}</span>
                    <div class="track-info">
                      <strong>{video.title}</strong><span>{video.artist}</span>
                    </div>
                    <span class="duration">{video.live ? 'LIVE' : time(video.duration)}</span
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

          {#if panel === 'library'}
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
                  <p>The library could not load. Check your connection and reload the page.</p>
                  <button class="button secondary" onclick={() => location.reload()}
                    >Reload page</button
                  >
                </div>
              {/await}
            {/key}
          {:else if panel === 'settings'}
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
                      void client?.action('approval', { enabled: event.currentTarget.checked });
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
                {#if invitationLink}<label for="invitation-link">Private invitation link</label
                  ><input
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
          {/if}
          {#key room.code}<RoomSocial {room} />{/key}
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
    <footer class="footer">
      <MotionPreference />
      <span>afterparty<span class="red">.</span></span><a
        href={`/patch-notes#v${releases[0].version}`}>v{releases[0].version} · Patch notes</a
      ><span>YOUR MUSIC. YOUR PEOPLE.</span>
    </footer>
  </div>
</div>

<style>
  .welcome-hero {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: clamp(20px, 3vw, 52px);
    align-items: center;
  }
  .welcome-stage {
    min-width: 0;
    aspect-ratio: 16 / 9;
  }
  @media (max-width: 1000px) {
    .welcome-hero {
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
    }
    .welcome-stage {
      max-width: 560px;
    }
  }
  @media (max-width: 600px) {
    .welcome-stage {
      width: min(100%, 340px);
      justify-self: center;
    }
  }
  .native-control-note {
    color: var(--muted);
    font-size: var(--tv-body, 14px);
    line-height: 1.5;
  }
  .empty-stage {
    position: relative;
    isolation: isolate;
    overflow: hidden;
  }
  .empty-stage :global(.concert-scenery) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0.35;
    z-index: -1;
  }
  .next-track {
    flex-shrink: 0;
  }
  .empty-queue .button {
    margin-top: 20px;
  }
  .discovery .search-results {
    max-height: min(52dvh, 560px);
    overflow: auto;
    scrollbar-width: thin;
    scrollbar-gutter: stable;
  }
  @media (min-width: 1200px) {
    .workspace-expanded {
      display: grid;
      grid-template-columns: minmax(300px, 0.8fr) minmax(0, 1.2fr);
      align-items: start;
      gap: 24px;
    }
    .workspace-expanded .room-tabs,
    .workspace-expanded :global(.room-social),
    .workspace-expanded .room-bottom {
      grid-column: 1 / -1;
    }
    .workspace-expanded .room-tabs {
      margin-bottom: 0;
    }
    .workspace-expanded .discovery {
      position: sticky;
      top: 24px;
    }
  }
  .tv-mode {
    grid-template-columns: 1fr;
  }
  .tv-mode .sidebar,
  .tv-mode .topbar,
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
  .tv-mode .queue-panel,
  .tv-mode .section-heading,
  .tv-mode .track-meta > .eyebrow,
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
