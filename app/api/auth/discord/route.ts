import {oauthStart} from '@/lib/discord-auth';
export async function GET(request:Request){try{return await oauthStart(request);}catch{return Response.redirect(new URL('/admin?login=unavailable',request.url),302);}}
