import test from 'node:test';
import assert from 'node:assert/strict';
import {toolAvailable,nextGoal} from './gameplay.js';
test('grenade starts unlocked, distinct tools follow permanent research and free mode',()=>{
 assert.equal(toolAvailable('charge',0,false),true);
 assert.equal(toolAvailable('pulse',39,false),false);assert.equal(toolAvailable('pulse',40,false),true);
 assert.equal(toolAvailable('shock',89,false),false);assert.equal(toolAvailable('shock',90,false),true);
 assert.equal(toolAvailable('shock',0,true),true);
});
test('next goal stays concrete before tools and points to actual next map after completion',()=>{
 assert.match(nextGoal(0,false,'courtyard'),/40/);assert.match(nextGoal(40,false,'courtyard'),/90/);
 assert.match(nextGoal(90,false,'courtyard'),/70%/);
 assert.match(nextGoal(140,true,'courtyard'),/仓库/);assert.match(nextGoal(280,true,'warehouse'),/自由/);
});
