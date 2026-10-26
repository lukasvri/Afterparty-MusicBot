import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacyConcertDestination } from '../src/lib/server/legacy-concert.ts';

const guild = '222222222222222';
const mapped = (code: string) => Response.json({ code, mode: 'discord', guildId: guild });

test('own-room URLs and hash credentials pass through without lookup or mutation', async () => {
  const url = new URL('https://site.example/?room=TESTROOM&tv=1#host=private-token');
  const before = url.href;
  const result = await legacyConcertDestination(url, (async () => {
    throw Error('Unexpected lookup');
  }) as typeof fetch);
  assert.deepEqual(result, { kind: 'room' });
  assert.equal(url.href, before);
});

test('legacy concert mapping requires the same room and replaces forged guild selection', async () => {
  const url = new URL(
    'https://site.example/?room=d0abc123&tv=1&guildId=111111111111111&next=https%3A%2F%2Fother.invalid#bookmark',
  );
  const result = await legacyConcertDestination(url, (async (path, options) => {
    assert.equal(path, '/api/rooms/D0ABC123');
    assert.equal(options?.method, 'GET');
    assert.equal(options?.cache, 'no-store');
    return mapped('D0ABC123');
  }) as typeof fetch);
  assert.equal(result.kind, 'concert');
  if (result.kind !== 'concert') throw Error('Missing concert redirect');
  const destination = new URL(result.location, url);
  assert.equal(destination.pathname, '/discord');
  assert.equal(destination.searchParams.get('guildId'), guild);
  assert.equal(destination.searchParams.get('tv'), '1');
  assert.equal(destination.searchParams.get('next'), 'https://other.invalid');
  assert.equal(destination.searchParams.has('room'), false);
  assert.equal(url.hash, '#bookmark');
});

test('unmapped or wrong-room nondefault links never select a default guild', async () => {
  for (const response of [
    new Response(null, { status: 404 }),
    mapped('DISCORD1'),
    mapped('D0BAD123'),
    Response.json({ code: 'D0ABC123', mode: 'own', guildId: guild }),
    Response.json({ code: 'D0ABC123', mode: 'discord', guildId: 'invalid' }),
  ]) {
    assert.deepEqual(
      await legacyConcertDestination(
        new URL('https://site.example/?room=D0ABC123&guildId=111111111111111'),
        (async () => response) as typeof fetch,
      ),
      { kind: 'unmapped' },
    );
  }
});

test('only DISCORD1 can fall back to the default concert when mapping is unavailable', async () => {
  const unavailable = (async () => {
    throw Error('Unavailable');
  }) as typeof fetch;
  assert.deepEqual(
    await legacyConcertDestination(
      new URL('https://site.example/?room=DISCORD1&guildId=111111111111111&tv=1'),
      unavailable,
    ),
    { kind: 'concert', location: '/discord?tv=1' },
  );
  assert.deepEqual(
    await legacyConcertDestination(new URL('https://site.example/?room=D0ABC123'), unavailable),
    { kind: 'unmapped' },
  );
});

test('a lookup that ignores cancellation is still bounded and cannot redirect another guild', async () => {
  let signal: AbortSignal | undefined;
  const result = await legacyConcertDestination(
    new URL('https://site.example/?room=D0ABC123'),
    ((_url, options) => {
      signal = options?.signal as AbortSignal;
      return new Promise<Response>(() => {});
    }) as typeof fetch,
    5,
  );
  assert.deepEqual(result, { kind: 'unmapped' });
  assert.equal(signal?.aborted, true);
});
