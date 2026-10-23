import { test } from 'node:test';
import assert from 'node:assert/strict';
import { betaEntry, bridge } from '../src/lib/api-bridge.ts';

test('the beta landing preserves room links and keeps Classic and API callbacks reachable', () => {
  const room = new Request('https://ap.beta.openworks.no/?room=TESTROOM');
  assert.equal(betaEntry(room, false), null);
  const response = betaEntry(room, true);
  assert.equal(response?.status, 307);
  assert.equal(response?.headers.get('Location'), 'https://ap.beta.openworks.no/v3?room=TESTROOM');
  assert.equal(
    betaEntry(new Request('https://ap.beta.openworks.no/?classic=1&room=TESTROOM'), true),
    null,
  );
  assert.equal(
    betaEntry(new Request('https://ap.beta.openworks.no/', { method: 'POST' }), true),
    null,
  );
  assert.equal(
    betaEntry(
      new Request('https://ap.beta.openworks.no/api/auth/discord/callback?code=synthetic'),
      true,
    ),
    null,
  );
});

test('forwarding preserves origin, cookies, bearer, revisions and response cookies', async () => {
  const request = new Request('https://synthetic.invalid/api/rooms/TESTROOM', {
    method: 'POST',
    headers: {
      Origin: 'https://synthetic.invalid',
      Cookie: 'session=synthetic',
      Authorization: 'Bearer synthetic',
      'X-Afterparty-Visitor': 'a'.repeat(32),
    },
    body: JSON.stringify({ action: 'pause', version: 42 }),
  });
  const expected = new Response('accepted', {
    headers: { 'Set-Cookie': 'session=new; HttpOnly; Secure' },
  });
  assert.equal(
    await bridge(request, {
      async fetch(forwarded) {
        assert.equal(forwarded, request);
        assert.equal(forwarded.url, request.url);
        assert.equal(forwarded.headers.get('Origin'), new URL(forwarded.url).origin);
        assert.equal(forwarded.headers.get('Cookie'), 'session=synthetic');
        assert.equal(forwarded.headers.get('Authorization'), 'Bearer synthetic');
        assert.deepEqual(await forwarded.json(), { action: 'pause', version: 42 });
        return expected;
      },
    }),
    expected,
  );
});

test('SSE bodies pass through without buffering, and request cancellation is retained', async () => {
  const controller = new AbortController();
  const request = new Request('https://synthetic.invalid/api/realtime/stream?room=TESTROOM', {
    signal: controller.signal,
  });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: sample\n\n'));
    },
  });
  const response = new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  const actual = await bridge(request, {
    async fetch(forwarded) {
      controller.abort();
      assert.equal(forwarded.signal.aborted, true);
      return response;
    },
  });
  assert.equal(actual, response);
  assert.equal(actual.body, stream);
  await actual.body?.cancel();
});

test('missing bindings and transport failures fail closed without leaking details', async () => {
  for (const binding of [
    undefined,
    {
      fetch: async () => {
        throw Error('synthetic secret');
      },
    },
  ]) {
    const response = await bridge(
      new Request('https://synthetic.invalid/api/admin/guilds'),
      binding,
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.doesNotMatch(await response.text(), /synthetic secret/);
  }
});
