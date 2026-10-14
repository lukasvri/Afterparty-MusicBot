import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {UserError} from './types.ts';
import type {Engine} from './engine.ts';
import type {Commands} from './commands.ts';
import type {DiscordBot} from './discord.ts';
export type GuildSession={id:string;name:string;roomCode:string;engine:Engine;commands:Commands;bot:DiscordBot};
export class Guilds extends EventEmitter{
 readonly sessions=new Map<string,GuildSession>();
 readonly defaultId:string;readonly codes:Record<string,string>;saveCodes:(codes:Record<string,string>)=>void;constructor(defaultId:string,codes:Record<string,string>={},saveCodes=(codes:Record<string,string>)=>{}){super();this.defaultId=defaultId;this.codes=codes;this.saveCodes=saveCodes;}
 roomCode(id:string){if(id===this.defaultId)return 'DISCORD1';if(this.codes[id])return this.codes[id];let n=0,code='';do{code='D0'+createHash('sha256').update(id+':'+n++).digest('hex').slice(0,6).toUpperCase();}while(Object.values(this.codes).includes(code));this.codes[id]=code;this.saveCodes(this.codes);return code;}
 register(session:GuildSession){if(!/^\d{14,22}$/.test(session.id)||this.sessions.has(session.id)||[...this.sessions.values()].some(s=>s.roomCode===session.roomCode))throw new UserError('Ugyldig eller duplisert server.');this.sessions.set(session.id,session);this.emit('added',session);}
 get(value?:unknown){const id=value===undefined||value===null||value===''?this.defaultId:String(value);if(!/^\d{14,22}$/.test(id))throw new UserError('Ugyldig Discord-server.');const s=this.sessions.get(id);if(!s)throw new UserError('Boten er ikke lagt til på denne serveren.',404);return s;}
 byRoom(code:string){return [...this.sessions.values()].find(s=>s.roomCode===code);}
 remove(id:string){const s=this.sessions.get(id);if(s){this.sessions.delete(id);this.emit('removed',s);}return s;}
 list(){return [...this.sessions.values()].map(s=>({id:s.id,name:s.name,roomCode:s.roomCode,ready:s.engine.ready}));}
 state(s:GuildSession,all=false){return {...(all?s.engine.snapshot():s.engine.websiteSnapshot()),guildId:s.id,roomCode:s.roomCode,guildName:s.name};}
}
