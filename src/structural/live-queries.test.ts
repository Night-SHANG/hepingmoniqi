import test from 'node:test';
import assert from 'node:assert/strict';
import {createStructuralSimulation} from './simulation.js';
import type {Cell, StructuralSimulation} from './types.js';

const cell=(id:number,x:number,y:number,over:Partial<Cell>={}):Cell=>({id,objectId:`cell-${id}`,role:'building',position:{x,y,z:0},material:'stone',color:0x888888,hp:100,maxHp:100,...over});
const fixture=()=>({id:'live-query-fixture',cells:[cell(1,0,0,{role:'terrain',anchor:true}),cell(2,0,1),cell(3,0,2),cell(4,8,0,{anchor:true})]});
const blast=(s:StructuralSimulation,id:string,x=0,y=1,damage=100)=>s.blast({id,epoch:s.epoch,position:{x,y,z:0},radius:.2,damage,impulse:0});

test('live queries freeze public cells and reuse idle identities without weakening owned snapshots',async()=>{
 const f=fixture();(f.cells[1] as any).metadata={objective:true,tags:['original']};
 const s=await createStructuralSimulation(f);
 try{
  assert.equal(typeof s.liveViews,'function','read-only live view API must exist');
  const before=s.liveViews(),revision=s.viewRevision;
  assert.equal(before.length,4);assert.equal(before[1].hp,100);
  assert.equal(s.liveViews(),before);s.step(1/60);assert.equal(s.liveViews(),before);assert.equal(s.viewRevision,revision);
  assert.throws(()=>{(before as any).push(before[0]);},TypeError);
  assert.throws(()=>{(before[1] as any).hp=0;},TypeError);
  assert.throws(()=>{(before[1].position as any).y=999;},TypeError);
  assert.throws(()=>{(before[1].rotation as any).w=0;},TypeError);
  assert.throws(()=>{(before[1] as any).metadata.tags.push('mutated');},TypeError);
  const owned=s.views();owned[1].hp=7;owned[1].position.y=50;(owned[1] as any).metadata.tags.push('owned');
  assert.equal(s.views()[1].hp,100);assert.equal(s.liveViews()[1].position.y,1);
  assert.deepEqual((s.liveViews()[1] as any).metadata.tags,['original']);
  blast(s,'partial',0,1,25);const after=s.liveViews();
  assert.notEqual(after,before);assert.equal(after[0],before[0]);assert.notEqual(after[1],before[1]);assert.equal(after[1].hp,75);
  assert.equal(before[1].hp,100);assert.equal(before[1].position.y,1);
 }finally{s.dispose();}
});

test('view deltas include damage, detachment, movement and disappearance without unchanged static cells',async()=>{
 const s=await createStructuralSimulation(fixture());
 try{
  assert.equal(typeof s.viewChanges,'function','cursor delta API must exist');
  const first=s.viewChanges();assert.equal(first.reset,true);assert.equal(first.cells.length,4);
  assert.deepEqual(s.viewChanges(first.revision).cells,[]);
  blast(s,'drop');const broken=s.viewChanges(first.revision);
  assert.equal(broken.reset,false);assert.deepEqual(broken.cells.map(c=>[c.id,c.state]).sort(),[[2,'gone'],[3,'dynamic']]);
  assert.ok(broken.revision>first.revision);
  s.step(1/60);const fallen=s.viewChanges(broken.revision);
  assert.equal(fallen.reset,false);assert.deepEqual(fallen.cells.map(c=>c.id),[3]);assert.ok(fallen.cells[0].position.y<2);
  const slowReader=s.viewChanges(first.revision);assert.deepEqual(slowReader.cells.map(c=>c.id).sort(),[2,3]);
  assert.equal(slowReader.cells.find(c=>c.id===3),fallen.cells[0]);
  assert.throws(()=>{(fallen.cells as any).pop();},TypeError);
  assert.equal(broken.cells.find(c=>c.id===3)!.position.y,2,'older delta is immutable');
  blast(s,'destroy-moving',fallen.cells[0].position.x,fallen.cells[0].position.y);
  const gone=s.viewChanges(fallen.revision);assert.equal(gone.cells.find(c=>c.id===3)!.state,'gone');
 }finally{s.dispose();}
});

test('view cursors reset after world replacement, reject future cursors, and preserve rejected restores',async()=>{
 const s=await createStructuralSimulation(fixture());
 try{
  assert.equal(typeof s.viewChanges,'function');const first=s.viewChanges(),snapshot=s.snapshot();
  assert.equal(s.restore({}),false);assert.equal(s.viewRevision,first.revision);assert.equal(s.liveViews(),first.cells);
  blast(s,'partial',8,0,25);const damaged=s.viewChanges(first.revision);assert.equal(s.research(),17);
  assert.equal(s.restore(snapshot),true);const restored=s.viewChanges(damaged.revision);assert.equal(restored.reset,true);assert.equal(restored.cells.find(c=>c.id===4)!.hp,100);assert.equal(s.research(),0);
  s.reset();const reset=s.viewChanges(restored.revision);assert.equal(reset.reset,true);assert.ok(reset.revision>restored.revision);
  assert.equal(s.viewChanges(reset.revision+1).reset,true);assert.equal(s.viewChanges(NaN).reset,true);
 }finally{s.dispose();}
});

test('expired view cursors reset instead of silently omitting changes',async()=>{
 const s=await createStructuralSimulation(fixture());
 try{
  assert.equal(typeof s.viewChanges,'function');const initial=s.viewChanges();
  for(let i=0;i<80;i++){blast(s,`small-${i}`,8,0,.1);s.viewChanges();}
  const page=s.viewChanges(initial.revision);assert.equal(page.reset,true);assert.equal(page.cells.length,4);assert.ok(page.cells.find(c=>c.id===4)!.hp<93);
 }finally{s.dispose();}
});

test('event cursors return only new immutable events and explicitly reset across epochs',async()=>{
 const s=await createStructuralSimulation(fixture());
 try{
  assert.equal(typeof s.eventsSince,'function','event cursor API must exist');
  const empty=s.eventsSince();assert.equal(empty.reset,true);assert.deepEqual(empty.events,[]);
  blast(s,'partial',8,0,25);const first=s.eventsSince(empty.cursor);
  assert.equal(first.reset,false);assert.deepEqual(first.events.map(e=>e.rootShotId),['partial']);
  assert.throws(()=>{(first.events[0].position as any).x=999;},TypeError);assert.throws(()=>{(first.cursor as any).index=900;},TypeError);
  const unchanged=s.eventsSince(first.cursor);assert.deepEqual(unchanged.events,[]);assert.deepEqual(unchanged.cursor,first.cursor);
  const owned=s.events();owned[0].position.x=999;assert.equal(s.eventsSince().events[0].position.x,8);
  const saved=s.snapshot();s.reset();const reset=s.eventsSince(first.cursor);assert.equal(reset.reset,true);assert.deepEqual(reset.events,[]);
  assert.equal(s.restore(saved),true);const restored=s.eventsSince(reset.cursor);assert.equal(restored.reset,true);assert.equal(restored.events[0].rootShotId,'partial');
 }finally{s.dispose();}
});

test('event cursors report a bounded-log gap instead of dropping it silently',async()=>{
 const s=await createStructuralSimulation({id:'empty-events',cells:[]});
 try{
  assert.equal(typeof s.eventsSince,'function');const first=s.eventsSince();
  for(let i=0;i<8193;i++)blast(s,`empty-${i}`,0,0,0);
  const gap=s.eventsSince(first.cursor);assert.equal(gap.reset,true);assert.equal(gap.events.length,8192);assert.equal(gap.events[0].rootShotId,'empty-1');
  assert.deepEqual(s.eventsSince(gap.cursor).events,[]);
  assert.equal(s.eventsSince({epoch:s.epoch,index:gap.cursor.index+1}).reset,true);
 }finally{s.dispose();}
});

test('warm idle and sparse-delta queries perform no repeated per-cell deep clones',async t=>{
 const f={id:'query-clone-budget',cells:Array.from({length:4096},(_,id)=>cell(id,id%64,Math.floor(id/64),{anchor:true}))};
 const s=await createStructuralSimulation(f);
 try{
  s.step(1/120);const first=s.liveViews(),revision=s.viewRevision;s.research();
  const clone=globalThis.structuredClone;let clones=0;
  globalThis.structuredClone=((...args:Parameters<typeof clone>)=>{clones++;return clone(...args);}) as typeof clone;
  try{
   const started=performance.now();
   for(let i=0;i<120;i++){s.step(1/60);assert.equal(s.liveViews(),first);assert.equal(s.viewRevision,revision);assert.equal(s.viewChanges(revision).cells.length,0);assert.equal(s.research(),0);}
   t.diagnostic(`120 idle query frames for 4096 cells: ${(performance.now()-started).toFixed(2)} ms`);
   assert.equal(clones,0,'idle reads must not deep-clone static cells');
   blast(s,'sparse',0,0,25);clones=0;
   const sparse=s.viewChanges(revision);assert.equal(sparse.reset,false);assert.equal(sparse.cells.length,1);assert.equal(sparse.cells[0].hp,75);assert.equal(clones,0,'cached static metadata must be reused for a changed cell');
  }finally{globalThis.structuredClone=clone;}
 }finally{s.dispose();}
});

test('first views reuse simulation-owned specs without per-cell deep clones and retain caller/restore isolation',async()=>{
 const f=fixture();(f.cells[1] as any).metadata={tags:['owned-original']};
 const s=await createStructuralSimulation(f);
 try{
  // The simulation still owns its initial deep copy. Freezing private specs
  // must not freeze or retain aliases into the caller's mutable input.
  assert.equal(Object.isFrozen(f.cells[1]),false);f.cells[1].hp=7;f.cells[1].position.y=99;(f.cells[1] as any).metadata.tags.push('caller-change');
  const nativeClone=globalThis.structuredClone;let clones=0;
  globalThis.structuredClone=((...args:Parameters<typeof nativeClone>)=>{clones++;return nativeClone(...args);}) as typeof nativeClone;
  let first:ReturnType<StructuralSimulation['viewChanges']>;
  try{first=s.viewChanges();assert.equal(clones,0,'initial immutable views must not deep-clone every already-owned spec again');}finally{globalThis.structuredClone=nativeClone;}
  assert.equal(first!.cells.length,4);assert.equal(first!.cells[1].hp,100);assert.equal(first!.cells[1].position.y,1);assert.deepEqual((first!.cells[1] as any).metadata.tags,['owned-original']);
  assert.throws(()=>{(first!.cells[1] as any).metadata.tags.push('view-change');},TypeError);
  blast(s,'first-real-delta');const detached=s.viewChanges(first!.revision);assert.deepEqual(detached.cells.map(c=>[c.id,c.state]),[[2,'gone'],[3,'dynamic']]);
  s.step(1/60);const moved=s.viewChanges(detached.revision);assert.deepEqual(moved.cells.map(c=>c.id),[3]);assert.ok(moved.cells[0].position.y<2);assert.equal(first!.cells[2].position.y,2);
  const saved=s.snapshot(),pose=s.views();s.reset();const reset=s.viewChanges(moved.revision);assert.equal(reset.reset,true);assert.equal(reset.cells[1].hp,100);assert.equal(reset.cells[1].state,'static');
  assert.ok(s.restore(saved));const restored=s.viewChanges(reset.revision);assert.equal(restored.reset,true);assert.deepEqual(s.views(),pose);assert.equal(restored.cells[1].state,'gone');assert.equal(restored.cells[2].state,'dynamic');
 }finally{s.dispose();}
});
