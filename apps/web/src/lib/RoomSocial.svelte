<script lang="ts">
  import {
    createRoomSocialClient,
    SOCIAL_REACTIONS,
    type SocialView,
  } from '#lib/room-social-client.ts';
  import { time, type Room } from '../../../../lib/types.ts';
  let { room }: { room: Room } = $props();
  const code = $derived(room.code),
    mode = $derived(room.mode),
    guildId = $derived(room.guildId),
    playbackKey = $derived(room.playbackKey);
  const eligible = $derived(Boolean(room.current) && room.current?.source !== 'soundcloud');
  let open = $state(false),
    selected = $state('reactions'),
    text = $state(''),
    notice = $state(''),
    editing = $state(false);
  let cells = $state([
    'Opening song',
    'Crowd sings along',
    'Guitar solo',
    'A favourite returns',
    'Hands in the air',
    'Acoustic moment',
    'Band introduction',
    'Encore',
    'Final bow',
  ]);
  let client: ReturnType<typeof createRoomSocialClient> | undefined;
  let view = $state<SocialView>({
    social: null,
    ready: false,
    busy: false,
    canManage: false,
    signIn: false,
    error: '',
  });
  const social = $derived(view.social);
  const disabled = $derived(view.busy || !view.ready || !social?.enabled);
  const invalidText = $derived(!text.trim() || /[\u0000-\u001f\u007f]/.test(text));
  const invalidCells = $derived(
    cells.some((cell) => !cell.trim() || /[\u0000-\u001f\u007f]/.test(cell)) ||
      new Set(cells.map((cell) => cell.trim().toLowerCase())).size !== 9,
  );
  const marked = $derived(social?.bingo?.marked ?? []);
  const bingoLine = $derived(
    [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ].some((line) => line.every((cell) => marked.includes(cell))),
  );
  $effect(() => {
    if (!open || !eligible || !playbackKey) return;
    const channel = createRoomSocialClient({ code, mode, guildId, playbackKey });
    client = channel;
    notice = '';
    editing = false;
    text = '';
    const unsubscribe = channel.subscribe((value) => {
      view = value;
    });
    const changed = () => channel.reconnect();
    window.addEventListener('online', changed);
    window.addEventListener('offline', changed);
    document.addEventListener('visibilitychange', changed);
    channel.start();
    return () => {
      window.removeEventListener('online', changed);
      window.removeEventListener('offline', changed);
      document.removeEventListener('visibilitychange', changed);
      unsubscribe();
      channel.destroy();
      client = undefined;
      view = {
        social: null,
        ready: false,
        busy: false,
        canManage: false,
        signIn: false,
        error: '',
      };
    };
  });
  function choose(tab: string) {
    selected = tab;
    editing = false;
    notice = '';
  }
  async function reaction(emoji: string) {
    if (await client?.act('reaction', { emoji })) notice = 'Reaction sent.';
  }
  async function highlight() {
    if (invalidText || disabled) return;
    if (await client?.act('highlight', { text: text.trim() })) {
      text = '';
      notice = 'Moment saved.';
    }
  }
  async function startBingo() {
    if (invalidCells || disabled) return;
    if (await client?.act('bingo-start', { cells: cells.map((cell) => cell.trim()) })) {
      editing = false;
      notice = 'Shared card started.';
    }
  }
</script>

{#if eligible}
  <section class="room-social" aria-label="Games and extras">
    <div class="social-heading">
      <div>
        <p class="eyebrow red">TOGETHER, IN THE MOMENT</p>
        <h2>Games & extras</h2>
        <p>Optional concert reactions, bingo and shared timestamps.</p>
      </div>
      <button class="button secondary" aria-expanded={open} onclick={() => (open = !open)}
        >{open ? 'Close extras' : 'Open extras'}</button
      >
    </div>
    {#if open}
      <div class="social-body">
        <nav aria-label="Concert extras">
          <button aria-pressed={selected === 'reactions'} onclick={() => choose('reactions')}
            >Live reactions</button
          ><button aria-pressed={selected === 'bingo'} onclick={() => choose('bingo')}
            >Concert bingo</button
          ><button aria-pressed={selected === 'moments'} onclick={() => choose('moments')}
            >Shared moments</button
          >
        </nav>
        <div class="social-meta">
          <span>{mode === 'discord' ? 'Shared with this concert' : 'Shared with this room'}</span
          >{#if view.canManage && social}<button
              disabled={view.busy || !view.ready}
              onclick={() => void client?.act('configure', { enabled: !social?.enabled })}
              >{social.enabled ? 'Disable extras' : 'Enable extras'}</button
            >{/if}
        </div>
        {#if !playbackKey}<p class="social-status" role="status">
            Waiting for a shared playback session.
          </p>{:else if view.error}<p class="social-status" role="status">
            {view.error}
            {#if view.signIn}<a href="/api/auth/discord" data-sveltekit-reload
                >Sign in with Discord</a
              >{:else}<button disabled={view.busy} onclick={() => client?.reconnect()}
                >Reconnect extras</button
              >{/if}
          </p>{:else if !social}<p class="social-status" role="status">
            Joining concert extras…
          </p>{/if}
        {#if social}
          {#if !social.enabled}<p class="social-status">
              The host has turned concert extras off.
            </p>{/if}
          {#if selected === 'reactions'}
            <div class="reactions" role="group" aria-label="Send a live reaction">
              {#each SOCIAL_REACTIONS as emoji, index}<button
                  {disabled}
                  aria-label={['Fire', 'Love', 'Applause', 'Rock on', 'Sparkle', 'Celebrate'][
                    index
                  ]}
                  onclick={() => void reaction(emoji)}
                  ><span aria-hidden="true">{emoji}</span><small
                    >{social.reactions.filter((reaction) => reaction.emoji === emoji).length ||
                      'React'}</small
                  ></button
                >{/each}
            </div>
          {:else if selected === 'moments'}
            <h3>Shared moments</h3>
            <p>Save the current shared timestamp with a short note. Links only, no recordings.</p>
            <form
              class="moment-form"
              onsubmit={(event) => {
                event.preventDefault();
                void highlight();
              }}
            >
              <label for="room-moment">What made this moment?</label>
              <div>
                <input
                  id="room-moment"
                  placeholder="That solo. That crowd. That feeling."
                  bind:value={text}
                  maxlength="160"
                  {disabled}
                  required
                /><button class="button primary" disabled={disabled || invalidText}
                  >Save this moment</button
                >
              </div>
            </form>
            <ul class="moments">
              {#each [...social.highlights].reverse() as highlight (highlight.id)}<li>
                  <a
                    href={`https://www.youtube.com/watch?v=${encodeURIComponent(highlight.videoId)}&t=${Math.floor(highlight.position)}s`}
                    target="_blank"
                    rel="noopener noreferrer"
                    ><time>{time(highlight.position)}</time><span>{highlight.text}</span><span
                      class="sr-only">Opens in a new tab</span
                    ></a
                  >{#if view.canManage}<button
                      class="remove-moment"
                      aria-label={`Remove moment: ${highlight.text}`}
                      disabled={view.busy || !view.ready}
                      onclick={() =>
                        void client?.act('remove-highlight', { highlightId: highlight.id })}
                      >Remove</button
                    >{/if}
                </li>{:else}<li class="empty-moments">
                  The best moments deserve a bookmark.
                </li>{/each}
            </ul>
          {:else}
            <div class="bingo-title">
              <h3>Concert bingo</h3>
              <span>{marked.length}/9</span>
            </div>
            <p>Watch together. The host marks each moment as it happens.</p>
            {#if editing}
              <form
                onsubmit={(event) => {
                  event.preventDefault();
                  void startBingo();
                }}
              >
                <div class="bingo-editor">
                  {#each cells as cell, index}<label for={'bingo-cell-' + index}
                      >Moment {index + 1}<input
                        id={'bingo-cell-' + index}
                        value={cell}
                        maxlength="60"
                        required
                        {disabled}
                        oninput={(event) =>
                          (cells = cells.map((value, position) =>
                            position === index ? event.currentTarget.value : value,
                          ))}
                      /></label
                    >{/each}
                </div>
                {#if invalidCells}<p class="social-status">
                    Enter nine different, non-empty moments without control characters.
                  </p>{/if}
                <div class="social-actions">
                  <button class="button primary" disabled={disabled || invalidCells}
                    >Start card</button
                  ><button class="button secondary" type="button" onclick={() => (editing = false)}
                    >Cancel</button
                  >
                </div>
              </form>
            {:else if social.bingo}
              <div class="bingo-grid" role="group" aria-label="Shared bingo card">
                {#each social.bingo.cells as cell, index}<button
                    aria-pressed={marked.includes(index)}
                    disabled={disabled ||
                      !view.canManage ||
                      !social.bingo.active ||
                      marked.includes(index)}
                    onclick={() => void client?.act('bingo-mark', { cell: index })}
                    ><small
                      >{marked.includes(index) ? '✓' : String(index + 1).padStart(2, '0')}</small
                    >{cell}</button
                  >{/each}
              </div>
              <p class="bingo-status">
                {!social.bingo.active
                  ? 'This card has ended.'
                  : bingoLine
                    ? 'Bingo! A shared line to remember.'
                    : view.canManage
                      ? 'Tap a square when you spot it.'
                      : 'Your host is calling the moments.'}
              </p>
            {:else}<p class="social-status">
                {view.canManage
                  ? 'Pick nine concert moments and start a shared card.'
                  : 'Your host can start a shared concert card.'}
              </p>{/if}
            {#if view.canManage && !editing}<div class="social-actions">
                <button
                  class="button secondary"
                  {disabled}
                  onclick={() => {
                    if (social?.bingo) cells = [...social.bingo.cells];
                    editing = true;
                  }}>{social.bingo ? 'New card' : 'Create card'}</button
                >{#if social.bingo?.active}<button
                    class="button secondary"
                    disabled={view.busy || !view.ready}
                    onclick={() => void client?.act('bingo-stop')}>End card</button
                  >{/if}
              </div>{/if}
          {/if}
          <p class="social-footnote" role="status">
            {notice || 'Optional extras. Your music keeps playing.'}
          </p>
        {/if}
      </div>
    {/if}
  </section>
{/if}

<style>
  .room-social {
    margin-top: 30px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: #111114;
    overflow: hidden;
  }
  .social-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 22px;
    padding: 24px;
  }
  .social-heading h2 {
    font-size: 20px;
    margin: 9px 0;
    letter-spacing: -0.035em;
  }
  p {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.8;
  }
  .social-heading .eyebrow {
    font-size: 8px;
  }
  .social-heading .button {
    flex-shrink: 0;
  }
  .social-body {
    padding: 0 24px 24px;
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    border-top: 1px solid var(--line);
    padding: 22px 0 16px;
  }
  nav button,
  .social-meta button,
  .social-status button,
  .remove-moment {
    min-height: 44px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 10px 13px;
    background: #1d1c22;
    color: #cfccd6;
    font: inherit;
    font-size: 12px;
  }
  nav button[aria-pressed='true'] {
    border-color: var(--red);
    color: white;
    background: #29171d;
  }
  .social-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    font-size: 11px;
    color: var(--muted);
    margin-bottom: 24px;
  }
  .social-meta button,
  .social-status button {
    background: transparent;
  }
  .social-status {
    padding: 16px 0;
  }
  .social-status a {
    text-decoration: underline;
  }
  .social-status button {
    margin-left: 12px;
  }
  .reactions {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 10px;
  }
  .reactions button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    min-height: 95px;
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 18px 10px;
    background: #1a191e;
    color: white;
  }
  .reactions button > span {
    font-size: 29px;
    line-height: 1.2;
  }
  small {
    color: var(--muted);
    font-size: 10px;
  }
  .social-footnote {
    border-top: 1px solid var(--line);
    margin-top: 24px;
    padding-top: 18px;
    font-size: 11px;
  }
  h3 {
    font-size: 18px;
    margin-bottom: 12px;
    letter-spacing: -0.025em;
  }
  .moment-form {
    margin: 22px 0;
  }
  label {
    display: block;
    font-size: 12px;
    color: #d9d6df;
  }
  .moment-form > div {
    display: flex;
    gap: 10px;
    margin-top: 10px;
  }
  input {
    min-width: 0;
    min-height: 44px;
    border: 1px solid #3c3a43;
    border-radius: 6px;
    padding: 10px 13px;
    background: #1a191e;
    color: white;
    font-size: 12px;
  }
  .moment-form input {
    flex: 1;
    width: 0;
  }
  .moments {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .moments li {
    display: flex;
    align-items: center;
    gap: 12px;
    border-top: 1px solid var(--line);
    padding: 13px 0;
    font-size: 12px;
  }
  .moments a {
    display: flex;
    align-items: center;
    gap: 15px;
    min-width: 0;
    flex: 1;
    padding: 8px 0;
    line-height: 1.7;
  }
  .moments a > span {
    overflow-wrap: anywhere;
  }
  time {
    color: var(--red);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .empty-moments {
    color: var(--muted);
  }
  .bingo-title {
    display: flex;
    justify-content: space-between;
    gap: 15px;
  }
  .bingo-title > span {
    font-size: 12px;
    color: var(--muted);
  }
  .bingo-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 9px;
    margin: 20px 0;
  }
  .bingo-grid button {
    display: flex;
    flex-direction: column;
    text-align: left;
    gap: 12px;
    min-height: 100px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #1b1a20;
    color: #e3dfe9;
    padding: 15px;
    font-size: 12px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .bingo-grid button[aria-pressed='true'] {
    border-color: var(--red);
    background: #29171d;
    opacity: 1;
  }
  .bingo-status {
    margin-bottom: 18px;
  }
  .social-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
  }
  .bingo-editor {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
    margin: 20px 0;
  }
  .bingo-editor input {
    display: block;
    width: 100%;
    margin-top: 8px;
  }
  @media (max-width: 650px) {
    .social-heading {
      padding: 20px 18px;
      align-items: flex-start;
      gap: 15px;
    }
    .social-heading p:not(.eyebrow) {
      display: none;
    }
    .social-heading h2 {
      font-size: 18px;
    }
    .social-heading .eyebrow {
      font-size: 7px;
    }
    .social-body {
      padding: 0 18px 20px;
    }
    nav {
      gap: 6px;
    }
    nav button {
      padding: 10px;
      font-size: 11px;
      flex: 1;
    }
    .reactions {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .moment-form > div {
      flex-wrap: wrap;
    }
    .moment-form input {
      flex-basis: 100%;
    }
    .bingo-editor {
      grid-template-columns: 1fr;
    }
    .bingo-grid {
      gap: 6px;
    }
    .bingo-grid button {
      padding: 10px;
      min-height: 110px;
      font-size: 10px;
    }
    .moments li {
      flex-wrap: wrap;
    }
    .moments a {
      flex-basis: 100%;
    }
  }
</style>
