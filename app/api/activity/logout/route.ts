import {activityLogout,activityResponse} from '@/lib/activity-server';
export const POST=(request:Request)=>activityResponse(()=>activityLogout(request));
