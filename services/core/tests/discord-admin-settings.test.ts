import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {DiscordBot} from '../src/discord.ts';

const registered = JSON.parse(readFileSync(new URL('../src/afterparty-commands.json', import.meta.url), 'utf8')) as {name: string; options?: {name: string}[]}[];
const expected = ['play', 'pause', 'resume', 'skip', 'stop', 'queue', 'now-playing', 'favorites', 'concert', 'help', 'vote-skip', 'history', 'volume', 'seek', 'cleanup', 'disconnect', 'fseek'];

test('the registered command menu has 17 working commands and keeps advanced choices on play', () => {
  assert.deepEqual(registered.map(command => command.name).sort(), expected.toSorted());
  assert.deepEqual(registered.find(command => command.name === 'play')!.options!.map(option => option.name), ['query', 'next', 'now', 'shuffle']);
});

test('stale config and crossfade interactions privately link to the current guild admin without mutation', async () => {
  for (const commandName of ['config', 'crossfade']) {
    let flags = 0, changed = false;
    const replies: unknown[] = [];
    const bot = {guildId: '111111111111111111', site: 'https://site.example', engine: {settings: {crossfade: 6}},
      manager: async () => {}, commands: {updateSettings: () => {changed = true;}}};
    const call = {commandName, user: {id: 'synthetic'}, deferred: true,
      deferReply: async (value: {flags: number}) => {flags = value.flags;}, isButton: () => false,
      options: {getSubcommand: () => commandName === 'config' ? 'set-default-volume' : 'off', data: [{options: [{value: 20}]}]},
      editReply: async (value: unknown) => {replies.push(value);}};
    await DiscordBot.prototype.interaction.call(bot as never, call as never);
    assert.equal(flags, 64);
    assert.equal(changed, false);
    assert.match(String(replies[0]), /https:\/\/site\.example\/admin\?guildId=111111111111111111/);
    assert.match(String(replies[0]), /settings.*admin/i);
  }
});

test('help advertises only registered slash commands and links settings to web admin', async () => {
  const replies: unknown[] = [];
  const bot = {guildId: '111111111111111111', site: 'https://site.example', engine: {}};
  const call = {commandName: 'help', deferred: true, deferReply: async () => {}, isButton: () => false,
    options: {}, editReply: async (value: unknown) => {replies.push(value);}};
  await DiscordBot.prototype.interaction.call(bot as never, call as never);
  const text = String(replies[0]);
  for (const command of text.replace(/https?:\/\/\S+/g, '').match(/\/[a-z][a-z-]*/g) ?? []) {
    if (command === '/admin') continue;
    assert(expected.includes(command.slice(1)), command);
  }
  assert.match(text, /settings.*admin/i);
});

test('play exposes clear next, now and shuffle choices while accepting legacy advanced options', async () => {
  for (const [commandName, flag, next, immediate, shuffle] of [
    ['play', 'next', true, false, false], ['play', 'now', true, true, false], ['play', 'shuffle', false, false, true],
    ['play-next', '', true, false, false], ['play-advanced', 'immediate', true, false, false], ['play-advanced', 'skip', true, true, false],
  ] as const) {
    const added: unknown[][] = [];
    const bot = {engine: {}, musicChannelId: 'synthetic-channel', sameVoice: async () => {}, commands: {add: async (...args: unknown[]) => {added.push(args); return 1;}},
      playerMessage: {confirmQueue: async () => {}}, updateMessage: async () => {}};
    const call = {commandName, user: {id: 'synthetic'}, deferred: true, deferReply: async () => {}, isButton: () => false,
      options: {getString: () => 'Synthetic song', getBoolean: (key: string) => key === flag}, deleteReply: async () => {}, editReply: async () => {}};
    await DiscordBot.prototype.interaction.call(bot as never, call as never);
    assert.deepEqual(added, [['Synthetic song', 'synthetic', {next, immediate, shuffle}]], commandName + ' ' + flag);
  }
});
