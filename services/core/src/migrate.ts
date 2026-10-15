import {importPreviousData,previousDataImported} from './data-import.ts';
import {Store} from './store.ts';
import {join} from 'node:path';
const store=new Store(join(process.env.DATA_DIR??'./data','core.sqlite'));importPreviousData(store,process.env.LEGACY_DATA_DIR??'/legacy-data',process.env.DISCORD_GUILD_ID??'');console.log(JSON.stringify({imported:previousDataImported(store),favorites:store.favorites().length,snapshots:store.get<unknown[]>('snapshots',[]).length}));store.close();
