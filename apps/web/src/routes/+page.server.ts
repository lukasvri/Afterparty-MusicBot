import { error, redirect } from '@sveltejs/kit';
import { legacyConcertDestination } from '#lib/server/legacy-concert.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, fetch }) => {
  const destination = await legacyConcertDestination(url, fetch);
  if (destination.kind === 'concert') redirect(307, destination.location);
  if (destination.kind === 'unmapped')
    error(404, 'This concert link could not be matched to a Discord server.');
  return {};
};
