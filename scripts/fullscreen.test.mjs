import test from 'node:test';
import assert from 'node:assert/strict';
import {enterFullscreen,leaveFullscreen,fullscreenElement} from '../lib/fullscreen.ts';

test('native fullscreen is awaited before reporting success',async()=>{
 let completed=false;
 const element={ownerDocument:{fullscreenEnabled:true},async requestFullscreen(){await Promise.resolve();completed=true;}};
 assert.equal(await enterFullscreen(element),true);assert.equal(completed,true);
});
test('a browser rejection selects the viewport fallback',async()=>{
 const element={ownerDocument:{fullscreenEnabled:true},async requestFullscreen(){throw new Error('Permission denied');}};
 assert.equal(await enterFullscreen(element),false);
});
test('unsupported fullscreen does not crash',async()=>{
 assert.equal(await enterFullscreen({ownerDocument:{}}),false);
});
test('a disabled native API is not called',async()=>{
 let calls=0;
 const element={ownerDocument:{fullscreenEnabled:false},async requestFullscreen(){calls++;}};
 assert.equal(await enterFullscreen(element),false);assert.equal(calls,0);
});
test('Safari fullscreen uses its matching enter and exit methods',async()=>{
 let entered=0,exited=0;
 const doc={webkitFullscreenElement:null,webkitExitFullscreen(){exited++;}};
 const element={ownerDocument:doc,webkitRequestFullscreen(){entered++;doc.webkitFullscreenElement=element;}};
 assert.equal(await enterFullscreen(element),true);assert.equal(fullscreenElement(doc),element);
 await leaveFullscreen(element);assert.equal(entered,1);assert.equal(exited,1);
});
test('an already fullscreen video is not requested a second time',async()=>{
 let calls=0;
 const doc={fullscreenElement:null};const element={ownerDocument:doc,async requestFullscreen(){calls++;}};doc.fullscreenElement=element;
 assert.equal(await enterFullscreen(element),true);assert.equal(calls,0);
});
test('exit leaves an unrelated fullscreen element alone',async()=>{
 let exits=0;const doc={fullscreenElement:{},async exitFullscreen(){exits++;}};
 await leaveFullscreen({ownerDocument:doc});assert.equal(exits,0);
});
test('native exit is awaited and errors remain observable',async()=>{
 let done=false;const doc={fullscreenElement:null,async exitFullscreen(){await Promise.resolve();done=true;}};const element={ownerDocument:doc};doc.fullscreenElement=element;
 await leaveFullscreen(element);assert.equal(done,true);
 doc.exitFullscreen=async()=>{throw new Error('Exit failed');};await assert.rejects(leaveFullscreen(element),/Exit failed/);
});
