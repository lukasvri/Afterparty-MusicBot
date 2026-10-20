import { body, fail, hash, limit, row } from '@/lib/server';
import { discordSession } from '@/lib/discord-auth';
import { coreUrl } from '@/lib/core-server';
import type { RoomState } from '@/lib/types';
/** Fresh ordinary membership/room authority, without imports or playback writes. */
export async function guessInput(request: Request) {
  if (!coreUrl()) fail(503, 'Games need a connected, updated Core.');
  const input = await body(request, 4096);
  const { scope, scopeId, action } = input;
  // Allow a small party behind one IP to poll without sharing playback budgets.
  await limit(request, 'guess-visitor', 600, 60000);
  if (action === 'catalog') return { action };
  if (!['room', 'guild'].includes(String(scope)) || typeof scopeId !== 'string' || !(scope === 'room' ? /^[A-Z0-9]{8}$/ : /^\d{14,22}$/).test(scopeId)) fail(400, 'Invalid game scope.');
  if (!['join', 'read', 'media', 'configure', 'start', 'guess', 'reveal', 'next', 'end', 'reset'].includes(String(action))) fail(400, 'Unknown game action.');
  if (action === 'join') await limit(request, 'guess-join', 30, 60000);
  let authority: Record<string, unknown>;
  if (scope === 'guild') { const session = await discordSession(request); if (!session) fail(401, 'Sign in with Discord to join this game.'); authority = { tokenCipher: session.token_cipher }; }
  else {
    const value = await row(scopeId);
    if (value.guild_id || scopeId === 'DISCORD1') fail(403, 'Join through the Discord concert.');
    const state = JSON.parse(value.state) as RoomState;
    const credential = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actorHash = credential ? await hash(credential) : '';
    authority = { roomExpiresAt: value.expires_at, host: actorHash === value.owner_hash || Boolean(actorHash && state.cohostHashes?.includes(actorHash)) };
  }
  return { scope, scopeId, action, ...authority, token: input.token, eventId: input.eventId, sessionId: input.sessionId, revision: input.revision, roundId: input.roundId, categoryId: input.categoryId, text: input.text, nickname: input.nickname,
    ...(action === 'configure' ? { settings: input.settings && typeof input.settings === 'object' ? Object.fromEntries(['durationSeconds', 'roundCount', 'maxPoints', 'minPoints', 'hints'].map(key => [key, (input.settings as Record<string, unknown>)[key]])) : null } : {}) };
}
