import {Store} from './store.ts';
import {join} from 'node:path';
const store=new Store(join(process.env.DATA_DIR??'./data','core.sqlite'));store.importMuse(process.env.LEGACY_DATA_DIR??'/legacy-data',process.env.DISCORD_GUILD_ID??'');console.log(JSON.stringify({imported:store.get('muse-imported',false),favorites:store.favorites().length,snapshots:store.get<any[]>('snapshots',[]).length}));store.close();
