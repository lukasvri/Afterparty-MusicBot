import {application} from '@/lib/discord-auth';
export async function GET(request:Request){try{const app=await application();if(!app.clientId)throw Error();return Response.redirect('https://discord.com/oauth2/authorize?'+new URLSearchParams({client_id:app.clientId,scope:'bot applications.commands',permissions:'3230720'}),302);}catch{return Response.redirect(new URL('/admin',request.url),302);}}
