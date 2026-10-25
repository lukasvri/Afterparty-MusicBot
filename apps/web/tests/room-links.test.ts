import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicRoomLink } from '../src/lib/rooms/room-links.ts';

test('public invitations discard credentials, private grants, viewing flags and unrelated parameters', () => {
  const origin =
    'https://private-user:private-password@site.example/v3?room=OTHER001&tv=1&access=private#host=private-grant';
  assert.equal(publicRoomLink(origin, 'ROOM0001'), 'https://site.example/?room=ROOM0001');
  assert.equal(
    publicRoomLink('http://127.0.0.1:5174', 'ROOM0001'),
    'http://127.0.0.1:5174/?room=ROOM0001',
  );
  assert.equal(
    new URL(publicRoomLink(origin, 'ROOM0001&host=private')).searchParams.get('host'),
    null,
  );
});
