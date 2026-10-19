/** Activity playback is a Discord concert, not a proxied YouTube player.
 * Discord's sandbox blocks direct YouTube scripts and frames. Never relay media
 * or weaken that policy. External playback is an explicit SDK user action.
 */
export type ActivityMedia = {openVideo: (id:string) => Promise<boolean>};
type LinkCommands = {openExternalLink: (input:{url:string}) => Promise<{opened:boolean|null}>};
export async function openActivityVideo(commands:LinkCommands, id:string) {
  if (!/^[\w-]{11}$/.test(id)) return false;
  try { return (await commands.openExternalLink({url:'https://www.youtube.com/watch?v='+id})).opened === true; }
  catch { return false; }
}

export function stageDisplayMode(activity:boolean) {
  return activity ? {embeddedVideo:false, viewportOnly:true, expand:'Utvid scena', restore:'Gjenopprett scena'}
    : {embeddedVideo:true, viewportOnly:false, expand:'Fullskjerm', restore:'Gå ut av fullskjerm'};
}
