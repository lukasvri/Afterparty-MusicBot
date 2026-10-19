/** Activity uses the official mapped YouTube player. External opening remains an
 * explicit error fallback; it never replaces the embedded player.
 */
export type ActivityMedia = {openVideo: (id:string) => Promise<boolean>};
type LinkCommands = {openExternalLink: (input:{url:string}) => Promise<{opened:boolean|null}>};
export async function openActivityVideo(commands:LinkCommands, id:string) {
  if (!/^[\w-]{11}$/.test(id)) return false;
  try { return (await commands.openExternalLink({url:'https://www.youtube.com/watch?v='+id})).opened === true; }
  catch { return false; }
}
