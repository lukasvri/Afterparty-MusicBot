import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiscordBot } from '../src/discord.ts';
import { Commands } from '../src/commands.ts';
import { Store } from '../src/store.ts';
import { Engine } from '../src/engine.ts';
import { Providers } from '../src/providers.ts';
import { publicTrack, type Track } from '../src/types.ts';
import { deferred } from './deferred.ts';

function favoriteFixture() {
    const dir = mkdtempSync(join(tmpdir(), 'afterparty-discord-favorites-'));
    const store = new Store(join(dir, 'core.sqlite'));
    store.favorite('other-listener', 'Evening', 'other-selection');
    store.favorite('listener', 'Evening', 'my-selection');
    store.favorite('other-listener', 'Other favorite', 'other-favorite');
    let voiceChecks = 0;
    const added: string[] = [];
    const replies: string[] = [];
    const bot = Object.assign(Object.create(DiscordBot.prototype), {
        guildId: 'synthetic-guild',
        engine: { store, providers: { search: async () => { throw Error('Unexpected provider search'); } } },
        autocompleteAt: new Map<string, number>(),
        sameVoice: async () => { voiceChecks++; },
        commands: { add: async (query: string) => { added.push(query); return 1; } },
        playerMessage: { confirmQueue: async () => {} },
    }) as DiscordBot;
    const interaction = (subcommand: string, name = 'Evening') => ({
        guildId: bot.guildId, user: { id: 'listener' }, commandName: 'favorites',
        deferred: true, deferReply: async () => {}, isButton: () => false,
        options: {
            getSubcommand: () => subcommand,
            getString: (key: string) => key === 'name' ? name : 'new-selection',
            getBoolean: () => false,
        },
        editReply: async (reply: string) => { replies.push(reply); },
        deleteReply: async () => {},
    });
    return {
        bot, store, added, replies, interaction, voiceChecks: () => voiceChecks,
        close: () => { store.close(); rmSync(dir, { recursive: true, force: true }); },
    };
}

test('favorite playback and listing select the requesting listener within the guild', async () => {
    const t = favoriteFixture();
    try {
        await t.bot.interaction(t.interaction('use') as never);
        assert.deepEqual(t.added, ['my-selection']);
        assert.equal(t.voiceChecks(), 1);
        await t.bot.interaction(t.interaction('list') as never);
        assert.deepEqual(t.replies, ['Evening']);
        await t.bot.interaction(t.interaction('use', 'Other favorite') as never);
        assert.deepEqual(t.added, ['my-selection']);
        assert.match(t.replies.at(-1)!, /Fant ikke favoritten/);
    } finally { t.close(); }
});

test('favorite create and remove do not require active voice playback or affect another author', async () => {
    const t = favoriteFixture();
    try {
        t.bot.sameVoice = async () => { throw Error('No active voice session'); };
        await t.bot.interaction(t.interaction('create', 'New favorite') as never);
        assert.equal(t.store.favorites('listener').find(f => f.name === 'New favorite')?.query, 'new-selection');
        await t.bot.interaction(t.interaction('remove') as never);
        assert(!t.store.favorites('listener').some(f => f.name === 'Evening'));
        assert.equal(t.store.favorites('other-listener').find(f => f.name === 'Evening')?.query, 'other-selection');
    } finally { t.close(); }
});

function autocompleteInteraction(commandName: string, name: string, value: string) {
    const replies: { name: string; value: string }[][] = [];
    const result = deferred<void>();
    const interaction = {
        guildId: 'synthetic-guild', user: { id: 'listener' }, commandName, responded: false,
        isAutocomplete: () => true,
        options: { getFocused: (full?: boolean) => full ? { name, value } : value },
        respond: async (choices: { name: string; value: string }[]) => {
            interaction.responded = true;
            replies.push(choices);
            result.resolve();
        },
    };
    return { interaction, replies, responded: result.promise };
}

test('favorite autocomplete returns usable names for the author even with a short or empty query', async () => {
    const t = favoriteFixture();
    try {
        for (const query of ['', 'e', 'EVEN', 'missing']) {
            const call = autocompleteInteraction('favorites', 'name', query);
            t.bot.handleInteraction(call.interaction as never);
            await call.responded;
            assert.deepEqual(call.replies, [query === 'missing' ? [] : [{ name: 'Evening', value: 'Evening' }]]);
        }
    } finally { t.close(); }
});

test('favorite autocomplete caps saved choices at the Discord limit without provider calls', async () => {
    const t = favoriteFixture();
    try {
        for (let i = 0; i < 30; i++) t.store.favorite('listener', 'Saved ' + i, 'selection ' + i);
        const call = autocompleteInteraction('favorites', 'name', 'Saved');
        t.bot.handleInteraction(call.interaction as never);
        await call.responded;
        assert.equal(call.replies[0].length, 25);
        assert(call.replies[0].every(choice => choice.value === choice.name));
    } finally { t.close(); }
});

test('music autocomplete remains bounded, throttles searches, and recovers provider failures', async context => {
    const t = favoriteFixture();
    let now = 10_000, searches = 0;
    context.mock.method(Date, 'now', () => now);
    try {
        t.bot.engine.providers.search = async () => {
            searches++;
            if (searches > 1) throw Error('Provider unavailable');
            return [{ id: 'abcdefghijk', artist: 'Artist', title: 'Example song' }] as never;
        };
        const first = autocompleteInteraction('play', 'query', 'Example');
        t.bot.handleInteraction(first.interaction as never);
        await first.responded;
        assert.deepEqual(first.replies[0], [{ name: 'Artist · Example song', value: 'https://www.youtube.com/watch?v=abcdefghijk' }]);
        const throttled = autocompleteInteraction('play', 'query', 'Example song');
        t.bot.handleInteraction(throttled.interaction as never);
        await throttled.responded;
        assert.deepEqual(throttled.replies[0], []);
        assert.equal(searches, 1);
        now += 1000;
        const failed = autocompleteInteraction('play-next', 'query', 'Another');
        t.bot.handleInteraction(failed.interaction as never);
        await failed.responded;
        assert.deepEqual(failed.replies[0], []);
        assert.equal(searches, 2);
    } finally { t.close(); }
});

test('invalid sleep replacement leaves the previous deadline and timer operational', async context => {
    context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
    let stopped = 0;
    const commands = new Commands({ stop: () => { stopped++; } } as never);
    try {
        await commands.execute({ action: 'sleep-timer', minutes: 1 });
        assert.equal(commands.sleepUntil, 61_000);
        await assert.rejects(commands.execute({ action: 'sleep-timer', minutes: 0 }), /1 til 1440/);
        assert.equal(commands.sleepUntil, 61_000);
        context.mock.timers.tick(60_000);
        assert.equal(stopped, 1);
        assert.equal(commands.sleepUntil, null);
        assert.equal(commands.sleep, null);
    } finally { commands.close(); }
});

test('duplicate cleanup keeps a queued concert separate from the same private Discord song', async () => {
    const current = { id: 'abcdefghijk', entryId: 'current-private', concert: false };
    const concert = { ...current, entryId: 'queued-concert', concert: true };
    const next = { id: 'bcdefghijkl', entryId: 'next-private', concert: false };
    let invalidations = 0, persisted = 0, changes = 0;
    const engine = {
        current,
        queue: [{ ...current, entryId: 'duplicate-private' }, concert, { ...concert, entryId: 'duplicate-concert' }, next],
        mixer: { invalidateNext: () => { invalidations++; } },
        persist: () => { persisted++; }, changed: () => { changes++; },
    };
    const commands = new Commands(engine as never);
    await commands.execute({ action: 'cleanup-duplicates' }, 'discord', 'listener');
    assert.deepEqual(engine.queue, [concert, next]);
    assert.equal(engine.current, current);
    assert.equal(invalidations, 1);
    assert.equal(persisted, 1);
    assert.equal(changes, 1);
});

function replayFixture() {
    const store = new Store(':memory:');
    const engine = new Engine(store, new Providers(store, {}), {
        onIdle: null, onError: null, play() {}, pause() {}, resume() {}, stop() {},
        duration: () => 0, advancing: () => false, buffering: () => false,
    });
    engine.connected = true;
    // Exercise actual queue/history/anchor handling without launching audio.
    engine.startTrack = async track => { engine.adoptTrack(track); };
    const commands = new Commands(engine);
    const song = (id: string, title: string, concert = false): Track => ({
        id, entryId: id, title, artist: 'Aster - Topic', source: 'youtube',
        duration: 210, image: '', live: false, embeddable: true, concert,
        radio: true, radioRelatedTo: 'original001', requestedBy: 'private-listener',
    });
    return {
        store, engine, commands, song,
        close: () => { commands.close(); engine.close(); store.close(); },
    };
}

test('unskip preserves explicitly replayed radio tracks and their private or concert intent', async () => {
    for (const concert of [false, true]) {
        const t = replayFixture();
        try {
            const previous = t.song('previous001', 'Previous song', concert);
            const current = t.song('current0001', 'Displaced song', concert);
            t.engine.current = current;
            t.engine.historyEntries = [previous, current];
            t.store.record('played-previous', publicTrack(previous)!);
            t.store.record('played-current', publicTrack(current)!);
            await t.commands.execute({ action: 'unskip' }, 'discord', 'listener');
            assert.equal(t.engine.current?.id, previous.id);
            assert.notEqual(t.engine.current?.entryId, previous.entryId);
            assert.equal(t.engine.current?.radio, false);
            assert.equal(t.engine.radioSeed?.id, previous.id);
            const queued = t.engine.queue[0];
            assert.notEqual(queued.entryId, current.entryId);
            assert.equal(queued.radioRelatedTo, undefined);
            await t.engine.startNext();
            assert.equal(t.engine.current?.id, current.id, 'The displaced song must survive history filtering');
            assert.equal(t.engine.current?.concert, concert);
            assert.equal(t.engine.radioSeed?.id, current.id);
            assert.equal(t.engine.websiteSnapshot().current?.id, concert ? current.id : undefined);
            assert(!JSON.stringify(t.engine.snapshot()).includes('private-listener'));
        } finally { t.close(); }
    }
});

test('saved queue restoration replays chosen recordings without changing the saved copy or publication intent', async () => {
    for (const action of ['snapshot-restore', 'snapshot-load']) {
        const t = replayFixture();
        try {
            t.engine.current = { ...t.song('original001', 'Opening'), radio: false };
            const privateSong = t.song('private0001', 'Private song');
            const concert = t.song('concert0001', 'Shared concert', true);
            const existing = { ...t.song('existing001', 'Existing request'), radio: false };
            t.engine.queue = [existing];
            const saved = { id: 'saved', name: 'Saved queue', createdAt: '2026-10-17T00:00:00Z', tracks: [privateSong, concert] };
            t.store.set('snapshots', [saved]);
            t.store.record('played-private', publicTrack(privateSong)!);
            t.store.record('played-concert', publicTrack(concert)!);
            const replace = action === 'snapshot-restore';
            await t.commands.execute({ action, id: 'saved', replace }, 'admin');
            assert.deepEqual(t.engine.queue.map(track => track.id), [...(replace ? [] : [existing.id]), privateSong.id, concert.id]);
            if (!replace) await t.engine.startNext();
            for (const selected of [privateSong, concert]) {
                await t.engine.startNext();
                assert.equal(t.engine.current?.id, selected.id);
                assert.notEqual(t.engine.current?.entryId, selected.entryId);
                assert.equal(t.engine.current?.radio, false);
                assert.equal(t.engine.current?.radioRelatedTo, undefined);
                assert.equal(t.engine.radioSeed?.id, selected.id);
                assert.equal(t.engine.websiteSnapshot().current?.id, selected.concert ? selected.id : undefined);
            }
            assert.deepEqual(t.store.get('snapshots', []), [saved]);
        } finally { t.close(); }
    }
});
