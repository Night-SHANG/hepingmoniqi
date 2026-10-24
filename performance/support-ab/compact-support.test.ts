import test from 'node:test';
import assert from 'node:assert/strict';
import { CompactSupport } from './compact-support.ts';
import { CompactTerrain, type TerrainConfig } from '../terrain/compact-terrain.ts';
import { createSupportGraph } from '../../src/structural/support.ts';
import { createStructuralFixture } from '../../src/structural/fixtures.ts';
import { sparseStructureFixture } from './sparse-structure-fixture.ts';
import type { Cell } from '../../src/structural/types.ts';
const cell=(id:number,x:number,y:number,z:number,options:Partial<Cell>={}):Cell=>({id,objectId:'object',role:'building',position:{x,y,z},material:'stone',color:1,hp:5,maxHp:5,...options});
function pair(cells:Cell[],config?:TerrainConfig){
  const terrain=config?new CompactTerrain(config):undefined;
  const ground=terrain?terrain.staticCellsInBounds(config!):[];
  const compact=new CompactSupport(cells,terrain?{terrain,bounds:config!}:undefined);
  const reference=createSupportGraph([...ground,...cells]);
  function compare(){assert.deepEqual(compact.unsupported(),reference.unsupported());}
  function cut(ids:number[]){compact.remove(ids);reference.remove(ids);compare();}
  compare();return {compact,reference,terrain,ground,compare,cut};
}
test('foundation cut detaches y=0 building, never promotes it to a synthetic root',()=>{
 const p=pair([cell(1,0,0,0,{role:'foundation'}),cell(2,0,1,0)],{map:'tiny',minX:-2,maxX:2,minZ:-2,maxZ:2});
 p.cut([p.terrain!.idAt(0,-1,0)!]);assert.deepEqual(p.compact.unsupported(),[{id:'unsupported-1',cells:[1,2]}]);
});
test('bridge retains either bank and only falls after both supports are removed',()=>{
 const p=pair([cell(10,-2,0,0,{anchor:true,role:'terrain'}),cell(20,-1,0,0),cell(30,0,0,0,{role:'bridge'}),cell(40,1,0,0,{role:'bridge'}),cell(50,2,0,0),cell(60,3,0,0,{anchor:true,role:'terrain'})]);
 p.cut([20]);assert.deepEqual(p.compact.unsupported(),[]);p.cut([50]);assert.deepEqual(p.compact.unsupported(),[{id:'unsupported-30',cells:[30,40]}]);
});
test('all outer-bottom roots are removable; no y=0 or interior-bottom support',()=>{
 const p=pair([cell(7,0,0,0)],{map:'roots',minX:-2,maxX:2,minZ:-2,maxZ:2});
 const roots=p.ground.filter(c=>c.anchor).map(c=>c.id);p.cut([...roots,...roots,9e8]);
 assert.equal(p.compact.unsupported().flatMap(p=>p.cells).length,201-roots.length);
 const before=p.compact.unsupported();p.cut(roots);assert.deepEqual(p.compact.unsupported(),before);
});
test('all eight layers of a ring cut release exact center soil and house, then independent components',()=>{
 const p=pair([cell(1,0,0,0),cell(2,0,1,0),cell(90,9,0,0),cell(91,9,1,0),cell(80,7,0,0)],{map:'ring',minX:-2,maxX:2,minZ:-2,maxZ:2,originalColumn:(x,z)=>x<0||z===0});
 const ring=p.ground.filter(c=>Math.abs(c.position.x)+Math.abs(c.position.z)===1).map(c=>c.id);p.cut(ring);
 const expected=[...p.ground.filter(c=>c.position.x===0&&c.position.z===0).map(c=>c.id),1,2].sort((a,b)=>a-b);
 assert.deepEqual(p.compact.unsupported().map(p=>p.cells),[expected,[80],[90,91]]);
 const out=p.compact.unsupported();out[0].cells.push(123);p.compare();p.cut(expected);
});
test('duplicate IDs, overlapping occupancy and invalid lattice are rejected identically',()=>{
 for(const cells of [[cell(1,0,0,0),cell(1,1,0,0)],[cell(1,0,0,0),cell(2,0,0,0)],[cell(1,.5,0,0)]]){
  assert.throws(()=>createSupportGraph(cells));assert.throws(()=>new CompactSupport(cells));
 }
 const terrain=new CompactTerrain({map:'dup',minX:0,maxX:0,minZ:0,maxZ:0});
 assert.throws(()=>new CompactSupport([cell(-1,1,0,0)],{terrain,bounds:{minX:0,maxX:0,minZ:0,maxZ:0}}),/duplicate/i);
 assert.throws(()=>new CompactSupport([cell(1,0,-1,0)],{terrain,bounds:{minX:0,maxX:0,minZ:0,maxZ:0}}),/overlap|occup/i);
 assert.deepEqual(new CompactSupport([]).unsupported(),[]);
});
test('snapshot isolation, deterministic ordering, cross-role/material faces and diagonal gaps',()=>{
 const cells=[cell(99,0,0,0,{anchor:true}),cell(-200,1,0,0,{role:'road',material:'road'}),cell(40,2,0,0,{role:'foundation'}),cell(1,3,0,0,{role:'building',material:'glass'}),cell(55,2,1,1,{role:'tree',material:'wood'})];
 const p=pair(cells);cells[0].anchor=false;cells[1].position.x=77;p.compare();p.cut([-200,-200,123456]);
 assert.deepEqual(p.compact.unsupported().map(p=>p.cells),[[1,40],[55]]);
});
test('random repeated cuts and explicit detached departure match exact MIT member sets',()=>{
 for(let seed=1;seed<=10;seed++){
  let state=seed;const rnd=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/2**32),cells:Cell[]=[];
  for(let x=-3;x<=3;x++)for(let y=0;y<=4;y++)for(let z=-2;z<=2;z++)if(rnd()>.25)cells.push(cell(1000+cells.length*7,x,y,z,{material:rnd()<.5?'wood':'stone',objectId:`obj-${x}`}));
  const p=pair(cells,{map:'random',minX:-3,maxX:3,minZ:-2,maxZ:2,originalColumn:(x,z)=>x<0||z===0}),all=[...p.ground,...cells];
  for(let step=0;step<25;step++){const ids=Array.from({length:1+Math.floor(rnd()*18)},()=>all[Math.floor(rnd()*all.length)].id);p.cut([...ids,ids[0]]);if(step%4===3)p.cut(p.compact.unsupported().flatMap(p=>p.cells));}
 }
});
test('sparse fixture extraction exactly retains source structures, IDs, colors and all 36 city buildings',()=>{
 for(const map of ['lab','neighborhood','city'] as const){
  const source=createStructuralFixture(map).cells.filter(c=>c.role!=='terrain');
  const sparse=sparseStructureFixture(map);
  assert.deepEqual(sparse.cells,source);
  assert.equal(sparse.allocations.groundCellObjects,0);
  assert.equal(new Set(sparse.cells.filter(c=>c.role==='building').map(c=>c.objectId)).size,map==='city'?36:map==='neighborhood'?9:2);
 }
});
test('terrain flood does not materialize pristine metadata or allocate cell neighbor objects',()=>{
 const terrain=new CompactTerrain({map:'alloc',minX:-10,maxX:10,minZ:-9,maxZ:9});
 terrain.cell=()=>{throw new Error('Pristine metadata was materialized');};
 const support=new CompactSupport([cell(1,0,0,0)],{terrain,bounds:{minX:-10,maxX:10,minZ:-9,maxZ:9}});
 assert.deepEqual(support.unsupported(),[]);support.removeAt(0,-1,0);assert.deepEqual(support.unsupported(),[{id:'unsupported-1',cells:[1]}]);
 const d=support.diagnostics();assert.equal(d.allocations.groundCellObjects,0);assert.equal(d.allocations.neighborObjects,0);assert.equal(d.allocations.traversalQueueArrays,1);
});
test('out-of-domain coordinates cannot alias another sparse position key',()=>{
 const cells=[cell(1,0,0,0),cell(2,1,1,1)],support=new CompactSupport(cells);
 // The packed z stride is four: these used to alias (0,0,0).
 assert.equal(support.removeAt(0,-1,4),false);
 assert.equal(support.removeAt(-1,4,0),false);
 assert.deepEqual(support.unsupported(),createSupportGraph(cells).unsupported());
});
test('sphere scan is clipped to finite topology even for huge finite coordinates or radius',()=>{
 const support=new CompactSupport([cell(1,0,0,0),cell(2,1,0,0)]);
 assert.equal(support.removeSphere({x:1e20,y:0,z:0},0),0);
 assert.equal(support.removeSphere({x:0,y:0,z:0},Number.MAX_VALUE),2);
 assert.deepEqual(support.unsupported(),[]);
});
test('packed sparse keys normalize large safe-integer coordinate offsets before arithmetic',()=>{
 for(const axis of ['y','z'] as const){
  const cells:Cell[]=[];
  for(let x=0;x<5;x++)for(let y=0;y<5;y++)for(let z=0;z<5;z++){
   const p={x,y,z};p[axis]+=2**53-16;cells.push(cell(cells.length+1,p.x,p.y,p.z));
  }
  assert.deepEqual(new CompactSupport(cells).unsupported(),createSupportGraph(cells).unsupported());
 }
});
test('ID removal rejects later descriptor mutation before it can remove a moved pose location',()=>{
 const bounds={map:'owned',minX:-1,maxX:1,minZ:-1,maxZ:1},terrain=new CompactTerrain(bounds),support=new CompactSupport([cell(1,0,0,0)],{terrain,bounds});
 const id=terrain.idAt(0,-1,0)!;terrain.promote(id,'moving',{x:1,y:-1,z:0},{x:0,y:0,z:0,w:1},'dynamic');
 assert.throws(()=>support.remove([id]),/pristine|mutat|descriptor/i);
 assert.equal(support.diagnostics().liveCells,73);
});
test('terrain coordinates outside bounded Int32 domain are rejected rather than inheriting descriptor numeric aliasing',()=>{
 const bounds={map:'large-offset',minX:0,maxX:4,minZ:2**53-16,maxZ:2**53-12},terrain=new CompactTerrain(bounds);
 assert.throws(()=>new CompactSupport([],{terrain,bounds}),/Int32|bounded|domain/i);
});
test('bounded sphere occupancy removal matches independent dense selection and exact MIT membership',()=>{
 const p=pair([cell(1,0,0,0,{role:'foundation'}),cell(2,0,1,0),cell(3,0,2,0)],{map:'sphere-parity',minX:-4,maxX:4,minZ:-3,maxZ:3});
 const all=[...p.ground,cell(1,0,0,0),cell(2,0,1,0),cell(3,0,2,0)],removed=new Set<number>();
 for(let i=0;i<12;i++){
  const at={x:i%3-1.25,y:i<6?-.25:-5.25,z:Math.floor(i/3)%2-.35},radius=1.37+(i%3)*.5;
  const ids=all.filter(c=>!removed.has(c.id)&&(c.position.x-at.x)**2+(c.position.y-at.y)**2+(c.position.z-at.z)**2<=radius*radius).map(c=>c.id);
  assert.equal(p.compact.removeSphere(at,radius),ids.length);ids.forEach(id=>removed.add(id));p.reference.remove(ids);p.compare();
 }
});
