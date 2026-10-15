import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readBrowserValue} from '../lib/browser-storage.ts';
import {visitorIdentity} from '../lib/visitor-identity.ts';

test('saved room ownership, visitor identity and every preference survive the namespace migration',()=>{
 const keys=['host:TESTROOM','visitor','audio','volume','sync-offset','sync-mode-v1','motion'];
 const values=new Map(keys.map(k=>['muse-'+k,'saved-'+k]));
 const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 for(const key of keys){assert.equal(readBrowserValue(storage,'afterparty-'+key),'saved-'+key);assert.equal(values.get('afterparty-'+key),'saved-'+key);}
 values.set('afterparty-audio','new-choice');assert.equal(readBrowserValue(storage,'afterparty-audio'),'new-choice');
 assert.equal(readBrowserValue(storage,'afterparty-host:NEWROOM'),null);
});
test('read-only browser storage still returns existing ownership',()=>{
 const storage={getItem:k=>k==='muse-host:TESTROOM'?'saved-token':null,setItem:()=>{throw Error('quota');}};
 assert.equal(readBrowserValue(storage,'afterparty-host:TESTROOM'),'saved-token');
});
test('new visitor header takes precedence and existing clients remain recognized',()=>{
 assert.equal(visitorIdentity(new Headers({'X-Muse-Visitor':'old'})),'old');
 assert.equal(visitorIdentity(new Headers({'X-Afterparty-Visitor':'new','X-Muse-Visitor':'old'})),'new');
 assert.equal(visitorIdentity(new Headers()),null);
});
