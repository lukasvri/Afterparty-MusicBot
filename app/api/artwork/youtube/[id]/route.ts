import { youtubeArtwork } from '@/lib/artwork';
type Context = {params: Promise<{id:string}>};
export const GET = async (request:Request, context:Context) => youtubeArtwork(request,(await context.params).id);
export const HEAD = GET;
