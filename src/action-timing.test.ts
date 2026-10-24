import test from 'node:test';
import assert from 'node:assert/strict';
import {createActionTiming} from './action-timing';
test('action timing is bounded, ordered, owned and accepts only explicit wall-clock samples',()=>{
 const trace=createActionTiming(3);for(let i=0;i<5;i++)trace.add('damage-start',{at:i,id:`shot-${i}`,epoch:2});
 const out=trace.read();assert.deepEqual(out.map(x=>x.at),[2,3,4]);out[0].at=99;out.push({kind:'fake',at:100});assert.deepEqual(trace.read().map(x=>x.at),[2,3,4]);
 trace.add('bad',{at:NaN});assert.equal(trace.read().length,3);
});
