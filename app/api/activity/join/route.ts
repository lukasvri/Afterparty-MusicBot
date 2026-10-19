import {activityJoin,activityResponse} from '@/lib/activity-server';
export const POST=(request:Request)=>activityResponse(()=>activityJoin(request));
