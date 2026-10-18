/** Public metadata only. No mode means no network; --replay never spawns a provider. */
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Providers } from '../services/core/src/providers.ts';
import { Store } from '../services/core/src/store.ts';
import type { ExtractedMedia } from '../services/core/src/external-types.ts';
import type { Track } from '../services/core/src/types.ts';

type Seed = { id: string; artist: string; title: string; group: string; sources: string[] };
type Failure = 'provider-unavailable' | 'provider-blocked' | 'provider-network' | 'provider-timeout' | 'time-budget' | 'request-budget' | 'invalid-output' | 'interrupted';
type Call = { target: string; at: string; elapsedMs: number; command: string[]; metadata?: ExtractedMedia; failure?: Failure };
type Result = { id: string; seed?: ReturnType<typeof smallTrack>; selected?: ReturnType<typeof smallTrack> | null; diagnostics: unknown[]; failure?: Failure };
type Snapshot = {
  schema: 1; capturedAt: string; sourceSha: string; node: string; extractor: string;
  completion?: 'running' | 'complete' | 'interrupted' | 'budget-exhausted';
  sourceState?: { dirty: boolean; status: string; sha256: Record<string, string> };
  configuration: { searchResults: 5; productionSearchResults: 20; concurrency: 1; maxCalls: number; maxSeconds: number; capabilities: string[] };
  seeds: Seed[]; calls: Call[]; results: Result[];
};
const fixedArgs = ['--ignore-config', '--no-cache-dir', '--socket-timeout', '10', '--retries', '0', '--extractor-retries', '0'];
const clean = (value: string) => value.replace(/[\u0000-\u001f]/g, ' ').slice(0, 200);
const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;
function targetOf(args: string[]) {
  const target = args.at(-1) ?? '';
  if (/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(target)) return target;
  if (/^ytsearch5:[^\u0000-\u001f]{1,250}$/.test(target)) return target;
  throw new Error('Only public YouTube video metadata and five-result search are allowed.');
}
/** Discard descriptions, tokens, playback URLs, headers and unrelated provider fields. */
export function smallMetadata(raw: ExtractedMedia): ExtractedMedia {
  if (Array.isArray(raw.entries)) return { entries: raw.entries.filter((item): item is ExtractedMedia => Boolean(item))
    .slice(0, 5).map(item => ({ id: String(item.id ?? '').match(/^[\w-]{11}$/)?.[0] ?? '' })) };
  const result: ExtractedMedia = {};
  for (const key of ['id', 'title', 'artist', 'track', 'uploader'] as const) {
    const value = raw[key];
    if (typeof value === 'string') result[key] = clean(value);
  }
  if (Array.isArray(raw.artists) && raw.artists.length <= 16 && raw.artists.every(artist =>
    typeof artist === 'string' && Boolean(artist.trim()) && artist.length <= 200)) result.artists = [...raw.artists];
  if (typeof raw.duration === 'number') result.duration = raw.duration;
  if (typeof raw.is_live === 'boolean') result.is_live = raw.is_live;
  if (typeof raw.playable_in_embed === 'boolean') result.playable_in_embed = raw.playable_in_embed;
  if (Array.isArray(raw.categories)) result.categories = raw.categories.filter(value => typeof value === 'string').slice(0, 8).map(clean);
  // Retain only short tags the actual parser consumes as genre evidence. In
  // particular, retain a false-positive label instead of laundering it to a genre.
  // These short public input labels are retained before parsing, including
  // rejected labels, so a later parser fix can be checked against the capture.
  result.tags = (raw.tags ?? []).filter(tag => typeof tag === 'string' && tag.length <= 80).slice(0, 64).map(clean);
  const genreLines = typeof raw.description === 'string' ? raw.description.match(/(?:genre|style)\s*:\s*[^\n]+/gi) ?? [] : [];
  const shortLines = genreLines.filter(line => line.length <= 120).slice(0, 4);
  if (shortLines.length) result.description = shortLines.join('\n');
  return result;
}
function smallTrack(track: Track) {
  return { id: track.id, title: clean(track.title), artist: clean(track.artist), duration: track.duration,
    genres: track.genres, music: track.music, live: track.live, embeddable: track.embeddable,
    source: track.source, url: watch(track.id), relatedTo: track.radioRelatedTo };
}
export function validateSeeds(value: unknown): Seed[] {
  if (!Array.isArray(value) || !value.length || value.length > 10) throw new Error('Manifest requires 1 to 10 seeds.');
  const seeds = value.map((item: Seed) => {
    if (!item || !/^[\w-]{11}$/.test(item.id) || !['artist', 'title', 'group'].every(key =>
      typeof item[key as keyof Seed] === 'string' && String(item[key as keyof Seed]).length <= 200)
      || !Array.isArray(item.sources) || !item.sources.length || item.sources.length > 4) throw new Error('Invalid seed manifest.');
    for (const source of item.sources) {
      const url = new URL(source);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        if (source !== watch(item.id)) throw new Error('Source must be a public HTTPS page without credentials or query parameters.');
      }
    }
    return item;
  });
  if (new Set(seeds.map(seed => seed.id)).size !== seeds.length) throw new Error('Use distinct seeds.');
  return seeds;
}
function limited(value: string | undefined, fallback: number, max: number) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new Error(`Budget must be an integer from 1 to ${max}.`);
  return parsed;
}
class ProbeFailure extends Error {
  readonly kind: Failure;
  constructor(kind: Failure) { super(kind); this.kind = kind; }
}
function failure(error: unknown): Failure { return error instanceof ProbeFailure ? error.kind : 'provider-unavailable'; }

/** The child receives no account/API environment, config, cookie file or browser profile. */
async function metadataProcess(command: string, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, args, { windowsHide: true, signal, stdio: ['ignore', 'pipe', 'pipe'],
      env: { NODE_ENV: 'test', PATH: dirname(process.execPath), ...(process.platform === 'win32' ? { SystemRoot: 'C:\\Windows' } : {}) } });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let processFailure: Error | undefined;
    let providerFailure: Failure = 'provider-unavailable';
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 8_000_000) { processFailure = new ProbeFailure('invalid-output'); child.kill(); }
      else chunks.push(chunk);
    });
    // Classify only. Never retain raw provider errors, URLs or arbitrary response text.
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (/sign in|not a bot|captcha|HTTP Error (?:403|429)|geo.?restrict|not available in your country/i.test(text)) providerFailure = 'provider-blocked';
      else if (providerFailure !== 'provider-blocked' && /getaddrinfo|name resolution|timed out|connection|network is unreachable/i.test(text)) providerFailure = 'provider-network';
    });
    child.on('error', error => { processFailure = error; });
    child.once('close', code => {
      if (signal.aborted) reject(new ProbeFailure('time-budget'));
      else if (processFailure || code !== 0) reject(processFailure ?? new ProbeFailure(providerFailure));
      else resolveOutput(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

async function exercise(snapshot: Snapshot, extract: Providers['extract'], onResult?: (result: Result) => void, shouldStop = () => false) {
  const results: Result[] = [];
  for (const item of snapshot.seeds) {
    if (shouldStop()) break;
    const store = new Store(':memory:');
    const providers = new Providers(store, {} as NodeJS.ProcessEnv);
    providers.extract = extract;
    // No key means this capability is unavailable. Keep the actual search/video fallback parsers.
    providers.youtube = async () => { throw new Error('YouTube API disabled: explicit empty environment.'); };
    const search = providers.search.bind(providers);
    providers.search = (query, _count, musicOnly) => search(query, 5, musicOnly);
    const result: Result = { id: item.id, diagnostics: [] };
    const info = console.info;
    console.info = (...args: unknown[]) => {
      if (args[0] === 'core-radio' && typeof args[1] === 'string') result.diagnostics.push(JSON.parse(args[1]));
    };
    try {
      const [seed] = await providers.video([item.id]);
      if (!seed) throw new ProbeFailure('provider-unavailable');
      result.seed = smallTrack(seed);
      result.selected = smallTrackOrNull(await providers.radio(seed, [seed.id]));
    } catch (error) { result.failure = failure(error); }
    finally { console.info = info; store.db.close(); }
    results.push(result);
    onResult?.(result);
  }
  return results;
}
function smallTrackOrNull(track: Track | null) { return track ? smallTrack(track) : null; }

export async function main(argv: string[]) {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!match || flags.has(match[1])) throw new Error('Use unique --name=value options.');
    flags.set(match[1], match[2] ?? '');
  }
  const supported = ['live', 'replay', 'manifest', 'out', 'snapshot', 'limit', 'ytdlp', 'max-calls', 'max-seconds'];
  if ([...flags.keys()].some(key => !supported.includes(key))) throw new Error('Unknown option.');
  if (!flags.has('live') && !flags.has('replay')) {
    console.log('No network performed. Use --live --manifest=FILE --out=FILE --ytdlp=ABSOLUTE_EXE [--limit=2 --max-calls=60 --max-seconds=300], or --replay --snapshot=FILE.');
    return;
  }
  if (flags.has('live') && flags.has('replay')) throw new Error('Choose exactly one mode.');
  if (flags.has('replay')) {
    const snapshot: Snapshot = JSON.parse(readFileSync(resolve(flags.get('snapshot') ?? ''), 'utf8'));
    if (snapshot.schema !== 1 || !Array.isArray(snapshot.calls) || snapshot.calls.length > 240) throw new Error('Unsupported snapshot.');
    if (snapshot.completion && snapshot.completion !== 'complete') {
      console.log(JSON.stringify({ mode: 'replay', completion: snapshot.completion, error: 'Partial capture retained; a full-capture comparison is unavailable.', completedSeeds: snapshot.results.length }));
      process.exitCode = 1;
      return;
    }
    validateSeeds(snapshot.seeds);
    const pending = new Map<string, Call[]>();
    for (const call of snapshot.calls) pending.set(call.target, [...(pending.get(call.target) ?? []), call]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('Network forbidden during replay.'); };
    try {
      const results = await exercise(snapshot, async args => {
        const target = targetOf(args);
        const call = pending.get(target)?.shift();
        if (!call) throw new ProbeFailure(snapshot.calls.length >= snapshot.configuration.maxCalls ? 'request-budget' : 'invalid-output');
        if (call.failure) throw new ProbeFailure(call.failure);
        return structuredClone(call.metadata!);
      });
      const unconsumed = [...pending.values()].reduce((total, calls) => total + calls.length, 0);
      const matches = JSON.stringify(results) === JSON.stringify(snapshot.results);
      console.log(JSON.stringify({ mode: 'replay', capturedSourceSha: snapshot.sourceSha, matches, unconsumed,
        originalResults: snapshot.results, replayResults: results }, null, 2));
      if (!matches || unconsumed) process.exitCode = 1;
    } finally { globalThis.fetch = originalFetch; }
    return;
  }
  const executable = flags.get('ytdlp') ?? '';
  if (!isAbsolute(executable) || !flags.get('out') || !flags.get('manifest')) throw new Error('Live requires explicit absolute --ytdlp, --manifest and --out.');
  const seeds = validateSeeds(JSON.parse(readFileSync(resolve(flags.get('manifest')!), 'utf8')))
    .slice(0, limited(flags.get('limit'), 2, 10));
  const maxCalls = limited(flags.get('max-calls'), 60, 240);
  const maxSeconds = limited(flags.get('max-seconds'), 300, 1200);
  const version = clean((await metadataProcess(executable, ['--ignore-config', '--version'], AbortSignal.timeout(10000))).trim());
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) }).trim();
  const sourceFiles = ['scripts/radio-catalog-probe.ts', ...['providers', 'radio', 'radio-pipeline', 'recommendations', 'matching', 'store', 'extractor']
    .map(name => `services/core/src/${name}.ts`)];
  const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
  const status = execFileSync('git', ['status', '--porcelain', '--', ...sourceFiles], { encoding: 'utf8', cwd: sourceRoot }).trim();
  const sourceState = { dirty: Boolean(status), status, sha256: Object.fromEntries(sourceFiles.map(path =>
    [path, createHash('sha256').update(readFileSync(resolve(sourceRoot, path))).digest('hex')])) };
  const snapshot: Snapshot = { schema: 1, capturedAt: new Date().toISOString(), sourceSha, node: process.version, extractor: version, completion: 'running',
    sourceState,
    configuration: { searchResults: 5, productionSearchResults: 20, concurrency: 1, maxCalls, maxSeconds,
      capabilities: ['public-yt-dlp-metadata', 'no-api-keys', 'no-lastfm', 'no-cookies', 'ignore-config', 'no-audio-downloads', 'fresh-in-memory-store-per-seed'] },
    seeds, calls: [], results: [] };
  const deadline = Date.now() + maxSeconds * 1000;
  const output = resolve(flags.get('out')!);
  mkdirSync(dirname(output), { recursive: true });
  const checkpoint = () => { writeFileSync(output + '.tmp', JSON.stringify(snapshot, null, 2) + '\n'); renameSync(output + '.tmp', output); };
  const stopped = new AbortController();
  const interrupt = () => { snapshot.completion = 'interrupted'; stopped.abort(); checkpoint(); };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  checkpoint();
  let tail: Promise<unknown> = Promise.resolve();
  const extract: Providers['extract'] = (args) => {
    const operation = tail.then(async () => {
      const target = targetOf(args);
      if (!args.includes('--skip-download') || !args.includes('--dump-single-json')) throw new Error('Metadata-only command required.');
      const start = Date.now();
      const call: Call = { target, at: new Date().toISOString(), elapsedMs: 0, command: [...fixedArgs, ...args] };
      if (stopped.signal.aborted) throw new ProbeFailure('interrupted');
      if (snapshot.calls.length >= maxCalls) { snapshot.completion = 'budget-exhausted'; throw new ProbeFailure('request-budget'); }
      snapshot.calls.push(call);
      try {
        if (Date.now() >= deadline) throw new ProbeFailure('time-budget');
        const raw = await metadataProcess(executable, call.command, AbortSignal.any([stopped.signal, AbortSignal.timeout(Math.max(1, Math.min(30000, deadline - Date.now())))]));
        let metadata: ExtractedMedia;
        try { metadata = JSON.parse(raw); } catch { throw new ProbeFailure('invalid-output'); }
        call.metadata = smallMetadata(metadata);
        return metadata;
      } catch (error) {
        call.failure = stopped.signal.aborted ? 'interrupted' : failure(error);
        if (call.failure === 'time-budget' && Date.now() < deadline) call.failure = 'provider-timeout';
        if (call.failure === 'time-budget') snapshot.completion = 'budget-exhausted';
        throw new ProbeFailure(call.failure);
      }
      finally { call.elapsedMs = Date.now() - start; checkpoint(); }
    });
    tail = operation.catch(() => {});
    return operation;
  };
  try {
    await exercise(snapshot, extract, result => { snapshot.results.push(result); checkpoint(); }, () => snapshot.completion !== 'running');
    if (snapshot.completion === 'running') snapshot.completion = 'complete';
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); checkpoint();
  }
  console.log(JSON.stringify({ mode: 'live', sourceSha, extractor: version, calls: snapshot.calls.length, output,
    completion: snapshot.completion, completedSeeds: snapshot.results.length,
    results: snapshot.results, limitations: 'Five search results instead of production20; no Last.fm/API keys. Metadata does not establish audio or listening quality.' }, null, 2));
  if (snapshot.completion !== 'complete') process.exitCode = snapshot.completion === 'interrupted' ? 130 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => { console.error('Probe failed. Check explicit mode, manifest, budgets and controlled executable. No private provider error was printed.'); process.exitCode = 1; });
}
