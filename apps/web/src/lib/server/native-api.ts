export type NativeContext = { params: Promise<{ code: string }> };
export type NativeHandler = (
  request: Request,
  context?: NativeContext,
) => Response | Promise<Response>;
export type NativeRoute = Record<string, unknown>;

// Fixed imports are intentional. Browser input never becomes an import path.
// Reuse the existing API contracts and authorization instead of duplicating them.
export const nativeRoutes = {
  '/api/admin/bot': () => import('../../../../../app/api/admin/bot/route.ts'),
  '/api/admin/control': () => import('../../../../../app/api/admin/control/route.ts'),
  '/api/admin/core-check': () => import('../../../../../app/api/admin/core-check/route.ts'),
  '/api/admin/guilds': () => import('../../../../../app/api/admin/guilds/route.ts'),
  '/api/admin/rooms': () => import('../../../../../app/api/admin/rooms/route.ts'),
  '/api/admin/session': () => import('../../../../../app/api/admin/session/route.ts'),
  '/api/auth/discord': () => import('../../../../../app/api/auth/discord/route.ts'),
  '/api/auth/discord/callback': () =>
    import('../../../../../app/api/auth/discord/callback/route.ts'),
  '/api/bot/install': () => import('../../../../../app/api/bot/install/route.ts'),
  '/api/bridge': () => import('../../../../../app/api/bridge/route.ts'),
  '/api/discord': () => import('../../../../../app/api/discord/route.ts'),
  '/api/discord/queue': () => import('../../../../../app/api/discord/queue/route.ts'),
  '/api/guess': () => import('../../../../../app/api/guess/route.ts'),
  '/api/guess/media': () => import('../../../../../app/api/guess/media/route.ts'),
  '/api/history': () => import('../../../../../app/api/history/route.ts'),
  '/api/me': () => import('../../../../../app/api/me/route.ts'),
  '/api/playlists': () => import('../../../../../app/api/playlists/route.ts'),
  '/api/realtime': () => import('../../../../../app/api/realtime/route.ts'),
  '/api/realtime/clock': () => import('../../../../../app/api/realtime/clock/route.ts'),
  '/api/realtime/stream': () => import('../../../../../app/api/realtime/stream/route.ts'),
  '/api/rooms': () => import('../../../../../app/api/rooms/route.ts'),
  '/api/rooms/[code]': () => import('../../../../../app/api/rooms/[code]/route.ts'),
  '/api/search': () => import('../../../../../app/api/search/route.ts'),
  '/api/social': () => import('../../../../../app/api/social/route.ts'),
  '/api/social/stream': () => import('../../../../../app/api/social/stream/route.ts'),
  '/api/videos': () => import('../../../../../app/api/videos/route.ts'),
} satisfies Record<string, () => Promise<NativeRoute>>;

export type NativePath = keyof typeof nativeRoutes;
export type NativeLoader = (path: NativePath) => Promise<NativeRoute>;
const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

const unavailable = (status: number, error: string, headers?: Record<string, string>) =>
  Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

/** Dispatch the original request without buffering its body or the returned response. */
export async function nativeApi(
  request: Request,
  load: NativeLoader = (path) => nativeRoutes[path](),
): Promise<Response> {
  const reject = (status: number, error: string, headers?: Record<string, string>) => {
    const response = unavailable(status, error, headers);
    return request.method === 'HEAD'
      ? new Response(null, { status, headers: response.headers })
      : response;
  };
  const pathname = new URL(request.url).pathname;
  let path: NativePath;
  let context: NativeContext | undefined;
  if (Object.hasOwn(nativeRoutes, pathname)) {
    // A literal bracket path is not an actual room identifier.
    if (pathname === '/api/rooms/[code]') return reject(404, 'API endpoint not found.');
    path = pathname as NativePath;
  } else {
    const match = /^\/api\/rooms\/([^/]+)$/.exec(pathname);
    if (!match) return reject(404, 'API endpoint not found.');
    let code: string;
    try {
      code = decodeURIComponent(match[1]);
    } catch {
      return reject(400, 'Invalid room path.');
    }
    // Reject separators instead of reinterpreting encoded paths as another route.
    if (code.includes('/') || code.includes('\\')) return reject(404, 'API endpoint not found.');
    path = '/api/rooms/[code]';
    context = { params: Promise.resolve({ code }) };
  }
  const route = await load(path);
  const supported = methods.filter((method) => typeof route[method] === 'function');
  if (supported.includes('GET') && !supported.includes('HEAD')) supported.push('HEAD');
  if (!supported.includes('OPTIONS')) supported.push('OPTIONS');
  const allow = methods.filter((method) => supported.includes(method)).join(', ');
  const method = request.method.toUpperCase();
  const handler = route[method] ?? (method === 'HEAD' ? route.GET : undefined);
  if (method === 'OPTIONS' && typeof handler !== 'function')
    return new Response(null, { status: 204, headers: { Allow: allow } });
  if (typeof handler !== 'function') return reject(405, 'Method not allowed.', { Allow: allow });
  const response = context
    ? await (handler as NativeHandler)(request, context)
    : await (handler as NativeHandler)(request);
  if (method !== 'HEAD') return response;
  // HEAD has GET's status and headers but never exposes or buffers a body.
  void response.body?.cancel().catch(() => {});
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
