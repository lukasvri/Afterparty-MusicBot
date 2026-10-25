import assert from 'node:assert/strict';
import { test } from 'node:test';
import { concertLink, isDiscordRoomCode } from '../src/concert-links.ts';
import { playerComponents } from '../src/player-message.ts';

test('concert links explicitly select the owning guild and reject invalid configuration', () => {
  for (const guild of ['111111111111111', '222222222222222']) {
    assert.equal(concertLink('https://site.example/old?room=DISCORD1#private', guild), `https://site.example/discord?guildId=${guild}`);
  }
  for (const site of ['', 'invalid', 'javascript:alert(1)', 'https://user:secret@site.example'])
    assert.equal(concertLink(site, '111111111111111'), '');
  for (const guild of ['', 'guild', '111111111111111?guildId=222222222222222'])
    assert.equal(concertLink('https://site.example', guild), '');
  for (const code of ['DISCORD1', 'D0ABC123']) assert.equal(isDiscordRoomCode(code), true);
  for (const code of ['TESTROOM', 'DISCORD2', 'D0ABC12Z', null, 'D0ABC123/other']) assert.equal(isDiscordRoomCode(code), false);
});

test('player concert buttons retain their guild and ordinary playback has no concert link', () => {
  for (const guildId of ['111111111111111', '222222222222222']) {
    const current = { concert: true };
    const bot = { guildId, site: 'https://site.example', roomCode: 'D0ABC123', engine: { current, paused: false, loop: false } };
    const links = () => playerComponents(bot as never).flatMap(row => row.toJSON().components).filter(item => 'url' in item).map(item => 'url' in item ? item.url : '');
    assert.deepEqual(links(), [`https://site.example/discord?guildId=${guildId}`]);
    current.concert = false;
    assert.deepEqual(links(), []);
  }
});
