import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Existing invitations keep their room parameters when moving to the native home.
export const GET: RequestHandler = ({ url }) => redirect(307, `/${url.search}`);
export const HEAD = GET;
