import {discordLogout} from '@/lib/discord-auth';
import {api,isAdmin} from '@/lib/server';
import {login,logout,hasPasswordSession} from '@/lib/admin-session';
import {getChatGPTUser,chatGPTSignOutPath} from '@/app/chatgpt-auth';
export const GET=(request:Request)=>api(async()=>({authenticated:await isAdmin(request),method:await hasPasswordSession(request)?'password':'owner'}));
export const POST=login;
export async function DELETE(request:Request){
 const response=await logout(request);if(!response.ok)return response;
 const discord=await discordLogout(request);response.headers.append('Set-Cookie',discord.headers.get('Set-Cookie')??'');
 const siteUser=await getChatGPTUser();
 return Response.json({authenticated:false,redirect:siteUser?chatGPTSignOutPath('/admin'):'/admin'},{headers:response.headers});
}
