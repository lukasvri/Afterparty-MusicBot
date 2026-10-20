import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as diagnostics from '../lib/player-diagnostics.ts';

// Execute the real player effect with deterministic timers and a fake provider.
// This tests callback ordering, not browser rendering or YouTube compatibility.
const source = ts.createSourceFile('afterparty.tsx', readFileSync(new URL('../app/afterparty.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect: ts.ArrowFunction | undefined;
function find(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect') {
    const callback = node.arguments[0];
    if (callback && ts.isArrowFunction(callback) && callback.getText(source).includes('loadYoutube()')) effect = callback;
  }
  ts.forEachChild(node, find);
}
find(source);
assert(effect, 'The real player initialization effect must be exercised');
const code = ts.transpileModule(`(${effect.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
type Events = { onReady: () => void; onError: (event: { data: number }) => void };
function harness() {
  let error = '', loading = false, ready = false;
  let resolve!: () => void, reject!: (error: Error) => void;
  const api = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const timers = new Map<number, () => void>();
  let next = 0, events: Events | undefined, destroyed = 0;
  const playerReady = { get current() { return ready; }, set current(value: boolean) { ready = value; } };
  const noop = () => {};
  const context = {
    ...diagnostics, consent: true,
    playerRoot: { current: { replaceChildren: noop, querySelector: () => null } },
    playerReady, player: { current: null }, roomRef: { current: { current: { id: 'synthetic01' } } },
    bufferStarted: { current: null }, loadedId: { current: '' }, syncRef: { current: noop },
    setPlayerLoading: (value: boolean) => { loading = value; },
    setPlayerError: (value: string) => { error = value; },
    setBufferSeconds: noop, setSyncStatus: noop, setAutoplayBlocked: noop, playerAudioReady: noop,
    loadYoutube: () => api,
    location: { origin: 'https://fixture.example' }, document: { createElement: () => ({}) },
    window: { YT: { Player: class { constructor(_target: unknown, options: { events: Events }) { events = options.events; } destroy() { destroyed++; } } } },
    setTimeout: (callback: () => void) => { timers.set(++next, callback); return next; },
    clearTimeout: (id: number) => { timers.delete(id); },
  };
  const cleanup = (runInNewContext(code, context) as () => () => void)();
  return {
    get error() { return error; }, get loading() { return loading; }, get ready() { return ready; },
    get events() { assert(events); return events; }, get destroyed() { return destroyed; },
    get pendingTimers() { return timers.size; },
    expire: () => { for (const callback of [...timers.values()]) callback(); timers.clear(); },
    start: async () => { resolve(); await api; await Promise.resolve(); },
    reject: async () => { reject(new Error('specific loader failure')); await api.catch(noop); await Promise.resolve(); },
    cleanup,
  };
}

test('provider rejection survives readiness deadline instead of becoming a generic timeout', async () => {
  for (const code of [2, 5, 100, 101, 150, 153]) {
    const h = harness(); await h.start(); h.events.onError({ data: code });
    const specific = h.error;
    assert(specific); h.expire();
    assert.equal(h.error, specific, `provider ${code} must survive the readiness deadline`);
    assert.equal(h.loading, false);
    assert.equal((diagnostics.playerDiagnostics() as ReturnType<typeof diagnostics.playerDiagnostics> & {providerErrorCode?:number|null}).providerErrorCode, code);
    h.events.onReady();
    assert.equal(h.ready, false, 'late readiness must not revive a failed attempt');
    assert.equal(h.error, specific);
    h.cleanup();
  }
});

test('loader rejection survives outer deadline and successful readiness cancels it', async () => {
  const failed = harness(); await failed.reject(); failed.expire();
  assert.equal(failed.error, 'specific loader failure'); failed.cleanup();
  const success = harness(); await success.start(); success.events.onReady(); success.expire();
  assert.equal(success.ready, true); assert.equal(success.error, ''); assert.equal(success.loading, false); success.cleanup();
});

test('an unanswered player still reports the original readiness timeout', async () => {
  const h = harness(); await h.start(); h.expire();
  assert.equal(h.error, 'YouTube-spilleren svarer ikke. Prøv videoen igjen.');
  assert.equal(h.loading, false); h.cleanup();
});

test('retry and unmount ignore old errors, readiness callbacks and loader completions', async () => {
  const old = harness(); await old.start(); old.events.onError({ data: 153 }); old.cleanup();
  const retry = harness(); await retry.start(); retry.events.onReady();
  assert.equal((diagnostics.playerDiagnostics() as ReturnType<typeof diagnostics.playerDiagnostics> & {providerErrorCode?:number|null}).providerErrorCode, null);
  old.events.onError({ data: 101 }); old.events.onReady(); old.expire();
  assert.equal(retry.error, ''); assert.equal(retry.ready, true); assert.equal(old.ready, false);
  assert.equal((diagnostics.playerDiagnostics() as ReturnType<typeof diagnostics.playerDiagnostics> & {providerErrorCode?:number|null}).providerErrorCode, null, 'old callbacks must not change retry diagnostics');
  assert.equal(old.destroyed, 1); assert.equal(old.pendingTimers, 0); retry.cleanup();
  const pending = harness(); pending.cleanup(); await pending.start(); pending.expire();
  assert.equal(pending.error, '');
  const rejected = harness(); rejected.cleanup(); await rejected.reject(); rejected.expire();
  assert.equal(rejected.error, '', 'a loader rejected after unmount must not update state');
});
