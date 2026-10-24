import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import {createDenseFixture} from '../compact/fixture.js';
import {CompactSupportLattice, createCompactSupport} from '../compact/support/index.js';
import {IndexedStructure} from '../compact/support/indexed-structure.js';
import {encodePristine} from '../compact/support/node-codec.js';
import {createStructuralSimulation} from './simulation.js';
import type {Cell, StructuralSimulation, StructuralSnapshot} from './types.js';

const cell=(id:number,x:number,y=0,over:Partial<Cell>={}):Cell=>({
 id,objectId:'batch-fixture',role:'building',position:{x,y,z:0},material:'stone',color:1,hp:100,maxHp:100,...over,
});
async function compact(cells:Cell[]){
 const fixture=createDenseFixture({id:'batched-damage-support',cells}),source=new CompactSupportLattice(fixture);
 const encoded=encodePristine(source,new IndexedStructure(source),{mapId:fixture.id,seed:11,sourceChecksums:{fixture:'a'.repeat(64)}});
 const removals:number[][]=[],operations:string[]=[];
 const sim=await createStructuralSimulation(fixture,{compactSupportFactory:async store=>{
  const graph=await createCompactSupport(store,{artifactBytes:encoded.bytes,expectation:encoded.manifest});
  // Observe the real graph boundary without replacing any support behavior.
  return {
   remove(ids){removals.push([...ids]);operations.push(`remove:${ids.join(',')}`);graph.remove(ids);},
   unsupported(){operations.push('unsupported');return graph.unsupported();},
   reset(){operations.push('reset');graph.reset();},dispose(){graph.dispose();},
  };
 }});
 return {sim,removals,operations,clear(){removals.length=0;operations.length=0;}};
}
const blast=(sim:StructuralSimulation,id:string,x:number,y=0,radius=.2,damage=100)=>sim.blast({id,epoch:sim.epoch,position:{x,y,z:0},radius,damage,impulse:0});
const save=(sim:StructuralSimulation)=>sim.snapshot() as StructuralSnapshot;
const run=(sim:StructuralSimulation,ticks:number)=>{for(let n=0;n<ticks;n++)sim.step(1/120);};
const bridge=()=>[
 cell(10,0,0,{anchor:true,role:'terrain',hp:1000,maxHp:1000}),
 cell(30,1,0,{hp:10,maxHp:10}),cell(20,2,0,{hp:10,maxHp:10}),
 cell(50,3),cell(40,4),cell(60,10,0,{anchor:true}),
];

// Catches per-death graph splits, a flush after detach, or reordered damage IDs.
test('one blast removes static deaths together before exact ordered detach and reward',async()=>{
 const {sim,removals,operations,clear}=await compact(bridge());
 try{
  clear();assert.ok(blast(sim,'cut',1.5,0,.6));
  assert.deepEqual(sim.views().map(c=>[c.id,c.hp,c.state]),[
   [10,1000,'static'],[30,0,'gone'],[20,0,'gone'],[50,100,'dynamic'],[40,100,'dynamic'],[60,100,'static'],
  ]);
  assert.deepEqual(save(sim).bodies.map(b=>[b.id,b.cells,b.rootShotId]),[['piece-1',[40,50],'cut']]);
  assert.deepEqual(sim.events(),[
   {id:'1:shot:cut',kind:'detonation',position:{x:1.5,y:0,z:0},rootShotId:'cut',epoch:1,tick:0},
   {id:'1:detach:piece-1',kind:'detach',position:{x:3.5,y:0,z:0},sourceId:'piece-1',rootShotId:'cut',epoch:1,tick:0},
  ]);
  assert.equal(sim.research(),138);assert.equal(sim.pending(),1);
  assert.deepEqual(save(sim).processed,['1:blast:cut:30','1:blast:cut:20']);
  const ray=(x:number)=>sim.physicsHost.world.castRay(new RAPIER.Ray({x,y:3,z:0},{x:0,y:-1,z:0}),10,true);
  assert.equal(ray(1),null);assert.equal(ray(2),null);assert.ok(ray(0));
  assert.deepEqual(removals,[[30,20],[40,50]]);
  assert.deepEqual(operations,['remove:30,20','unsupported','remove:40,50']);
  const before=sim.snapshot();assert.equal(blast(sim,'cut',1.5,0,.6),false);assert.deepEqual(sim.snapshot(),before);
  clear();assert.ok(blast(sim,'other-command',10));assert.deepEqual(removals,[[60]]);assert.equal(sim.research(),200);
  sim.reset();assert.equal(sim.research(),0);assert.equal(sim.pending(),0);clear();
  assert.ok(blast(sim,'cut',1.5,0,.6));assert.deepEqual(removals,[[30,20],[40,50]]);assert.equal(sim.research(),138);
 }finally{sim.dispose();}
});

// Catches collecting post-death state, duplicate dynamic departures, and leaked
// pending batches after restoring or resetting the world.
test('destroying detached members preserves chunk deletion without repeat support writes',async()=>{
 const {sim,removals,clear}=await compact(bridge());
 try{
  assert.ok(blast(sim,'cut',1.5,0,.6));const detached=sim.snapshot();clear();
  assert.ok(blast(sim,'airborne-left',3));assert.deepEqual(save(sim).bodies.map(b=>b.cells),[[40]]);
  assert.ok(blast(sim,'airborne-right',4));assert.deepEqual(save(sim).bodies,[]);assert.equal(sim.pending(),0);
  assert.equal(sim.research(),138);assert.equal(sim.physicsHost.cell(50)!.state,'gone');assert.equal(sim.physicsHost.cell(40)!.state,'gone');
  assert.deepEqual(removals,[]);
  assert.ok(sim.restore(detached));assert.equal(sim.pending(),1);clear();
  run(sim,1200);assert.equal(sim.pending(),0);assert.equal(sim.physicsHost.cell(50)!.state,'gone');
  assert.equal(sim.physicsHost.cell(40)!.state,'gone');assert.equal(sim.research(),138);assert.deepEqual(removals,[]);
 }finally{sim.dispose();}
});

// Catches a per-impact flush or accumulating deaths across native steps.
test('one native impact command batch removes both static targets once and never replays',async()=>{
 const {sim,removals,clear}=await compact([
  cell(1,0,0,{anchor:true,hp:1,maxHp:1}),cell(2,3,0,{anchor:true,hp:1,maxHp:1}),
  cell(101,0,5),cell(102,3,5),
 ]);
 try{
  assert.deepEqual(removals,[[101],[102]]);assert.equal(sim.research(),199);clear();
  for(let n=0;n<300&&!sim.events().some(e=>e.kind==='impact');n++)sim.step(1/120);
  const impacts=sim.events().filter(e=>e.kind==='impact');
  assert.deepEqual(impacts.map(e=>[e.targetId,e.damage]).sort((a,b)=>a[0]!-b[0]!),[[1,1],[2,1]]);
  assert.equal(new Set(impacts.map(e=>e.tick)).size,1);
  assert.equal(sim.physicsHost.cell(1)!.state,'gone');assert.equal(sim.physicsHost.cell(2)!.state,'gone');assert.equal(sim.research(),200);
  assert.equal(removals.length,1);assert.deepEqual([...removals[0]].sort((a,b)=>a-b),[1,2]);
  const struck=sim.snapshot();assert.ok(sim.restore(struck));clear();run(sim,1200);
  assert.equal(sim.pending(),0);assert.equal(sim.events().filter(e=>e.kind==='impact').length,2);assert.deepEqual(removals,[]);
  sim.reset();clear();for(let n=0;n<300&&!sim.events().some(e=>e.kind==='impact');n++)sim.step(1/120);
  assert.equal(sim.events().filter(e=>e.kind==='impact').length,2);assert.equal(removals.length,1);
  assert.deepEqual([...removals[0]].sort((a,b)=>a-b),[1,2]);
 }finally{sim.dispose();}
});

test('destroying sleeping rubble does not depart the support graph a second time',async()=>{
 const {sim,removals,clear}=await compact([
  cell(10,0,0,{anchor:true,role:'terrain',hp:10000,maxHp:10000}),cell(20,0,1),cell(30,0,2),
 ]);
 try{
  assert.ok(blast(sim,'drop',0,1));run(sim,1200);const rubble=sim.physicsHost.cell(30)!;
  assert.equal(rubble.state,'rubble');assert.equal(sim.research(),200);clear();
  assert.ok(sim.blast({id:'rubble',epoch:sim.epoch,position:rubble.position,radius:.2,damage:1000,impulse:0}));
  assert.equal(sim.physicsHost.cell(30)!.state,'gone');assert.deepEqual(save(sim).bodies,[]);
  assert.equal(sim.research(),200);assert.equal(sim.pending(),0);assert.deepEqual(removals,[]);
 }finally{sim.dispose();}
});
