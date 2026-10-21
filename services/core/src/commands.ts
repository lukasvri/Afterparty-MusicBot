import { randomUUID } from 'node:crypto';
import { ConcertQueue } from './concert-queue.ts';
import { Engine } from './engine.ts';
import { UserError, type Track, type Settings, type SavedQueue } from './types.ts';

const REVISION_ACTIONS = new Set([
    'pause', 'resume', 'skip', 'next', 'seek', 'seek-relative', 'replay', 'unskip',
    'remove', 'move', 'jump', 'clear', 'shuffle', 'cleanup-duplicates', 'snapshot-restore', 'snapshot-load',
]);

function replayTrack(track: Track): Track {
    // Restoring history or a saved queue is an explicit selection, so automatic
    // radio exclusions must not discard the chosen recording later in the queue.
    const selected = { ...track, entryId: randomUUID(), radio: false };
    delete selected.radioRelatedTo;
    return selected;
}

export class Commands {
    engine: Engine;
    concertQueue: ConcertQueue;
    activity: {
        at: string;
        text: string;
    }[] = [];
    sleep: ReturnType<typeof setTimeout> | null = null;
    sleepUntil: number | null = null;
    enqueueTail: Promise<unknown> = Promise.resolve();
    disconnect: (() => void) | null = null;
    diagnostic: (() => Promise<string>) | null = null;
    constructor(engine: Engine) { this.engine = engine; this.concertQueue = new ConcertQueue(engine); }
    note(text: string) { this.activity.unshift({ at: new Date().toISOString(), text }); this.activity = this.activity.slice(0, 20); }
    async add(query:string, author='website', options:{next?:boolean;immediate?:boolean;shuffle?:boolean;concert?:boolean;moderated?:boolean}={}) {
        const e=this.engine, epoch=e.queueGeneration;
        const found=e.providers.resolve(query).then(tracks=>({tracks}),error=>({error}));
        const result=this.enqueueTail.catch(()=>{}).then(async()=>{
            const outcome=await found;
            if('error' in outcome)throw outcome.error;
            const tracks=outcome.tracks.map(t=>({...t,requestedBy:author,concert:options.concert===true}));
            if(options.concert&&(!tracks.length||tracks.some(t=>t.source!=='youtube'||!t.embeddable)))throw new UserError('This video cannot be shown in Afterparty. Choose another YouTube video.');
            if(epoch!==e.queueGeneration||!e.connected)throw new UserError('Playback stopped before the search finished.');
            if(options.shuffle)for(let i=tracks.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[tracks[i],tracks[j]]=[tracks[j],tracks[i]];}
            const count=options.moderated && this.concertQueue.request(tracks) ? tracks.length : e.enqueue(tracks,options.next,options.immediate);
            this.note(options.concert?'Added a concert to Discord and Afterparty':'Added music to Discord');
            return count;
        });
        this.enqueueTail=result;
        return result;
    }
    async execute(input: Record<string, unknown>, scope: 'public' | 'admin' | 'discord' = 'admin', author = 'website') {
        const e = this.engine, action = String(input.action);
        if(scope==='public'&&['pause','resume','skip'].includes(action)&&(!e.current?.concert||input.playbackKey!=='core:'+e.current.entryId))throw new UserError('The concert has changed. Refresh the page and try again.',409);
        if (scope === 'public' && !['pause', 'resume', 'skip', 'enqueue'].includes(action))
            throw new UserError('This action requires administrator access.', 403);
        if (REVISION_ACTIONS.has(action) && typeof input.queueRevision === 'string' && input.queueRevision !== e.revision())
            throw new UserError('The queue has changed. Refresh and try again.', 409);
        if (['pause', 'resume', 'skip', 'enqueue', 'seek'].includes(action) && !e.connected)
            throw new UserError('Start the bot in a Discord voice channel first.', 409);
        switch (action) {
            case 'enqueue': {
                if (scope === 'public' && (typeof input.videoId !== 'string' || !/^[\w-]{11}$/.test(input.videoId)))
                    throw new UserError('Choose a YouTube video.');
                await this.add(String(input.query ?? input.videoId ?? ''), author, {next:Boolean(input.next),immediate:Boolean(input.immediate),shuffle:Boolean(input.shuffle),moderated:scope==='public',concert:scope==='public'||input.concert===true});
                break;
            }
            case 'pause':
                if (!e.current)
                    throw new UserError('No song is playing.');
                if (!e.paused)
                    e.pause();
                break;
            case 'resume':
                e.resume();
                break;
            case 'skip':
            case 'next':
                await e.skip(Number(input.number ?? 1));
                break;
            case 'stop':
                e.stop();
                break;
            case 'disconnect':
                e.stop();
                this.disconnect?.();
                break;
            case 'seek':
                await e.seek(Number(input.seconds ?? input.position));
                break;
            case 'seek-relative':
                await e.seek(Math.max(0, e.snapshot().position + Number(input.seconds)));
                break;
            case 'diagnostic':
                if (scope !== 'admin' || !this.diagnostic)
                    throw new UserError('Access denied.', 403);
                return this.diagnostic();
            case 'replay':
                await e.seek(e.current?.offset ?? 0);
                break;
            case 'unskip': {
                const previous = e.historyEntries.at(-2);
                if (!previous)
                    throw new UserError('There is no previous song to return to.');
                if (e.current)
                    e.queue.unshift(replayTrack(e.current));
                await e.startTrack(replayTrack(previous));
                break;
            }
            case 'remove':
                e.remove(Number(input.position ?? input.index) - Number(input.position !== undefined), Number(input.range ?? 1));
                break;
            case 'move':
                e.move(Number(input.from) - 1, Number(input.to) - 1);
                break;
            case 'jump':
                await e.skip(Number(input.position));
                break;
            case 'clear':
                e.clear();
                break;
            case 'shuffle':
                e.shuffle();
                break;
            case 'volume':
                e.setVolume(Number(input.value ?? input.level));
                break;
            case 'loop-sang':
            case 'loop':
                e.loop = typeof input.value === 'boolean' ? input.value : !e.loop;
                e.mixer?.invalidateNext();
                e.changed();
                break;
            case 'loop-queue':
                e.loopQueue = typeof input.value === 'boolean' ? input.value : !e.loopQueue;
                e.changed();
                break;
            case 'sleep-timer':
            case 'sleep': {
                const minutes = Number(input.minutes);
                if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440)
                    throw new UserError('Choose a stop timer from 1 to 1440 minutes.');
                if (this.sleep)
                    clearTimeout(this.sleep);
                this.sleepUntil = Date.now() + minutes * 60000;
                this.sleep = setTimeout(() => { e.stop(); this.sleep = null; this.sleepUntil = null; }, minutes * 60000);
                break;
            }
            case 'cancel-sleep-timer':
            case 'sleep-cancel':
                if (this.sleep)
                    clearTimeout(this.sleep);
                this.sleep = null;
                this.sleepUntil = null;
                break;
            case 'snapshot-save': {
                const snapshots = e.store.get<SavedQueue[]>('snapshots', []);
                snapshots.unshift({ id: randomUUID(), name: String(input.name ?? 'Spilleliste').slice(0, 80), createdAt: new Date().toISOString(), tracks: [...(e.current ? [e.current] : []), ...e.queue] });
                e.store.set('snapshots', snapshots.slice(0, 100));
                break;
            }
            case 'snapshot-restore':
            case 'snapshot-load': {
                const s = e.store.get<SavedQueue[]>('snapshots', []).find(s => s.id === input.id);
                if (!s)
                    throw new UserError('Playlist not found.');
                if (input.replace)
                    e.clear();
                e.enqueue(s.tracks.map(replayTrack));
                break;
            }
            case 'snapshot-delete':
                e.store.set('snapshots', e.store.get<SavedQueue[]>('snapshots', []).filter(s => s.id !== input.id));
                break;
            case 'cleanup-duplicates': {
                const key = (track: Track) => JSON.stringify([track.concert === true, track.id]);
                const seen = new Set(e.current ? [key(e.current)] : []);
                e.queue = e.queue.filter(t => { const id = key(t); if (seen.has(id))
                    return false; seen.add(id); return true; });
                e.mixer?.invalidateNext();
                e.persist();
                e.changed();
                break;
            }
            default: throw new UserError('Unknown player action.');
        }
        this.note(action === 'pause' ? 'Playback paused' : action === 'resume' ? 'Playback resumed' : action === 'skip' ? 'Skipped to the next song' : 'Performed ' + action);
        return 'Done by the Afterparty bot.';
    }
    updateSettings(input: Record<string, unknown>) { const bounds: Record<string, [
        number,
        number
    ]> = { playlistLimit: [1, 1000], secondsToWaitAfterQueueEmpties: [0, 86400], defaultVolume: [0, 100], defaultQueuePageSize: [1, 30], turnDownVolumeWhenPeopleSpeakTarget: [0, 100], crossfade: [0, 12], audioBitrateKbps: [64, 384] }; const next: Partial<Settings> = {}; for (const key of Object.keys(this.engine.settings)) {
        if (!(key in input))
            continue;
        const value = input[key];
        if (key in bounds) {
            if (!Number.isInteger(value) || Number(value) < bounds[key][0] || Number(value) > bounds[key][1])
                throw new UserError('Invalid value for ' + key);
        }
        else if (typeof value !== 'boolean')
            throw new UserError('Invalid value for ' + key);
        (next as Record<string, unknown>)[key] = value;
    } this.engine.setSettings(next); return { ...this.engine.settings, updatedAt: new Date().toISOString() }; }
    close() { if (this.sleep)
        clearTimeout(this.sleep); }
}
