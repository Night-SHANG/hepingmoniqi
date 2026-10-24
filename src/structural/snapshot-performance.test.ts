import test from 'node:test';
import assert from 'node:assert/strict';
import {createStructuralSimulation} from './simulation.js';
import type {Cell,StructuralSimulation} from './types.js';
const cell=(id:number,x:number,y:number,over:Partial<Cell>={}):Cell=>({id,objectId:`cell-${id}`,role:'building',position:{x,y,z:0},material:'stone',color:0x888888,hp:100,maxHp:100,...over});
const fixture=()=>({id:'sparse-snapshot',cells:[cell(1,0,0,{role:'terrain',anchor:true}),cell(2,0,1),cell(3,0,2),cell(4,8,0,{anchor:true})]});
const blast=(s:StructuralSimulation,id:string,x:number,y:number,damage=100)=>s.blast({id,epoch:s.epoch,position:{x,y,z:0},radius:.2,damage,impulse:0});

test('sparse snapshots omit pristine cells while retaining full save metadata and ownership',async()=>{
 const s=await createStructuralSimulation(fixture());
 try{
  assert.equal(typeof s.snapshotSparse,'function','sparse snapshot API must exist');
  const empty:any=s.snapshotSparse();assert.equal(empty.schema,'structural-simulation-changes/v1');assert.deepEqual(empty.cells,[]);
  const pristine:any=s.snapshot();assert.equal(pristine.schema,'structural-simulation/v1');assert.equal(pristine.cells.length,4);
  blast(s,'partial',8,0,25);const sparse:any=s.snapshotSparse(),full:any=s.snapshot();
  assert.deepEqual(sparse.cells.map((c:any)=>c.id),[4]);assert.equal(sparse.cells[0].hp,75);
  const {schema:_,cells:__,...metadata}=sparse;const {schema:___,cells:____,...fullMetadata}=full;
  assert.deepEqual(metadata,fullMetadata);assert.deepEqual(sparse.cells[0],full.cells.find((c:any)=>c.id===4));
  sparse.cells[0].hp=0;sparse.cells[0].position.x=999;sparse.events[0].position.x=999;
  assert.equal((s.snapshotSparse() as any).cells[0].hp,75);assert.equal((s.snapshotSparse() as any).cells[0].position.x,8);assert.equal(s.events()[0].position.x,8);
  assert.equal(s.restore(s.snapshotSparse()),false,'sparse schema cannot bypass strict full restore validation');
 }finally{s.dispose();}
});

test('sparse tracking retains detached motion, fully gone cells and reset/restore reconstruction',async()=>{
 const s=await createStructuralSimulation(fixture());
 try{
  assert.equal(typeof s.snapshotSparse,'function');blast(s,'drop',0,1);s.step(.05);
  const sparse:any=s.snapshotSparse(),full:any=s.snapshot();
  assert.deepEqual(sparse.cells.map((c:any)=>c.id).sort(),[2,3]);assert.equal(sparse.cells.find((c:any)=>c.id===2).state,'gone');assert.ok(sparse.cells.find((c:any)=>c.id===3).position.y<2);
  assert.deepEqual(sparse.cells,full.cells.filter((c:any)=>c.id===2||c.id===3));
  s.reset();assert.deepEqual((s.snapshotSparse() as any).cells,[]);
  assert.equal(s.restore(full),true);const restored:any=s.snapshotSparse();assert.deepEqual(restored.cells,sparse.cells);assert.deepEqual(restored.bodies,sparse.bodies);
  const baseline:any=s.snapshot();const invalid=structuredClone(baseline);invalid.accumulator=.1;
  assert.equal(s.restore(invalid),false);assert.deepEqual(s.snapshot(),baseline);assert.deepEqual((s.snapshotSparse() as any).cells,restored.cells);
 }finally{s.dispose();}
});

test('initially gone and unsupported cells are represented without waiting for a first damage command',async()=>{
 const s=await createStructuralSimulation({id:'initial-sparse',cells:[cell(1,0,0,{hp:0,anchor:true}),cell(2,0,5)]});
 try{assert.equal(typeof s.snapshotSparse,'function');const sparse:any=s.snapshotSparse();assert.deepEqual(sparse.cells.map((c:any)=>[c.id,c.state]).sort(),[[1,'gone'],[2,'dynamic']]);}finally{s.dispose();}
});

test('sparse snapshots do not enumerate the full authority cell map to allocate then discard pristine saves',async()=>{
 const s=await createStructuralSimulation({id:'sparse-scan-budget',cells:Array.from({length:4096},(_,id)=>cell(id,id%64,Math.floor(id/64),{role:'terrain',anchor:true}))});
 try{
  assert.equal(typeof s.snapshotSparse,'function');s.snapshot();blast(s,'one-cell',0,0,25);
  const values=Map.prototype.values;let enumeratedCells=0;
  Map.prototype.values=function*(this:Map<unknown,unknown>){for(const value of values.call(this)){if(value&&typeof value==='object'&&'spec'in value&&'state'in value&&'hp'in value)enumeratedCells++;yield value;}} as typeof values;
  try{
   for(let i=0;i<20;i++){const sparse:any=s.snapshotSparse();assert.equal(sparse.cells.length,1);assert.equal(sparse.cells[0].id,0);}
   assert.equal(enumeratedCells,0,'sparse saves must walk only the persistent changed-ID index');
   assert.equal((s.snapshot() as any).cells.length,4096);assert.equal(enumeratedCells,4096,'owned full snapshot remains complete');
  }finally{Map.prototype.values=values;}
 }finally{s.dispose();}
});

test('private original-spec sharing never accepts fixture, view or snapshot mutation and reset remains original',async()=>{
 const source=fixture();const s=await createStructuralSimulation(source);
 try{
  const pristine=s.views();source.cells[1].hp=1;source.cells[1].position.y=500;source.cells[1].objectId='mutated-input';
  const view=s.views();view[1].hp=0;view[1].position.y=999;view[1].objectId='mutated-output';
  const full:any=s.snapshot();full.cells[1].hp=0;full.cells[1].position.y=999;
  assert.deepEqual(s.views(),pristine);blast(s,'damage',0,1,25);s.reset();assert.deepEqual(s.views(),pristine);
 }finally{s.dispose();}
});

test('initialization and reset retain one private source copy instead of cloning each original spec twice',async()=>{
 const source={id:'spec-copy-budget',cells:Array.from({length:16},(_,id)=>cell(id,id,0,{anchor:true}))};
 const clone=globalThis.structuredClone;let specClones=0;
 globalThis.structuredClone=((value:unknown,...args:any[])=>{if(value&&typeof value==='object'&&'id'in value&&'material'in value&&'maxHp'in value)specClones++;return clone(value,...args);}) as typeof clone;
 let s:Awaited<ReturnType<typeof createStructuralSimulation>>|undefined;
 try{s=await createStructuralSimulation(source);assert.equal(specClones,0);s.reset();assert.equal(specClones,0);}finally{globalThis.structuredClone=clone;s?.dispose();}
});
