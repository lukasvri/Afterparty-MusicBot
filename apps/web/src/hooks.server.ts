import { env } from 'cloudflare:workers';
import { hostingTransition } from '../../../lib/hosting-transition.ts';
import { coreUrl } from '../../../lib/core-server.ts';
import { browserConnections, securityHeaders } from '#lib/server/security-headers.ts';
import type { Handle } from '@sveltejs/kit/hooks';

// A retired host must stop before routing, authentication or any database write.
export const handle: Handle = async ({ event, resolve }) => {
  const transition = hostingTransition(event.request, env.AFTERPARTY_HOST_TRANSITION);
  if (transition) return securityHeaders(event.request, transition, ["'self'"]);
  const connections = browserConnections(coreUrl(), import.meta.env.VITE_SENTRY_DSN);
  return securityHeaders(event.request, await resolve(event), connections);
};
