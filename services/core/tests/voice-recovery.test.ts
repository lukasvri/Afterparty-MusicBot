import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createAudioPlayer, VoiceConnectionStatus, type VoiceConnection, type DiscordGatewayAdapterLibraryMethods } from '@discordjs/voice';
import { DiscordBot } from '../src/discord.ts';
import { AudioDiagnostics } from '../src/audio-diagnostics.ts';

let fixtureId = 0;
async function fixture(t: TestContext) {
    let payloads = 0, disconnects = 0;
    let adapterMethods: DiscordGatewayAdapterLibraryMethods;
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
            voiceAdapterCreator: (methods: DiscordGatewayAdapterLibraryMethods) => {
                adapterMethods = methods;
                return { sendPayload: () => { payloads++; return true; }, destroy() {} };
            },
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
    return { bot, engine, connection, channel, adapterDestroyed: () => adapterMethods.destroy(), payloads: () => payloads, disconnects: () => disconnects };
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


test('a gateway adapter destroyed during recovery releases its dead connection and permits joining again', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = await fixture(t);
    close(f.connection, 4006);
    t.mock.timers.tick(19999);
    // discord.js ClientVoiceManager calls this callback on ShardDisconnect.
    f.adapterDestroyed();
    assert.equal(f.connection.state.status, VoiceConnectionStatus.Destroyed);
    assert.equal(f.engine.connected, false);
    assert.equal(f.bot.connection, null);
    assert.equal(f.disconnects(), 1);
    t.mock.timers.tick(60000);
    assert.equal(f.disconnects(), 1);
    const joining = f.bot.join(f.channel as never);
    const replacement = f.bot.connection!;
    assert.notEqual(replacement, f.connection);
    transition(replacement, VoiceConnectionStatus.Ready);
    await joining;
    assert.equal(f.engine.connected, true);
});

test('rapid irregular outages do not accumulate deadlines or unpause either guild', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const a = await fixture(t), b = await fixture(t);
    a.engine.paused = false;
    const delays = [0, 1, 37, 19999, 749, 10001, 19998, 801];
    for (let index = 0; index < 64; index++) {
        const active = index % 2 ? a : b, unaffected = index % 2 ? b : a;
        close(active.connection, index % 3 ? 4006 : 4014);
        const total = delays[index % delays.length];
        t.mock.timers.tick(Math.floor(total / 2));
        transition(active.connection, VoiceConnectionStatus.Connecting);
        t.mock.timers.tick(total - Math.floor(total / 2));
        transition(active.connection, VoiceConnectionStatus.Ready);
        assert.equal(active.engine.connected, true, `outage ${index} recovered before its deadline`);
        assert.equal(unaffected.connection.state.status, VoiceConnectionStatus.Ready);
        assert.equal(a.engine.paused, false);
        assert.equal(b.engine.paused, true);
        assert.equal(a.engine.runId, 'synthetic-run');
        assert.equal(b.engine.runId, 'synthetic-run');
        assert.equal(a.disconnects() + b.disconnects(), 0);
    }
    t.mock.timers.tick(60000);
    assert.equal(a.disconnects() + b.disconnects(), 0, 'all 64 superseded deadlines were cancelled');
    close(a.connection, 4006);
    t.mock.timers.tick(20000);
    assert.equal(a.disconnects(), 1);
    assert.equal(b.disconnects(), 0);
    assert.equal(b.connection.state.status, VoiceConnectionStatus.Ready);
});

test('Ready delivered first at the deadline cancels expiry, while post-expiry events cannot affect a new connection', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = await fixture(t);
    // Both callbacks share a timestamp. Exercise both possible delivery orders.
    setTimeout(() => transition(f.connection, VoiceConnectionStatus.Ready), 20000);
    close(f.connection, 4006);
    t.mock.timers.tick(20000);
    assert.equal(f.engine.connected, true);
    assert.equal(f.disconnects(), 0);
    close(f.connection, 4006);
    const staleState = f.connection.state;
    setTimeout(() => {
        f.connection.emit('stateChange', staleState, { ...staleState, status: VoiceConnectionStatus.Ready });
        f.connection.emit(VoiceConnectionStatus.Ready, staleState, f.connection.state);
    }, 20000);
    t.mock.timers.tick(20000);
    assert.equal(f.connection.state.status, VoiceConnectionStatus.Destroyed);
    assert.equal(f.disconnects(), 1);
    const joining = f.bot.join(f.channel as never);
    const replacement = f.bot.connection!;
    transition(replacement, VoiceConnectionStatus.Ready);
    await joining;
    const diagnostics = f.engine.diagnostics.snapshot();
    f.connection.emit('stateChange', staleState, { ...staleState, status: VoiceConnectionStatus.Destroyed });
    f.connection.emit('stateChange', staleState, { ...staleState, status: VoiceConnectionStatus.Ready });
    f.connection.emit('error', new Error('stale synthetic gateway error'));
    close(f.connection, 4006);
    t.mock.timers.tick(60000);
    assert.equal(f.bot.connection, replacement);
    assert.equal(replacement.state.status, VoiceConnectionStatus.Ready);
    assert.equal(f.engine.connected, true);
    assert.equal(f.disconnects(), 1);
    assert.deepEqual(f.engine.diagnostics.snapshot(), diagnostics);
});

test('replacing an established connection retires its identity before destroy without clearing the active run', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = await fixture(t), other = await fixture(t);
    close(f.connection, 4006);
    const joining = f.bot.join({ ...f.channel, id: 'synthetic-replacement-channel' } as never);
    const replacement = f.bot.connection!;
    assert.equal(f.connection.state.status, VoiceConnectionStatus.Destroyed);
    assert.notEqual(replacement, f.connection);
    assert.equal(f.engine.connected, true);
    assert.equal(f.engine.paused, true);
    assert.equal(f.engine.runId, 'synthetic-run');
    assert.equal(f.engine.lastError, '');
    assert.equal(f.disconnects(), 0);
    transition(replacement, VoiceConnectionStatus.Ready);
    await joining;
    const diagnostics = f.engine.diagnostics.snapshot();
    f.connection.emit('stateChange', replacement.state, { ...replacement.state, status: VoiceConnectionStatus.Destroyed });
    t.mock.timers.tick(60000);
    assert.equal(f.bot.connection, replacement);
    assert.equal(f.engine.connected, true);
    assert.equal(f.disconnects(), 0);
    assert.deepEqual(f.engine.diagnostics.snapshot(), diagnostics);
    assert.equal(other.connection.state.status, VoiceConnectionStatus.Ready);
    assert.equal(other.engine.connected, true);
    assert.equal(other.disconnects(), 0);
});

test('gateway destruction while Ready clears only the affected guild exactly once', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = await fixture(t), other = await fixture(t);
    f.adapterDestroyed();
    const diagnostics = f.engine.diagnostics.snapshot();
    assert.equal(f.connection.state.status, VoiceConnectionStatus.Destroyed);
    assert.equal(f.bot.connection, null);
    assert.equal(f.engine.connected, false);
    assert.equal(f.disconnects(), 1);
    assert.equal(diagnostics.events.filter(event => event.reason === 'voice-error').length, 1);
    // Late state notifications cannot create another teardown or contaminate the other guild.
    f.connection.emit('stateChange', other.connection.state, f.connection.state);
    t.mock.timers.tick(60000);
    assert.equal(f.disconnects(), 1);
    assert.deepEqual(f.engine.diagnostics.snapshot(), diagnostics);
    assert.equal(other.engine.connected, true);
    assert.equal(other.engine.paused, true);
    assert.equal(other.disconnects(), 0);
});

test('a superseded real handshake rejection cannot release the newer join reservation', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = await fixture(t);
    const interrupted = f.bot.join({ ...f.channel, id: 'synthetic-interrupted-channel' } as never);
    const interruptedConnection = f.bot.connection!;
    const failed = assert.rejects(interrupted, /Could not connect to the voice channel/);
    f.bot.disconnect();
    const joining = f.bot.join({ ...f.channel, id: 'synthetic-newest-channel' } as never);
    const replacement = f.bot.connection!;
    interruptedConnection.emit('error', new Error('synthetic late handshake error'));
    await failed;
    assert.equal(f.bot.connection, replacement);
    assert.equal(f.bot.joining, true);
    assert.equal(replacement.state.status, VoiceConnectionStatus.Signalling);
    assert.equal(interruptedConnection.state.status, VoiceConnectionStatus.Destroyed);
    interruptedConnection.emit('error', new Error('synthetic late handshake error'));
    assert.equal(f.engine.lastError, '');
    transition(replacement, VoiceConnectionStatus.Ready);
    await joining;
    t.mock.timers.tick(60000);
    assert.equal(f.bot.connection, replacement);
    assert.equal(f.engine.connected, true);
    assert.equal(f.bot.joining, false);
    assert.equal(f.disconnects(), 1);
});
