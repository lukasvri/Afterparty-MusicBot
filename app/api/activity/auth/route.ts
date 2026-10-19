import {activityAuthenticate,activityResponse} from '@/lib/activity-server';
export const POST=(request:Request)=>activityResponse(()=>activityAuthenticate(request));
