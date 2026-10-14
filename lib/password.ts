const encoder=new TextEncoder();
export const hex=(bytes:Uint8Array)=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
export function constantEqual(left:string,right:string){let difference=left.length^right.length;for(let i=0;i<Math.max(left.length,right.length);i++)difference|=(left.charCodeAt(i)||0)^(right.charCodeAt(i)||0);return difference===0;}
export async function verifyPassword(password:string,stored:string){
 const [kind,iterations,salt,expected]=stored.split('$');
 if(kind!=='pbkdf2'||iterations!=='100000'||!/^([a-f0-9]{2}){16}$/.test(salt??'')||!/^([a-f0-9]{2}){32}$/.test(expected??'')||password.length>200)return false;
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 const bytes=Uint8Array.from(salt.match(/../g)!,value=>parseInt(value,16));
 const derived=await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes,iterations:100000,hash:'SHA-256'},key,256);
 return constantEqual(hex(new Uint8Array(derived)),expected);
}
export const randomToken=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export const sessionCookie=(request:Request)=>{
 const name=new URL(request.url).protocol==='https:'?'__Host-gk-admin':'gk-admin';
 const token=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${name}=`))?.slice(name.length+1);
 return token&&/^[a-f0-9]{64}$/.test(token)?token:null;
};
export const cookieHeader=(request:Request,token:string,age=28800)=>`${new URL(request.url).protocol==='https:'?'__Host-gk-admin':'gk-admin'}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
