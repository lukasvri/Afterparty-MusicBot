import {activityBridge} from '@/lib/activity-bridge';
import {activityResponse} from '@/lib/activity-server';
export const GET=(request:Request)=>activityResponse(()=>activityBridge(request));
export const POST=GET;
