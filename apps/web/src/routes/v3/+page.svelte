<script lang="ts">
  import { onMount } from 'svelte';
  import { createRoomClient, type RoomClientState } from '#lib/room-client.ts';
  import Icon from '#lib/Icon.svelte';
  import RoomAudio from '#lib/RoomAudio.svelte';
  import { time } from '../../../../../lib/types.ts';
  import '../../app.css';

  let client: ReturnType<typeof createRoomClient> | undefined;
  let view = $state<RoomClientState>({
    room: null,
    connection: 'idle',
    live: false,
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
  let seekValue = $state<number | null>(null);
  let tick = $state(0);
  const room = $derived(view.room);
  const target = $derived.by(() => {
    void tick;
    return client?.playback() ?? { position: 0, playing: false, stale: false };
  });
  const classic = $derived(
    room ? `/?classic=1&room=${encodeURIComponent(room.code)}` : '/?classic=1',
  );
  const connected = $derived(view.connection === 'connected' && !target.stale);
  onMount(() => {
    client = createRoomClient();
    const unsubscribe = client.subscribe((value) => {
      view = value;
    });
    const initial = new URL(location.href).searchParams.get('room');
    if (initial) void client.join(initial);
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
    if (await client?.create(roomName.trim() || 'The listening room')) rememberRoom();
  }
  function rememberRoom() {
    if (!view.room) return;
    const url = new URL(location.href);
    url.searchParams.set('room', view.room.code);
    history.replaceState(history.state, '', url);
  }
  async function share() {
    try {
      await navigator.clipboard.writeText(location.href);
      copied = true;
    } catch {
      copied = false;
    }
  }
  function leave() {
    client?.leave();
    copied = false;
    seekValue = null;
    history.replaceState(history.state, '', '/v3');
  }
  function goHome(event: MouseEvent) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    leave();
  }
</script>

<svelte:head>
  <title>{room ? `${room.name} · Afterparty` : 'Your music. Your people. · Afterparty'}</title>
  <meta
    name="description"
    content="A listening room for your people. Find a song, build a queue and listen together with Afterparty."
  />
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<a class="skip-link" href="#main">Skip to music</a>
<div class="app-shell">
  <aside class="sidebar">
    <a class="brand" href="/v3" aria-label="Afterparty home" onclick={goHome}
      ><img src="/afterparty-mark.svg" width="42" height="42" alt="" /><span
        >afterparty<span class="red">.</span></span
      ></a
    >
    <p class="nav-label">YOUR SPACE</p>
    <nav aria-label="Main navigation">
      <a class="nav-link active" href="/v3" aria-current="page" onclick={goHome}
        ><Icon name="headphones" />Listening room</a
      >
      <a class="nav-link" href={classic} data-sveltekit-reload
        ><Icon name="music" />Classic Afterparty<Icon name="arrow" size={16} /></a
      >
      <a class="nav-link" href="/admin" data-sveltekit-reload
        ><Icon name="settings" />Server settings</a
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
        <span class="status-dot" class:online={connected}></span>{connected
          ? view.live
            ? 'Live'
            : 'Connected'
          : view.connection === 'reconnecting' || target.stale
            ? 'Reconnecting…'
            : view.connection === 'connecting'
              ? 'Connecting…'
              : 'Make yourself at home'}
      </div>
    </header>
    <main id="main">
      {#if !room}
        <section class="welcome">
          <p class="eyebrow red">GOOD MUSIC NEEDS GOOD COMPANY</p>
          <h1>Your music.<br />Your people<span class="red">.</span></h1>
          <p class="intro">One room. One shared queue. A soundtrack you make together.</p>
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
              <button
                class="button primary"
                disabled={view.busy || view.connection === 'connecting'}
                >Create private room <Icon name="arrow" /></button
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
                disabled={view.busy || view.connection === 'connecting'}
                >Join room <Icon name="arrow" /></button
              >
            </form>
          </div>
          <div class="welcome-foot">
            <span>PRIVATE BY DEFAULT</span><span>SHARED IN REAL TIME</span><span
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
            <button class="button secondary" onclick={leave}>Leave room</button><button
              class="button secondary invite"
              onclick={share}
              ><Icon name="link" />{copied ? 'Link copied' : 'Invite friends'}<span
                class="room-code">{room.code}</span
              ></button
            >
          </div>
        </section>
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
                />{/key}
              <div class="track-meta">
                <span class="eyebrow red"
                  >{room.current.live ? 'LIVE' : 'THE CURRENT SOUNDTRACK'}</span
                >
                <h2>{room.current.title}</h2>
                <p>{room.current.artist}</p>
              </div>
              <div class="transport">
                <button
                  class="play-control"
                  aria-label={room.playing ? 'Pause playback' : 'Resume playback'}
                  disabled={!room.isHost || view.busy || !connected}
                  onclick={() => {
                    void client?.control(room.playing ? 'pause' : 'play');
                  }}><Icon name={room.playing ? 'pause' : 'play'} size={24} /></button
                ><button
                  class="icon-button"
                  aria-label="Next track"
                  disabled={!room.isHost || view.busy || !connected}
                  onclick={() => {
                    void client?.control('next');
                  }}><Icon name="next" /></button
                >
                <div class="timeline">
                  <label class="sr-only" for="seek">Playback position</label><input
                    id="seek"
                    type="range"
                    min="0"
                    max={Math.max(1, room.current.duration)}
                    step="1"
                    value={seekValue ?? Math.min(target.position, room.current.duration)}
                    disabled={!room.isHost || room.current.live || view.busy || !connected}
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
                </div>
              </div>
              {#if !room.isHost}<p class="permission-note">
                  The host controls playback. Everyone can add to the queue.
                </p>{/if}
            {:else}
              <div class="empty-stage">
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
                  </li>{/each}
              </ol>
            {:else}<div class="empty-queue">
                <Icon name="music" size={30} />
                <h3>Room for your next favourite</h3>
                <p>Add a song below.<br />The best queues are a group effort.</p>
              </div>{/if}
            <div class="queue-footer">
              <span class="status-dot online"></span>One queue. Everyone in sync.
            </div>
          </section>
        </div>
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
                  <span class="duration">{video.live ? 'LIVE' : time(video.duration)}</span><button
                    class="icon-button add-track"
                    aria-label={`Add ${video.title} to queue`}
                    disabled={view.busy || !connected || video.embeddable === false}
                    onclick={() => {
                      void client?.add(video.id);
                    }}><Icon name="add" /></button
                  >
                </li>{/each}
            </ul>{/if}
        </section>
        <div class="room-bottom">
          <span>KEEP THE GOOD MUSIC GOING.</span><a href={classic} data-sveltekit-reload
            >Radio, playlists & more in Classic <Icon name="arrow" size={16} /></a
          >
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
      <span>afterparty<span class="red">.</span></span><span>YOUR MUSIC. YOUR PEOPLE.</span>
    </footer>
  </div>
</div>
