import test from 'node:test';
import assert from 'node:assert/strict';
import {createExperimentFlow} from './experiment-flow';
test('destruction percentage never initiates settlement; only explicit request does',()=>{const f=createExperimentFlow();assert.equal(f.shouldSettle(0,false),false);assert.equal(f.canAct(),true);f.requestFinish();assert.equal(f.canAct(),false);assert.equal(f.shouldSettle(0,false),true);});
test('requested settlement waits for all ordnance and visual effects without pausing them',()=>{const f=createExperimentFlow();f.requestFinish();assert.equal(f.shouldSettle(1,false),false);assert.equal(f.shouldSettle(0,true),false);assert.equal(f.shouldSettle(0,false),true);f.settled();assert.equal(f.shouldSettle(0,false),false);assert.equal(f.canAct(),false);});
test('reset cancels pending settlement and enables another round',()=>{const f=createExperimentFlow();f.requestFinish();f.reset();assert.equal(f.canAct(),true);assert.equal(f.shouldSettle(0,false),false);});
