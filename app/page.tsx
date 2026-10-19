import { env } from 'cloudflare:workers';
import Afterparty from './afterparty';
import ActivityPage from './activity/page';
import { activityLaunchRootEnabled, type ActivityLaunchSettings } from '@/lib/activity-launch';

export const dynamic = 'force-dynamic';

export default function Page() {
  return activityLaunchRootEnabled(env as ActivityLaunchSettings) ? <ActivityPage /> : <Afterparty />;
}
