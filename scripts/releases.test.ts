import {test} from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {releases,nextVersion,releaseNotes,changelog,validate,validateReleaseHistory} from './releases.ts';
import {legacyUpdates} from '../lib/legacy-updates.ts';

test('version increments reset only the subordinate components',()=>{
 assert.equal(nextVersion('1.0.0','patch'),'1.0.1');
 assert.equal(nextVersion('1.4.9','patch'),'1.4.10');
 assert.equal(nextVersion('1.4.9','minor'),'1.5.0');
 assert.equal(nextVersion('1.4.9','major'),'2.0.0');
 for(const value of ['36','v1.0.0','01.2.3','1.2','1.2.3-beta'])assert.throws(()=>nextVersion(value,'patch'));
 assert.throws(()=>nextVersion('1.0.0','unknown'));
});
test('website and Core manifests, locks and generated changelog agree',()=>{
 validate();
 const latest=releases[0];
 assert(changelog().includes(releaseNotes(latest)));
 assert(releaseNotes(latest).includes(`## v${latest.version}: ${latest.title}`));
 for(const item of latest.items)assert(releaseNotes(latest).includes(`- ${item}\n`));
 const page=readFileSync(new URL('../app/patch-notes/page.tsx',import.meta.url),'utf8');
 assert(page.includes("import releases from '@/lib/releases.json'"));
 assert(page.includes('[...releases,...legacyUpdates]'));
});
test('all historical entries retain their labels, dates and content in the changelog',()=>{
 assert.equal(createHash('sha256').update(JSON.stringify(legacyUpdates)).digest('hex'),'4006b79c002167cd5f2457d2c89a5233e7324503d3ba1566d77dc1278ca8ba25');
 assert.deepEqual(legacyUpdates.map(entry=>entry.version),['36','35','34','33','31','30','19','11','10','09','08','07','06','05']);
 for(const entry of legacyUpdates){
  assert(changelog().includes(`### V${entry.version}: ${entry.title}\n\n${entry.date}`));
  for(const item of entry.items)assert(changelog().includes(`- ${item}\n`));
 }
});
test('validation rejects version drift and duplicate releases',()=>{
 try{releases.unshift({...releases[0],version:nextVersion(releases[0].version,'patch')});assert.throws(validate,/Version mismatch/);}finally{releases.shift();}
 try{releases.push(releases[0]);assert.throws(validate,/Duplicate/);}finally{releases.pop();}
 validate();
});

const history=(versions: string[])=>versions.map(version=>({version,date:'2026-10-15',title:'Test release',items:['Synthetic release notes']}));
test('release history accepts single entries and consecutive semantic increments',()=>{
 for(const versions of [
  ['1.0.0'],
  ['1.4.10','1.4.9'],
  ['1.10.0','1.9.12'],
  ['10.0.0','9.8.7'],
  ['2.0.1','2.0.0','1.1.0','1.0.1','1.0.0'],
 ])assert.doesNotThrow(()=>validateReleaseHistory(history(versions)),versions.join(', '));
});
test('release history rejects ascending, mixed, skipped and non-reset transitions',()=>{
 for(const versions of [
  ['1.0.0','1.0.1'],
  ['1.0.2','1.0.0','1.0.1'],
  ['1.0.3','1.0.1'],
  ['1.3.0','1.1.4'],
  ['3.0.0','1.9.9'],
  ['1.5.1','1.4.9'],
  ['2.1.0','1.4.9'],
  ['2.0.1','1.4.9'],
  ['1.4.9','1.4.10'],
  ['1.9.0','1.10.0'],
  ['9.0.0','10.0.0'],
 ])assert.throws(()=>validateReleaseHistory(history(versions)),/Invalid release transition/,versions.join(', '));
 assert.throws(()=>validateReleaseHistory([]),/At least one release/);
 assert.throws(()=>validateReleaseHistory(history(['1.0.0','1.0.0'])),/Duplicate/);
});
test('full validation rejects an appended newer release before checking generated notes',()=>{
 try{
  releases.push({...releases[0],version:nextVersion(releases[0].version,'patch')});
  assert.throws(validate,/Invalid release transition/);
 }finally{releases.pop();}
 validate();
});
