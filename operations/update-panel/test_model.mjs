import {test} from 'node:test';
import assert from 'node:assert/strict';
import {viewState, frozenRequest} from './model.mjs';
const commit = 'a'.repeat(40);
const nonce = 'b'.repeat(64);
test('a checked deployed version stays up to date and cannot publish again',()=>{
 const v=viewState({stage:'ready',ready:true,available:false,current_commit:commit,commit,message:'Ready to publish'});
 assert.equal(v.updated,true);assert.equal(v.ready,false);assert.equal(v.actionTitle,'Beta er oppdatert');assert.doesNotMatch(v.message,/Ready to publish/);
});
test('a new tested candidate can be explicitly confirmed',()=>{
 const s={stage:'ready',ready:true,available:true,commit,confirmation_id:nonce};
 assert.equal(viewState(s).ready,true);const request=frozenRequest(s);s.commit='c'.repeat(40);
 assert.equal(request.commit,commit);assert.equal(Object.isFrozen(request),true);
});
test('checking, running, blocked and same-version candidates cannot be submitted',()=>{
 for(const patch of [{checking:true},{running:true},{stage:'blocked'},{available:false},{confirmation_id:'x'},{commit:'main'}]){
  assert.equal(frozenRequest({stage:'ready',ready:true,available:true,commit,confirmation_id:nonce,...patch}),null);
 }
});
test('old errors are not shown after a successful check',()=>{
 assert.equal(viewState({stage:'ready',error:'Old failure'}).error,'');
 assert.equal(viewState({stage:'failed',error:'Actual failure'}).error,'Actual failure');
});
test('a check preserves the label of the last completed job',()=>{
 assert.equal(viewState({stage:'ready',progress_kind:'last'}).progressLabel,'Siste fullførte oppdatering');
});
