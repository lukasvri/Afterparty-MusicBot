/** Public invitations never carry host grants, private fragments or viewing preferences. */
export function publicRoomLink(origin: string, code: string) {
  const link = new URL('/', new URL(origin).origin);
  link.searchParams.set('room', code);
  return link.href;
}
