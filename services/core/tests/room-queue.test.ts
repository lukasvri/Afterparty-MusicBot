import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeRoom, needsRecommendation, type RoomPlayback } from '../src/room-state.ts';
const track = (id: string) => ({ id, title: id, artist: 'Test', image: '', duration: 180, live: false, embeddable: true });
const current = track('current0001'), selected = track('selected001'), manual = track('manual00001'), radio = {...track('radio000001'), radio:true};
const initial = (): RoomPlayback => ({current,queue:[selected,manual],playing:true,position:30});
test('play now consumes the selected queued track and invalidates old radio and undo state', () => {
 const before = {...initial(), queue:[selected,radio,manual], requests:[selected], undoQueue:[radio], radioRetryAt:999999};
 const after = changeRoom(before,{action:'play-video',video:selected},true,35);
 assert.equal(after.current?.id,selected.id);
 assert.deepEqual(after.queue.map(v=>v.id),[manual.id]);
 assert.deepEqual(after.requests,[]);
 assert.equal(after.radioRetryAt,undefined);
 assert.equal(after.undoQueue,undefined);
 assert.equal(after.position,0);
 assert.equal(after.playing,true);
 assert.deepEqual(before.queue.map(v=>v.id),[selected.id,radio.id,manual.id]);
 assert.equal(changeRoom(after,{action:'next'},true,10).current?.id,manual.id);
});
test('undo after disabling radio restores manual tracks without resurrecting radio suggestions',()=>{
 const cleared=changeRoom({...initial(),queue:[manual,radio]},{action:'clear'},true,30);
 const disabled=changeRoom(cleared,{action:'radio',enabled:false},true,30);
 const restored=changeRoom(disabled,{action:'undo'},true,30);
 assert.deepEqual(restored.queue.map(v=>v.id),[manual.id]);
});
test('queued tracks and disabled radio bypass recommendation coordination',()=>{
 assert.equal(needsRecommendation(initial(),{action:'next'}),false);
 assert.equal(needsRecommendation({...initial(),queue:[],radio:false},{action:'next'}),false);
 assert.equal(needsRecommendation({...initial(),queue:[]},{action:'next'}),true);
 assert.equal(needsRecommendation({...initial(),current:null,queue:[],history:[current],radio:false},{action:'radio',enabled:true}),true);
});

test('undo counts pending guest requests toward the room capacity without losing state', () => {
 const queue = Array.from({length: 49}, (_, i) => track(`saved${String(i).padStart(6, '0')}`));
 let state = changeRoom({...initial(), queue, approvalRequired: true}, {action: 'clear'}, true, 30);
 for (const id of ['request0001', 'request0002']) {
  state = changeRoom(state, {action: 'add', video: track(id)}, false, 30);
 }
 const before = structuredClone(state);
 assert.throws(() => changeRoom(state, {action: 'undo'}, true, 30), /The queue is too full/);
 assert.deepEqual(state, before);
 // Freeing one pending slot makes the same undo possible at exactly 50 tracks.
 state = changeRoom(state, {action: 'reject', videoId: 'request0002'}, true, 30);
 const restored = changeRoom(state, {action: 'undo'}, true, 30);
 assert.deepEqual(restored.queue.map(v => v.id), queue.map(v => v.id));
 assert.deepEqual(restored.requests?.map(v => v.id), ['request0001']);
 assert.equal(restored.undoQueue, undefined);
});

test('undo counts new queued tracks and pending requests together', () => {
 const queue = Array.from({length: 48}, (_, i) => track(`saved${String(i).padStart(6, '0')}`));
 let state = changeRoom({...initial(), queue, approvalRequired: true}, {action: 'clear'}, true, 30);
 state = changeRoom(state, {action: 'add', video: manual}, true, 30);
 for (const id of ['request0001', 'request0002']) {
  state = changeRoom(state, {action: 'add', video: track(id)}, false, 30);
 }
 assert.throws(() => changeRoom(state, {action: 'undo'}, true, 30), /The queue is too full/);
});
