import { randomUUID } from 'node:crypto';
import { ConcertQueue } from './concert-queue.ts';
import { Engine } from './engine.ts';
import { UserError, type Track, type Settings, type SavedQueue } from './types.ts';

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
            if(options.concert&&(!tracks.length||tracks.some(t=>t.source!=='youtube'||!t.embeddable)))throw new UserError('Videoen kan ikke vises i Afterparty. Velg en annen YouTube-video.');
            if(epoch!==e.queueGeneration||!e.connected)throw new UserError('Avspillingen ble stoppet før søket var ferdig.');
            if(options.shuffle)for(let i=tracks.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[tracks[i],tracks[j]]=[tracks[j],tracks[i]];}
            const count=options.moderated && this.concertQueue.request(tracks) ? tracks.length : e.enqueue(tracks,options.next,options.immediate);
            this.note(options.concert?'La til konsert i Discord og Afterparty':'La til musikk i Discord');
            return count;
        });
        this.enqueueTail=result;
        return result;
    }
    async execute(input: Record<string, unknown>, scope: 'public' | 'admin' | 'discord' = 'admin', author = 'website') {
        const e = this.engine, action = String(input.action);
        if(scope==='public'&&['pause','resume','skip'].includes(action)&&(!e.current?.concert||input.playbackKey!=='core:'+e.current.entryId))throw new UserError('Konserten er endret. Oppdater siden før du prøver igjen.',409);
        if (scope === 'public' && !['pause', 'resume', 'skip', 'enqueue'].includes(action))
            throw new UserError('Denne handlingen krever administratortilgang.', 403);
        if (['skip', 'seek', 'remove', 'move', 'jump'].includes(action) && typeof input.queueRevision === 'string' && input.queueRevision !== e.revision())
            throw new UserError('Køen er endret. Oppdater og prøv igjen.', 409);
        if (['pause', 'resume', 'skip', 'enqueue', 'seek'].includes(action) && !e.connected)
            throw new UserError('Start boten i en talekanal i Discord først.', 409);
        switch (action) {
            case 'enqueue': {
                if (scope === 'public' && (typeof input.videoId !== 'string' || !/^[\w-]{11}$/.test(input.videoId)))
                    throw new UserError('Velg en YouTube-video.');
                await this.add(String(input.query ?? input.videoId ?? ''), author, {next:Boolean(input.next),immediate:Boolean(input.immediate),shuffle:Boolean(input.shuffle),moderated:scope==='public',concert:scope==='public'||input.concert===true});
                break;
            }
            case 'pause':
                if (!e.current)
                    throw new UserError('Ingen sang spiller.');
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
                    throw new UserError('Ingen tilgang.', 403);
                return this.diagnostic();
            case 'replay':
                await e.seek(e.current?.offset ?? 0);
                break;
            case 'unskip': {
                const previous = e.historyEntries.at(-2);
                if (!previous)
                    throw new UserError('Ingen tidligere sang å gå tilbake til.');
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
                    throw new UserError('Velg en stopptimer fra 1 til 1440 minutter.');
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
                    throw new UserError('Fant ikke spillelisten.');
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
            default: throw new UserError('Ukjent spillerhandling.');
        }
        this.note(action === 'pause' ? 'Avspillingen ble satt på pause' : action === 'resume' ? 'Avspillingen fortsatte' : action === 'skip' ? 'Hoppet til neste sang' : 'Utførte ' + action);
        return 'Utført av Afterparty-boten.';
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
                throw new UserError('Ugyldig verdi for ' + key);
        }
        else if (typeof value !== 'boolean')
            throw new UserError('Ugyldig verdi for ' + key);
        (next as Record<string, unknown>)[key] = value;
    } this.engine.setSettings(next); return { ...this.engine.settings, updatedAt: new Date().toISOString() }; }
    close() { if (this.sleep)
        clearTimeout(this.sleep); }
}
