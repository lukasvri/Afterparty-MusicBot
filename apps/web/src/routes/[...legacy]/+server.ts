import { env } from 'cloudflare:workers';
import { bridge, type ApiBinding } from '#lib/server/api-bridge.ts';
import type { RequestHandler } from './$types';

// Unported pages, OAuth callbacks and API endpoints keep their existing handlers.
// A service binding is configured locally, never supplied by a browser URL.
const forward: RequestHandler = ({ request }) =>
  bridge(request, (env as unknown as { AFTERPARTY_API?: ApiBinding }).AFTERPARTY_API);
export {
  forward as GET,
  forward as HEAD,
  forward as POST,
  forward as PUT,
  forward as PATCH,
  forward as DELETE,
  forward as OPTIONS,
};
