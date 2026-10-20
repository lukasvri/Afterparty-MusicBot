import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {legacyUpdates} from '../lib/legacy-updates.ts';

const root=new URL('../',import.meta.url);
type Release = {version: string; title: string; date: string; items: string[]};
const read=(path: string)=>readFileSync(new URL(path,root),'utf8');
export const releases: Release[]=JSON.parse(read('lib/releases.json'));
export function nextVersion(version: string,kind: string){
 if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw new Error('Expected MAJOR.MINOR.PATCH');
 const [major,minor,patch]=version.split('.').map(Number);
 if(kind==='patch')return `${major}.${minor}.${patch+1}`;
 if(kind==='minor')return `${major}.${minor+1}.0`;
 if(kind==='major')return `${major+1}.0.0`;
 throw new Error('Expected patch, minor or major');
}
export function releaseNotes(release: Release){
 return `## v${release.version}: ${release.title}\n\n${release.date}\n\n${release.items.map(item=>`- ${item}`).join('\n')}\n`;
}
export function changelog(){
 return '# Changelog\n\nGenerated from `lib/releases.json` and `lib/legacy-updates.ts`. Do not edit by hand.\nRelease entries describe source versions, not production deployment status.\nSee [release policy](docs/RELEASING.md).\n\n'+releases.map(releaseNotes).join('\n')+'\n## Historical integer versions\n\nOriginal dates, numbering and Norwegian wording are preserved.\n\n'+legacyUpdates.map(entry=>`### V${entry.version}: ${entry.title}\n\n${entry.date}\n\n${entry.items.map(item=>`- ${item}`).join('\n')}\n`).join('\n');
}
// Prerelease notes describe review builds, never a stable release or deployment.
export function releaseVersion(value: string){
 const match=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/.exec(value);
 if(!match)throw new Error('Expected semantic release or numbered prerelease');
 return {base:match.slice(1,4).join('.'),stage:match[4]??'',number:Number(match[5]??0)};
}
export function validateReleaseHistory(releases: Release[]){
 if(!releases.length)throw new Error('At least one release is required');
 const versions=new Set();
 for(const release of releases){
  releaseVersion(release.version);
  if(versions.has(release.version))throw new Error('Duplicate release version');
  versions.add(release.version);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(release.date)||new Date(release.date).toISOString().slice(0,10)!==release.date)throw new Error('Invalid release date');
  if(!release.title||!release.items.length||release.items.some(item=>typeof item!=='string'||!item.trim()))throw new Error('Empty release notes');
 }
 for(let index=1;index<releases.length;index++){
  const older=releases[index].version;
  const newer=releases[index-1].version;
  const a=releaseVersion(older),b=releaseVersion(newer);
  const normal=!a.stage&&['patch','minor','major'].some(kind=>nextVersion(a.base,kind)===b.base)&&(!b.stage||b.number===1);
  const advance=a.stage&&a.base===b.base&&(!b.stage||
   (a.stage===b.stage&&b.number===a.number+1)||
   (['alpha','beta','rc'].indexOf(b.stage)===['alpha','beta','rc'].indexOf(a.stage)+1&&b.number===1));
  // A new alpha may supersede an unfinished lower release line. Retain that
  // line's notes without manufacturing a stable release or a skipped stage.
  const supersede=a.stage&&b.stage==='alpha'&&b.number===1&&
   ['minor','major'].some(kind=>nextVersion(a.base,kind)===b.base);
  if(!normal&&!advance&&!supersede){
   throw new Error(`Invalid release transition: ${older} -> ${newer}; releases must be newest first with one patch, minor or major increment`);
  }
 }
}
export function validate(){
 validateReleaseHistory(releases);
 for(const path of ['package.json','package-lock.json','services/core/package.json','services/core/package-lock.json']){
  const manifest=JSON.parse(read(path));
  if(manifest.version!==releases[0].version||manifest.packages&&manifest.packages[''].version!==releases[0].version)throw new Error(`Version mismatch: ${path}`);
 }
 if(read('CHANGELOG.md')!==changelog())throw new Error('Run npm run release:changelog');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2];
 if(mode==='--write')writeFileSync(new URL('CHANGELOG.md',root),changelog());
 else if(mode==='--check')validate();
 else if(mode==='--notes'){validate();process.stdout.write(releaseNotes(releases[0]));}
 else throw new Error('Usage: node scripts/releases.ts --write|--check|--notes');
}
