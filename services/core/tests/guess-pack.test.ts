import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGuessPackInventory, getGuessPack, getGuessPackClips, listGuessPacks, validateGuessPack } from '../src/guess-packs.ts';
import { runGuessPack } from '../src/guess-pack.ts';
import { prepareConfiguredGuessSource } from '../src/guess-source.ts';
import { checkConfiguredGuessSource } from '../src/guess-check.ts';
import { GUESS_AUDIO_RATE, guessWave } from '../src/guess-audio-format.ts';

const id = 'edm-festival-hits';
const ids = ['3nQNiWdeH2Q', 'SHFTHDncw0g', 'UtF6Jej8yb4', 'IcrbM1l_BoI', 'DuFUtL8zUAk', 'l9Q7GISatW0', '1y6smkh6c-0', 'JRfuAukYTKg'];
const approvals = () => ids.map(videoId => ({ videoId, permission: {
  approved: true, reference: 'https://permission.example.test/synthetic-approval', expiresAt: Date.now() + 3_600_000,
} }));
async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'afterparty-guess-pack-'));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}
function noAnswers(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of [...ids, ...getGuessPack(id).tracks.flatMap(track => [track.title, track.artist]), 'https:', 'uploaderName', 'sourceUrl'])
    assert(!text.includes(secret), secret);
}

test('the bundled verified pack contains eight distinct canonical sources and no permission claims', () => {
  assert.deepEqual(listGuessPacks(), [{ id, name: 'EDM festival hits', count: 8 }]); noAnswers(listGuessPacks());
  const pack = getGuessPack(id);
  assert.deepEqual(pack.tracks.map(track => track.videoId), ids);
  for (const track of pack.tracks) {
    assert.equal(track.sourceUrl, 'https://www.youtube.com/watch?v=' + track.videoId);
    assert.deepEqual(track.categoryIds, ['2010s', 'edm-classics', id]);
    assert.equal(track.startSeconds, 30); assert.equal(track.durationSeconds, 30); assert(!('permission' in track));
  }
  pack.tracks[0].title = 'Changed'; pack.tracks[0].categoryIds = [];
  assert.equal(getGuessPack(id).tracks[0].title, 'Heroes Tonight');
  assert.throws(() => getGuessPack('../quiz-playlists.json'), { status: 503 });
});

test('the trusted preset entry point copies only curated clip metadata and makes no approval claim', () => {
  const clips = getGuessPackClips(id);
  assert.deepEqual(clips.map(clip => clip.videoId), ids);
  for (const clip of clips) {
    assert.deepEqual(Object.keys(clip).sort(), ['aliases', 'artist', 'categoryIds', 'durationSeconds', 'startSeconds', 'title', 'videoId']);
    assert(!('permission' in clip)); assert(!('rightsCleared' in clip));
  }
  clips[0].title = 'Mutated'; clips[0].categoryIds = [];
  assert.equal(getGuessPackClips(id)[0].title, 'Heroes Tonight');
  assert(getGuessPackClips(id)[0].categoryIds.includes(id));
  assert.throws(() => getGuessPackClips('../other.json'), { status: 503 });
});

test('manifest validation rejects malformed, duplicate, unverified or unbounded recordings and copies only known fields', () => {
  const pack = getGuessPack(id), first = pack.tracks[0];
  const malformed: unknown[] = [null, [], { ...pack, id: 'invented-pack' }, { ...pack, tracks: [] },
    { ...pack, tracks: Array(9).fill(first) }, { ...pack, tracks: Array(1) },
    { ...pack, tracks: [first, first] }, { ...pack, permission: { approved: true } }];
  for (const change of [{ videoId: 'bad' }, { title: 'bad\nanswer' }, { aliases: null }, { aliases: Array(1) }, { aliases: Array(9).fill('Alias') },
    { categoryIds: [] }, { categoryIds: ['2010s'] }, { categoryIds: [id, id] }, { categoryIds: [id, 'unknown'] },
    { startSeconds: null }, { startSeconds: 3601 }, { startSeconds: NaN }, { durationSeconds: 31 }, { durationSeconds: 15.5 },
    { sourceUrl: 'https://evil.example.test/watch?v=' + first.videoId }, { uploaderName: 'bad\u202ename' },
    { evidenceUrl: 'http://evidence.example.test' }, { verifiedAt: '2026-02-30' }, { permission: { approved: true } }])
    malformed.push({ ...pack, tracks: [{ ...first, ...change }] });
  for (const value of malformed) assert.throws(() => validateGuessPack(value), { status: 503 });
  const copied = validateGuessPack({ ...pack, secret: 'discard', tracks: [{ ...first, headers: { Cookie: 'discard' } }] });
  assert(!JSON.stringify(copied).includes('discard'));
});

test('templates remain inactive and approved inventory requires an exact, complete, future permission map', () => {
  const template = buildGuessPackInventory(id);
  assert.equal(template.length, 8); assert(template.every(record => record.permission.approved === false));
  assert(template.every(record => record.permission.reference === '' && record.permission.expiresAt === 0));
  const evidence = approvals().reverse(), active = buildGuessPackInventory(id, evidence);
  assert.deepEqual(active.map(record => record.videoId), ids);
  assert(active.every(record => record.permission.approved));
  assert(!JSON.stringify(active).includes('sourceUrl')); assert(!JSON.stringify(active).includes('verifiedAt'));
  evidence[0].permission.reference = 'https://mutated.example.test';
  active[0].categoryIds = [];
  assert(buildGuessPackInventory(id, approvals())[0].categoryIds.includes(id));
  const invalid: unknown[] = [undefined, null, {}, [], approvals().slice(1), [...approvals(), approvals()[0]],
    approvals().map(() => approvals()[0]), approvals().map((entry, index) => index ? entry : { ...entry, videoId: 'unknown____' })];
  for (const permission of [{ approved: false }, { reference: '' }, { reference: 'http://evidence.example.test' },
    { reference: 'https://user:secret@evidence.example.test' }, { expiresAt: Date.now() }, { expiresAt: Infinity },
    { expiresAt: Number.MAX_SAFE_INTEGER + 1 }, { expiresAt: null }, { secret: 'unexpected' }])
    invalid.push(approvals().map((entry, index) => index ? entry : { ...entry, permission: { ...entry.permission, ...permission } }));
  for (const value of invalid) assert.throws(() => buildGuessPackInventory(id, value), { status: 503 });
});

test('CLI listing is safe, output is exclusive/private and an inactive template fails before any provider I/O', async t => {
  const dir = await directory(t), path = join(dir, 'inventory.json');
  noAnswers(await runGuessPack(['--list']));
  assert.deepEqual(await runGuessPack(['--out', path, '--pack', id]), { packId: id, count: 8, approved: false });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const bytes = await readFile(path, 'utf8'), records = JSON.parse(bytes);
  assert(records.every((record: { permission: { approved: boolean } }) => !record.permission.approved));
  await assert.rejects(runGuessPack(['--pack', id, '--out', path]), { status: 503 });
  assert.equal(await readFile(path, 'utf8'), bytes);
  const options = { signal: new AbortController().signal, youtube: {
    extract: async () => { assert.fail('inactive template must not extract'); },
    fetcher: async () => { assert.fail('inactive template must not fetch'); },
    decode: async () => { assert.fail('inactive template must not decode'); },
  } };
  const config = { GUESS_YOUTUBE_CLIPS: '1', GUESS_YOUTUBE_INVENTORY_PATH: path };
  await assert.rejects(prepareConfiguredGuessSource(config, options), { status: 503 });
  assert.equal(await prepareConfiguredGuessSource({ ...config, GUESS_YOUTUBE_CLIPS: '0' }, options), undefined);
});

test('CLI rejects unknown/duplicate flags, unsafe paths, malformed approval files and symlinks before creating output', async t => {
  const dir = await directory(t), output = join(dir, 'out.json'), file = join(dir, 'approval.json');
  const invalid = [[], ['--list', '--pack', id], ['--pack', id], ['--pack', id, '--out', 'relative.json'],
    ['--pack', id, '--out', dir + '/../out.json'], ['--pack', id, '--out', output, '--out', output],
    ['--pack', id, '--out', output, '--approve', 'true'], ['--pack', 'unknown', '--out', output]];
  for (const args of invalid) await assert.rejects(runGuessPack(args), { status: 503 });
  for (const content of ['not JSON', '[]', JSON.stringify(approvals().slice(1)), 'x'.repeat(32769)]) {
    await writeFile(file, content);
    await assert.rejects(runGuessPack(['--pack', id, '--out', output, '--approval-file', file]), { status: 503 });
    await assert.rejects(stat(output), { code: 'ENOENT' });
  }
  const original = JSON.stringify(approvals()); await writeFile(file, original);
  const link = join(dir, 'approval-link.json'); await symlink(file, link);
  await assert.rejects(runGuessPack(['--pack', id, '--out', output, '--approval-file', link]), { status: 503 });
  await symlink(file, output);
  await assert.rejects(runGuessPack(['--pack', id, '--out', output, '--approval-file', file]), { status: 503 });
  assert.equal(await readFile(file, 'utf8'), original, 'exclusive output creation never overwrites a symlink target');
});

test('approved CLI inventory prepares all eight recordings privately and preflight exposes only category capacity', async t => {
  const dir = await directory(t), path = join(dir, 'inventory.json'), file = join(dir, 'approvals.json');
  await writeFile(file, JSON.stringify(approvals()));
  const result = await runGuessPack(['--pack', id, '--approval-file', file, '--out', path]);
  assert.deepEqual(result, { packId: id, count: 8, approved: true }); noAnswers(result);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  let extracts = 0, fetches = 0, decodes = 0;
  const wav = guessWave(new Uint8Array(GUESS_AUDIO_RATE * 2 * 30));
  const output = await checkConfiguredGuessSource({ GUESS_YOUTUBE_CLIPS: '1', GUESS_YOUTUBE_INVENTORY_PATH: path }, {
    signal: new AbortController().signal, youtube: {
      extract: async args => {
        const videoId = new URL(args.at(-1)!).searchParams.get('v'); assert(ids.includes(videoId!)); extracts++;
        return { id: videoId, is_live: false, duration: 180, ext: 'webm', vcodec: 'none', acodec: 'opus',
          url: 'https://rr1---synthetic.googlevideo.com/videoplayback?mime=audio%2Fwebm' };
      }, fetcher: async () => { fetches++; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/webm' } }); },
      decode: async (_input, clip) => { decodes++; assert.deepEqual(clip, { format: 'webm', startSeconds: 30, durationSeconds: 30 }); return wav; },
    },
  });
  assert.equal(output.status, 'ready');
  assert.deepEqual(output.categories.map(category => [category.id, category.count]), [['2010s', 8], ['edm-classics', 8], [id, 8]]);
  assert(output.categories.every(category => JSON.stringify(category.durations) === JSON.stringify([{ seconds: 30, count: 8 }])));
  noAnswers(output); assert.deepEqual([extracts, fetches, decodes], [8, 8, 8]);
});

test('a malformed final approval in private inventory fails before the first extraction, download or decode', async t => {
  const dir = await directory(t), path = join(dir, 'invalid-inventory.json');
  const active = buildGuessPackInventory(id, approvals());
  for (const permission of [{ ...active[7].permission, approved: false }, { ...active[7].permission, expiresAt: 0 },
    { ...active[7].permission, reference: 'http://permission.example.test' }, null]) {
    await writeFile(path, JSON.stringify(active.map((record, index) => index === 7 ? { ...record, permission } : record)));
    await assert.rejects(prepareConfiguredGuessSource({ GUESS_YOUTUBE_CLIPS: '1', GUESS_YOUTUBE_INVENTORY_PATH: path }, {
      signal: new AbortController().signal, youtube: {
        extract: async () => { assert.fail('validate every approval before extracting the first recording'); },
        fetcher: async () => { assert.fail('invalid inventory must not fetch'); },
        decode: async () => { assert.fail('invalid inventory must not decode'); },
      },
    }), { status: 503 });
  }
});

test('actual CLI emits only a listing or generic error without raw paths and answers', () => {
  const script = fileURLToPath(new URL('../src/guess-pack.ts', import.meta.url));
  const listing = spawnSync(process.execPath, [script, '--list'], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr); noAnswers(JSON.parse(listing.stdout));
  const error = spawnSync(process.execPath, [script, '--pack', id, '--out', '/private/missing-sensitive-directory/output.json'], { encoding: 'utf8' });
  assert.equal(error.status, 1); assert.equal(error.stdout, '');
  assert.equal(error.stderr, 'The private game playlist could not be generated.\n');
});
