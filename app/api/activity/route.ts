import {activityStart,activityResponse} from '@/lib/activity-server';
export const GET=(request:Request)=>activityResponse(()=>activityStart(request));
