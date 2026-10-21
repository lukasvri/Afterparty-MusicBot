import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createAudioPlayer, VoiceConnectionStatus, type VoiceConnection } from '@discordjs/voice';
import { DiscordBot } from '../src/discord.ts';
import { Engine } from '../src/engine.ts';
import { Commands } from '../src/commands.ts';
import { Providers } from '../src/providers.ts';
import { Store } from '../src/store.ts';
import type { Sink } from '../src/audio.ts';
import type { Track } from '../src/types.ts';
import { deferred } from './deferred.ts';
import { syntheticSong } from './radio-queue-fixture.ts';

/** Exercises production Engine state with synthetic consumed audio, not real voice packets. */
class SyntheticSink implements Sink {
    player = createAudioPlayer();
    milliseconds = 12340;
    stopped = false;
    onIdle: ((id: string) => void) | null = null;
    onError: ((error: Error, id: string) => void) | null = null;
    play() { assert.fail('these state tests must never start audio or FFmpeg'); }
    stop() { this.stopped = true; this.milliseconds = 0; }
    pause() {}
    resume() {}
    duration() { return this.milliseconds; }
    advancing() { return false; }
    buffering() { return !this.stopped; }
}
let fixtureId = 0;
async function fixture(t: TestContext, paused: boolean) {
    const store = new Store(':memory:'), providers = new Providers(store, {}), sink = new SyntheticSink();
    const engine = new Engine(store, providers, sink), commands = new Commands(engine);
    clearInterval(engine.timer);
    engine.settings.radio = false;
    engine.ready = true;
    const bot = Object.assign(Object.create(DiscordBot.prototype), {
        engine, sink, guildId: 'synthetic-state-guild-' + ++fixtureId,
        connection: null, talking: new Set(), client: { user: { id: 'synthetic-bot' } },
    }) as DiscordBot;
    const channel = {
        id: 'synthetic-channel', bitrate: 96000,
        guild: { members: { me: {} }, voiceAdapterCreator: () => ({ sendPayload: () => true, destroy() {} }) },
        permissionsFor: () => ({ has: () => true }),
    };
    const joining = bot.connectVoice(channel as never), connection = bot.connection!;
    transition(connection, VoiceConnectionStatus.Ready);
    await joining;
    const outgoing = syntheticSong(1, { radio: false, concert: true });
    const incoming = syntheticSong(2, { radio: false, concert: true });
    const later = syntheticSong(3, { radio: false, concert: false });
    engine.current = outgoing;
    engine.queue = [incoming, later];
    engine.paused = paused;
    engine.runId = 'synthetic-active-run';
    engine.abort = new AbortController();
    engine.segments = [{ track: outgoing, startFrame: 0, offset: 17.5 }, { track: incoming, startFrame: 500, offset: 3.5 }];
    engine.tick(); // Reconcile the actually consumed crossfade segment before the outage.
    t.after(() => { bot.disconnect(); commands.close(); engine.close(); sink.player.stop(); store.close(); });
    return { store, providers, sink, engine, commands, bot, connection, incoming, later };
}
function transition(connection: VoiceConnection, status: VoiceConnectionStatus) {
    Reflect.set(connection, 'state', { ...connection.state, status });
}
function close(connection: VoiceConnection) {
    Reflect.apply(Reflect.get(connection, 'onNetworkingClose'), connection, [4006]);
}

test('voice recovery preserves the consumed run and pause, then failed recovery leaves an exact restorable checkpoint in one guild', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const a = await fixture(t, false), b = await fixture(t, true);
    const aCurrent = a.engine.current, aRun = a.engine.runId;
    const bState = structuredClone(b.engine.snapshot()), bRecovery = b.store.get('recovery', null);
    const checkpoint = a.store.get<{ track: Track; position: number; paused: boolean }>('recovery', null!);
    assert.equal(checkpoint.track.entryId, a.incoming.entryId);
    assert.equal(checkpoint.position, 5.84);
    assert.equal(checkpoint.paused, false);
    assert.deepEqual(a.engine.queue.map(track => track.entryId), [a.later.entryId]);
    for (const delay of [1, 19999, 17, 8431, 112]) {
        close(a.connection);
        close(b.connection);
        t.mock.timers.tick(delay);
        transition(a.connection, VoiceConnectionStatus.Ready);
        transition(b.connection, VoiceConnectionStatus.Ready);
        assert.equal(a.engine.current, aCurrent);
        assert.equal(a.engine.runId, aRun);
        assert.equal(a.engine.paused, false);
        assert.equal(b.engine.paused, true);
        assert.deepEqual(a.store.get('recovery', null), checkpoint);
    }
    close(a.connection);
    t.mock.timers.tick(20000);
    const snapshot = a.engine.snapshot();
    assert.equal(snapshot.connected, false);
    assert.equal(snapshot.playing, false);
    assert.equal(snapshot.buffering, false);
    assert.equal(snapshot.current, null);
    assert.equal(a.engine.runId, null);
    assert.equal(a.engine.abort, null);
    assert.deepEqual(a.engine.queue.map(track => track.entryId), [a.later.entryId]);
    assert.deepEqual(a.store.get('queue', []), a.engine.queue);
    assert.equal(a.store.get('current', 'missing'), null);
    assert.deepEqual(a.store.get('recovery', null), checkpoint, 'disconnect retains the consumed incoming recording and offset');
    // Wall-clock response timestamps can change without a mutation in the other guild.
    assert.deepEqual({ ...b.engine.snapshot(), lastSeen: bState.lastSeen, serverTime: bState.serverTime }, bState);
    assert.deepEqual(b.store.get('recovery', null), bRecovery);
    assert.equal(b.engine.connected, true);
    assert.equal(b.engine.runId, 'synthetic-active-run');
    a.sink.onIdle?.(aRun!);
    a.sink.onError?.(new Error('synthetic obsolete resource failure'), aRun!);
    assert.equal(a.engine.current, null, 'obsolete audio callbacks cannot restart the disconnected guild');
    const restored = new Engine(a.store, a.providers, new SyntheticSink());
    try {
        clearInterval(restored.timer);
        assert.deepEqual(restored.queue.map(track => track.entryId), [a.incoming.entryId, a.later.entryId]);
        assert.equal(restored.queue[0].offset, checkpoint.position);
        assert.equal(restored.connected, false, 'loading a checkpoint does not activate a real voice connection');
    } finally { restored.close(); }
});

test('a failed guild recovery cancels its in-flight enqueue while another guild keeps FIFO additions and manual pause', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const a = await fixture(t, false), b = await fixture(t, true);
    const first = deferred<Track[]>(), second = deferred<Track[]>(), third = deferred<Track[]>();
    a.providers.resolve = () => first.promise;
    b.providers.resolve = query => query === 'first synthetic' ? second.promise : third.promise;
    const lost = a.commands.add('cancelled synthetic');
    const retainedFirst = b.commands.add('first synthetic'), retainedSecond = b.commands.add('second synthetic');
    const rejected = assert.rejects(lost, /Playback stopped before the search finished/);
    close(a.connection);
    t.mock.timers.tick(20000);
    const aRevision = a.engine.revision();
    third.resolve([syntheticSong(6, { radio: false })]);
    first.resolve([syntheticSong(4, { radio: false })]);
    second.resolve([syntheticSong(5, { radio: false })]);
    await Promise.all([rejected, retainedFirst, retainedSecond]);
    assert.deepEqual(a.engine.queue.map(track => track.entryId), [a.later.entryId]);
    assert.equal(a.engine.revision(), aRevision);
    assert.deepEqual(a.store.get('queue', []), a.engine.queue);
    assert.deepEqual(b.engine.queue.map(track => track.entryId), [b.later.entryId, '5', '6']);
    assert.deepEqual(b.store.get('queue', []), b.engine.queue);
    assert.equal(b.engine.connected, true);
    assert.equal(b.engine.paused, true);
    assert.equal(b.engine.current?.entryId, b.incoming.entryId);
    assert.equal(b.engine.runId, 'synthetic-active-run');
});
