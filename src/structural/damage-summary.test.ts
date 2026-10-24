import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../domain.js';
import type {DamageCommand,DamageResult,Loadout,WorldSnapshot} from '../contracts.js';
import {createStructuralGameWorld,type StructuralGameWorld} from './game-world.js';

const stock:Loadout={charge:2,pulse:0,shock:2,echo:0,split:0,phase:0,heavy:0,nova:0};
async function ready(){
 const world=createStructuralGameWorld(),legacy=createWorld().getSnapshot();legacy.research=1400;
 assert.ok(await world.restore(legacy));assert.ok(await world.startRound('courtyard',stock));return world;
}
const cut=(world:StructuralGameWorld,reward=true):DamageCommand=>({id:'foundation-cut',epoch:world.epoch,target:{x:0,y:-1,z:0},weapon:'shock',power:3,reward});
const summary=(result:DamageResult)=>({...result,removed:[],detached:[]});
function comparable(snapshot:WorldSnapshot){
 const saved=structuredClone(snapshot),simulation=(saved.structural as any).simulation,epoch=saved.epoch;
 const unepoch=(id:string)=>id.startsWith(`${epoch}:`)?`0:${id.slice(String(epoch).length+1)}`:id;
 saved.epoch=0;simulation.epoch=0;simulation.processed=simulation.processed.map(unepoch);
 simulation.events=simulation.events.map((event:any)=>({...event,epoch:0,id:unepoch(event.id)}));return saved;
}
function settle(world:StructuralGameWorld){for(let n=0;n<2400&&world.pending();n++)world.step(1/120);assert.equal(world.pending(),0);}

// Catches merely clearing result arrays after constructing the same expensive
// Voxel payload. Observe allocations without replacing physics or query work.
test('summary damage skips legacy Voxel projection, cloning and moving-payload enumeration',async()=>{
 const world=await ready();
 try{
  assert.ok(world.damage(cut(world)).detached.length>0);world.step(.05);
  const moving=world.getRenderBinding()!.movingViews().find(cell=>cell.state==='dynamic'&&cell.role==='building');assert.ok(moving);
  const nativeFreeze=Object.freeze,nativeClone=globalThis.structuredClone;
  let voxelProjections=0,voxelClones=0,movingArrays=0;
  const isVoxel=(value:any)=>value&&typeof value==='object'&&'structuralState'in value&&'anchored'in value;
  Object.freeze=((value:any)=>{
   if(isVoxel(value))voxelProjections++;
   if(Array.isArray(value)&&value.length&&value.every(cell=>cell&&typeof cell==='object'&&'rotation'in cell&&(cell.state==='dynamic'||cell.state==='rubble')))movingArrays++;
   return nativeFreeze(value);
  }) as typeof Object.freeze;
  globalThis.structuredClone=((value:any,...args:any[])=>{if(isVoxel(value))voxelClones++;return nativeClone(value,...args);}) as typeof structuredClone;
  let result:DamageResult;
  try{result=world.damage({id:'hit-airborne',epoch:world.epoch,target:{...moving.position},weapon:'charge',power:3},{details:false});}
  finally{Object.freeze=nativeFreeze;globalThis.structuredClone=nativeClone;}
  assert.equal(result!.accepted,true);assert.equal(world.getVoxel(moving.id),null);
  assert.equal(voxelProjections,0,'summary damage must not materialize prior or next legacy Voxel objects');
  assert.equal(voxelClones,0,'summary damage must not deep-clone result Voxels');
  assert.equal(movingArrays,0,'summary damage must not gather moving views solely for pre-hit payload poses');
  assert.deepEqual(result!.removed,[]);assert.deepEqual(result!.detached,[]);
 }finally{world.suspend();}
});

// Catches changes to damage, support, rewards, inventory, events, native poses,
// secondary impacts, serialization, or shot deduplication in summary mode.
test('default and summary damage produce identical real physics, rewards, events and saved state',async()=>{
 const world=await ready();
 try{
  const initial=world.getSnapshot();
  async function run(details:boolean){
   assert.ok(await world.restore(initial));assert.ok(world.recordShot('shock'));
   const first=world.damage(cut(world),{details});
   assert.ok(first.accepted&&first.newlyDestroyed>0&&first.researchEarned>0);
   if(details){assert.ok(first.removed.length>0);assert.ok(first.detached.length>0);}
   else{assert.deepEqual(first.removed,[]);assert.deepEqual(first.detached,[]);}
   const firstSave=comparable(world.getSnapshot());world.step(.05);
   const moving=world.getRenderBinding()!.movingViews().find(cell=>cell.state==='dynamic'&&cell.role==='building');assert.ok(moving);
   const current=world.getVoxel(moving.id)!;assert.deepEqual(current.position,moving.position);assert.ok(Object.isFrozen(current)&&Object.isFrozen(current.position));
   assert.ok(world.recordShot('charge'));
   const command:DamageCommand={id:'second-hit',epoch:world.epoch,target:{...moving.position},weapon:'charge',power:3};
   const second=world.damage(command,{details}),secondSave=comparable(world.getSnapshot());assert.ok(second.accepted);
   assert.equal(world.getVoxel(moving.id),null);const beforeRepeat=world.getSnapshot();
   assert.equal(world.damage(command,{details}).accepted,false);assert.deepEqual(world.getSnapshot(),beforeRepeat);
   settle(world);const final=comparable(world.getSnapshot());
   assert.ok(world.events().some(event=>event.kind==='impact'),'real falling members must exercise secondary impacts');
   const voxels=world.getVoxels(),round=world.getRound(),objective=world.getObjective(),research=world.getResearch();
   const saved=world.getSnapshot();world.suspend();assert.deepEqual(world.getVoxels(),voxels);
   assert.ok(await world.restore(saved));assert.deepEqual(world.getVoxels(),voxels);assert.equal(world.getResearch(),research);
   assert.equal(world.damage({...command,epoch:world.epoch},{details}).accepted,false,'restored shot IDs remain deduplicated');
   const settled=world.finishRound();assert.equal(world.damage({...cut(world),id:'after-settlement'},{details}).accepted,false);
   return {first:summary(first),firstSave,second:summary(second),secondSave,final,round,objective,research,settled};
  }
  const full=await run(true),minimal=await run(false);assert.deepEqual(minimal,full);
 }finally{world.suspend();}
});

// Catches stale pre-hit poses after a summary operation, mutable payload aliasing,
// and accidentally changing the default call to summary-only behavior.
test('default damage after summary damage returns owned Voxels at the true moving pre-hit pose',async()=>{
 const world=await ready();
 try{
  assert.ok(world.damage(cut(world),{details:false}).accepted);world.step(.05);
  const moving=world.getRenderBinding()!.movingViews().find(cell=>cell.state==='dynamic'&&cell.role==='building');assert.ok(moving);
  const before=world.getVoxel(moving.id)!;
  assert.notDeepEqual(before.position,world.getRenderBinding()!.fixture.originalPosition(moving.id),'the chosen member must actually have moved');
  const result=world.damage({id:'owned-pre-hit',epoch:world.epoch,target:{...before.position},weapon:'charge',power:3});
  const removed=result.removed.find(voxel=>voxel.id===before.id);assert.ok(removed);assert.deepEqual(removed,before);
  const saved=world.getSnapshot();removed.position.y=999;removed.hp=999;
  assert.deepEqual(world.getSnapshot(),saved);assert.notEqual(before.position.y,999);assert.equal(world.getVoxel(before.id),null);
 }finally{world.suspend();}
});

test('summary unrewarded damage and its fallout stay unrewarded and reject stale commands',async()=>{
 const world=await ready();
 try{
  const research=world.getResearch(),inventory=world.getRound(),initial=world.getSnapshot();
  assert.equal(world.damage({...cut(world),epoch:world.epoch-1},{details:false}).accepted,false);assert.deepEqual(world.getSnapshot(),initial);
  const hit=world.damage(cut(world,false),{details:false});assert.ok(hit.accepted&&hit.newlyDestroyed>0);assert.equal(hit.researchEarned,0);
  settle(world);assert.equal(world.getResearch(),research);assert.deepEqual(world.getRound(),inventory);
  const saved=world.getSnapshot();assert.ok(await world.restore(saved));assert.equal(world.getResearch(),research);
 }finally{world.suspend();}
});
