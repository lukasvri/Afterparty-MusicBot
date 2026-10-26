import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => redirect(307, `/discord${url.search}`);
export const HEAD = GET;
