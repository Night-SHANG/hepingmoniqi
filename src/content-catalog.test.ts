import test from 'node:test';
import assert from 'node:assert/strict';
import * as gameplay from './gameplay.js';
test('v06 gates keep original unlocks and add two three-slot tools with real ten-slot tier',()=>{
 assert.equal(gameplay.toolAvailable('echo' as any,239,false),false);
 assert.equal(gameplay.toolAvailable('echo' as any,240,false),true);
 assert.equal(gameplay.toolAvailable('split' as any,419,true),false);
 assert.equal(gameplay.toolAvailable('split' as any,420,true),true);
 assert.equal(gameplay.weaponCost('echo' as any),3);
 assert.equal(gameplay.weaponCost('split' as any),3);
 assert.equal(gameplay.capacityForResearch(419),8);
 assert.equal(gameplay.capacityForResearch(420),10);
 assert.equal(gameplay.capacityForResearch(999999),10);
});
test('v06 inventories require all six exact keys and weighted unlocked counts',()=>{
 const inventory={charge:1,pulse:0,shock:0,echo:1,split:2,phase:0};
 assert.equal(gameplay.validateLoadout(inventory,420),true);
 assert.equal(gameplay.validateLoadout({...inventory,charge:2},420),false);
 assert.equal(gameplay.validateLoadout(inventory,419),false);
 assert.equal(gameplay.validateLoadout({charge:1,pulse:0,shock:0} as any,420),false);
 assert.equal(gameplay.validateLoadout({...inventory,extra:0} as any,420),false);
});
test('all new rewards are shown once when a gate is crossed',()=>{
 assert.deepEqual(gameplay.crossedUnlocks(120,420),['回声震荡器','高架连廊','分裂球','叠层塔楼','携带容量 8 → 10 格']);
 assert.deepEqual(gameplay.crossedUnlocks(420,999999),['穿行球','悬臂观景台']);
});
test('catalog map availability and titles are data driven; unknown IDs never unlock',async()=>{
 const {MAP_IDS,MAPS,mapAvailable,mapTitle,toolAvailable,RESERVED_CAPACITY_TIERS}=await import('./content-catalog.js');
 assert.deepEqual(MAP_IDS,['courtyard','warehouse','bridge','tower','cantilever']);
 for(const id of MAP_IDS){assert.equal(mapTitle(id),MAPS[id].title);assert.equal(mapAvailable(id,MAPS[id].research),true);if(MAPS[id].research)assert.equal(mapAvailable(id,MAPS[id].research-1),false);}
 assert.equal(mapAvailable('fake' as any,1000,true),false);assert.equal(toolAvailable('fake' as any,1000,true),false);
 assert.deepEqual(RESERVED_CAPACITY_TIERS,[12]);
});
test('echo is placed and remote while split supports quick or placement delivery',()=>{
 assert.deepEqual(gameplay.deliveryPolicy('echo','quick','automatic'),{delivery:'place',trigger:'remote',canLaunch:false,canChooseTrigger:false});
 assert.deepEqual(gameplay.deliveryPolicy('split','quick','automatic'),{delivery:'quick',trigger:'automatic',canLaunch:true,canChooseTrigger:true});
});
