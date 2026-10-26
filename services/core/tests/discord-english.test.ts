import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {DiscordBot} from '../src/discord.ts';
import {playerEmbed, playerComponents, playerMoreComponents} from '../src/player-message.ts';
import {UserError} from '../src/types.ts';

const definitions = JSON.parse(readFileSync(new URL('../src/afterparty-commands.json', import.meta.url), 'utf8')) as {name: string; description: string; options?: {name: string; options?: {name: string}[]}[]}[];
function interaction(commandName: string, values: Record<string, unknown> = {}) {
  const replies: unknown[] = [];
  return {replies, commandName, user: {id: 'synthetic-listener'}, deferred: true,
    deferReply: async () => {}, isButton: () => false,
    options: {getString: (key: string) => typeof values[key] === 'string' ? values[key] : null,
      getInteger: (key: string) => typeof values[key] === 'number' ? values[key] : null,
      getBoolean: (key: string) => values[key] === true, getSubcommand: () => values.subcommand},
    editReply: async (value: unknown) => {replies.push(value);}, deleteReply: async () => {},
  };
}

test('English registration advertises canonical commands while legacy aliases remain handler-only', () => {
  assert.equal(definitions.find(d => d.name === 'play')?.description, 'Play a track from a link or search');
  for (const name of ['help', 'concert']) assert(definitions.some(d => d.name === name), name);
  for (const name of ['hjelp', 'konsert', 'config']) assert(!definitions.some(d => d.name === name), name);
  assert(definitions.find(d => d.name === 'concert')?.options?.some(o => o.name === 'url'));
  assert(definitions.find(d => d.name === 'history')?.options?.some(o => o.name === 'count'));
  assert(!definitions.find(d => d.name === 'play-advanced')?.options?.some(o => o.name === 'split'));
  assert(!definitions.find(d => d.name === 'favorites')?.options?.find(o => o.name === 'use')?.options?.some(o => o.name === 'split'));
});

test('canonical and legacy help reply in English without voice or playback access', async () => {
  for (const name of ['help', 'hjelp']) {
    const call = interaction(name);
    const bot = {engine: {}, site: 'https://site.example', sameVoice: async () => {throw Error('Help must not need voice');}};
    await DiscordBot.prototype.interaction.call(bot as never, call as never);
    assert.match(String(call.replies[0]), /\/concert/);
    assert.match(String(call.replies[0]), /SoundCloud/);
    assert(!/\b(lenker|legg|sang|innstillinger)\b/.test(String(call.replies[0])));
  }
});

test('canonical concert url and legacy concert link retain the same public-concert routing', async () => {
  for (const [name, option] of [['concert', 'url'], ['konsert', 'lenke']]) {
    const added: unknown[][] = [], call = interaction(name, {[option]: 'https://youtu.be/abcdefghijk'});
    const bot = {engine: {}, sameVoice: async () => {}, commands: {add: async (...args: unknown[]) => {added.push(args); return 1;}},
      playerMessage: {confirmQueue: async () => {}}, updateMessage: async () => {}};
    await DiscordBot.prototype.interaction.call(bot as never, call as never);
    assert.deepEqual(added, [['abcdefghijk', 'synthetic-listener', {concert: true}]]);
  }
});

test('concert sharing commands publish the selected guild native page without accessing voice', async () => {
  for (const guildId of ['111111111111111', '222222222222222']) {
    for (const command of ['concert', 'konsert']) {
      const call = interaction(command);
      const bot = { engine: {}, site: 'https://site.example', guildId, roomCode: 'D0ABC123',
        sameVoice: async () => { throw Error('Sharing never changes playback'); } };
      await DiscordBot.prototype.interaction.call(bot as never, call as never);
      assert.deepEqual(call.replies, [`Watch the shared concert in Afterparty: https://site.example/discord?guildId=${guildId}`]);
    }
  }
});

test('English history count and stale legacy count select the requested bounded history', async () => {
  for (const option of ['count', 'antall']) {
    let count = 0;
    const call = interaction('history', {[option]: 3});
    const bot = {engine: {store: {history: (value: number) => {count = value; return [];}}}};
    await DiscordBot.prototype.interaction.call(bot as never, call as never);
    assert.equal(count, 3);
    assert.deepEqual(call.replies, ['No playback history yet.']);
  }
});

test('English player labels keep persisted component IDs and the resume icon', () => {
  const track = {id: 'abcdefghijk', title: 'Synthetic song', artist: 'Synthetic artist', image: '', duration: 100, live: false};
  const engine = {current: track, queue: [], loading: false, paused: true, loop: false, loopQueue: false,
    snapshot: () => ({current: track, playing: false, buffering: false, position: 25, volume: 70})};
  const bot = {engine};
  assert.equal(playerEmbed(bot as never).data.title, 'Paused');
  const controls = playerComponents(bot as never).flatMap(row => row.toJSON().components);
  assert.deepEqual(controls.map(c => 'custom_id' in c ? c.custom_id : ''), ['krutt:pause-resume', 'krutt:skip', 'krutt:stop', 'krutt:loop', 'krutt:shuffle', 'krutt:favorite']);
  assert.deepEqual(controls.map(c => 'label' in c ? c.label : ''), ['Resume', 'Skip', 'Stop', 'Loop', 'Shuffle queue', 'Save favorite']);
  assert.equal('emoji' in controls[0] && controls[0].emoji?.name, '▶️');
  assert.deepEqual(playerMoreComponents(bot as never)[0].components.map(c => 'label' in c.data ? c.data.label : undefined), ['−10 sec', '+30 sec', 'Show queue']);
});

test('stale chapter-splitting options fail before joining voice or changing playback', async () => {
  for (const name of ['play', 'play-advanced', 'favorites']) {
    const call = interaction(name, {split: true, subcommand: 'use'});
    let touched = false;
    const bot = {engine: {store: {favorites: () => []}}, sameVoice: async () => {touched = true;},
      commands: {add: async () => {touched = true;}}};
    await DiscordBot.prototype.interaction.call(bot as never, call as never);
    assert.equal(touched, false);
    assert.deepEqual(call.replies, ['Chapter splitting is not supported. Leave split off and try again.']);
  }
});

test('retired no-op settings reject stale invocations without changing stored settings', async () => {
  for (const subcommand of ['set-queue-add-response-hidden', 'set-auto-announce-next-song']) {
    assert(!definitions.find(d => d.name === 'config')?.options?.some(o => o.name === subcommand));
    const call = interaction('config', {subcommand});
    const bot = {engine: {}, manager: async () => {throw Error('Unexpected permission lookup');},
      commands: {updateSettings: () => {throw Error('Unexpected setting mutation');}}};
    await DiscordBot.prototype.interaction.call(bot as never, call as never);
    assert.match(String(call.replies[0]), /settings are managed in web admin/);
  }
});

test('all eight previous config mutations now redirect without changing settings', async () => {
  for (const sub of ['set-playlist-limit', 'set-wait-after-queue-empties', 'set-leave-if-no-listeners', 'set-reduce-vol-when-voice',
    'set-reduce-vol-when-voice-target', 'set-default-volume', 'set-default-queue-page-size', 'set-audio-quality']) {
    const call = Object.assign(interaction('config', {subcommand: sub}), {options: {
      getSubcommand: () => sub, data: [{options: [{value: 42}]}],
    }});
    const changed: unknown[] = [];
    const bot = {engine: {}, site: 'https://site.example', commands: {updateSettings: (input: unknown) => {changed.push(input);}}};
    await DiscordBot.prototype.interaction.call(bot as never, call as never);
    assert.deepEqual(changed, []);
    assert.match(String(call.replies[0]), /https:\/\/site.example\/admin/);
  }
});

test('voice and manager admission errors reach private replies in English without playback mutation', async () => {
  for (const [channel, connection, expected] of [
    [null, null, 'Join a voice channel first.'],
    [{id: 'listener-channel'}, {joinConfig: {channelId: 'other-channel'}}, 'You must be in the same voice channel as the bot.'],
    [{id: 'listener-channel'}, null, 'Start playback with /play first.'],
  ] as const) {
    const call = Object.assign(interaction('pause'), {guild: {members: {fetch: async () => ({voice: {channel}})}}});
    const bot = Object.assign(Object.create(DiscordBot.prototype), {engine: {}, connection,
      commands: {execute: async () => {throw Error('Playback must remain unchanged');}}});
    await bot.interaction(call as never);
    assert.deepEqual(call.replies, [expected]);
  }
  const call = Object.assign(interaction('crossfade', {subcommand: 'off'}), {guild: {members: {fetch: async () => ({permissions: {has: () => false}})}}});
  const bot = Object.assign(Object.create(DiscordBot.prototype), {engine: {}, commands: {updateSettings: () => {throw Error('Forbidden mutation');}}});
  await assert.rejects(DiscordBot.prototype.manager.call(bot as never, call as never), /You need Manage Server permission/);
});

test('validation and unexpected failures remain English without exposing provider diagnostics', async () => {
  const invalid = interaction('concert', {url: 'https://untrusted.example/secret'});
  await DiscordBot.prototype.interaction.call({engine: {}} as never, invalid as never);
  assert.deepEqual(invalid.replies, ['Use a valid YouTube URL.']);
  for (const error of [new Error('private provider token=synthetic-secret'), new UserError('Choose a valid track.')]) {
    const call = interaction('play', {query: 'Synthetic song'});
    const bot = {engine: {}, musicChannelId: 'configured-channel', sameVoice: async () => {}, commands: {add: async () => {throw error;}}};
    await DiscordBot.prototype.interaction.call(bot as never, call as never);
    assert.deepEqual(call.replies, [error instanceof UserError ? 'Choose a valid track.' : 'The action could not be completed. Try again.']);
  }
});

test('guild startup submits the English definitions to a synthetic guild without logging into Discord', async () => {
  let registered: typeof definitions | undefined;
  const guild = {commands: {set: async (value: typeof definitions) => {registered = value;}}};
  const bot = {ownsClient: false, guildId: 'synthetic-guild', client: {guilds: {fetch: async (id: string) => {
    assert.equal(id, 'synthetic-guild'); return guild;
  }}}, engine: {current: null}, restore: async () => {}, messageTimer: null as ReturnType<typeof setInterval> | null};
  try {
    await DiscordBot.prototype.start.call(bot as never, 'unused-synthetic-token');
    assert.deepEqual(registered, definitions);
    assert.equal(registered!.length, 17);
    assert.equal(new Set(registered!.map(d => d.name)).size, 17);
    const inspect = (nodes: {name: string; description?: string; options?: unknown[]}[]) => {
      for (const node of nodes) {
        assert.match(node.name, /^[a-z0-9-]{1,32}$/);
        assert(node.description && node.description.length <= 100);
        assert(!/[æøåÆØÅ]/.test(node.description));
        if (node.options) inspect(node.options as typeof nodes);
      }
    };
    inspect(registered!);
  } finally {if (bot.messageTimer) clearInterval(bot.messageTimer);}
});

test('English slash controls keep their existing queue action and positional arguments', async () => {
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ...['clear', 'loop-queue', 'loop', 'next', 'pause', 'replay', 'resume', 'shuffle', 'stop', 'unskip', 'disconnect'].map(name => [name, {}, {action: name}] as [string, Record<string, unknown>, Record<string, unknown>]),
    ['volume', {level: 75}, {action: 'volume', value: 75}], ['skip', {number: 2}, {action: 'skip', number: 2}],
    ['move', {from: 3, to: 1}, {action: 'move', from: 3, to: 1}], ['remove', {position: 2, range: 3}, {action: 'remove', position: 2, range: 3}],
    ['seek', {time: '1:30'}, {action: 'seek', seconds: 90}], ['fseek', {time: '30s'}, {action: 'seek', seconds: 55}],
  ];
  for (const [name, values, expected] of cases) {
    const executed: unknown[][] = [], call = interaction(name, values);
    let voiceChecks = 0;
    const bot = {engine: {snapshot: () => ({position: 25})}, sameVoice: async () => {voiceChecks++;},
      commands: {execute: async (...args: unknown[]) => {executed.push(args);}}};
    await DiscordBot.prototype.interaction.call(bot as never, call as never);
    assert.equal(voiceChecks, 1, name);
    assert.deepEqual(executed, [[expected, 'discord', 'synthetic-listener']], name);
    assert.deepEqual(call.replies, ['Done.'], name);
  }
});
