import { env } from 'cloudflare:workers';
import { hostingTransition } from '../../../lib/hosting-transition.ts';
import type { Handle } from '@sveltejs/kit/hooks';

// A retired host must stop before routing, authentication or any database write.
export const handle: Handle = ({ event, resolve }) =>
  hostingTransition(event.request, env.AFTERPARTY_HOST_TRANSITION) ?? resolve(event);
