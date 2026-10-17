import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { VoiceConnectionStatus } from '@discordjs/voice';
import { DiscordBot } from '../src/discord.ts';
import { AudioDiagnostics } from '../src/audio-diagnostics.ts';
import { UserError } from '../src/types.ts';
import { deferred } from './deferred.ts';

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

test('simultaneous requests share one voice handshake and keep admission reserved until completion', async () => {
    const t = fixture(), ready = deferred<void>();
    let admissions = 0, connections = 0;
    t.bot.admitVoice = () => { admissions++; };
    t.bot.connectVoice = async () => { connections++; await ready.promise; };
    const channel = { id: 'synthetic-channel' };
    const first = t.bot.join(channel as never), second = t.bot.join(channel as never);
    assert.equal(t.bot.joining, true);
    assert.equal(admissions, 1);
    assert.equal(connections, 1);
    ready.resolve();
    await Promise.all([first, second]);
    assert.equal(t.bot.joining, false);
});

test('a replacement handshake stays pending even while the previous engine connection flag is true', async () => {
    const t = fixture(), ready = deferred<void>();
    t.engine.connected = true;
    t.bot.connection = { joinConfig: { channelId: 'previous-channel' } } as never;
    let connections = 0, secondResolved = false;
    t.bot.connectVoice = async channel => {
        connections++;
        t.bot.connection = { joinConfig: { channelId: channel.id } } as never;
        await ready.promise;
    };
    const channel = { id: 'replacement-channel' };
    const first = t.bot.join(channel as never);
    const second = t.bot.join(channel as never).then(() => { secondResolved = true; });
    try {
        await Promise.resolve();
        assert.equal(secondResolved, false);
        assert.equal(connections, 1);
        assert.equal(t.bot.joining, true);
    } finally {
        ready.resolve();
        await Promise.all([first, second]);
    }
    assert.equal(secondResolved, true);
    assert.equal(t.bot.joining, false);
});

test('a concurrent request for another voice channel cannot replace a pending handshake', async () => {
    const t = fixture(), ready = deferred<void>();
    let connections = 0;
    t.bot.connectVoice = async () => { connections++; await ready.promise; };
    const first = t.bot.join({ id: 'one-channel' } as never);
    await assert.rejects(t.bot.join({ id: 'another-channel' } as never), UserError);
    assert.equal(connections, 1);
    ready.resolve();
    await first;
});

test('failed shared joins release admission and a later request can retry', async () => {
    const t = fixture(), ready = deferred<void>();
    let connections = 0;
    t.bot.connectVoice = async () => { connections++; if (connections === 1) await ready.promise; };
    const first = t.bot.join({ id: 'synthetic-channel' } as never);
    const second = t.bot.join({ id: 'synthetic-channel' } as never);
    const settled = Promise.all([assert.rejects(first, UserError), assert.rejects(second, UserError)]);
    ready.reject(new UserError('Voice unavailable'));
    await settled;
    assert.equal(t.bot.joining, false);
    await t.bot.join({ id: 'synthetic-channel' } as never);
    assert.equal(connections, 2);
});

test('completion of a disconnected handshake cannot release a newer voice admission', async () => {
    const t = fixture(), old = deferred<void>(), current = deferred<void>();
    let connections = 0;
    Object.assign(t.engine, { setConnection: () => {} });
    t.bot.talking = new Set();
    t.bot.connectVoice = async () => { await (++connections === 1 ? old.promise : current.promise); };
    const previous = t.bot.join({ id: 'synthetic-channel' } as never);
    t.bot.disconnect();
    const next = t.bot.join({ id: 'synthetic-channel' } as never);
    const failed = assert.rejects(previous, UserError);
    old.reject(new UserError('Voice interrupted'));
    await failed;
    assert.equal(t.bot.joining, true);
    current.resolve();
    await next;
    assert.equal(t.bot.joining, false);
    assert.equal(connections, 2);
});
