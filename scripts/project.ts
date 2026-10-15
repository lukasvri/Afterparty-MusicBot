import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));const action=process.argv[2]??'help';
const run=(command: string,args: string[],cwd=root)=>{const r=spawnSync(command,args,{cwd,stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);};
if(action==='check'){run(process.execPath,['node_modules/typescript/bin/tsc','--noEmit']);run('docker',['--context','default','build','--target','validation','-t','gutta-krutt-core:validation','.'],root+'/services/core');}
else if(action==='core')run('bash',['core-control.sh',process.argv[3]??'status'],root+'/services/core');
else if(action==='dev')run('npm',['run','dev']);
else console.log('Bruk: npm run project -- check | core start/stop/status/logs/admin | dev');
