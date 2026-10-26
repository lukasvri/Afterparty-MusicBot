import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserConnections, securityHeaders } from '../src/lib/server/security-headers.ts';

test('browser connections allow only self and explicitly configured HTTPS services', () => {
  assert.deepEqual(browserConnections(null), ["'self'"]);
  const dsn = 'https://' + 'a'.repeat(32) + '@o123.ingest.de.sentry.io/456';
  assert.deepEqual(browserConnections('https://core.example', dsn), [
    "'self'",
    'https://core.example',
    'wss://core.example',
    'https://o123.ingest.de.sentry.io',
  ]);
  assert.deepEqual(browserConnections(null, 'https://attacker.invalid/1'), ["'self'"]);
  for (const url of ['http://core.example', 'https://user:password@core.example'])
    assert.throws(() => browserConnections(url));
});

test('headers preserve the response stream, status, cookies and framework script nonces', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event'));
      controller.close();
    },
  });
  const response = new Response(stream, {
    status: 202,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "script-src 'self' 'nonce-synthetic'; style-src 'self'; frame-ancestors 'none'",
      'Set-Cookie': '__Host-fixture=synthetic; Secure; HttpOnly; Path=/',
    },
  });
  const protectedResponse = securityHeaders(new Request('https://afterparty.invalid/'), response, [
    "'self'",
  ]);
  assert.equal(protectedResponse.body, stream);
  assert.equal(protectedResponse.status, 202);
  assert.equal(protectedResponse.headers.get('cache-control'), 'no-store');
  assert.equal(protectedResponse.headers.get('set-cookie'), response.headers.get('set-cookie'));
  assert.match(protectedResponse.headers.get('content-security-policy')!, /'nonce-synthetic'/);
  assert.match(
    protectedResponse.headers.get('content-security-policy')!,
    /style-src 'self' 'nonce-synthetic'/,
  );
  assert.match(protectedResponse.headers.get('content-security-policy')!, /connect-src 'self'/);
  assert.equal(protectedResponse.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal(protectedResponse.headers.get('x-frame-options'), 'DENY');
  assert.equal(protectedResponse.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await protectedResponse.text(), 'event');
});

test('immutable redirects are protected and HTTP does not trust forwarded HTTPS hints', () => {
  const request = new Request('http://127.0.0.1/', { headers: { 'X-Forwarded-Proto': 'https' } });
  const response = securityHeaders(request, Response.redirect('https://afterparty.invalid/'), [
    "'self'",
  ]);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://afterparty.invalid/');
  assert.equal(response.headers.get('strict-transport-security'), null);
  assert.match(response.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
});
