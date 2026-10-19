import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchHeaders, requestContextFromRequest } from 'vinext/config/config-matchers';
import config from '../next.config.ts';
import { applyFramePolicy, activityFramePolicy, standaloneFramePolicy } from '../lib/frame-policy.ts';

async function rendered(path: string) {
  const request = new Request('https://afterparty.example' + path);
  const rules = await config.headers!();
  const headers = new Headers();
  for (const item of matchHeaders(new URL(request.url).pathname, rules.map(({ source, headers }) => ({ source, headers })), requestContextFromRequest(request))) headers.set(item.key, item.value);
  headers.set('X-Synthetic', 'retained');
  const baseline = new Response('synthetic document', { headers });
  return applyFramePolicy(request, baseline);
}

test('exact Activity document replaces inherited framing restrictions without opening APIs or other pages', async () => {
  for (const path of ['/activity', '/activity?frame_id=test&instance_id=test']) {
    const response = await rendered(path);
    assert.equal(response.headers.get('X-Frame-Options'), null);
    assert.equal(response.headers.get('Content-Security-Policy'), activityFramePolicy);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('X-Synthetic'), 'retained');
    assert.equal(await response.text(), 'synthetic document');
  }
  for (const path of ['/', '/admin', '/patch-notes', '/activity/', '/Activity', '/ACTIVITY', '/activity/admin', '/activity-extra', '/%61ctivity', '/activity%2f', '/api/activity/auth', '/api/activity/bridge', '/api/admin/session', '/api/social']) {
    const response = await rendered(path);
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY', path);
    assert.equal(response.headers.get('Content-Security-Policy'), standaloneFramePolicy, path);
  }
});

test('framing decisions ignore caller supplied origins and forwarded paths', async () => {
  const request = new Request('https://afterparty.example/admin', { headers: { Origin: 'https://discord.com', 'X-Forwarded-Uri': '/activity', 'X-Original-URL': '/activity' } });
  const response = applyFramePolicy(request, new Response(null, { status: 401, headers: { 'Set-Cookie': 'synthetic=1; HttpOnly; Secure', 'Content-Security-Policy': activityFramePolicy } }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(response.headers.get('Content-Security-Policy'), standaloneFramePolicy);
  assert.equal(response.headers.get('Set-Cookie'), 'synthetic=1; HttpOnly; Secure');
});

// Optional check against an actual locally built worker, never a production URL.
if (process.env.ACTIVITY_HEADER_PREVIEW_URL) test('local built worker sends the expected Activity and standalone headers', async () => {
  const base = new URL(process.env.ACTIVITY_HEADER_PREVIEW_URL!);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Only local preview verification is allowed');
  for (const path of ['/activity', '/', '/admin', '/Activity', '/activity/', '/activity/admin', '/api/activity/auth']) {
    const response = await fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    assert.equal(response.headers.get('Content-Security-Policy'), path === '/activity' ? activityFramePolicy : standaloneFramePolicy, path);
    assert.equal(response.headers.get('X-Frame-Options'), path === '/activity' ? null : 'DENY', path);
    await response.body?.cancel();
  }
});
