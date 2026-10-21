import { body, fail, limit } from '@/lib/server';
import { coreUrl } from '@/lib/core-server';
import { normalizePlaylistUrl } from '../services/core/src/playlist-url';

/** Public metadata jobs only. Queue authorization remains at the existing room/guild boundary. */
export async function playlistInput(request: Request) {
  const input = await body(request, 4096);
  if (!coreUrl()) fail(503, 'Playlist imports need a connected, updated Core.');
  if (input.action === 'start') {
    await limit(request, 'playlist-start', 6, 600000);
    if (typeof input.url !== 'string') fail(400, 'Paste a YouTube or Spotify playlist link.');
    let normalized;
    try { normalized = normalizePlaylistUrl(input.url); }
    catch { fail(400, 'Paste a YouTube or Spotify playlist link.'); }
    return { action: 'start', url: normalized!.url };
  }
  if (!['read', 'cancel'].includes(String(input.action)) || typeof input.id !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.id) ||
    typeof input.token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(input.token))
    fail(400, 'Invalid playlist import request.');
  await limit(request, 'playlist-poll', 240, 600000);
  return { action: input.action, id: input.id, token: input.token };
}
