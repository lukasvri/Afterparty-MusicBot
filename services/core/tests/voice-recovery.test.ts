import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createAudioPlayer, VoiceConnectionStatus, type VoiceConnection } from '@discordjs/voice';
import { DiscordBot } from '../src/discord.ts';
import { AudioDiagnostics } from '../src/audio-diagnostics.ts';

let fixtureId = 0;
async function fixture(t: TestContext) {
    let payloads = 0, disconnects = 0;
    const engine = {
        connected: false, paused: true, runId: 'synthetic-run', lastError: '', ducking: false,
        settings: { turnDownVolumeWhenPeopleSpeak: false },
        diagnostics: new AudioDiagnostics(), store: { set() {} }, changed() {},
        setConnection(connected: boolean) {
            this.connected = connected;
            if (!connected) disconnects++;
        },
    };
    const player = createAudioPlayer();
    const bot = Object.assign(Object.create(DiscordBot.prototype), {
        engine, guildId: 'synthetic-recovery-' + ++fixtureId, connection: null,
        sink: { player }, talking: new Set(), client: { user: { id: 'synthetic-bot' } },
    }) as DiscordBot;
    const channel = {
        id: 'synthetic-channel', bitrate: 96000,
        guild: {
            members: { me: {} },
            voiceAdapterCreator: () => ({ sendPayload: () => { payloads++; return true; }, destroy() {} }),
        },
        permissionsFor: () => ({ has: () => true }),
    };
    const joining = bot.connectVoice(channel as never);
    const connection = bot.connection!;
    transition(connection, VoiceConnectionStatus.Ready);
    await joining;
    t.after(() => {
        bot.disconnect();
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
        player.stop();
    });
    return { bot, engine, connection, payloads: () => payloads, disconnects: () => disconnects };
}
function transition(connection: VoiceConnection, status: VoiceConnectionStatus) {
    // Synthetic state delivery only: no Discord packets, sockets or credentials.
    Reflect.set(connection, 'state', { ...connection.state, status });
}
function close(connection: VoiceConnection, code: number) {
    Reflect.apply(Reflect.get(connection, 'onNetworkingClose'), connection, [code]);
}

test('an established reconnect that skips Disconnected expires after 20 seconds without Ready', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = await fixture(t);
    let disconnectedEvents = 0;
    f.connection.on(VoiceConnectionStatus.Disconnected, () => { disconnectedEvents++; });
    const initialPayloads = f.payloads();
    close(f.connection, 4006);
    assert.equal(f.connection.state.status, VoiceConnectionStatus.Signalling);
    assert.equal(disconnectedEvents, 0);
    assert.equal(f.payloads(), initialPayloads + 1);
    t.mock.timers.tick(19999);
    assert.equal(f.engine.connected, true);
    assert.equal(f.payloads(), initialPayloads + 1, 'only the voice library initiates reconnection');
    t.mock.timers.tick(1);
    assert.equal(f.connection.state.status, VoiceConnectionStatus.Destroyed);
    assert.equal(f.bot.connection, null);
    assert.equal(f.engine.connected, false);
    assert.equal(f.disconnects(), 1);
    assert.equal(f.payloads(), initialPayloads + 2, 'deadline destruction sends only the leave payload');
    assert.match(f.engine.lastError, /Use \/play/);
    assert.equal(f.engine.diagnostics.snapshot().events.filter(e => e.reason === 'voice-error').length, 1);
});

test('Disconnected, Signalling and Connecting share one Ready deadline', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = await fixture(t);
    close(f.connection, 4014);
    t.mock.timers.tick(10000);
    transition(f.connection, VoiceConnectionStatus.Signalling);
    t.mock.timers.tick(9000);
    transition(f.connection, VoiceConnectionStatus.Connecting);
    t.mock.timers.tick(1000);
    assert.equal(f.engine.connected, false);
    assert.equal(f.disconnects(), 1);
});

test('Ready cancels recovery without changing manual pause or the active run', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = await fixture(t);
    close(f.connection, 4006);
    t.mock.timers.tick(19000);
    transition(f.connection, VoiceConnectionStatus.Ready);
    t.mock.timers.tick(60000);
    assert.equal(f.bot.connection, f.connection);
    assert.equal(f.engine.connected, true);
    assert.equal(f.engine.paused, true);
    assert.equal(f.engine.runId, 'synthetic-run');
    assert.equal(f.disconnects(), 0);
    assert.equal(f.engine.diagnostics.snapshot().events.filter(e => e.reason === 'voice-reconnected').length, 1);
    close(f.connection, 4006);
    t.mock.timers.tick(19999);
    assert.equal(f.engine.connected, true);
    t.mock.timers.tick(1);
    assert.equal(f.engine.connected, false, 'a later outage gets its own bounded recovery');
});

test('intentional disconnect cancels the deadline and cannot add a timeout error', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = await fixture(t);
    close(f.connection, 4006);
    f.bot.disconnect();
    t.mock.timers.tick(60000);
    assert.equal(f.disconnects(), 1);
    assert.equal(f.engine.lastError, '');
    assert(!f.engine.diagnostics.snapshot().events.some(e => e.reason === 'voice-error'));
});

test('an old recovery deadline cannot disconnect a replacement or another guild', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = await fixture(t), other = await fixture(t);
    close(f.connection, 4006);
    // Keep the old connection alive to exercise the identity guard even if its destroy was delayed.
    f.bot.connection = other.connection;
    t.mock.timers.tick(60000);
    assert.equal(f.bot.connection, other.connection);
    assert.equal(other.connection.state.status, VoiceConnectionStatus.Ready);
    assert.equal(other.engine.connected, true);
    assert.equal(f.disconnects(), 0);
    assert.equal(other.disconnects(), 0);
    f.bot.connection = null;
});
