import test from 'node:test';
import assert from 'node:assert/strict';
import {toolAvailable,nextGoal} from './gameplay.js';
test('grenade starts unlocked and free mode does not bypass permanent weapon research',()=>{
 for(const free of [false,true]){
  assert.equal(toolAvailable('charge',0,free),true);
  assert.equal(toolAvailable('pulse',39,free),false);assert.equal(toolAvailable('pulse',40,free),true);
  assert.equal(toolAvailable('shock',89,free),false);assert.equal(toolAvailable('shock',90,free),true);
 }
});
test('next goal follows research gates rather than building completion',()=>{
 for(const complete of [false,true]){
  assert.match(nextGoal(0,complete,'courtyard'),/40/);assert.match(nextGoal(40,complete,'courtyard'),/90/);
  assert.match(nextGoal(90,complete,'courtyard'),/120/);assert.match(nextGoal(119,complete,'courtyard'),/仓库/);
  assert.match(nextGoal(120,complete,'courtyard'),/仓库/);assert.doesNotMatch(nextGoal(120,complete,'courtyard'),/70%|100%/);
 }
 assert.match(nextGoal(120,false,'warehouse'),/实验|自由|重试/);
});
