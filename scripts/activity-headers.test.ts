import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchHeaders, requestContextFromRequest } from 'vinext/config/config-matchers';
import config from '../next.config.ts';
import { applyFramePolicy, activityFramePolicy, standaloneFramePolicy } from '../lib/frame-policy.ts';
import { activityLaunchRootEnabled, type ActivityLaunchSettings } from '../lib/activity-launch.ts';

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

const rootSettings: ActivityLaunchSettings = {
  DISCORD_ACTIVITY_LAUNCH_ROOT: 'true',
  DISCORD_ACTIVITY_ENABLED: 'true',
  DISCORD_ACTIVITY_CLIENT_ID: '123456789012345678',
};

test('root launch requires all exact server settings and never trusts caller headers', () => {
  assert.equal(activityLaunchRootEnabled(rootSettings), true);
  for (const settings of [
    {}, { ...rootSettings, DISCORD_ACTIVITY_LAUNCH_ROOT: 'false' },
    { ...rootSettings, DISCORD_ACTIVITY_LAUNCH_ROOT: 'TRUE' },
    { ...rootSettings, DISCORD_ACTIVITY_ENABLED: 'false' },
    { ...rootSettings, DISCORD_ACTIVITY_CLIENT_ID: '' },
    { ...rootSettings, DISCORD_ACTIVITY_CLIENT_ID: 'not-an-application' },
  ]) {
    assert.equal(activityLaunchRootEnabled(settings), false);
    const request = new Request('https://test.example/', { headers: {
      Origin: 'https://discord.com', 'X-Forwarded-Uri': '/activity',
    } });
    const response = applyFramePolicy(request, new Response(null), settings);
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(response.headers.get('Content-Security-Policy'), standaloneFramePolicy);
  }
});

test('opt-in root framing is limited to GET/HEAD launch documents and preserves query and cookies', () => {
  for (const method of ['GET', 'HEAD']) {
    const request = new Request('https://test.example/?frame_id=test&instance_id=test', { method });
    const response = applyFramePolicy(request, new Response(null, { headers: {
      'Set-Cookie': 'synthetic=1; Secure; HttpOnly', 'X-Frame-Options': 'DENY',
    } }), rootSettings);
    assert.equal(response.headers.get('X-Frame-Options'), null);
    assert.equal(response.headers.get('Content-Security-Policy'), activityFramePolicy);
    assert.equal(response.headers.get('Set-Cookie'), 'synthetic=1; Secure; HttpOnly');
    assert.equal(new URL(request.url).searchParams.get('frame_id'), 'test');
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = applyFramePolicy(new Request('https://test.example/', { method }), new Response(null), rootSettings);
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY', method);
  }
  for (const path of ['/admin', '/api/activity', '/api/admin/session', '/api/social', '//', '/%2f', '/Activity', '/activity/']) {
    const response = applyFramePolicy(new Request('https://test.example' + path), new Response(null), rootSettings);
    assert.equal(response.headers.get('Content-Security-Policy'), standaloneFramePolicy, path);
  }
});

// Optional check against an actual locally built worker, never a production URL.
if (process.env.ACTIVITY_HEADER_PREVIEW_URL) test('local built worker sends the expected Activity and standalone headers', async () => {
  const base = new URL(process.env.ACTIVITY_HEADER_PREVIEW_URL!);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Only local preview verification is allowed');
  const launchRoot = process.env.ACTIVITY_HEADER_PREVIEW_LAUNCH_ROOT === 'true';
  const { readFile } = await import('node:fs/promises');
  const worker = JSON.parse(await readFile(new URL('../dist/server/wrangler.json', import.meta.url), 'utf8')) as { compatibility_flags?: string[] };
  assert(worker.compatibility_flags?.includes('enable_request_signal'), 'Built Worker must expose incoming request cancellation');
  for (const path of ['/activity', '/', '/?frame_id=synthetic&instance_id=synthetic', '/admin', '/Activity', '/activity/', '/activity/admin', '/api/activity/auth']) {
    const response = await fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const root = path === '/' || path.startsWith('/?');
    const activity = path === '/activity' || (launchRoot && root);
    assert.equal(response.headers.get('Content-Security-Policy'), activity ? activityFramePolicy : standaloneFramePolicy, path);
    assert.equal(response.headers.get('X-Frame-Options'), activity ? null : 'DENY', path);
    if (root) {
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.equal(html.includes('data-activity-phase="idle"'), launchRoot, path);
      if (launchRoot) assert(html.includes('Connect with Discord'));
    } else await response.body?.cancel();
  }
  const notes = await fetch(new URL('/patch-notes', base), { signal: AbortSignal.timeout(15000) });
  assert.equal(notes.status, 200);
  const html = await notes.text();
  assert(html.includes('Preserve Activity video, audio and queue controls'));
  assert(html.includes('3.0.0-beta.6'));
});
