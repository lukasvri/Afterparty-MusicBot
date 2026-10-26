import {oauthCallback} from '@/lib/discord-auth';
export async function GET(request:Request){try{return await oauthCallback(request);}catch{return Response.redirect(new URL('/admin?login=failed',request.url),302);}}
