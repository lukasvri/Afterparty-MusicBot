<script lang="ts">
  import { onMount } from 'svelte';
  import PublicPage from '#lib/PublicPage.svelte';
  import GameAudio from '#lib/GameAudio.svelte';
  import { createGameClient, type GameScope, type GameView } from '#lib/game-client.ts';
  import { guessAvailability } from '../../../../../lib/guess-availability.ts';
  import type { GuessSettings } from '../../../../../services/core/src/guess-game.ts';
  let mounted = $state(false);
  let code = $state(''),
    guild = $state(''),
    nickname = $state(''),
    answer = $state('');
  let scope = $state<GameScope | null>(null),
    client: ReturnType<typeof createGameClient> | undefined;
  let view = $state<GameView>({ data: null, ready: false, busy: false, error: '', signIn: false });
  let tick = $state(0),
    dirty = $state(false),
    base = $state(0),
    category = $state('');
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
  const availability = $derived(
    guessAvailability(
      game?.categories.find((item) => item.id === category),
      settings.durationSeconds,
      settings.roundCount,
    ),
  );
  const stale = $derived(dirty && base !== game?.revision);
  const disabled = $derived(!view.ready || view.busy);
  const answered = $derived(
    Boolean(
      game?.scoreboard.find((player) => player.id === view.data?.self.participantId)?.hasAnswered,
    ),
  );
  let unsubscribe: (() => void) | undefined;
  function useLatest() {
    if (game) {
      settings = { ...game.settings };
      category = game.categoryId;
      base = game.revision;
      dirty = false;
    }
  }
  function edit() {
    if (!dirty) base = game?.revision ?? 0;
    dirty = true;
  }
  function leave() {
    unsubscribe?.();
    client?.destroy();
    client = undefined;
    scope = null;
    view = { data: null, ready: false, busy: false, error: '', signIn: false };
    answer = '';
    dirty = false;
  }
  function join() {
    leave();
    scope = {
      scope: guild ? 'guild' : 'room',
      scopeId: guild || code.trim().toUpperCase(),
      nickname,
    };
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
  async function act(action: string, fields: Record<string, unknown> = {}) {
    const result = await client?.act(action, fields);
    if (result && action === 'guess') answer = '';
    if (result && action === 'configure') {
      dirty = false;
      useLatest();
    }
  }
  onMount(() => {
    mounted = true;
    const query = new URLSearchParams(location.search);
    const room = query.get('room') ?? '',
      server = query.get('guild') ?? '';
    if (/^[A-Z0-9]{8}$/.test(room)) code = room;
    if (/^\d{14,22}$/.test(server)) guild = server;
    const timer = setInterval(() => tick++, 250);
    const reconnect = () => client?.reconnect();
    document.addEventListener('visibilitychange', reconnect);
    window.addEventListener('offline', reconnect);
    window.addEventListener('online', reconnect);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', reconnect);
      window.removeEventListener('offline', reconnect);
      window.removeEventListener('online', reconnect);
      leave();
    };
  });
</script>

<PublicPage title="Guess the song" eyebrow="AFTERPARTY / MUSIC QUIZ">
  <p class="intro">
    Quick ears. Late hints. Every second counts. Play with your room or Discord server while your
    music queue stays separate.
  </p>
  {#if !scope}
    <form
      class="card join"
      onsubmit={(event) => {
        event.preventDefault();
        join();
      }}
    >
      <h2>Join your game lobby</h2>
      {#if guild}<p>Discord server: {guild}</p>{:else}<label
          >Room code<input
            bind:value={code}
            required
            minlength="8"
            maxlength="8"
            pattern={'[A-Za-z0-9]{8}'}
            autocomplete="off"
            placeholder="8-character code"
          /></label
        >{/if}
      <label
        >Nickname<input
          bind:value={nickname}
          maxlength="24"
          autocomplete="off"
          placeholder="Choose a game nickname"
        /></label
      >
      <button class="primary" disabled={!mounted}>Join lobby</button>
      <a href="/v3">Create or find a listening room</a>
    </form>
  {:else}
    <div class="room-bar">
      <span>Game lobby / {scope.scopeId}</span><button onclick={leave}>Leave game</button>
    </div>
    {#if view.error}<div class="notice" role="status">
        {view.error}
        <button onclick={() => client?.reconnect()}>Reconnect game</button>{#if view.signIn}<a
            href="/api/auth/discord"
            data-sveltekit-reload>Sign in with Discord</a
          >{/if}
      </div>{/if}
    {#if !game}<p role="status">Joining the game…</p>{:else}
      {#if game.categories.some((item) => item.id === 'synthetic-test')}<p class="notice">
          Synthetic audio test: generated tones and fictional titles. Answers: Test Tone One, Test
          Tone Two, Test Tone Three, Test Tone Four, Test Tone Five. Artist: Synthetic Test
          Generator.
        </p>{/if}
      <div class="game-grid">
        <section class="card stage" aria-label="Guess the song round">
          <div class="room-bar">
            <span class="eyebrow"
              >{game.phase === 'round' ? 'LISTEN & GUESS' : game.phase.toUpperCase()}</span
            ><span>Round {game.roundNumber}/{game.settings.roundCount}</span>
          </div>
          {#if game.phase === 'lobby' || game.phase === 'results'}
            <p role="status">
              {view.data?.sourceState === 'loading'
                ? 'Loading quiz songs…'
                : view.data?.sourceState === 'ready'
                  ? 'Quiz songs ready'
                  : view.data?.sourceState === 'disabled'
                    ? 'Quiz songs are disabled on this Core.'
                    : 'The host can load quiz songs for everyone.'}
            </p>
            {#if view.data?.canManage && view.data?.canPrepare && view.data?.sourceState !== 'ready'}<button
                disabled={disabled || view.data?.sourceState === 'loading'}
                onclick={() => void act('prepare')}>Load quiz songs</button
              >{/if}
          {/if}
          {#if game.phase === 'lobby'}
            <h2>The room is ready. Are you?</h2>
            <form
              onsubmit={(event) => {
                event.preventDefault();
                if (!stale)
                  void act('configure', { settings, categoryId: category, revision: base });
              }}
            >
              <fieldset disabled={disabled || !view.data?.canManage}>
                <legend>Game settings</legend>
                <label
                  >Category<select bind:value={category} onchange={edit}
                    >{#each game.categories as item}<option value={item.id}
                        >{item.name}{item.available ? '' : ' · Not loaded'}</option
                      >{/each}</select
                  ></label
                >
                <label
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
                  >
                  <label
                    >Rounds<input
                      type="number"
                      min="1"
                      max={Math.max(1, availability.maxRounds)}
                      step="1"
                      required
                      bind:value={settings.roundCount}
                      oninput={edit}
                    /></label
                  >
                  <label
                    >Starting points<input
                      type="number"
                      min="100"
                      max="2000"
                      step="1"
                      required
                      bind:value={settings.maxPoints}
                      oninput={edit}
                    /></label
                  >
                  <label
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
                  ><input type="checkbox" bind:checked={settings.hints} onchange={edit} />Late hints</label
                >
                <button disabled={disabled || stale || !dirty}>Save settings</button>
              </fieldset>
            </form>
            {#if stale}<p role="status">
                The lobby changed while you edited. <button onclick={useLatest}
                  >Use latest settings</button
                >
              </p>{/if}
            <p>
              {availability.canStart
                ? `${availability.eligibleRounds} recordings fit these settings.`
                : 'Choose a loaded category with enough recordings for this duration and number of rounds.'}
            </p>
            {#if view.data?.canManage}<button
                class="primary"
                disabled={disabled || stale || dirty || !availability.canStart}
                onclick={() => void act('start')}>Start game</button
              >{:else}<p>The host starts the game.</p>{/if}
          {:else}
            {#if round}
              {#if game.phase === 'round'}
                <div class="countdown">
                  <strong>{Math.ceil(remaining).toString().padStart(2, '0')}<small>s</small></strong
                  ><progress
                    aria-label="Round time remaining"
                    max={game.settings.durationSeconds}
                    value={remaining}
                  ></progress>
                </div>
                <h2>
                  {game.settings.answerMode === 'artist' ? 'Who’s the artist?' : 'What’s the song?'}
                </h2>
                {#key `${game.sessionId}:${round.roundId}`}<GameAudio
                    available={view.data?.mediaAvailable === true}
                    active={view.ready && remaining > 0 && now >= round.startsAt}
                    {elapsed}
                    fetchAudio={(signal) => client!.media(signal)}
                  />{/key}
                <form
                  class="answer"
                  onsubmit={(event) => {
                    event.preventDefault();
                    if (
                      !disabled &&
                      !answered &&
                      remaining > 0 &&
                      now >= round.startsAt &&
                      answer.trim()
                    )
                      void act('guess', { text: answer });
                  }}
                >
                  <label
                    >{game.settings.answerMode === 'artist' ? 'Artist name' : 'Song title'}<input
                      bind:value={answer}
                      maxlength="120"
                      autocomplete="off"
                      disabled={disabled || answered || remaining <= 0 || now < round.startsAt}
                    /></label
                  >
                  <button
                    class="primary"
                    disabled={disabled ||
                      answered ||
                      remaining <= 0 ||
                      now < round.startsAt ||
                      !answer.trim()}>Submit answer</button
                  >
                </form>
                {#if view.data?.self.result}<p role="status">
                    {view.data.self.result.correct
                      ? `Correct! +${view.data.self.result.awarded} points`
                      : 'Not quite. Try another answer.'}
                  </p>{/if}
                {#if round.hints.artistInitial}<p>
                    Artist initial: {round.hints.artistInitial}
                  </p>{/if}
                {#if round.hints.titleWordCount}<p>
                    Title words: {round.hints.titleWordCount}
                  </p>{/if}
                {#if round.hints.artistWordCount}<p>
                    Artist words: {round.hints.artistWordCount}
                  </p>{/if}
                {#if typeof round.skipVotes === 'number' && typeof round.skipRequired === 'number'}<button
                    disabled={disabled || view.data?.self.skipVoted || remaining <= 0}
                    onclick={() => void act('skip')}
                    >{view.data?.self.skipVoted ? 'Skip vote counted' : 'Vote to skip'} ({round.skipVotes}/{round.skipRequired})</button
                  >{/if}
              {:else if round.answer}<h2>{round.answer.title}</h2>
                <p class="artist">{round.answer.artist}</p>{/if}
            {/if}
            {#if game.phase === 'results'}<h2>That’s a wrap.</h2>
              <p>The final scores are in.</p>{/if}
            {#if view.data?.canManage}<div class="controls">
                {#if game.phase === 'round'}<button {disabled} onclick={() => void act('reveal')}
                    >Reveal answer</button
                  >{/if}
                {#if game.phase === 'reveal'}<button
                    class="primary"
                    {disabled}
                    onclick={() => void act('next')}>Next round</button
                  >{/if}
                {#if game.phase === 'results'}<button
                    class="primary"
                    {disabled}
                    onclick={() => void act('reset')}>Back to lobby</button
                  >{:else}<button {disabled} onclick={() => void act('end')}>End game</button>{/if}
              </div>{/if}
          {/if}
        </section>
        <aside class="card">
          <h2>Leaderboard</h2>
          <ol class="scores">
            {#each game.scoreboard as player}<li>
                <span
                  >{player.nickname}{player.id === view.data?.self.participantId
                    ? ' (you)'
                    : ''}{#if player.hasAnswered}<small>Answered</small>{/if}</span
                ><strong>{player.total}</strong>
              </li>{/each}
          </ol>
          <p class="note">Nicknames belong to this game, not Discord identities.</p>
        </aside>
      </div>
    {/if}
  {/if}
</PublicPage>

<style>
  .intro {
    font-size: 17px;
    max-width: 620px;
    margin-bottom: 32px;
  }
  .card {
    padding: 26px;
    background: #131316;
    border: 1px solid #28282f;
    border-radius: 16px;
    min-width: 0;
  }
  .card h2 {
    margin-top: 0;
  }
  .join {
    max-width: 430px;
    display: grid;
    gap: 20px;
  }
  .game-grid {
    display: grid;
    gap: 20px;
    grid-template-columns: minmax(0, 1.7fr) minmax(220px, 1fr);
    margin-top: 24px;
  }
  label {
    display: grid;
    gap: 7px;
    font-size: 13px;
    color: #d8d8df;
    margin-bottom: 16px;
  }
  input,
  select {
    width: 100%;
    box-sizing: border-box;
    min-height: 46px;
    padding: 10px 12px;
    background: #0c0c0f;
    border: 1px solid #34343e;
    border-radius: 8px;
    color: #f7f7fa;
    font: inherit;
  }
  button {
    min-height: 44px;
    padding: 10px 18px;
    border: 1px solid #383840;
    background: #222228;
    border-radius: 8px;
    color: #f7f7fa;
    font: inherit;
    cursor: pointer;
  }
  button:disabled,
  fieldset:disabled {
    opacity: 0.5;
  }
  button:disabled {
    cursor: default;
  }
  button:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid #ff6072;
    outline-offset: 4px;
  }
  .primary {
    background: #ff263e;
    border-color: #ff263e;
  }
  .room-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
  }
  .eyebrow {
    letter-spacing: 1.2px;
    color: #ff6072;
  }
  .notice {
    padding: 16px;
    border: 1px solid #4b333b;
    background: #20151a;
    border-radius: 10px;
    margin: 20px 0;
  }
  .notice button,
  .notice a {
    margin-left: 10px;
  }
  fieldset {
    padding: 0;
    border: 0;
    margin: 0;
    min-width: 0;
  }
  legend {
    margin: 20px 0;
    font-weight: 600;
    color: #eeeef5;
  }
  .settings-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 14px;
  }
  .toggle {
    display: flex;
    align-items: center;
  }
  .toggle input {
    width: 18px;
    min-height: 18px;
  }
  .countdown strong {
    font-size: 72px;
    color: #f6f6fa;
    letter-spacing: -4px;
  }
  .countdown small {
    font-size: 22px;
    color: #777785;
    letter-spacing: 0;
  }
  progress {
    width: 100%;
    accent-color: #ff263e;
    height: 5px;
  }
  .answer {
    margin: 24px 0;
  }
  .controls {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 24px;
  }
  .scores {
    padding: 0;
    list-style: none;
  }
  .scores li {
    display: flex;
    align-items: center;
    gap: 14px;
    justify-content: space-between;
    border-bottom: 1px solid #292930;
    padding: 15px 0;
  }
  .scores small {
    display: block;
    color: #ff6072;
    font-size: 11px;
  }
  .scores span {
    overflow-wrap: anywhere;
  }
  .note {
    color: #82828f;
    font-size: 12px;
  }
  .artist {
    color: #ff6072;
    font-size: 20px;
  }
  @media (max-width: 720px) {
    .game-grid {
      grid-template-columns: 1fr;
    }
    .card {
      padding: 20px;
    }
  }
</style>
