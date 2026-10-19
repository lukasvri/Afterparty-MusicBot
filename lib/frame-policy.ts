import { isActivityLaunchDocument, type ActivityLaunchSettings } from './activity-launch.ts';

/** Only Activity documents, including an enabled launch root, permit Discord framing. API origins and
 * authorization are separate checks; these hosts never grant API access.
 * Discord's SDK lists the stable, PTB and canary Discord parent origins:
 * https://github.com/discord/embedded-app-sdk/blob/main/src/Discord.ts
 */
export const standaloneFramePolicy = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'";
export const activityFramePolicy = "frame-ancestors https://discord.com https://*.discord.com https://discordapp.com https://*.discordapp.com; base-uri 'self'; object-src 'none'";

/** Apply after framework headers so inherited DENY cannot block the Activity,
 * and framework case/trailing-slash matching cannot widen the exception.
 */
export function applyFramePolicy(request: Request, response: Response, settings: ActivityLaunchSettings = {}): Response {
  const headers = new Headers(response.headers);
  if (new URL(request.url).pathname === '/activity' || isActivityLaunchDocument(request, settings)) {
    headers.delete('X-Frame-Options');
    headers.set('Content-Security-Policy', activityFramePolicy);
  } else {
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Content-Security-Policy', standaloneFramePolicy);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
