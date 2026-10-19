/** Only a separately configured Activity test website may use its root to launch. */
export type ActivityLaunchSettings = {
  DISCORD_ACTIVITY_LAUNCH_ROOT?: string;
  DISCORD_ACTIVITY_ENABLED?: string;
  DISCORD_ACTIVITY_CLIENT_ID?: string;
};

export function activityLaunchRootEnabled(settings: ActivityLaunchSettings): boolean {
  return settings.DISCORD_ACTIVITY_LAUNCH_ROOT === 'true'
    && settings.DISCORD_ACTIVITY_ENABLED === 'true'
    && /^\d{14,22}$/.test(settings.DISCORD_ACTIVITY_CLIENT_ID ?? '');
}

export function isActivityLaunchDocument(request: Request, settings: ActivityLaunchSettings): boolean {
  return new URL(request.url).pathname === '/'
    && (request.method === 'GET' || request.method === 'HEAD')
    && activityLaunchRootEnabled(settings);
}
