import { validErrorDsn } from '../../../../../lib/error-reporting.ts';

/** Restrict browser connections to this host and explicitly configured services. */
export function browserConnections(coreOrigin: string | null, sentryDsn?: string): string[] {
  const sources = ["'self'"];
  if (coreOrigin) {
    const url = new URL(coreOrigin);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Invalid Core browser origin.');
    sources.push(url.origin, url.origin.replace(/^https:/, 'wss:'));
  }
  if (validErrorDsn(sentryDsn)) sources.push(new URL(sentryDsn).origin);
  return sources;
}

/** Preserve streaming bodies, status, cookies and SvelteKit's generated CSP nonces. */
export function securityHeaders(
  request: Request,
  response: Response,
  connections: string[],
): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (new URL(request.url).protocol === 'https:')
    headers.set('Strict-Transport-Security', 'max-age=31536000');
  const policy =
    headers.get('Content-Security-Policy') ||
    "base-uri 'self'; object-src 'none'; frame-ancestors 'none'";
  const directives = policy
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean);
  const script = directives.find((directive) => directive.startsWith('script-src '));
  const nonce = script?.split(/\s+/).find((source) => /^'nonce-[A-Za-z0-9+/]+=*'$/.test(source));
  // External CSS may mean SvelteKit emits no inline style during SSR. Its script
  // nonce must still authorize trusted client-created style elements/transitions.
  const finalPolicy = directives
    .filter((directive) => !directive.startsWith('connect-src '))
    .map((directive) =>
      nonce && directive.startsWith('style-src ') && !directive.split(/\s+/).includes(nonce)
        ? directive + ' ' + nonce
        : directive,
    );
  finalPolicy.push('connect-src ' + connections.join(' '));
  headers.set('Content-Security-Policy', finalPolicy.join('; '));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
