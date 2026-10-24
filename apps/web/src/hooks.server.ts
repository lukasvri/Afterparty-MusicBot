import { env } from 'cloudflare:workers';
import { bridge, type ApiBinding } from '#lib/server/api-bridge.ts';
import type { Handle } from '@sveltejs/kit/hooks';

// An explicit fallback keeps the original application reviewable during migration.
// Forward unchanged to the fixed API binding so cookies and origin guards survive.
export const handle: Handle = ({ event, resolve }) => {
  if (event.url.searchParams.get('classic') === '1' && event.request.method === 'GET')
    return bridge(event.request, env.AFTERPARTY_API as ApiBinding | undefined);
  return resolve(event);
};
