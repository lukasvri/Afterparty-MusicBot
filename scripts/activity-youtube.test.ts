import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityYoutubeFrame,youtubeActivityUrl,installActivityYoutubeScripts} from '../lib/activity-youtube.ts';
const origin='https://123456789012345678.discordsays.com';

test('Activity routes only official API/widget/embed paths, preserves real origin, and never maps media or arbitrary hosts',()=>{
 assert.equal(youtubeActivityUrl('https://www.youtube.com/iframe_api',origin),origin+'/youtube/iframe_api');
 const frame=new URL(activityYoutubeFrame('synthetic01',origin));
 assert.equal(frame.origin,origin);assert.equal(frame.pathname,'/youtube/embed/synthetic01');
 assert.equal(frame.searchParams.get('origin'),origin);assert.equal(frame.searchParams.get('enablejsapi'),'1');
 assert.equal(frame.searchParams.get('autoplay'),'0');assert.equal(frame.searchParams.get('fs'),'1');
 assert.equal(youtubeActivityUrl('https://www.youtube.com/s/player/c271e571/www-widgetapi.vflset/www-widgetapi.js',origin),origin+'/youtube/s/player/c271e571/www-widgetapi.vflset/www-widgetapi.js');
 for(const url of ['https://other.example/iframe_api','https://www.youtube.com.evil.example/iframe_api','https://user:pass@www.youtube.com/iframe_api','https://www.youtube.com:8443/iframe_api','https://www.youtube.com/watch?v=synthetic01','https://www.youtube.com/videoplayback','https://example.googlevideo.com/videoplayback'])assert.throws(()=>youtubeActivityUrl(url,origin));
 assert.throws(()=>activityYoutubeFrame('invalid',origin));
});

test('scoped widget rewriting cleans up and never changes the Activity fetch transport or nested frames',async()=>{
 const saved=new Map<string,PropertyDescriptor|undefined>();
 const set=(key:string,value:unknown)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
 class FakeElement {querySelectorAll(){return [];} }
 class Script extends FakeElement {
  values=new Map<string,string>();replacement?:Script;removed=false;
  get attributes(){return [...this.values].map(([name,value])=>({name,value}));}
  getAttribute(name:string){return this.values.get(name)??null;}
  setAttribute(name:string,value:string){this.values.set(name,value);}
  set src(value:string){this.values.set('src',value);}
  get src(){return this.values.get('src')??'';}
  replaceWith(node:Script){this.replacement=node;}
  remove(){this.removed=true;}
 }
 let callback:MutationCallback|undefined,disconnected=false;const head={};
 const before=globalThis.fetch;
 try{
  set('Element',FakeElement);set('HTMLScriptElement',Script);set('location',{href:origin+'/',origin});
  set('document',{head,createElement:(tag:string)=>{assert.equal(tag,'script');return new Script();}});
  set('MutationObserver',class {constructor(cb:MutationCallback){callback=cb;}observe(target:unknown){assert.equal(target,head);}disconnect(){disconnected=true;}});
  const restore=installActivityYoutubeScripts(url=>new URL('/youtube'+url.pathname,origin));
  const source=new Script();source.src='https://www.youtube.com/s/player/hash/www-widgetapi.vflset/www-widgetapi.js';
  callback!([{type:'childList',addedNodes:[source]} as unknown as MutationRecord],{} as MutationObserver);
  assert.equal(source.replacement?.src,origin+'/youtube/s/player/hash/www-widgetapi.vflset/www-widgetapi.js');
  const unrelated=new Script();unrelated.src='https://other.example/script.js';
  callback!([{type:'attributes',target:unrelated} as unknown as MutationRecord],{} as MutationObserver);assert.equal(unrelated.replacement,undefined);
  assert.equal(globalThis.fetch,before);restore();assert.equal(disconnected,true);assert.equal(source.replacement?.removed,true);
 }finally{for(const [key,value]of saved){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}}
});

test('the actual loader maps before insertion and pre-created iframe keeps official API attributes; standalone uses a div',async()=>{
 const saved=new Map<string,PropertyDescriptor|undefined>();
 const set=(key:string,value:unknown)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
 const created:Record<string,unknown>[]=[];const win:{YT?:{Player:unknown};onYouTubeIframeAPIReady?:()=>void}={};
 try{
  set('window',win);set('location',{origin});set('document',{createElement:(tag:string)=>{const node={tag};created.push(node);return node;},head:{appendChild:(script:HTMLScriptElement)=>{assert.equal(script.src,origin+'/youtube/iframe_api');queueMicrotask(()=>{win.YT={Player:class{}};win.onYouTubeIframeAPIReady?.();});}}});
  const {loadYoutube,youtubePlayerTarget}=await import('../lib/youtube-player.ts');
  await loadYoutube(true);
  const frame=youtubePlayerTarget(true,'synthetic01') as HTMLIFrameElement;
  assert.equal((frame as unknown as {tag:string}).tag,'iframe');assert.equal(new URL(frame.src).searchParams.get('origin'),origin);
  assert.equal(frame.allowFullscreen,true);assert(frame.allow.includes('fullscreen'));assert.equal(frame.referrerPolicy,'strict-origin-when-cross-origin');
  assert.equal((youtubePlayerTarget(false,undefined) as unknown as {tag:string}).tag,'div');
 }finally{for(const [key,value]of saved){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}}
});
