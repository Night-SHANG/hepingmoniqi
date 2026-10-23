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

// These cases protect cost weighting, the live progression boundary, and input
// validation rather than accepting any positive collection of unlocked tools.
test('loadout capacity uses six slots before 120 research and eight thereafter',async()=>{
 const gameplay=await import('./gameplay.js');
 assert.equal(typeof gameplay.capacityForResearch,'function');
 for(const [research,capacity] of [[0,6],[40,6],[90,6],[119,6],[120,8],[999999,8]])assert.equal(gameplay.capacityForResearch(research),capacity);
 assert.equal(gameplay.weaponCost('charge'),1);assert.equal(gameplay.weaponCost('pulse'),2);assert.equal(gameplay.weaponCost('shock'),2);
 assert.equal(gameplay.validateLoadout({charge:2,pulse:1,shock:1},90),true,'2 grenades, a rocket and a remote package consume six slots');
 assert.equal(gameplay.validateLoadout({charge:4,pulse:1,shock:1},119),false);
 assert.equal(gameplay.validateLoadout({charge:4,pulse:1,shock:1},120),true);
});
test('loadout validation rejects empty, overbudget, locked and malformed item counts',async()=>{
 const {validateLoadout}=await import('./gameplay.js');assert.equal(typeof validateLoadout,'function');
 for(const [loadout,research] of [
  [{charge:0,pulse:0,shock:0},120], [{charge:7,pulse:0,shock:0},0],
  [{charge:1,pulse:1,shock:0},39], [{charge:1,pulse:0,shock:1},89],
  [{charge:-1,pulse:0,shock:0},120], [{charge:1.5,pulse:0,shock:0},120],
  [{charge:Infinity,pulse:0,shock:0},120], [{charge:Number.MAX_SAFE_INTEGER+1,pulse:0,shock:0},120],
  [{charge:1,pulse:0},120], [{charge:1,pulse:0,shock:0,fake:1},120], [null,120],
  [{charge:1,pulse:0,shock:0},NaN], [{charge:1,pulse:0,shock:0},-1]
 ] as const)assert.equal(validateLoadout(loadout as any,research),false,JSON.stringify({loadout,research}));
 assert.equal(validateLoadout({charge:1,pulse:0,shock:0},0),true,'using less than all capacity is valid');
 assert.equal(validateLoadout({charge:0,pulse:1,shock:0},40),true);
 assert.equal(validateLoadout({charge:0,pulse:0,shock:1},90),true);
});

// Dropping a threshold, duplicating the 120 reward, or inventing a higher tier
// must fail these assertions against the complete, player-visible reward list.
test('crossed unlocks includes every milestone and the distinct capacity reward',async()=>{
 const {crossedUnlocks}=await import('./gameplay.js');
 assert.equal(typeof crossedUnlocks,'function');
 assert.deepEqual(crossedUnlocks(0,120),['火箭弹','遥控爆破包','双跨仓库','携带容量 6 → 8 格']);
 assert.deepEqual(crossedUnlocks(39,40),['火箭弹']);
 assert.deepEqual(crossedUnlocks(89,90),['遥控爆破包']);
 assert.deepEqual(crossedUnlocks(119,120),['双跨仓库','携带容量 6 → 8 格']);
 assert.deepEqual(crossedUnlocks(40,999999),['遥控爆破包','双跨仓库','携带容量 6 → 8 格']);
});
test('crossed unlocks does not repeat earned rewards or report noncrossings',async()=>{
 const {crossedUnlocks}=await import('./gameplay.js');
 assert.equal(typeof crossedUnlocks,'function');
 for(const [start,end] of [[0,0],[0,39],[40,89],[90,119],[120,120],[120,999999],[120,0]])assert.deepEqual(crossedUnlocks(start,end),[],`${start} to ${end}`);
});
// Allowing launch/automatic on packages, or stripping a quick tool's requested
// trigger, must fail the exhaustive legal delivery/trigger combinations below.
test('remote package always uses placement and remote trigger',async()=>{
 const {deliveryPolicy}=await import('./gameplay.js');
 assert.equal(typeof deliveryPolicy,'function');
 for(const delivery of ['quick','place'] as const)for(const trigger of ['automatic','remote'] as const){
  assert.deepEqual(deliveryPolicy('shock',delivery,trigger),{delivery:'place',trigger:'remote',canLaunch:false,canChooseTrigger:false});
 }
});
test('launchable tools retain quick trigger choice and force remote placement',async()=>{
 const {deliveryPolicy}=await import('./gameplay.js');
 assert.equal(typeof deliveryPolicy,'function');
 for(const weapon of ['charge','pulse'] as const)for(const trigger of ['automatic','remote'] as const){
  assert.deepEqual(deliveryPolicy(weapon,'quick',trigger),{delivery:'quick',trigger,canLaunch:true,canChooseTrigger:true});
  assert.deepEqual(deliveryPolicy(weapon,'place',trigger),{delivery:'place',trigger:'remote',canLaunch:true,canChooseTrigger:false});
 }
});
