<script lang="ts">
  import { onMount, tick as afterRender } from 'svelte';
  import { replaceState } from '$app/navigation';
  import GameAudio from '#lib/GameAudio.svelte';
  import Icon from '#lib/Icon.svelte';
  import { createGameClient, type GameScope, type GameView } from '#lib/game-client.ts';
  import { createRoomClient } from '#lib/room-client.ts';
  import {
    gamePresets,
    presetSettings,
    rankPlayers,
    validGameSettings,
  } from '#lib/game-experience.ts';
  import { browserStorage } from '../../../../../lib/browser-storage.ts';
  import { guessAvailability } from '../../../../../lib/guess-availability.ts';
  import type { GuessSettings } from '../../../../../services/core/src/guess-game.ts';

  let mounted = $state(false),
    hosting = $state(false),
    lobbyError = $state('');
  let code = $state(''),
    guild = $state(''),
    nickname = $state(''),
    answer = $state('');
  let scope = $state<GameScope | null>(null);
  let client: ReturnType<typeof createGameClient> | undefined;
  let creatingRoom: ReturnType<typeof createRoomClient> | undefined;
  let view = $state<GameView>({ data: null, ready: false, busy: false, error: '', signIn: false });
  let tick = $state(0),
    dirty = $state(false),
    base = $state(0),
    category = $state('');
  let audioEnabled = $state(false),
    copied = $state(false),
    inviteUrl = $state(''),
    advanced = $state(false);
  let stageHeading = $state<HTMLHeadingElement>();
  let previousStage = '';
  let settings = $state<GuessSettings>({
    durationSeconds: 30,
    roundCount: 5,
    maxPoints: 1000,
    minPoints: 100,
    hints: true,
    answerMode: 'title',
  });
  const game = $derived(view.data?.game),
    round = $derived(game?.round);
  const now = $derived.by(() => {
    void tick;
    return client?.clock() ?? 0;
  });
  const remaining = $derived(
    round && game
      ? Math.min(game.settings.durationSeconds, Math.max(0, (round.deadline - now) / 1000))
      : 0,
  );
  const elapsed = $derived(round ? Math.max(0, (now - round.startsAt) / 1000) : 0);
  const countdown = $derived(round ? Math.max(0, Math.ceil((round.startsAt - now) / 1000)) : 0);
  const chosenCategory = $derived(game?.categories.find((item) => item.id === category));
  const availability = $derived(
    guessAvailability(chosenCategory, settings.durationSeconds, settings.roundCount),
  );
  const stale = $derived(dirty && base !== game?.revision);
  const disabled = $derived(!view.ready || view.busy);
  const players = $derived(rankPlayers(game?.scoreboard ?? []));
  const self = $derived(players.find((player) => player.id === view.data?.self.participantId));
  const answered = $derived(Boolean(self?.hasAnswered));
  const winners = $derived(players.filter((player) => player.rank === 1 && player.total > 0));
  const points = $derived(
    game && round
      ? Math.max(
          game.settings.minPoints,
          Math.round(
            game.settings.maxPoints -
              (game.settings.maxPoints - game.settings.minPoints) *
                Math.min(1, elapsed / game.settings.durationSeconds),
          ),
        )
      : 0,
  );
  const lastRound = $derived(Boolean(game && game.roundNumber >= game.settings.roundCount));
  let unsubscribe: (() => void) | undefined;

  $effect(() => {
    if (!game) return;
    const key = `${game.sessionId}:${game.round?.roundId ?? ''}:${game.phase}`;
    if (key !== previousStage) {
      previousStage = key;
      answer = '';
      void afterRender().then(() => stageHeading?.focus({ preventScroll: true }));
    }
  });
  function useLatest() {
    if (!game) return;
    settings = { ...game.settings };
    category = game.categoryId;
    base = game.revision;
    dirty = false;
  }
  function edit() {
    if (!dirty) base = game?.revision ?? 0;
    dirty = true;
  }
  function preset(id: string) {
    const next = presetSettings(id, chosenCategory, settings);
    if (next) {
      edit();
      settings = next;
    }
  }
  function changeCategory(value: string) {
    edit();
    category = value;
    const next =
      presetSettings(
        'party',
        game?.categories.find((item) => item.id === value),
        settings,
      ) ??
      presetSettings(
        'quick',
        game?.categories.find((item) => item.id === value),
        settings,
      );
    if (next) settings = next;
  }
  function leave() {
    unsubscribe?.();
    client?.destroy();
    client = undefined;
    scope = null;
    view = { data: null, ready: false, busy: false, error: '', signIn: false };
    answer = '';
    dirty = false;
    audioEnabled = false;
    previousStage = '';
    copied = false;
    inviteUrl = '';
  }
  function join() {
    if (hosting) return;
    leave();
    lobbyError = '';
    scope = {
      scope: guild ? 'guild' : 'room',
      scopeId: guild || code.trim().toUpperCase(),
      nickname,
    };
    if (!/^(?:[A-Z0-9]{8}|\d{14,22})$/.test(scope.scopeId)) {
      leave();
      lobbyError = 'Enter the eight-character room code from your invite.';
      return;
    }
    const url = new URL('/games', location.origin);
    url.searchParams.set(guild ? 'guild' : 'room', scope.scopeId);
    inviteUrl = url.href;
    void replaceState(url, {});
    if (nickname.trim()) browserStorage.set('afterparty-display-name', nickname.trim());
    client = createGameClient(scope);
    unsubscribe = client.subscribe((state) => {
      view = state;
      if (state.data && !dirty) {
        settings = { ...state.data.game.settings };
        category = state.data.game.categoryId;
        base = state.data.game.revision;
      }
    });
    client.start();
  }
  async function hostGame() {
    if (hosting || !mounted) return;
    hosting = true;
    lobbyError = '';
    const creator = createRoomClient();
    creatingRoom = creator;
    let message = '';
    const stop = creator.subscribe((value) => {
      message = value.error;
    });
    try {
      if (
        !(await creator.create(nickname.trim() ? `${nickname.trim()}'s game night` : 'Game night'))
      )
        throw Error(message || 'Your game room could not be created. Try again.');
      if (creatingRoom !== creator || !mounted) return;
      let created = '';
      const read = creator.subscribe((value) => {
        created = value.room?.code ?? '';
      });
      read();
      code = created;
      guild = '';
      hosting = false;
      join();
    } catch (error) {
      if (mounted)
        lobbyError = error instanceof Error ? error.message : 'Your game could not start.';
    } finally {
      stop();
      creator.destroy();
      if (creatingRoom === creator) creatingRoom = undefined;
      hosting = false;
    }
  }
  async function act(action: string, fields: Record<string, unknown> = {}) {
    const result = await client?.act(action, fields);
    if (result && action === 'guess') answer = '';
    if (result && action === 'configure') useLatest();
    return result;
  }
  async function startGame() {
    if (disabled || stale || !availability.canStart || !validGameSettings(settings) || !client)
      return;
    if (
      dirty &&
      !(await act('configure', { settings: { ...settings }, categoryId: category, revision: base }))
    )
      return;
    await act('start');
  }
  async function share() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      copied = true;
    } catch {
      copied = false;
    }
  }
  onMount(() => {
    mounted = true;
    nickname = (browserStorage.get('afterparty-display-name') ?? '').slice(0, 24);
    const query = new URLSearchParams(location.search),
      room = query.get('room') ?? '',
      server = query.get('guild') ?? '';
    if (/^[A-Za-z0-9]{8}$/.test(room)) code = room.toUpperCase();
    if (/^\d{14,22}$/.test(server)) guild = server;
    const timer = setInterval(() => tick++, 250);
    const reconnect = () => client?.reconnect();
    document.addEventListener('visibilitychange', reconnect);
    window.addEventListener('offline', reconnect);
    window.addEventListener('online', reconnect);
    return () => {
      mounted = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', reconnect);
      window.removeEventListener('offline', reconnect);
      window.removeEventListener('online', reconnect);
      creatingRoom?.destroy();
      leave();
    };
  });
</script>

<svelte:head
  ><title
    >{game?.phase === 'round' ? `Round ${game.roundNumber} · ` : ''}Guess the song · Afterparty</title
  ><meta
    name="description"
    content="A music quiz for your people. Pick a soundtrack, invite friends and race to name the song."
  /></svelte:head
>
<a class="skip" href="#game">Skip to game</a>
<div class="game-shell">
  <header class="game-header">
    <a class="brand" href="/v3" aria-label="Afterparty home"
      ><img src="/afterparty-mark.svg" width="34" height="34" alt="" /><span
        >afterparty<span class="red">.</span></span
      ></a
    ><a class="back" href={scope?.scope === 'room' ? `/v3?room=${scope.scopeId}` : '/v3'}
      >Back to music <Icon name="arrow" size={16} /></a
    >
  </header>
  <main id="game">
    {#if !scope}
      <section class="welcome">
        <p class="eyebrow red">THE MUSIC QUIZ / AFTERPARTY</p>
        <h1>Know the song.<br />Own the night<span class="red">.</span></h1>
        <p class="intro">
          That first note. The scramble for the title. The friend who somehow knows every song.
          Bring them all.
        </p>
        <div class="entry-grid">
          <section class="entry-card">
            <span class="step">01 / YOUR PEOPLE</span>
            <h2>Make it a game night.</h2>
            <p>Start a private room, send the invite and pick your soundtrack together.</p>
            <label for="nickname">Nickname</label><input
              id="nickname"
              bind:value={nickname}
              maxlength="24"
              placeholder="What should we call you?"
              autocomplete="nickname"
            /><button class="primary" disabled={!mounted || hosting} onclick={() => void hostGame()}
              >{hosting ? 'Creating your room…' : 'Host a game'}<Icon
                name="arrow"
                size={18}
              /></button
            >
          </section>
          <form
            class="entry-card"
            onsubmit={(event) => {
              event.preventDefault();
              join();
            }}
          >
            <span class="step">02 / ALREADY INVITED?</span>
            <h2>Your friends are waiting.</h2>
            <p>Use their room code. Everyone gets their own score and a place on the board.</p>
            {#if guild}<p class="scope-note">Playing with your Discord server.</p>{:else}<label
                for="room-code">Room code</label
              ><input
                id="room-code"
                bind:value={code}
                required
                minlength="8"
                maxlength="8"
                pattern={'[A-Za-z0-9]{8}'}
                placeholder="8-character code"
                autocapitalize="characters"
                autocomplete="off"
              />{/if}<button disabled={!mounted || hosting}
              >Join lobby<Icon name="users" size={18} /></button
            >
          </form>
        </div>
        {#if lobbyError}<p role="alert" class="notice">{lobbyError}</p>{/if}
        <div class="how-it-works">
          <span><b>01</b> Hear the song</span><span><b>02</b> Beat the clock</span><span
            ><b>03</b> Claim the bragging rights</span
          >
        </div>
      </section>
    {:else}
      <div class="room-bar">
        <div>
          <span class="eyebrow red">GUESS THE SONG</span>
          <p>
            {scope.scope === 'room' ? 'Room' : 'Server'} <strong>{scope.scopeId}</strong><span
              class="connection"
              class:online={view.ready}>{view.ready ? 'Connected' : 'Connecting'}</span
            >
          </p>
        </div>
        <div class="actions">
          <button class="subtle" onclick={() => void share()}
            >{copied ? 'Invite copied' : 'Invite friends'}<Icon name="link" size={16} /></button
          ><button class="subtle" onclick={leave}>Leave game</button>
        </div>
      </div>
      {#if inviteUrl}<details class="invite">
          <summary>Game invite link</summary><input
            aria-label="Game invite link"
            readonly
            value={inviteUrl}
            onclick={(event) => event.currentTarget.select()}
          />
        </details>{/if}
      {#if view.error}<div class="notice" role="status">
          {view.error}<button class="subtle" onclick={() => client?.reconnect()}
            >Reconnect game</button
          >{#if view.signIn}<a href="/api/auth/discord" data-sveltekit-reload
              >Sign in with Discord</a
            >{/if}
        </div>{/if}
      {#if !game}<div class="joining" role="status">
          <div class="record"></div>
          <h1>{view.error ? 'This game isn’t ready yet.' : 'Finding your people…'}</h1>
          <p>
            {view.error
              ? 'Check the invite, then reconnect or return to your host.'
              : 'Your game lobby is on its way.'}
          </p>
        </div>{:else}
        <div class="game-grid">
          <section class="stage" aria-label="Guess the song round">
            <div class="stage-top">
              <span class="eyebrow"
                >{game.phase === 'lobby'
                  ? 'BEFORE THE FIRST NOTE'
                  : game.phase === 'round'
                    ? 'LISTEN & GUESS'
                    : game.phase === 'reveal'
                      ? 'THE REVEAL'
                      : 'THE FINAL SCORES'}</span
              ><span
                >{game.phase === 'lobby'
                  ? `${players.length} ${players.length === 1 ? 'player' : 'players'}`
                  : `Round ${game.roundNumber}/${game.settings.roundCount}`}</span
              >
            </div>
            {#if game.phase === 'lobby'}
              <h1 bind:this={stageHeading} tabindex="-1">
                {view.data?.canManage ? 'Set the mood.' : 'Get comfortable.'}
              </h1>
              <p class="stage-intro">
                {view.data?.canManage
                  ? 'Pick a soundtrack and a pace. We’ll handle the scorekeeping.'
                  : 'The host is picking your soundtrack. Your spot on the board is ready.'}
              </p>
              {#if game.categories.some((item) => item.id === 'synthetic-test')}<p
                  class="notice compact"
                >
                  Audio check mode uses generated tones and fictional songs. Choose a music category
                  for a music quiz.
                </p>{/if}
              {#if view.data?.canManage}
                <label for="category">Your soundtrack</label><select
                  id="category"
                  value={category}
                  {disabled}
                  onchange={(event) => changeCategory(event.currentTarget.value)}
                  >{#each game.categories as item}<option value={item.id}
                      >{item.name}{item.available ? '' : ' · Not loaded'}</option
                    >{/each}</select
                >
                <div class="presets" role="group" aria-label="Game pace">
                  {#each gamePresets as option}<button
                      class="preset"
                      class:selected={settings.durationSeconds === option.seconds &&
                        settings.roundCount ===
                          presetSettings(option.id, chosenCategory, settings)?.roundCount}
                      aria-pressed={settings.durationSeconds === option.seconds &&
                        settings.roundCount ===
                          presetSettings(option.id, chosenCategory, settings)?.roundCount}
                      disabled={disabled || !presetSettings(option.id, chosenCategory, settings)}
                      onclick={() => preset(option.id)}
                      ><span>{option.name}</span><strong
                        >{option.seconds}s
                        <small
                          >× {presetSettings(option.id, chosenCategory, settings)?.roundCount ??
                            option.rounds} rounds</small
                        ></strong
                      >
                      <p>{option.description}</p></button
                    >{/each}
                </div>
                <details class="advanced" bind:open={advanced}>
                  <summary>Fine-tune the game <span>Timing, hints & scoring</span></summary>
                  <form
                    onsubmit={(event) => {
                      event.preventDefault();
                      if (!stale)
                        void act('configure', { settings, categoryId: category, revision: base });
                    }}
                  >
                    <fieldset {disabled}>
                      <legend class="sr-only">Game settings</legend><label
                        >Answer mode<select
                          bind:value={settings.answerMode}
                          onchange={edit}
                          disabled={game.settings.answerMode === undefined}
                          ><option value="title">Song title</option><option value="artist"
                            >Artist name</option
                          ></select
                        ></label
                      >
                      <div class="settings-grid">
                        <label
                          >Round seconds<input
                            type="number"
                            min="15"
                            max={availability.maxDurationSeconds}
                            step="1"
                            required
                            bind:value={settings.durationSeconds}
                            oninput={edit}
                          /></label
                        ><label
                          >Rounds<input
                            type="number"
                            min="1"
                            max={Math.max(1, availability.maxRounds)}
                            step="1"
                            required
                            bind:value={settings.roundCount}
                            oninput={edit}
                          /></label
                        ><label
                          >Starting points<input
                            type="number"
                            min="100"
                            max="2000"
                            step="1"
                            required
                            bind:value={settings.maxPoints}
                            oninput={edit}
                          /></label
                        ><label
                          >Minimum points<input
                            type="number"
                            min="0"
                            max={settings.maxPoints}
                            step="1"
                            required
                            bind:value={settings.minPoints}
                            oninput={edit}
                          /></label
                        >
                      </div>
                      <label class="toggle"
                        ><input type="checkbox" bind:checked={settings.hints} onchange={edit} />Late
                        hints</label
                      ><button
                        class="subtle"
                        disabled={disabled || stale || !dirty || !validGameSettings(settings)}
                        >Save settings</button
                      >
                    </fieldset>
                  </form>
                </details>
                {#if stale}<p class="notice" role="status">
                    The lobby changed while you edited.<button onclick={useLatest}
                      >Use latest settings</button
                    >
                  </p>{/if}
              {:else}<div class="guest-summary">
                  <span>YOUR SOUNDTRACK</span>
                  <h2>{chosenCategory?.name ?? 'The host’s choice'}</h2>
                  <p>
                    {settings.roundCount} rounds · {settings.durationSeconds} seconds · {settings.answerMode ===
                    'artist'
                      ? 'Name the artist'
                      : 'Name the song'}
                  </p>
                </div>{/if}
              {#if !availability.canStart}<div class="source-status" role="status">
                  <h3>
                    {view.data?.sourceState === 'loading'
                      ? 'Finding your soundtrack…'
                      : 'We need some songs first.'}
                  </h3>
                  <p>
                    {view.data?.sourceState === 'loading'
                      ? 'The host can start once the song library is ready.'
                      : view.data?.canManage
                        ? 'Load songs or choose a category with recordings that fit your game.'
                        : 'Your host needs to load songs or choose another category.'}
                  </p>
                  {#if view.data?.canManage && view.data.canPrepare && view.data.sourceState !== 'ready'}<button
                      disabled={disabled || view.data.sourceState === 'loading'}
                      onclick={() => void act('prepare')}
                      >{view.data.sourceState === 'loading'
                        ? 'Loading quiz songs…'
                        : 'Load quiz songs'}</button
                    >{/if}
                </div>{/if}
              <div class="start-bar">
                <div>
                  <strong>{settings.roundCount} rounds · {settings.durationSeconds}s each</strong>
                  <p>
                    {settings.answerMode === 'artist' ? 'Guess the artist' : 'Guess the song'} · {settings.hints
                      ? 'Late hints on'
                      : 'No hints'}
                  </p>
                </div>
                {#if view.data?.canManage}<button
                    class="primary"
                    disabled={disabled ||
                      stale ||
                      !availability.canStart ||
                      !validGameSettings(settings)}
                    onclick={() => void startGame()}
                    >{view.busy ? 'Getting ready…' : 'Start game'}<Icon
                      name="play"
                      size={18}
                    /></button
                  >{:else}<span class="waiting">Waiting for the host</span>{/if}
              </div>
            {:else if game.phase === 'round' && round}
              <div class="round-visual" class:counting={countdown > 0} class:solved={answered}>
                <div class="record">
                  <span>{countdown > 0 ? countdown : answered ? '✓' : 'ap.'}</span>
                </div>
                <span class="eyebrow"
                  >{countdown > 0
                    ? 'HERE IT COMES'
                    : answered
                      ? 'YOU FOUND IT'
                      : 'TRUST YOUR EARS'}</span
                >
              </div>
              <div class="round-title">
                <h1 bind:this={stageHeading} tabindex="-1">
                  {countdown > 0
                    ? 'Get ready.'
                    : answered
                      ? 'That’s the one.'
                      : game.settings.answerMode === 'artist'
                        ? 'Who’s the artist?'
                        : 'What’s the song?'}
                </h1>
                <div class="countdown" class:urgent={remaining <= 10 && countdown === 0}>
                  <strong>{Math.ceil(remaining).toString().padStart(2, '0')}</strong><span
                    >seconds</span
                  >
                </div>
              </div>
              <progress
                aria-label="Round time remaining"
                max={game.settings.durationSeconds}
                value={remaining}
              ></progress>
              <div class="round-stats">
                <span
                  >{answered
                    ? `${view.data?.self.result?.awarded ?? 0} points earned`
                    : `${points} points up for grabs`}</span
                ><span>{game.answeredCount}/{players.length} found it</span>
              </div>
              {#key `${game.sessionId}:${round.roundId}`}<GameAudio
                  available={view.data?.mediaAvailable === true}
                  active={view.ready && remaining > 0 && now >= round.startsAt}
                  {elapsed}
                  autoPlay={audioEnabled}
                  onEnabled={() => {
                    audioEnabled = true;
                  }}
                  onDisabled={() => {
                    audioEnabled = false;
                  }}
                  fetchAudio={(signal) => client!.media(signal)}
                />{/key}
              {#if answered}<div class="correct" role="status">
                  <span>✓</span>
                  <div>
                    <strong>Correct! +{view.data?.self.result?.awarded ?? 0} points</strong>
                    <p>Sit tight. Let’s see who else gets it.</p>
                  </div>
                </div>{:else}<form
                  class="answer"
                  onsubmit={(event) => {
                    event.preventDefault();
                    if (!disabled && remaining > 0 && now >= round.startsAt && answer.trim())
                      void act('guess', { text: answer });
                  }}
                >
                  <label for="answer"
                    >{game.settings.answerMode === 'artist' ? 'Artist name' : 'Song title'}</label
                  >
                  <div>
                    <input
                      id="answer"
                      bind:value={answer}
                      maxlength="120"
                      autocomplete="off"
                      placeholder={game.settings.answerMode === 'artist'
                        ? 'You know this voice…'
                        : 'It’s on the tip of your tongue…'}
                      disabled={disabled || remaining <= 0 || countdown > 0}
                    /><button
                      class="primary"
                      disabled={disabled || remaining <= 0 || countdown > 0 || !answer.trim()}
                      >{view.busy ? 'Sending…' : 'Submit answer'}</button
                    >
                  </div>
                  {#if view.data?.self.result && !view.data.self.result.correct}<p
                      class="feedback"
                      role="status"
                    >
                      Not quite. Take another shot.
                    </p>{/if}
                </form>{/if}
              <div class="hints" aria-live="polite">
                {#if round.hints.artistInitial}<span
                    >Artist starts with <strong>{round.hints.artistInitial}</strong></span
                  >{/if}{#if round.hints.titleWordCount}<span
                    ><strong>{round.hints.titleWordCount}</strong> words in the title</span
                  >{/if}{#if round.hints.artistWordCount}<span
                    ><strong>{round.hints.artistWordCount}</strong> words in the artist name</span
                  >{/if}
              </div>
              {#if remaining <= 0}<p role="status" class="notice">
                  Time’s up. Waiting for the reveal…
                </p>{/if}
              <div class="round-footer">
                {#if typeof round.skipVotes === 'number' && typeof round.skipRequired === 'number'}<button
                    class="text-button"
                    disabled={disabled ||
                      view.data?.self.skipVoted ||
                      remaining <= 0 ||
                      countdown > 0}
                    onclick={() => void act('skip')}
                    >{view.data?.self.skipVoted ? 'Skip vote counted' : 'Stuck? Vote to skip'} ({round.skipVotes}/{round.skipRequired})</button
                  >{/if}{#if view.data?.canManage}<button
                    class="subtle"
                    {disabled}
                    onclick={() => void act('reveal')}>Reveal answer</button
                  >{/if}
              </div>
            {:else if game.phase === 'reveal'}
              <div class="reveal-icon" aria-hidden="true"><Icon name="music" size={38} /></div>
              <p class="eyebrow red">
                {game.settings.answerMode === 'artist' ? 'THE ARTIST WAS' : 'THE SONG WAS'}
              </p>
              <h1 class="revealed-title" bind:this={stageHeading} tabindex="-1">
                {game.settings.answerMode === 'artist'
                  ? (round?.answer?.artist ?? 'Waiting for the reveal…')
                  : (round?.answer?.title ?? 'Waiting for the reveal…')}
              </h1>
              <p class="artist">
                {game.settings.answerMode === 'artist'
                  ? round?.answer?.title
                  : round?.answer?.artist}
              </p>
              <div class="reveal-summary">
                <strong>{game.answeredCount}</strong><span
                  >{game.answeredCount === 1
                    ? 'person got it right.'
                    : 'people got it right.'}<small
                    >{answered
                      ? 'Including you. Nicely done.'
                      : 'The next one could be yours.'}</small
                  ></span
                >
              </div>
              {#if view.data?.canManage}<button
                  class="primary next"
                  {disabled}
                  onclick={() => void act('next')}
                  >{lastRound ? 'Show final scores' : 'Next round'}<Icon name="arrow" /></button
                >{:else}<p class="waiting">
                  {lastRound ? 'Final scores coming up…' : 'The host will start the next round.'}
                </p>{/if}
            {:else if game.phase === 'results'}
              <p class="eyebrow red">THE BRAGGING RIGHTS GO TO</p>
              <h1 bind:this={stageHeading} tabindex="-1">
                {winners.length === 1
                  ? `${winners[0].nickname}.`
                  : winners.length > 1
                    ? 'The joint champions.'
                    : 'The next game.'}
              </h1>
              <p class="stage-intro">
                {winners.length > 1
                  ? winners.map((player) => player.nickname).join(' · ')
                  : winners.length === 1
                    ? `${winners[0].total.toLocaleString()} points. A soundtrack well played.`
                    : 'No points this time. New soundtrack, fresh start?'}
              </p>
              <div class="podium">
                {#each players.slice(0, 3) as player (player.id)}<div
                    class:champion={player.rank === 1 && player.total > 0}
                  >
                    <span>#{player.rank}</span>
                    <h2>{player.nickname}</h2>
                    <strong>{player.total.toLocaleString()}</strong>
                    <p>{player.id === view.data?.self.participantId ? 'That’s you' : 'points'}</p>
                  </div>{/each}
              </div>
              {#if view.data?.canManage}<button
                  class="primary next"
                  {disabled}
                  onclick={() => void act('reset')}>Back to lobby<Icon name="arrow" /></button
                >{:else}<p class="waiting">The host can set up another game.</p>{/if}
            {/if}
            {#if view.data?.canManage && ['round', 'reveal'].includes(game.phase)}<details
                class="host-tools"
              >
                <summary>Host controls</summary><button
                  class="subtle"
                  {disabled}
                  onclick={() => {
                    if (confirm('End this game and show the final scores?')) void act('end');
                  }}>End game</button
                >
              </details>{/if}
          </section>
          <aside class="leaderboard" aria-label="Leaderboard">
            <div class="board-heading">
              <h2>{game.phase === 'results' ? 'Final standings' : 'The leaderboard'}</h2>
              <span>{players.length}</span>
            </div>
            <p class="board-intro">Fast ears. Faster answers.</p>
            <ol class="scores">
              {#each players as player (player.id)}<li
                  class:self={player.id === view.data?.self.participantId}
                >
                  <span class="rank">{String(player.rank).padStart(2, '0')}</span>
                  <div>
                    <strong>{player.nickname}</strong><small
                      >{player.id === view.data?.self.participantId
                        ? 'You'
                        : player.hasAnswered && game.phase === 'round'
                          ? 'Found it'
                          : 'In the game'}</small
                    >
                  </div>
                  <b>{player.total.toLocaleString()}</b
                  >{#if player.hasAnswered && game.phase === 'round'}<span
                      class="answered"
                      aria-label="Answered correctly">✓</span
                    >{/if}
                </li>{/each}
            </ol>
            <p class="board-note">
              {game.phase === 'lobby'
                ? 'Share the invite. There’s room for your rivals.'
                : self
                  ? `You’re #${self.rank}. Every song is another chance.`
                  : 'The next song could change everything.'}
            </p>
          </aside>
        </div>
      {/if}
    {/if}
  </main>
  <footer>
    <span>afterparty<span class="red">.</span></span><a href="/support">Need a hand?</a><span
      >GOOD MUSIC. FRIENDLY RIVALRIES.</span
    >
  </footer>
</div>

<style>
  :global(body) {
    margin: 0;
    background: #0b0b0d;
    color: #f2f1ef;
    font-family: Inter, Arial, sans-serif;
    color-scheme: dark;
  }
  @font-face {
    font-family: Inter;
    src: url('/fonts/inter-latin-wght-normal.woff2') format('woff2');
    font-weight: 100 900;
    font-display: swap;
  }
  * {
    box-sizing: border-box;
  }
  a {
    color: inherit;
    text-decoration: none;
  }
  h1,
  h2,
  h3,
  p {
    margin: 0;
  }
  button,
  input,
  select {
    font: inherit;
  }
  button,
  a,
  input,
  select {
    -webkit-tap-highlight-color: transparent;
  }
  .red {
    color: #ff3d52;
  }
  .game-shell {
    min-height: 100vh;
  }
  .game-header {
    max-width: 1400px;
    margin: auto;
    padding: 26px 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #29292f;
    gap: 20px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 23px;
    font-weight: 750;
    letter-spacing: -1px;
  }
  .brand img {
    flex-shrink: 0;
  }
  .back {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: #b5b2bd;
    min-height: 44px;
  }
  main {
    max-width: 1400px;
    margin: auto;
    padding: 40px 44px 70px;
  }
  .eyebrow,
  .step {
    font-size: 10px;
    letter-spacing: 1.8px;
    font-weight: 650;
    line-height: 1.7;
  }
  .welcome {
    padding-top: 32px;
  }
  .welcome h1 {
    font-size: clamp(48px, 7vw, 90px);
    line-height: 1.04;
    letter-spacing: -5px;
    margin: 24px 0;
  }
  .intro {
    max-width: 590px;
    color: #aaa6b2;
    font-size: 17px;
    line-height: 1.8;
  }
  .entry-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    max-width: 1000px;
    margin-top: 48px;
    border-top: 1px solid #303036;
  }
  .entry-card {
    padding: 32px 34px 15px 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .entry-card + .entry-card {
    padding: 32px 0 15px 34px;
    border-left: 1px solid #303036;
  }
  .step {
    color: #96919e;
  }
  .entry-card h2 {
    margin: 15px 0 12px;
    font-size: 25px;
    letter-spacing: -0.9px;
  }
  .entry-card p {
    color: #aaa6b2;
    font-size: 13px;
    line-height: 1.8;
    margin-bottom: 24px;
    max-width: 370px;
  }
  .entry-card button {
    margin-top: 14px;
    justify-content: space-between;
  }
  .entry-card input {
    width: 100%;
  }
  label {
    display: block;
    font-size: 12px;
    color: #d7d3dd;
    margin: 0 0 10px;
  }
  input,
  select {
    min-height: 48px;
    background: #151518;
    border: 1px solid #3c3942;
    border-radius: 6px;
    color: inherit;
    padding: 11px 14px;
    width: 100%;
  }
  select {
    cursor: pointer;
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 46px;
    padding: 12px 18px;
    border: 1px solid #3b3841;
    border-radius: 6px;
    background: #202024;
    color: #f2eff5;
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
  }
  button:hover {
    background: #2a282e;
  }
  button:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  button.primary {
    background: #ff263e;
    color: #100b0e;
    border-color: #ff263e;
  }
  button.primary:hover {
    background: #ff6274;
  }
  button.subtle {
    background: #18171b;
  }
  button:focus-visible,
  a:focus-visible,
  input:focus-visible,
  select:focus-visible,
  summary:focus-visible {
    outline: 2px solid #ff6274;
    outline-offset: 4px;
  }
  h1:focus {
    outline: none;
  }
  .how-it-works {
    display: flex;
    gap: 38px;
    margin-top: 32px;
    font-size: 11px;
    color: #aaa6b2;
    flex-wrap: wrap;
  }
  .how-it-works b {
    color: #ff6274;
    margin-right: 9px;
  }
  .room-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
  }
  .room-bar p {
    margin-top: 8px;
    font-size: 12px;
    color: #aaa6b2;
  }
  .room-bar strong {
    letter-spacing: 1px;
    color: #f2eff5;
    margin-left: 5px;
  }
  .connection {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: 18px;
    font-size: 10px;
  }
  .connection:before {
    content: '';
    width: 5px;
    height: 5px;
    background: #aaa6b2;
    border-radius: 50%;
  }
  .connection.online:before {
    background: #ff263e;
  }
  .actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .invite {
    margin-top: 15px;
    max-width: 600px;
  }
  summary {
    cursor: pointer;
    min-height: 44px;
    align-content: center;
    font-size: 12px;
    color: #aaa6b2;
  }
  .invite input {
    margin-top: 10px;
    font-size: 12px;
  }
  .game-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 32px;
    margin-top: 28px;
    align-items: start;
  }
  .stage {
    background: #111113;
    border: 1px solid #2b282f;
    padding: 34px;
    border-radius: 10px;
    min-width: 0;
  }
  .stage-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    color: #aaa6b2;
    font-size: 11px;
    margin-bottom: 30px;
  }
  .stage-top .eyebrow {
    font-size: 9px;
  }
  .stage h1 {
    font-size: clamp(32px, 4vw, 50px);
    line-height: 1.15;
    letter-spacing: -1.8px;
    overflow-wrap: anywhere;
  }
  .stage-intro {
    color: #aaa6b2;
    font-size: 13px;
    line-height: 1.8;
    margin: 15px 0 28px;
    max-width: 510px;
  }
  .stage > select {
    margin-bottom: 22px;
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin: 0 0 24px;
  }
  button.preset {
    display: block;
    text-align: left;
    min-width: 0;
    padding: 20px 15px;
    background: #17161a;
    border-color: #343039;
  }
  .preset.selected {
    border-color: #ff3d52;
    background: #24151b;
  }
  .preset > span {
    font-size: 12px;
    font-weight: 650;
  }
  .preset strong {
    display: block;
    font-size: 29px;
    letter-spacing: -1px;
    margin: 16px 0 10px;
  }
  .preset small {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0;
    color: #c0bac9;
  }
  .preset p {
    color: #aaa6b2;
    font-size: 10px;
    line-height: 1.7;
    font-weight: 400;
  }
  .advanced {
    border-top: 1px solid #2b282f;
    border-bottom: 1px solid #2b282f;
    margin-bottom: 24px;
  }
  .advanced summary {
    padding: 16px 0;
    color: #ddd7e4;
    font-size: 12px;
  }
  .advanced summary span {
    margin-left: 18px;
    color: #8d8797;
    font-size: 10px;
  }
  .advanced form {
    padding: 15px 0 24px;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  .settings-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px 14px;
    margin: 18px 0;
  }
  .settings-grid input {
    margin-top: 9px;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .toggle input {
    width: 18px;
    min-height: 18px;
    accent-color: #ff263e;
  }
  .start-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    margin-top: 28px;
    flex-wrap: wrap;
  }
  .start-bar strong {
    font-size: 13px;
  }
  .start-bar p {
    color: #aaa6b2;
    font-size: 11px;
    margin-top: 8px;
  }
  .waiting {
    font-size: 12px;
    color: #b8b0c1;
    line-height: 1.8;
  }
  .notice,
  .source-status {
    padding: 18px;
    background: #21171d;
    border: 1px solid #583444;
    border-radius: 7px;
    font-size: 12px;
    line-height: 1.8;
    margin: 20px 0;
  }
  .notice button,
  .notice a {
    margin: 8px 0 0 14px;
  }
  .notice.compact {
    padding: 12px 15px;
    font-size: 11px;
  }
  .source-status h3 {
    font-size: 15px;
  }
  .source-status p {
    color: #c8becc;
    margin: 8px 0 15px;
  }
  .guest-summary {
    padding: 25px;
    border: 1px solid #353039;
    background: #18151a;
    border-radius: 8px;
  }
  .guest-summary > span {
    font-size: 9px;
    color: #a99cb2;
    letter-spacing: 1.5px;
  }
  .guest-summary h2 {
    margin: 12px 0;
    font-size: 26px;
    letter-spacing: -1px;
  }
  .guest-summary p {
    font-size: 12px;
    color: #bcb2c5;
    line-height: 1.7;
  }
  .round-visual {
    display: flex;
    align-items: center;
    gap: 22px;
    margin: 14px 0 28px;
  }
  .record {
    width: 96px;
    height: 96px;
    flex-shrink: 0;
    border-radius: 50%;
    background: repeating-radial-gradient(circle, #17161a 0 4px, #28252c 5px 6px);
    display: grid;
    place-items: center;
    border: 1px solid #37313b;
  }
  .record span {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    background: #ff263e;
    display: grid;
    place-items: center;
    font-size: 23px;
    font-weight: 750;
    color: #100b0d;
    letter-spacing: -2px;
  }
  .round-visual.solved .record span {
    background: #e9e6df;
    font-size: 27px;
    letter-spacing: 0;
  }
  .round-visual > .eyebrow {
    color: #b1a3ba;
  }
  .round-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 26px;
  }
  .countdown {
    text-align: right;
    flex-shrink: 0;
  }
  .countdown strong {
    display: block;
    font-size: 56px;
    font-weight: 600;
    line-height: 1;
    letter-spacing: -3px;
    font-variant-numeric: tabular-nums;
  }
  .countdown span {
    font-size: 10px;
    color: #aaa6b2;
  }
  .countdown.urgent strong {
    color: #ff6274;
  }
  progress {
    appearance: none;
    width: 100%;
    height: 5px;
    accent-color: #ff263e;
    display: block;
    border: 0;
  }
  .round-stats {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: #bcb3c5;
    margin: 12px 0 25px;
    gap: 16px;
  }
  .answer {
    margin: 28px 0 10px;
  }
  .answer > div {
    display: flex;
    gap: 10px;
  }
  .answer input {
    flex: 1;
    min-width: 0;
  }
  .answer button {
    flex-shrink: 0;
  }
  .answer label {
    margin-bottom: 12px;
  }
  .feedback {
    color: #d8b6c4;
    margin: 12px 0;
    font-size: 12px;
  }
  .correct {
    display: flex;
    gap: 18px;
    align-items: center;
    padding: 24px;
    background: #211d20;
    border: 1px solid #66515b;
    border-radius: 8px;
    margin: 28px 0;
  }
  .correct > span {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: #f1e9ea;
    color: #3c252d;
    font-size: 25px;
    flex-shrink: 0;
  }
  .correct strong {
    font-size: 16px;
  }
  .correct p {
    color: #bbb0bc;
    font-size: 12px;
    line-height: 1.7;
    margin-top: 8px;
  }
  .hints {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin: 20px 0;
  }
  .hints > span {
    border: 1px solid #403343;
    padding: 9px 12px;
    border-radius: 5px;
    font-size: 11px;
    color: #c2b3ca;
  }
  .round-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 15px;
    border-top: 1px solid #2b282f;
    padding-top: 18px;
    margin-top: 28px;
  }
  button.text-button {
    background: none;
    border: 0;
    padding: 10px 0;
    color: #bfb1cb;
    font-size: 11px;
    text-align: left;
  }
  .reveal-icon {
    display: grid;
    place-items: center;
    width: 90px;
    height: 90px;
    background: #26151c;
    border-radius: 50%;
    color: #ff5066;
    margin: 16px 0 36px;
  }
  .stage .revealed-title {
    font-size: clamp(38px, 5vw, 68px);
    margin: 18px 0;
  }
  .artist {
    font-size: 20px;
    color: #bcb1c6;
    line-height: 1.6;
  }
  .reveal-summary {
    display: flex;
    gap: 20px;
    align-items: center;
    margin: 34px 0;
  }
  .reveal-summary > strong {
    font-size: 55px;
    letter-spacing: -3px;
    color: #ff6274;
  }
  .reveal-summary > span {
    font-size: 14px;
  }
  .reveal-summary small {
    display: block;
    color: #aaa0b3;
    font-size: 12px;
    margin-top: 10px;
  }
  .next {
    min-width: 220px;
    justify-content: space-between;
  }
  .host-tools {
    border-top: 1px solid #302930;
    margin-top: 30px;
    padding-top: 8px;
  }
  .host-tools button {
    margin: 8px 0;
  }
  .podium {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin: 35px 0;
  }
  .podium > div {
    background: #19161b;
    border: 1px solid #3b303e;
    padding: 22px 14px;
    border-radius: 8px;
    min-width: 0;
  }
  .podium .champion {
    border-color: #ff3d52;
    background: #2a1720;
  }
  .podium span {
    color: #b39cbd;
    font-size: 13px;
  }
  .podium h2 {
    font-size: 15px;
    line-height: 1.5;
    overflow-wrap: anywhere;
    margin: 16px 0 10px;
  }
  .podium strong {
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -1px;
  }
  .podium p {
    color: #a99caf;
    font-size: 10px;
    margin-top: 7px;
  }
  .leaderboard {
    border-top: 2px solid #ff263e;
    padding: 25px 0 0;
  }
  .board-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 15px;
  }
  .board-heading h2 {
    font-size: 20px;
    letter-spacing: -0.7px;
  }
  .board-heading > span {
    color: #ac9bb5;
    font-size: 12px;
  }
  .board-intro {
    color: #9f92a8;
    font-size: 11px;
    line-height: 1.7;
    margin-top: 10px;
  }
  .scores {
    list-style: none;
    margin: 22px 0 0;
    padding: 0;
  }
  .scores li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 0;
    border-top: 1px solid #2e2832;
    min-width: 0;
  }
  .rank {
    font-size: 12px;
    color: #82758c;
    min-width: 20px;
  }
  .scores li > div {
    min-width: 0;
    flex: 1;
  }
  .scores strong {
    font-size: 12px;
    display: block;
    overflow-wrap: anywhere;
    font-weight: 550;
  }
  .scores small {
    display: block;
    font-size: 9px;
    color: #9f8ea9;
    margin-top: 7px;
  }
  .scores b {
    font-size: 15px;
    letter-spacing: -0.5px;
  }
  .scores .self .rank {
    color: #ff6274;
  }
  .scores .self strong {
    color: #fff;
  }
  .answered {
    font-size: 13px;
    color: #d5becd;
  }
  .board-note {
    color: #9987a3;
    font-size: 10px;
    line-height: 1.8;
    border-top: 1px solid #2e2832;
    padding-top: 20px;
    margin-top: 12px;
  }
  .joining {
    text-align: center;
    padding: 60px 20px;
  }
  .joining .record {
    margin: 0 auto 30px;
  }
  .joining h1 {
    font-size: 36px;
    letter-spacing: -1px;
  }
  .joining p {
    color: #aaa6b2;
    margin-top: 18px;
  }
  footer {
    max-width: 1400px;
    margin: auto;
    border-top: 1px solid #2b282f;
    padding: 26px 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }
  footer > span:first-child {
    font-size: 19px;
    font-weight: 750;
    letter-spacing: -1px;
  }
  footer a {
    font-size: 11px;
    color: #aaa6b2;
  }
  footer > span:last-child {
    font-size: 8px;
    letter-spacing: 1.3px;
    color: #887c90;
  }
  .skip {
    position: fixed;
    top: -100px;
    left: 20px;
    background: #ff263e;
    color: #000;
    padding: 16px;
    z-index: 20;
  }
  .skip:focus {
    top: 15px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }
  @media (max-width: 1100px) {
    .game-grid {
      grid-template-columns: minmax(0, 1fr) 240px;
      gap: 24px;
    }
    .stage {
      padding: 26px;
    }
    .presets {
      grid-template-columns: 1fr;
    }
    button.preset {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
      padding: 16px;
    }
    .preset strong {
      margin: 0;
      font-size: 23px;
    }
    .preset p {
      grid-column: 1/-1;
    }
  }
  @media (max-width: 800px) {
    .game-header {
      padding: 18px 22px;
    }
    main {
      padding: 28px 22px 50px;
    }
    .game-grid {
      grid-template-columns: 1fr;
      gap: 32px;
    }
    .welcome {
      padding-top: 15px;
    }
    .welcome h1 {
      font-size: clamp(48px, 9vw, 72px);
      letter-spacing: -3px;
    }
    .intro {
      font-size: 14px;
    }
    .entry-grid {
      margin-top: 35px;
    }
    .entry-card {
      padding: 25px 22px 10px 0;
    }
    .entry-card + .entry-card {
      padding: 25px 0 10px 22px;
    }
    .entry-card h2 {
      font-size: 21px;
    }
    footer {
      padding: 25px 22px;
    }
    .leaderboard {
      max-width: none;
    }
    .presets {
      grid-template-columns: repeat(3, 1fr);
    }
    button.preset {
      display: block;
      padding: 16px 12px;
    }
    .preset strong {
      margin: 14px 0 8px;
    }
    .preset small {
      display: block;
      margin-top: 8px;
    }
    .preset p {
      font-size: 9px;
    }
    .stage h1 {
      font-size: 36px;
    }
    .stage .revealed-title {
      font-size: 45px;
    }
  }
  @media (max-width: 500px) {
    .entry-grid {
      grid-template-columns: 1fr;
    }
    .entry-card,
    .entry-card + .entry-card {
      padding: 28px 0;
    }
    .entry-card + .entry-card {
      border-left: 0;
      border-top: 1px solid #303036;
    }
    .stage {
      padding: 22px 18px;
    }
    .room-bar .actions {
      width: 100%;
    }
    .room-bar .actions button {
      flex: 1;
    }
    .connection {
      margin-left: 12px;
    }
    .stage h1 {
      font-size: 30px;
      letter-spacing: -1px;
    }
    .stage .revealed-title {
      font-size: 38px;
    }
    .presets {
      gap: 7px;
    }
    button.preset {
      padding: 15px 10px;
    }
    .preset > span {
      font-size: 10px;
    }
    .preset strong {
      font-size: 22px;
    }
    .preset small {
      font-size: 9px;
    }
    .preset p {
      display: none;
    }
    .advanced summary span {
      display: none;
    }
    .round-title {
      gap: 12px;
    }
    .countdown strong {
      font-size: 46px;
    }
    .round-visual {
      margin: 5px 0 22px;
      gap: 16px;
    }
    .record {
      width: 75px;
      height: 75px;
    }
    .record span {
      width: 40px;
      height: 40px;
      font-size: 21px;
    }
    .round-visual .eyebrow {
      font-size: 8px;
    }
    .answer > div {
      flex-wrap: wrap;
    }
    .answer input {
      flex-basis: 100%;
    }
    .answer button {
      width: 100%;
    }
    .round-stats {
      font-size: 9px;
    }
    .correct {
      padding: 18px 14px;
      gap: 12px;
    }
    .correct strong {
      font-size: 14px;
    }
    .podium {
      gap: 8px;
    }
    .podium > div {
      padding: 18px 10px;
    }
    .podium strong {
      font-size: 24px;
    }
    .podium h2 {
      font-size: 12px;
    }
    .next {
      width: 100%;
      min-width: 0;
    }
    .round-footer {
      flex-wrap: wrap;
    }
    footer > span:last-child {
      display: none;
    }
    .how-it-works {
      gap: 18px;
    }
  }
  progress::-webkit-progress-bar {
    background: #343037;
    border-radius: 3px;
  }
  progress::-webkit-progress-value {
    background: #ff263e;
    border-radius: 3px;
  }
  progress::-moz-progress-bar {
    background: #ff263e;
    border-radius: 3px;
  }
  @media (max-width: 500px) {
    .stage-top {
      margin-bottom: 20px;
    }
    .round-visual {
      margin-bottom: 16px;
    }
    .round-visual .record {
      width: 48px;
      height: 48px;
    }
    .round-visual .record span {
      width: 28px;
      height: 28px;
      font-size: 16px;
    }
    .invite summary {
      min-height: 28px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation: none !important;
      transition: none !important;
      scroll-behavior: auto !important;
    }
  }
</style>
