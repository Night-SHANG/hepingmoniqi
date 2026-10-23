import test from 'node:test';
import assert from 'node:assert/strict';
import {toolAvailable,nextGoal} from './gameplay.js';
import * as gameplay from './gameplay.js';
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
  assert.match(nextGoal(120,complete,'courtyard'),/240/);assert.doesNotMatch(nextGoal(120,complete,'courtyard'),/70%|100%/);
 }
 assert.match(nextGoal(120,false,'warehouse'),/240/);
});

// These cases protect cost weighting, the live progression boundary, and input
// validation rather than accepting any positive collection of unlocked tools.
test('loadout capacity uses six slots before 120 research and eight thereafter',async()=>{
 const gameplay=await import('./gameplay.js');
 assert.equal(typeof gameplay.capacityForResearch,'function');
 for(const [research,capacity] of [[0,6],[40,6],[90,6],[119,6],[120,8],[419,8],[420,10],[999999,10]])assert.equal(gameplay.capacityForResearch(research),capacity);
 assert.equal(gameplay.weaponCost('charge'),1);assert.equal(gameplay.weaponCost('pulse'),2);assert.equal(gameplay.weaponCost('shock'),2);
 assert.equal(gameplay.validateLoadout({charge:2,pulse:1,shock:1,echo:0,split:0,phase:0,heavy:0,nova:0},90),true,'2 grenades, a rocket and a remote package consume six slots');
 assert.equal(gameplay.validateLoadout({charge:4,pulse:1,shock:1,echo:0,split:0,phase:0,heavy:0,nova:0},119),false);
 assert.equal(gameplay.validateLoadout({charge:4,pulse:1,shock:1,echo:0,split:0,phase:0,heavy:0,nova:0},120),true);
});
test('loadout validation rejects empty, overbudget, locked and malformed item counts',async()=>{
 const {validateLoadout}=await import('./gameplay.js');assert.equal(typeof validateLoadout,'function');
 for(const [loadout,research] of [
  [{charge:0,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0},120], [{charge:7,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0},0],
  [{charge:1,pulse:1,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0},39], [{charge:1,pulse:0,shock:1,echo:0,split:0,phase:0,heavy:0,nova:0},89],
  [{charge:-1,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0},120], [{charge:1.5,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0},120],
  [{charge:Infinity,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0},120], [{charge:Number.MAX_SAFE_INTEGER+1,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0},120],
  [{charge:1,pulse:0},120], [{charge:1,pulse:0,shock:0,fake:1,echo:0,split:0,phase:0,heavy:0,nova:0},120], [null,120],
  [{charge:1,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0},NaN], [{charge:1,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0},-1]
 ] as const)assert.equal(validateLoadout(loadout as any,research),false,JSON.stringify({loadout,research}));
 assert.equal(validateLoadout({charge:1,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0},0),true,'using less than all capacity is valid');
 assert.equal(validateLoadout({charge:0,pulse:1,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0},40),true);
 assert.equal(validateLoadout({charge:0,pulse:0,shock:1,echo:0,split:0,phase:0,heavy:0,nova:0},90),true);
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
 assert.deepEqual(crossedUnlocks(40,999999),['遥控爆破包','双跨仓库','携带容量 6 → 8 格','回声震荡器','高架连廊','分裂球','叠层塔楼','携带容量 8 → 10 格','穿行球','悬臂观景台','街区冲击弹','九栋街区','城市核爆弹','六区城市']);
 assert.deepEqual(crossedUnlocks(619,620),['穿行球','悬臂观景台']);
});
test('crossed unlocks does not repeat earned rewards or report noncrossings',async()=>{
 const {crossedUnlocks}=await import('./gameplay.js');
 assert.equal(typeof crossedUnlocks,'function');
 for(const [start,end] of [[0,0],[0,39],[40,89],[90,119],[120,120],[420,619],[620,899],[1400,999999],[120,0]])assert.deepEqual(crossedUnlocks(start,end),[],`${start} to ${end}`);
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

// The type limit must apply even when a fourth kind still fits the weighted budget.
test('round loadouts reject a fourth positive tool type and zero releases its slot',()=>{
 const four={charge:1,pulse:1,shock:1,echo:1,split:0,phase:0,heavy:0,nova:0};
 assert.equal(gameplay.validateLoadout(four,240),false,'four kinds cost only eight slots but exceed the type limit');
 assert.equal(gameplay.validateLoadout({...four,shock:0},240),true);
 assert.equal(gameplay.validateLoadout({charge:4,pulse:0,shock:0,echo:1,split:1,phase:0,heavy:0,nova:0},420),true,'three types may contain more than three items');
});
test('selected tool helpers count positive kinds in catalog order, not ammunition quantity',()=>{
 assert.equal(typeof gameplay.selectedToolTypes,'function');
 assert.equal(typeof gameplay.selectedToolTypeCount,'function');
 const selected={split:1,phase:0,heavy:0,nova:0,echo:0,shock:4,pulse:0,charge:2};
 assert.deepEqual(gameplay.selectedToolTypes(selected),['charge','shock','split']);
 assert.equal(gameplay.selectedToolTypeCount(selected),3);
 assert.deepEqual(gameplay.selectedToolTypes({...selected,shock:0}),['charge','split']);
 assert.equal(gameplay.selectedToolTypeCount({...selected,shock:0}),2);
 assert.deepEqual(gameplay.selectedToolTypes({charge:0,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0}),[]);
});
test('tool-slot eligibility is independent of capacity and research and keeps selected types adjustable',()=>{
 assert.equal(typeof gameplay.canSelectToolType,'function');
 const full={charge:100,pulse:100,shock:100,echo:0,split:0,phase:0,heavy:0,nova:0};
 assert.equal(gameplay.canSelectToolType(full,'charge'),true);
 assert.equal(gameplay.canSelectToolType(full,'echo'),false);
 assert.equal(gameplay.canSelectToolType(full,'split'),false);
 assert.equal(gameplay.canSelectToolType({...full,pulse:0},'echo'),true);
 assert.equal(gameplay.canSelectToolType({...full,pulse:0},'bogus' as any),false);
});
test('free tool selection keeps the same three-type and unlock rules without a capacity cap',()=>{
 assert.equal(typeof gameplay.validateToolSelection,'function');
 const selection={charge:100,pulse:100,shock:100,echo:0,split:0,phase:0,heavy:0,nova:0};
 assert.equal(gameplay.validateToolSelection(selection,90),true);
 assert.equal(gameplay.validateToolSelection({...selection,echo:1},420),false);
 assert.equal(gameplay.validateToolSelection({...selection,shock:0,echo:1},239),false);
 assert.equal(gameplay.validateToolSelection({...selection,shock:0,echo:1},240),true);
 assert.equal(gameplay.validateToolSelection({charge:0,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0},420),false);
 for(const bad of [{...selection,charge:-1},{...selection,charge:1.5},{...selection,charge:Infinity},{charge:1},null])assert.equal(gameplay.validateToolSelection(bad as any,420),false);
 assert.equal(gameplay.validateToolSelection(selection,NaN),false);
 assert.equal(gameplay.validateToolSelection(selection,-1),false);
});
test('reselection depends on the originally carried types, even after one type has run out',()=>{
 assert.equal(typeof gameplay.requiresLoadoutReselection,'function');
 const loadout={charge:1,pulse:1,shock:1,echo:1,split:0,phase:0,heavy:0,nova:0};
 const round={budget:8,used:1,startResearch:240,startDestroyed:0,settled:false,loadout,remaining:{...loadout,charge:0}};
 assert.equal(gameplay.requiresLoadoutReselection(round),true);
 assert.equal(gameplay.requiresLoadoutReselection({...round,loadout:{...loadout,echo:0}}),false);
 assert.equal(gameplay.requiresLoadoutReselection({}),false);
});
