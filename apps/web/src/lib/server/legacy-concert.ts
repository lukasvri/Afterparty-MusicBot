import {
  isConcertGuildId,
  isDiscordRoomCode,
} from '../../../../../services/core/src/concert-links.ts';

type Destination = { kind: 'room' } | { kind: 'unmapped' } | { kind: 'concert'; location: string };

/** Resolve old bot invitations through the public, concert-filtered room endpoint. */
export async function legacyConcertDestination(
  source: URL,
  request: typeof fetch,
  timeoutMs = 1500,
): Promise<Destination> {
  const code = source.searchParams.get('room')?.toUpperCase();
  if (!isDiscordRoomCode(code)) return { kind: 'room' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let guildId: string | undefined;
  try {
    const lookup = (async () => {
      const response = await request(`/api/rooms/${code}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        return;
      }
      const room = (await response.json()) as {
        code?: unknown;
        mode?: unknown;
        guildId?: unknown;
      } | null;
      if (room?.code === code && room.mode === 'discord' && isConcertGuildId(room.guildId))
        return room.guildId;
    })();
    // Internal server fetches may ignore abort until their handler settles.
    guildId = await Promise.race([
      lookup,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(undefined);
        }, timeoutMs);
      }),
    ]);
  } catch {
    /* The default room alone may fall back to the default concert. */
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  if (!guildId && code !== 'DISCORD1') return { kind: 'unmapped' };
  const destination = new URL('/discord', source);
  destination.search = source.search;
  destination.searchParams.delete('room');
  destination.searchParams.delete('guildId');
  if (guildId) destination.searchParams.set('guildId', guildId);
  // Leave fragments to the browser's redirect inheritance; the server never reads credentials in a hash.
  return { kind: 'concert', location: destination.pathname + destination.search };
}
