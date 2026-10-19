import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return {
      url: 'data:text/javascript,' + encodeURIComponent("export const env={GUTTA_CORE_PUBLIC_URL:'https://core.example',ADMIN_BRIDGE_KEY:'synthetic-test-key'};"), shortCircuit: true,
    };
    if (specifier.startsWith('.') && !/\.\w+$/.test(specifier)) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
});
const { request } = await import('../lib/browser-api.ts');
const { coreRequest } = await import('../lib/core-server.ts');
hooks.deregister();

function clock() {
  let now = 0;
  const timers: { at: number; controller: AbortController }[] = [];
  return {
    timeout(ms: number) { const controller = new AbortController(); timers.push({ at: now + ms, controller }); return controller.signal; },
    advance(ms: number) { now += ms; for (const t of timers) if (now >= t.at && !t.controller.signal.aborted) t.controller.abort(new DOMException('signal timed out', 'TimeoutError')); },
  };
}

test('a 30.5-second catalog result survives browser and Core search deadlines', async t => {
  const time = clock();
  t.mock.method(AbortSignal, 'timeout', (ms: number) => time.timeout(ms));
  const pending: { signal: AbortSignal; finish: () => void }[] = [];
  t.mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init!.signal!;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    pending.push({ signal, finish: () => resolve(Response.json({ videos: [{ id: 'abcdefghijk' }] })) });
  }));
  const browser = request<{videos:unknown[]}>('/api/search?q=synthetic').catch(error => { throw error; });
  const core = coreRequest<{videos:unknown[]}>('/v1/catalog?q=synthetic').catch(error => { throw error; });
  // Attach handlers before advancing the virtual clock to avoid unhandled errors.
  const result = Promise.allSettled([browser, core]);
  time.advance(30500);
  assert(pending.every(p => !p.signal.aborted), 'A successful slow catalog query must not be cut off at 12 or 25 seconds');
  for (const p of pending) p.finish();
  assert((await result).every(r => r.status === 'fulfilled'));
});

test('ordinary reads keep short deadlines and caller cancellation stays authoritative', async t => {
  const time = clock();
  t.mock.method(AbortSignal, 'timeout', (ms: number) => time.timeout(ms));
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => { signals.push(init!.signal!); return Response.json({ ok: true }); });
  await request('/api/rooms/SYNTHETC');
  await coreRequest('/v1/application');
  const controller = new AbortController();
  await request('/api/search?q=synthetic', { signal: controller.signal });
  assert.equal(signals[2], controller.signal);
  time.advance(12000); assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
  time.advance(13000); assert.equal(signals[1].aborted, true);
  assert.equal(signals[2].aborted, false); controller.abort(); assert.equal(signals[2].aborted, true);
});

test('search timeout gives a useful message without retrying or leaking transport internals', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new DOMException('signal timed out', 'TimeoutError'); });
  await assert.rejects(request('/api/search?q=synthetic'), /Music search timed out/);
  assert.equal(calls, 1);
});

test('catalog reads remain bounded with a browser margin and exact path matching', async t => {
  const time = clock();
  t.mock.method(AbortSignal, 'timeout', (ms: number) => time.timeout(ms));
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => { signals.push(init!.signal!); return Response.json({ videos: [] }); });
  await request('/api/videos?ids=abcdefghijk');
  await coreRequest('/v1/catalog?ids=abcdefghijk');
  await request('/api/search-admin');
  await coreRequest('/v1/catalog-admin');
  time.advance(60000);
  assert.equal(signals[0].aborted, false); assert.equal(signals[1].aborted, true);
  assert.equal(signals[2].aborted, true); assert.equal(signals[3].aborted, true);
  time.advance(15000); assert.equal(signals[0].aborted, true);
});

test('Core catalog fetch follows its HTTP caller cancellation',async t=>{
 const controller=new AbortController();let sent:AbortSignal|undefined;
 t.mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{sent=init!.signal!;sent.addEventListener('abort',()=>reject(sent!.reason),{once:true});}));
 const pending=assert.rejects(coreRequest('/v1/catalog?q=synthetic','GET',undefined,{},controller.signal));
 controller.abort();await pending;assert.equal(sent!.aborted,true);
});
