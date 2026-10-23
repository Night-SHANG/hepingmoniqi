import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWorld} from './domain.js';
import {TOOLS,MAP_IDS,WEAPON_IDS} from './content-catalog.js';
import {capacityForResearch,crossedUnlocks,mapAvailable,toolAvailable,validateLoadout} from './gameplay.js';
import type {Loadout,MapId,Voxel,WorldSnapshot} from './contracts.js';
const empty:Loadout={charge:0,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0};
const legacySix={charge:2,pulse:1,shock:0,echo:0,split:0,phase:2};

test('scaled progression keeps global capacity and opens each map with its matching tool',()=>{
 for(const [map,weapon,gate,cost] of [['neighborhood','heavy',900,3],['city','nova',1400,5]] as const){
  assert.equal(mapAvailable(map,gate-1),false);assert.equal(mapAvailable(map,gate),true);
  assert.equal(mapAvailable(map,0,true),true);
  assert.equal(toolAvailable(weapon,gate-1,true),false);assert.equal(toolAvailable(weapon,gate,true),true);
  assert.equal(TOOLS[weapon]?.cost,cost);
 }
 assert.equal(capacityForResearch(1400),10);assert.equal(capacityForResearch(999999),10);
 assert.equal(validateLoadout({...empty,nova:2},1400),true);
 assert.equal(validateLoadout({...empty,nova:2,charge:1},1400),false);
 assert.equal(validateLoadout({...empty,charge:1,pulse:1,shock:1,heavy:1},1400),false);
 assert.deepEqual(crossedUnlocks(899,900),['街区冲击弹','九栋街区']);
 assert.deepEqual(crossedUnlocks(1399,1400),['城市核爆弹','六区城市']);
});

test('schema 7 six-key migrations preserve research, unlocks and exact spent ammunition',()=>{
 const source=createWorld();const base=source.getSnapshot();
 const old:any={...base,schemaVersion:7,research:4200,completedMaps:['courtyard','warehouse','bridge','tower','cantilever'],firstRewardClaimed:true,round:{budget:10,used:5,startResearch:4100,startDestroyed:0,settled:false,loadout:legacySix,remaining:{...legacySix,pulse:0,phase:1}}};
 const world=createWorld();assert.equal(world.restore(old),true);
 assert.equal(world.getSnapshot().schemaVersion,8);assert.equal(world.getSnapshot().research,4200);
 assert.deepEqual(world.getObjective().completedMaps,old.completedMaps);
 assert.deepEqual(world.getRound(),{...old.round,loadout:{...legacySix,heavy:0,nova:0},remaining:{...old.round.remaining,heavy:0,nova:0}});
 assert.equal(world.recordShot('heavy'),false);assert.equal(world.recordShot('nova'),false);
 for(const field of ['loadout','remaining'])for(const key of ['heavy','nova','injected']){
  const bad=structuredClone(old);bad.round[field][key]=0;assert.equal(createWorld().restore(bad),false);
 }
 const missing=structuredClone(old);delete missing.round.remaining.phase;assert.equal(world.restore(missing),false);
 const before=world.getSnapshot();assert.equal(world.restore({...old,mapId:'city'}),false);assert.deepEqual(world.getSnapshot(),before);
});

test('schema 8 exact inventories refuse omitted or injected keys without refilling',()=>{
 const world=createWorld();assert.equal(world.restore({...world.getSnapshot(),research:1400}),true);
 assert.equal(world.startRound('courtyard',{...empty,heavy:1,nova:1,charge:2}),true);
 assert.equal(world.recordShot('heavy'),true);assert.equal(world.recordShot('nova'),true);
 const saved=world.getSnapshot();assert.equal(saved.schemaVersion,8);assert.equal(saved.round!.used,8);
 const reloaded=createWorld();assert.equal(reloaded.restore(saved),true);assert.deepEqual(reloaded.getRound(),saved.round);
 for(const field of ['loadout','remaining'])for(const change of ['missing','extra']){
  const bad=structuredClone(saved) as any;if(change==='missing')delete bad.round[field].nova;else bad.round[field].injected=0;
  const before=reloaded.getSnapshot();assert.equal(reloaded.restore(bad),false);assert.deepEqual(reloaded.getSnapshot(),before);
 }
});

test('legacy unit snapshots reject injected geometry or research weight',()=>{
 const world=createWorld(),before=world.getSnapshot();
 for(const extension of [{size:{x:1,y:1,z:1}},{weight:1},{size:{x:100,y:1,z:1}},{weight:999}]){
  const bad=structuredClone(before);Object.assign(bad.voxels[0],extension);
  assert.equal(world.restore(bad),false);assert.deepEqual(world.getSnapshot(),before);
 }
});

test('scaled scenes have independently supported canonical buildings and weighted objectives',()=>{
 for(const [map,count] of [['neighborhood',9],['city',36]] as const){
  const world=createWorld();assert.equal(world.loadMap(map,true),true);
  const buildings=world.getVoxels().filter(v=>v.group==='house');
  const ids=new Set(buildings.map(v=>v.objectId));assert.equal(ids.size,count);
  assert.ok(buildings.every(v=>v.size&&v.size.x>0&&v.size.y>0&&v.size.z>0&&v.weight!>0));
  assert.equal(world.getObjective().total,buildings.reduce((sum,v)=>sum+(v.weight??1),0));
  assert.equal(world.getObjective().destroyed,0);assert.equal(world.getObjective().fraction,0);
  for(const objectId of ids)assert.ok(buildings.some(v=>v.objectId===objectId&&v.anchored));
  assert.equal(createWorld().restore(world.getSnapshot()),true);
 }
});

test('scaled save geometry, weight and support ownership are immutable canonical data',()=>{
 const world=createWorld();assert.equal(world.loadMap('neighborhood',true),true);const before=world.getSnapshot();
 const candidate=before.voxels.find(v=>v.group==='house'&&v.size)!;assert.ok(candidate);
 const view=world.getVoxels().find(v=>v.id===candidate.id)!;
 assert.ok(Object.isFrozen(view.size));const detachedCopy=world.getSnapshot();detachedCopy.voxels.find(v=>v.id===candidate.id)!.size!.x+=1;
 assert.deepEqual(world.getSnapshot(),before);
 for(const mutate of [(v:Voxel)=>v.size!.x+=.1,(v:Voxel)=>delete v.size,(v:Voxel)=>v.weight!+=1,(v:Voxel)=>delete v.weight,(v:Voxel)=>v.objectId='forged',(v:Voxel)=>v.hp=v.maxHp+.01]){
  const bad=structuredClone(before);mutate(bad.voxels.find(v=>v.id===candidate.id)!);assert.equal(world.restore(bad),false);assert.deepEqual(world.getSnapshot(),before);
 }
});

test('scaled damage reaches actual AABB faces rather than only proxy centers and grants partial research',()=>{
 const world=createWorld();assert.equal(world.loadMap('neighborhood',true),true);
 const voxel=world.getVoxels().find(v=>v.group==='house'&&v.size&&Math.max(v.size.x,v.size.y,v.size.z)>=2)!;assert.ok(voxel);
 const axis=(['x','y','z'] as const).reduce((best,next)=>voxel.size![next]>voxel.size![best]?next:best,'x' as 'x'|'y'|'z');
 const target={...voxel.position,[axis]:voxel.position[axis]+voxel.size![axis]/2-.05};
 assert.ok(Math.hypot(target.x-voxel.position.x,target.y-voxel.position.y,target.z-voxel.position.z)>2.6*Math.sqrt(.001));
 const result=world.damage({id:'face-contact',epoch:world.epoch,weapon:'charge',power:.001,target});
 assert.equal(result.accepted,true);assert.equal(result.newlyDestroyed,0);assert.ok(result.researchEarned>0);
 assert.ok(world.getVoxels().find(v=>v.id===voxel.id)!.hp<voxel.hp);
 assert.equal(world.getObjective().fraction,0);
 const before=world.getSnapshot();assert.equal(world.damage({id:'face-contact',epoch:world.epoch,weapon:'charge',power:.001,target}).accepted,false);assert.deepEqual(world.getSnapshot(),before);
 const reloaded=createWorld();assert.equal(reloaded.restore(before),true);assert.deepEqual(reloaded.getVoxels(),before.voxels);
});

test('scaled support cannot borrow foundations from another building and preserves unaffected buildings',()=>{
 const world=createWorld();assert.equal(world.loadMap('neighborhood',true),true);const base=world.getSnapshot();
 const buildingId=base.voxels.find(v=>v.group==='house')!.objectId;
 const unsupported={...base,voxels:base.voxels.filter(v=>!(v.objectId===buildingId&&v.anchored))};unsupported.destroyedCount=base.totalCount-unsupported.voxels.length;
 assert.equal(world.restore(unsupported),false);assert.deepEqual(world.getSnapshot(),base);
 const foundation=base.voxels.find(v=>v.objectId===buildingId&&v.anchored)!;
 const result=world.damage({id:'isolated-cut',epoch:world.epoch,weapon:'charge',power:1,target:foundation.position,reward:false});
 const affected=new Set(result.removed.map(v=>v.objectId));
 assert.ok(result.detached.every(v=>affected.has(v.objectId)));
 for(const id of new Set(base.voxels.map(v=>v.objectId)))if(!affected.has(id))assert.deepEqual(world.getVoxels().filter(v=>v.objectId===id),base.voxels.filter(v=>v.objectId===id));
 assert.equal(world.getSnapshot().research,0);
});

// These fingerprints were recorded from the frozen v07 release, not calculated
// with v08 builders. Exact canonical geometry/hp is the save-compatibility API.
test('all five old maps retain exact v07 serialized cells and damage/support outcomes',()=>{
 const cases=[
  ['courtyard','e6ce2011c2a2ea682539399721cb7bce6b202febfbd2b1af52b2bfeed7ec709d','f01cbf4862e4d0f123be51f55d6ff8ba834b50cef16d6e37ec4942e24111b96c',[54,0,12,40,0,7]],
  ['warehouse','b3592d78fc1e5c7427fd0d35e7f58030188c792697f497306a9141da59540578','106ca3008d6ef411ce430779e6ec233276fdb0c413ca68789e9f13b055b51e12',[46,0,13,43,0,10]],
  ['bridge','2c11e7fd17f67b44f233d7a276f18755c1dad6d9119a4553aab94ebc01af8f1b','4ea39b0df586334e6b0cab3fb1c9cf3bcf6c76361060c9eb8553beb84209e2dd',[0,0,0,18,38,61]],
  ['tower','7ff5bc6b0ea7391a8e1f42c93a19c7a1bbf9214efb66b41314a9c337abe9ad3b','ebda1772f863f57751791ddf7ef628cfc4fb2fe575d264e6166aaa3edd63174c',[4,0,6,9,0,9]],
  ['cantilever','4601260a57f0beb9e39d8fd1afac7f123d751f7ffa75bb5cb16ad8e87c48f344','0b48489d95e2f1f2b49c31e919b59e8aded2ecd464900032c8be20697fdb2a31',[0,0,0,3,205,178]],
 ] as const;
 for(const [map,initial,damaged,expected] of cases){
  const world=createWorld();assert.equal(world.loadMap(map,true),true);
  const fingerprint=()=>createHash('sha256').update(JSON.stringify(world.getVoxels())).digest('hex');
  assert.equal(fingerprint(),initial,map);const outcomes:number[]=[];
  for(const [i,target] of [{x:0,y:3,z:5},{x:-6,y:5,z:0}].entries()){
   const result=world.damage({id:`golden-${i}`,epoch:world.epoch,target,weapon:'pulse',power:1});
   outcomes.push(result.removed.length,result.detached.length,result.researchEarned);
  }
  assert.equal(fingerprint(),damaged,map);assert.deepEqual(outcomes,expected,map);
 }
});

test('weighted scaled destruction settles at the existing 200 RP cap and free rounds earn nothing',()=>{
 for(const map of ['neighborhood','city'] as const)for(const reward of [true,false]){
  const world=createWorld();assert.equal(world.loadMap(map,true),true);const initial=world.getObjective();let earned=0;
  for(let i=0;!world.getObjective().complete&&i<60;i++){
   const target=world.getVoxels().find(v=>v.group==='house')!.position;const prior=world.getObjective().destroyed;
   const result=world.damage({id:`clear-${i}`,epoch:world.epoch,weapon:'nova',power:3,target,reward});earned+=result.researchEarned;
   assert.equal(world.getObjective().destroyed-prior,[...result.removed,...result.detached].filter(v=>v.group==='house').reduce((sum,v)=>sum+(v.weight??1),0));
  }
  assert.equal(world.getObjective().complete,true);assert.equal(world.getObjective().destroyed,initial.total);
  assert.equal(world.getObjective().fraction,1);assert.equal(earned,reward?200:0);assert.equal(world.getSnapshot().research,earned);
  const snapshot=world.getSnapshot();const reloaded=createWorld();assert.equal(reloaded.restore(snapshot),true);assert.equal(reloaded.getSnapshot().research,earned);
  world.reset();assert.equal(world.getSnapshot().research,earned);assert.equal(world.getObjective().destroyed,0);
  assert.equal(world.damage({id:'stale',epoch:snapshot.epoch,weapon:'nova',power:1,target:{x:0,y:0,z:0}}).accepted,false);
 }
});

test('new heavy tools damage multiple actual building objects, not only visual scenery',()=>{
 for(const [map,weapon] of [['neighborhood','heavy'],['city','nova']] as const){
  const world=createWorld();assert.equal(world.loadMap(map,true),true);
  const groups=new Map<string,Voxel[]>();for(const voxel of world.getVoxels())if(voxel.group==='house'){const id=voxel.objectId!;const group=groups.get(id)??[];group.push(voxel);groups.set(id,group);}
  const centers=[...groups].map(([id,cells])=>({id,x:(Math.min(...cells.map(v=>v.position.x-v.size!.x/2))+Math.max(...cells.map(v=>v.position.x+v.size!.x/2)))/2,z:(Math.min(...cells.map(v=>v.position.z-v.size!.z/2))+Math.max(...cells.map(v=>v.position.z+v.size!.z/2)))/2}));
  let pair=[centers[0],centers[1]],nearest=Infinity;
  for(let a=0;a<centers.length;a++)for(let b=a+1;b<centers.length;b++){const distance=Math.hypot(centers[a].x-centers[b].x,centers[a].z-centers[b].z);if(distance<nearest){nearest=distance;pair=[centers[a],centers[b]];}}
  const result=world.damage({id:'multi-building',epoch:world.epoch,weapon,power:1,target:{x:(pair[0].x+pair[1].x)/2,y:1,z:(pair[0].z+pair[1].z)/2}});
  assert.equal(result.accepted,true);assert.ok(result.removed.length>0);
  assert.ok(new Set([...result.removed,...result.detached].filter(v=>v.group==='house').map(v=>v.objectId)).size>=2);
  assert.ok(result.researchEarned>0);assert.ok(world.getObjective().fraction>0);assert.ok(world.getObjective().fraction<1);
  const saved=world.getSnapshot();assert.equal(createWorld().restore(saved),true);
 }
});

test('city nova crosses a real district boundary while leaving distant districts intact',async()=>{
 const {getScaledBuildingPlacements}=await import('./scaled-map-generators.js');
 const world=createWorld();assert.equal(world.loadMap('city',true),true);const before=world.getSnapshot();
 const placements=getScaledBuildingPlacements('city'),blocks=new Map(placements.map(p=>[p.objectId,p.blockId]));
 const result=world.damage({id:'cross-district',epoch:world.epoch,weapon:'nova',power:1,target:{x:0,y:2,z:0}});
 const affected=new Set([...result.removed,...result.detached].map(v=>blocks.get(v.objectId!)));
 assert.ok(affected.size>=2);assert.ok(affected.size<6);
 for(const block of new Set(placements.map(p=>p.blockId)))if(!affected.has(block))assert.deepEqual(world.getVoxels().filter(v=>blocks.get(v.objectId!)===block),before.voxels.filter(v=>blocks.get(v.objectId!)===block));
});
