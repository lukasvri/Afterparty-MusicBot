import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createElement,type ComponentType,type ImgHTMLAttributes} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import type {Room} from '../lib/types.ts';

test('actual queue component renders authoritative order without reversing new additions',()=>{
 const code=ts.transpileModule(readFileSync(new URL('../components/party/social-queue.tsx',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
 }).outputText;
 const localRequire=createRequire(import.meta.url);
 const exports:Record<string,unknown>={};
 runInNewContext(code,{exports,require:(name:string)=>{
  if(name==='next/image')return function FixtureImage(props:ImgHTMLAttributes<HTMLImageElement>&{unoptimized?:boolean}){const image={...props};delete image.unoptimized;return createElement('img',image);};
  if(name==='@/components/language')return {useLanguage:()=>({t:(text:string)=>text})};
  if(name==='@/lib/types')return {time:()=> '0:00'};
  return localRequire(name);
 }});
 const track=(id:string,title:string)=>({id,title,artist:'Synthetic',image:'',duration:60,live:false,embeddable:true});
 const room:Room={code:'SYNTHETC',name:'Synthetic',version:1,serverTime:1,expiresAt:99999,viewers:1,isHost:false,
  playing:true,position:0,radio:false,current:track('current0001','Current'),queue:[track('automatic01','Existing radio'),track('manual00001','First addition'),track('manual00002','Second addition')]};
 const Queue=exports.SocialQueue as ComponentType<{room:Room;busy:boolean;onAction:()=>void}>;
 const html=renderToStaticMarkup(createElement(Queue,{room,busy:false,onAction:()=>{}}));
 assert(html.indexOf('Existing radio')<html.indexOf('First addition'));
 assert(html.indexOf('First addition')<html.indexOf('Second addition'));
 assert.match(html,/queue-number[^>]*>1</);assert.match(html,/queue-number[^>]*>3</);
 assert.deepEqual(room.queue.map(v=>v.title),['Existing radio','First addition','Second addition']);
});
