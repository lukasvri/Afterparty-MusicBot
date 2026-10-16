import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeSeekTracker} from '../lib/native-seek.ts';
test('native scrubbing is confirmed once and buffering alone does not seek the room',()=>{
 const t=new NativeSeekTracker();
 t.observe(10,0,1);t.observe(10.2,250,3);t.observe(10.2,4000,3);
 assert.equal(t.observe(10.3,4250,1),null);
 assert.equal(t.observe(80,4500,3),null);
 assert.equal(t.observe(80.25,4750,1),80.25);
 assert.equal(t.observe(80.5,5000,1),null);
 assert.equal(t.observe(20,5250,2),null);
 assert.equal(t.observe(20,5500,2),20);
});
test('programmatic seeks remain suppressed through arbitrarily slow buffering',()=>{
 const t=new NativeSeekTracker();t.observe(10,0,1);t.write(80);
 assert.equal(t.observe(10,5000,3),null);
 assert.equal(t.observe(80,10000,1),null);
 assert.equal(t.observe(80.25,10250,1),null);
 assert.equal(t.pending,false);
});
test('a load landing is acknowledged while Core buffering or permissions delay seek detection',()=>{
 const t=new NativeSeekTracker();
 t.write(0);
 t.acknowledge(0.1,100);
 // Core remains buffering while the iframe has already advanced past its target.
 assert.equal(t.observe(2.5,2500,1),null);
 assert.equal(t.observe(80,2600,3),null);
 assert.equal(t.observe(80,2700,2),80);
 assert.equal(t.observe(35,2800,3),null);
 assert.equal(t.observe(35,2900,2),35);
});
