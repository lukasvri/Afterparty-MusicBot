import { env } from 'cloudflare:workers';
import { betaEntry, bridge, type ApiBinding } from '#lib/server/api-bridge.ts';
import type { RequestHandler } from './$types';

const forward: RequestHandler = ({ request }) =>
  bridge(request, (env as unknown as { AFTERPARTY_API?: ApiBinding }).AFTERPARTY_API);

const entry: RequestHandler = (event) =>
  betaEntry(event.request, env.AFTERPARTY_BETA_ENTRY === '1') ?? forward(event);

export {
  entry as GET,
  entry as HEAD,
  forward as POST,
  forward as PUT,
  forward as PATCH,
  forward as DELETE,
  forward as OPTIONS,
};
