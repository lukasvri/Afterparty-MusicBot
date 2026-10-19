import test from 'node:test';
import assert from 'node:assert/strict';
import {enterFullscreen,leaveFullscreen,fullscreenElement} from '../lib/fullscreen.ts';

type DocumentFixture = {
 fullscreenEnabled?: boolean;
 fullscreenElement?: Element | null;
 webkitFullscreenElement?: Element | null;
 exitFullscreen?: () => Promise<void>;
 webkitExitFullscreen?: () => void;
};
type ElementMethods = Partial<Pick<HTMLElement, 'requestFullscreen'>> & {webkitRequestFullscreen?: () => void};
// Node has no DOM. The fixture supplies the exact fullscreen API surface used
// by the helper, with one explicit boundary to its browser HTMLElement input.
const elementFixture = (ownerDocument: DocumentFixture, methods: ElementMethods = {}): HTMLElement =>
 ({ownerDocument, ...methods}) as HTMLElement;

test('native fullscreen is awaited before reporting success',async()=>{
 let completed=false;
 const element=elementFixture({fullscreenEnabled:true},{async requestFullscreen(){await Promise.resolve();completed=true;}});
 assert.equal(await enterFullscreen(element),true);assert.equal(completed,true);
});
test('a browser rejection selects the viewport fallback',async()=>{
 const element=elementFixture({fullscreenEnabled:true},{async requestFullscreen(){throw new Error('Permission denied');}});
 assert.equal(await enterFullscreen(element),false);
});
test('unsupported fullscreen does not crash',async()=>{
 assert.equal(await enterFullscreen(elementFixture({})),false);
});
test('a disabled native API is not called',async()=>{
 let calls=0;
 const element=elementFixture({fullscreenEnabled:false},{async requestFullscreen(){calls++;}});
 assert.equal(await enterFullscreen(element),false);assert.equal(calls,0);
});
test('Safari fullscreen uses its matching enter and exit methods',async()=>{
 let entered=0,exited=0;
 const doc:DocumentFixture={webkitFullscreenElement:null,webkitExitFullscreen(){exited++;}};
 const element=elementFixture(doc,{webkitRequestFullscreen(){entered++;doc.webkitFullscreenElement=element;}});
 assert.equal(await enterFullscreen(element),true);assert.equal(fullscreenElement(element.ownerDocument),element);
 await leaveFullscreen(element);assert.equal(entered,1);assert.equal(exited,1);
});
test('an already fullscreen video is not requested a second time',async()=>{
 let calls=0;
 const doc:DocumentFixture={fullscreenElement:null};const element=elementFixture(doc,{async requestFullscreen(){calls++;}});doc.fullscreenElement=element;
 assert.equal(await enterFullscreen(element),true);assert.equal(calls,0);
});
test('exit leaves an unrelated fullscreen element alone',async()=>{
 let exits=0;const doc:DocumentFixture={fullscreenElement:elementFixture({}),async exitFullscreen(){exits++;}};
 await leaveFullscreen(elementFixture(doc));assert.equal(exits,0);
});
test('native exit is awaited and errors remain observable',async()=>{
 let done=false;const doc:DocumentFixture={fullscreenElement:null,async exitFullscreen(){await Promise.resolve();done=true;}};const element=elementFixture(doc);doc.fullscreenElement=element;
 await leaveFullscreen(element);assert.equal(done,true);
 doc.exitFullscreen=async()=>{throw new Error('Exit failed');};await assert.rejects(leaveFullscreen(element),/Exit failed/);
});


test('explicit viewport-only mode never requests or reports native fullscreen',async()=>{
 let requests=0;const element=elementFixture({fullscreenEnabled:true},{async requestFullscreen(){requests++;}});
 assert.equal(await enterFullscreen(element,true),false);assert.equal(requests,0);
});


test('native fullscreen capability is preserved when granted and falls back when denied',async()=>{
 let calls=0;
 const allowed=elementFixture({fullscreenEnabled:true},{async requestFullscreen(){calls++;}});
 assert.equal(await enterFullscreen(allowed),true);assert.equal(calls,1);
 const denied=elementFixture({fullscreenEnabled:false},{async requestFullscreen(){calls++;}});
 assert.equal(await enterFullscreen(denied),false);assert.equal(calls,1);
});
