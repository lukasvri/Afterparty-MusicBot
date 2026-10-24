import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { nativeApi, nativeRoutes, type NativeLoader } from '../src/lib/server/native-api.ts';

const origin = 'https://afterparty.invalid';

test('the native map covers every existing API route and imports its canonical handler', async () => {
  const directory = new URL('../../../app/api/', import.meta.url);
  const files = await readdir(directory, { recursive: true });
  const paths = files
    .filter((file) => file.endsWith('/route.ts'))
    .map((file) => '/api/' + file.slice(0, -'/route.ts'.length))
    .sort();
  assert.deepEqual(Object.keys(nativeRoutes).sort(), paths);
  const source = await readFile(
    new URL('../src/lib/server/native-api.ts', import.meta.url),
    'utf8',
  );
  for (const path of paths) {
    assert(
      source.includes(`import('../../../../../app${path}/route.ts')`),
      `${path} reuses its canonical handler`,
    );
  }
});

test('all static routes dispatch the exact Request and return the original Response', async () => {
  for (const path of Object.keys(nativeRoutes).filter((path) => !path.includes('['))) {
    const request = new Request(`${origin}${path}?synthetic=1`, {
      headers: { Cookie: 'synthetic=session', Origin: origin },
    });
    const response = new Response('synthetic');
    const result = await nativeApi(request, async (selected) => {
      assert.equal(selected, path);
      return {
        GET: (...args: unknown[]) => {
          assert.equal(args.length, 1, 'static handlers receive no fabricated context');
          assert.equal(args[0], request);
          return response;
        },
      };
    });
    assert.equal(result, response);
  }
});

test('dynamic room routes receive decoded promised params without replacing the request', async () => {
  const request = new Request(`${origin}/api/rooms/TEST%52OOM`, {
    method: 'POST',
    body: JSON.stringify({ action: 'pause', version: 7 }),
  });
  const response = new Response('room');
  const result = await nativeApi(request, async (selected) => {
    assert.equal(selected, '/api/rooms/[code]');
    return {
      POST: async (actual: Request, context: { params: Promise<{ code: string }> }) => {
        assert.equal(actual, request);
        assert(context.params instanceof Promise);
        assert.deepEqual(await context.params, { code: 'TESTROOM' });
        assert.deepEqual(await actual.json(), { action: 'pause', version: 7 });
        return response;
      },
    };
  });
  assert.equal(result, response);
});

test('streaming media, cookies, redirects and abort signals are preserved', async () => {
  const controller = new AbortController();
  const request = new Request(`${origin}/api/guess/media`, {
    method: 'POST',
    body: 'synthetic input',
    signal: controller.signal,
    headers: { Authorization: 'Bearer synthetic', Cookie: 'synthetic=session' },
  });
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      streamController = value;
    },
  });
  const headers = new Headers({ 'Content-Type': 'audio/ogg', Location: '/next' });
  headers.append('Set-Cookie', 'first=synthetic; HttpOnly; Path=/');
  headers.append('Set-Cookie', 'second=synthetic; HttpOnly; Path=/');
  const response = new Response(stream, { status: 307, headers });
  const result = await nativeApi(request, async () => ({
    POST: (actual: Request) => {
      assert.equal(actual, request);
      assert.equal(actual.signal, request.signal);
      assert.equal(actual.headers.get('authorization'), 'Bearer synthetic');
      assert.equal(actual.headers.get('cookie'), 'synthetic=session');
      return response;
    },
  }));
  assert.equal(result, response, 'dispatch returns before the stream closes');
  assert.equal(result.body, stream);
  assert.equal(result.status, 307);
  assert.equal(result.headers.get('location'), '/next');
  assert.deepEqual(result.headers.getSetCookie(), headers.getSetCookie());
  controller.abort();
  assert(request.signal.aborted);
  streamController!.close();
});

test('HEAD uses GET headers and status without returning or buffering its body', async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    {
      status: 202,
      statusText: 'Accepted',
      headers: { 'Content-Type': 'text/event-stream', 'Set-Cookie': 'synthetic=session' },
    },
  );
  const request = new Request(`${origin}/api/realtime/stream`, { method: 'HEAD' });
  const result = await nativeApi(request, async () => ({
    GET: (actual: Request) => {
      assert.equal(actual, request);
      return response;
    },
  }));
  assert.equal(result.status, 202);
  assert.equal(result.statusText, 'Accepted');
  assert.equal(result.headers.get('content-type'), 'text/event-stream');
  assert.equal(result.headers.get('set-cookie'), 'synthetic=session');
  assert.equal(result.body, null);
  assert.equal(await result.text(), '');
  assert(cancelled);
});

test('explicit HEAD and OPTIONS handlers take precedence over automatic responses', async () => {
  let getCalls = 0;
  const load: NativeLoader = async () => ({
    GET: () => {
      getCalls++;
      return new Response('GET');
    },
    HEAD: () => new Response(null, { status: 201, headers: { 'X-Synthetic': 'HEAD' } }),
    OPTIONS: () => new Response(null, { status: 200, headers: { Allow: 'synthetic' } }),
  });
  const head = await nativeApi(new Request(`${origin}/api/rooms`, { method: 'HEAD' }), load);
  assert.equal(head.status, 201);
  assert.equal(head.headers.get('x-synthetic'), 'HEAD');
  const options = await nativeApi(new Request(`${origin}/api/rooms`, { method: 'OPTIONS' }), load);
  assert.equal(options.status, 200);
  assert.equal(options.headers.get('allow'), 'synthetic');
  assert.equal(getCalls, 0);
});

test('automatic OPTIONS and unsupported methods describe the actual allowed methods', async () => {
  const load: NativeLoader = async () => ({
    GET: () => new Response('read'),
    DELETE: () => new Response('delete'),
  });
  const options = await nativeApi(
    new Request(`${origin}/api/admin/rooms`, { method: 'OPTIONS' }),
    load,
  );
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('allow'), 'GET, HEAD, DELETE, OPTIONS');
  const rejected = await nativeApi(
    new Request(`${origin}/api/admin/rooms`, { method: 'PATCH' }),
    load,
  );
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get('allow'), 'GET, HEAD, DELETE, OPTIONS');
  assert.equal(rejected.headers.get('cache-control'), 'no-store');
  const headWithoutGet = await nativeApi(
    new Request(`${origin}/api/playlists`, { method: 'HEAD' }),
    async () => ({ POST: () => new Response('write') }),
  );
  assert.equal(headWithoutGet.status, 405);
  assert.equal(headWithoutGet.headers.get('allow'), 'POST, OPTIONS');
  assert.equal(headWithoutGet.body, null);
});

test('unknown and encoded-separator paths cannot select arbitrary modules', async () => {
  let loads = 0;
  for (const path of [
    '/api/unknown',
    '/api/admin/rooms/other',
    '/api/rooms/A%2FB',
    '/api/rooms/A%5CB',
    '/api/rooms/[code]',
    '/api/rooms/%',
  ]) {
    const response = await nativeApi(new Request(origin + path), async () => {
      loads++;
      return {};
    });
    assert([400, 404].includes(response.status), path);
  }
  assert.equal(loads, 0);
  const head = await nativeApi(new Request(`${origin}/api/unknown`, { method: 'HEAD' }));
  assert.equal(head.status, 404);
  assert.equal(head.body, null);
});
