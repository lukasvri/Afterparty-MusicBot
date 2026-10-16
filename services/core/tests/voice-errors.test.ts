import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { VoiceConnectionStatus } from '@discordjs/voice';
import { DiscordBot } from '../src/discord.ts';
import { AudioDiagnostics } from '../src/audio-diagnostics.ts';
import { UserError } from '../src/types.ts';

function fixture() {
    let changes = 0;
    const queue = [{ entryId: 'synthetic-track', offset: 42 }];
    const engine = {
        queue, ready: true, connected: false, lastError: '', diagnostics: new AudioDiagnostics(),
        settings: { turnDownVolumeWhenPeopleSpeak: false },
        changed: () => { changes++; },
    };
    const bot = Object.assign(Object.create(DiscordBot.prototype), {
        engine, guildId: 'synthetic-voice-error-guild', connection: null,
    }) as DiscordBot;
    return { bot, engine, queue, changes: () => changes };
}

test('a voice WebSocket 522 during the initial handshake is handled before Ready', async () => {
    const t = fixture();
    const channel = {
        id: 'synthetic-channel',
        guild: {
            members: { me: {} },
            voiceAdapterCreator: () => ({ sendPayload: () => true, destroy: () => {} }),
        },
        permissionsFor: () => ({ has: () => true }),
    };
    const joining = t.bot.connectVoice(channel as never);
    const connection = t.bot.connection!;
    assert(connection);
    assert.doesNotThrow(() => connection.emit('error', new Error('Unexpected server response: 522')));
    assert.equal(t.engine.diagnostics.snapshot().events[0].reason, 'voice-error');
    connection.destroy();
    await assert.rejects(joining, UserError);
    assert.equal(connection.state.status, VoiceConnectionStatus.Destroyed);
    assert.equal(t.bot.connection, null);
    assert.deepEqual(t.engine.queue, [{ entryId: 'synthetic-track', offset: 42 }]);
});

test('an established connection error keeps library recovery and other connections intact', () => {
    const t = fixture();
    const current = new EventEmitter();
    const stale = new EventEmitter();
    t.bot.connection = current as never;
    t.engine.connected = true;
    t.bot.watchVoiceErrors(current as never);
    t.bot.watchVoiceErrors(stale as never);
    assert.doesNotThrow(() => current.emit('error', new Error('private endpoint details')));
    assert.equal(t.bot.connection, current);
    assert.equal(t.engine.connected, true);
    assert.equal(t.changes(), 1);
    assert(!t.engine.lastError.includes('private endpoint'));
    assert.doesNotThrow(() => stale.emit('error', new Error('stale connection')));
    assert.equal(t.changes(), 1);
    assert.equal(t.engine.diagnostics.snapshot().events.length, 1);
});

test('a failed superseded handshake cannot clear a newer connection or fail with a null reference', async () => {
    for (const replacement of [null, new EventEmitter()]) {
        const t = fixture();
        const channel = {
            id: 'synthetic-channel',
            guild: { members: { me: {} }, voiceAdapterCreator: () => ({ sendPayload: () => true, destroy: () => {} }) },
            permissionsFor: () => ({ has: () => true }),
        };
        const joining = t.bot.connectVoice(channel as never);
        const previous = t.bot.connection!;
        t.bot.connection = replacement as never;
        previous.destroy();
        previous.emit('error', new Error('Connection closed during handshake'));
        await assert.rejects(joining, UserError);
        assert.equal(t.bot.connection, replacement);
    }
});

test('failed voice restoration leaves a guild available with its queued recovery intact', async () => {
    const t = fixture();
    let started = 0;
    Object.assign(t.engine, {
        store: { get: (key: string) => key === 'voice-channel' ? 'synthetic-channel' : { paused: true } },
        startNext: async () => { started++; },
    });
    const guild = { channels: { fetch: async () => ({
        isVoiceBased: () => true, members: [{ user: { bot: false } }],
    }) } };
    t.bot.join = async () => { throw new UserError('Voice unavailable'); };
    await t.bot.restore(guild as never);
    assert.equal(started, 0);
    assert.equal(t.engine.connected, false);
    assert.equal(t.engine.ready, true);
    assert.equal(t.changes(), 1);
    assert.deepEqual(t.engine.queue, [{ entryId: 'synthetic-track', offset: 42 }]);
    assert.match(t.engine.lastError, /\/play/);
});

test('unexpected restoration errors still fail startup instead of hiding corruption', async () => {
    const t = fixture();
    Object.assign(t.engine, { store: { get: () => 'synthetic-channel' } });
    const guild = { channels: { fetch: async () => ({
        isVoiceBased: () => true, members: [{ user: { bot: false } }],
    }) } };
    t.bot.join = async () => { throw new Error('Unexpected failure'); };
    await assert.rejects(t.bot.restore(guild as never), /Unexpected failure/);
});
