import assert from 'node:assert/strict';
import type {AddressInfo} from 'node:net';
import {test} from 'node:test';
import type {Sink} from '../src/audio.ts';
import {Commands} from '../src/commands.ts';
import {Engine} from '../src/engine.ts';
import {Guilds} from '../src/guilds.ts';
import {DiscordOAuth} from '../src/oauth.ts';
import {Providers} from '../src/providers.ts';
import {createServers} from '../src/server.ts';
import {Store} from '../src/store.ts';

test('all ten web-admin settings persist through real Core while bounds and guild grants prevent unrelated mutations', async () => {
  const first = '100000000000000001', second = '100000000000000002', guilds = new Guilds(first);
  const resources = [first, second].map(id => {
    const store = new Store(':memory:');
    const sink: Sink = {onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {}, duration: () => 0, advancing: () => false, buffering: () => false};
    const engine = new Engine(store, new Providers(store, {}), sink), commands = new Commands(engine);
    guilds.register({id, name: 'Synthetic ' + id, roomCode: guilds.roomCode(id), engine, commands, bot: {privateState: () => ({settings: engine.settings})} as never});
    return {store, engine, commands};
  });
  const oauth = new DiscordOAuth('synthetic-key', 'app', 'secret', 'https://site.example', async () => Response.json([{id: first, name: 'Synthetic A', permissions: '32'}]));
  const grant = oauth.seal({access: 'synthetic-access', expiresAt: Date.now() + 60000, user: {id: first, name: 'Synthetic manager'}});
  const servers = await createServers(resources[0].engine, resources[0].commands, {key: 'synthetic-key', origin: 'https://site.example', guilds, oauth, publicPort: 0, host: '127.0.0.1'});
  const base = 'http://127.0.0.1:' + (servers.publicServer.address() as AddressInfo).port;
  const settings = {playlistLimit: 101, defaultQueuePageSize: 21, defaultVolume: 55, audioBitrateKbps: 256,
    crossfade: 4, secondsToWaitAfterQueueEmpties: 650, leaveIfNoListeners: false,
    turnDownVolumeWhenPeopleSpeak: true, turnDownVolumeWhenPeopleSpeakTarget: 25, radio: false};
  const originalOther = structuredClone(resources[1].engine.settings);
  const inactive = {queueAddResponseEphemeral: false, autoAnnounceNextSong: true};
  resources[0].engine.setSettings(inactive);
  const post = (guildId: string, values: Record<string, unknown>, tokenCipher?: string) => fetch(base + '/v1/admin', {
    method: 'POST', headers: {Authorization: 'Bearer synthetic-key', 'Content-Type': 'application/json'},
    body: JSON.stringify({operation: 'settings', guildId, settings: values, ...(tokenCipher ? {tokenCipher} : {})}),
  });
  try {
    const response = await post(first, settings, grant);
    assert.equal(response.status, 200);
    const ack = await response.json() as {settings: Record<string, unknown>};
    for (const [key, value] of Object.entries(settings)) assert.equal(ack.settings[key], value, key);
    assert.equal(typeof ack.settings.updatedAt, 'string');
    for (const [key, value] of Object.entries(settings)) assert.equal(resources[0].store.get<Record<string, unknown>>('settings', {})[key], value, key);
    for (const [key, value] of Object.entries(inactive)) assert.equal(resources[0].store.settings()[key as keyof typeof inactive], value,
      'Omitted inactive compatibility settings retain their stored value');
    assert.deepEqual(resources[1].engine.settings, originalOther);
    assert.equal((await post(second, {defaultVolume: 1})).status, 403);
    assert.equal((await post(second, {defaultVolume: 1}, grant)).status, 403);
    const beforeInvalid = structuredClone(resources[0].engine.settings);
    for (const invalid of [{playlistLimit: 0}, {playlistLimit: 1001}, {defaultQueuePageSize: 31}, {defaultVolume: -1},
      {audioBitrateKbps: 385}, {crossfade: 13}, {secondsToWaitAfterQueueEmpties: 86401}, {turnDownVolumeWhenPeopleSpeakTarget: 101},
      {leaveIfNoListeners: 'true'}, {radio: 'false'}]) {
      assert.equal((await post(first, {...invalid, defaultVolume: invalid.defaultVolume ?? 99}, grant)).status, 400);
      assert.deepEqual(resources[0].engine.settings, beforeInvalid, 'A rejected batch cannot partially change another setting');
    }
    assert.deepEqual(resources[1].engine.settings, originalOther);
  } finally {
    await servers.close();
    for (const resource of resources) {resource.commands.close(); resource.engine.close(); resource.store.close();}
  }
});
