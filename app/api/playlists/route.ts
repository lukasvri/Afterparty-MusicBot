import { api } from '@/lib/server';
import { coreRequest } from '@/lib/core-server';
import { playlistInput } from '@/lib/playlist-server';

export const POST = (request: Request) => api(async () =>
  coreRequest('/v1/playlists', 'POST', await playlistInput(request), {}, request.signal));
