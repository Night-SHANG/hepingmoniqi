import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompactStructures } from '../structure-store/compact-structures.ts';
import { CompactTerrain } from '../terrain/compact-terrain.ts';
import { CompactSupport } from '../support-ab/compact-support.ts';
import { CompactIncrementalSupport } from './incremental-support.ts';
import { SparseStructure, random } from '../../vendor/three-voxel-destruction/structure.ts';
import { createSupportGraph } from '../../src/structural/support.ts';
import type { Cell } from '../../src/structural/types.ts';
const cell=(id:number,x:number,y:number,z:number,anchor=false,objectId='object',material:Cell['material']='wood'):Cell=>({id,position:{x,y,z},objectId,material,role:'building',color:1,hp:5,maxHp:5,...(anchor?{anchor:true}:{})});
const canonical=(s:SparseStructure,cells:Cell[])=>s.chunks.map(ch=>({objectId:ch.objectId,voxels:ch.voxels.map(i=>cells[i].id),ground:ch.ground,edges:[...ch.edges]}));
function pair(cells:Cell[],config?:{map:string,minX:number,maxX:number,minZ:number,maxZ:number,originalColumn?:(x:number,z:number)=>boolean},seed=11){
 const terrain=config?new CompactTerrain(config):undefined,all=[...(terrain?terrain.staticCellsInBounds(config!):[]),...cells].sort((a,b)=>a.id-b.id);
 const store=new CompactStructures(cells),subject=new CompactIncrementalSupport(store,terrain?{terrain,bounds:config!,objectId:`game:${config!.map}:geology`}:undefined,seed);
 const raw=new SparseStructure(all.map(c=>({...c.position,material:c.material,objectId:c.objectId,anchor:c.anchor===true})),seed),reference=createSupportGraph(all),oracle=new CompactSupport(cells,terrain?{terrain:new CompactTerrain(config!),bounds:config!}:undefined);
 const indices=new Map(all.map((c,i)=>[c.id,i]));
 const check=()=>{assert.deepEqual(subject.partition(),canonical(raw,all));assert.deepEqual(subject.unsupported(),reference.unsupported());assert.deepEqual(subject.unsupported(),oracle.unsupported());};
 const remove=(ids:number[])=>{subject.remove(ids);reference.remove(ids);oracle.remove(ids);raw.leave(ids.map(id=>indices.get(id)).filter((n):n is number=>n!==undefined));check();};
 return {subject,reference,raw,all,terrain,store,check,remove};
}
test('unanchored cells are reported as exact stable logical IDs, never synthetic roots',()=>{
 const p=pair([cell(17,0,0,0),cell(18,0,1,0)]);assert.deepEqual(p.subject.unsupported(),[{id:'unsupported-17',cells:[17,18]}]);p.check();
});
test('seeded chunk order, membership, reciprocal faces, and explicit removable anchors match',()=>{
 const cells:Cell[]=[];for(let x=-10;x<=10;x++)for(let y=0;y<4;y++)for(let z=-2;z<=2;z++)cells.push(cell(1000+cells.length,x,y,z,y===0&&x===-10,x<0?'left':'right',(x+y+z)%3?'wood':'stone'));
 const p=pair(cells.reverse());p.check();for(const x of [-9,-1,0,7]){const ids=p.all.filter(c=>c.position.x===x).map(c=>c.id);p.remove([...ids,...ids]);p.remove(ids);}p.remove(p.all.filter(c=>c.anchor).map(c=>c.id));
});
test('foundation and bridge cuts preserve exact seeded chunks and ordered components',()=>{
 const cfg={map:'bounded',minX:-9,maxX:9,minZ:-3,maxZ:3,originalColumn:(x:number,z:number)=>Math.abs(x)<5&&Math.abs(z)<2};
 const cells:Cell[]=[];for(const x of [-5,5])for(let y=0;y<3;y++)cells.push(cell(100+cells.length,x,y,0,false,'pier','stone'));for(let x=-5;x<=5;x++)cells.push(cell(100+cells.length,x,3,0,false,'bridge'));
 const p=pair(cells,cfg);p.check();p.remove(p.all.filter(c=>c.position.x===-5&&c.position.y===-1&&c.position.z===0).map(c=>c.id));assert.equal(p.subject.unsupported().length,0);p.remove(p.all.filter(c=>c.position.x===5&&c.position.y===-1&&c.position.z===0).map(c=>c.id));assert.deepEqual(p.subject.unsupported()[0].cells,cells.map(c=>c.id));
 const roots=p.all.filter(c=>c.anchor).map(c=>c.id);p.remove([...roots,...roots,999999]);p.remove(roots);assert.ok(p.subject.unsupported().some(s=>s.cells.some(id=>id<0)));
});
test('randomized removal batches preserve exact seed partitions and edge counters',()=>{
 for(let seed=1;seed<=16;seed++){
  const rnd=random(seed),cells:Cell[]=[];for(let x=-5;x<=5;x++)for(let y=0;y<=6;y++)for(let z=-3;z<=3;z++)if(rnd()<.7)cells.push(cell(10000+cells.length*2,x,y,z,y===0&&rnd()<.2,seed%2?'mono':`o-${Math.floor(rnd()*3)}`,seed%3?'wood':rnd()<.5?'stone':'wood'));
  const p=pair(cells,undefined,seed);p.check();for(let step=0;step<30;step++){const ids=Array.from({length:1+Math.floor(rnd()*12)},()=>cells[Math.floor(rnd()*cells.length)].id);p.remove([...ids,...ids.slice(0,3),-1234567]);}
 }
});
test('historical negative terrain IDs interleave with sparse negative/positive IDs safely',()=>{
 const cells=[cell(-1000,0,0,0),cell(0,0,1,0),cell(150,0,2,0)];const p=pair(cells,{map:'ids',minX:-1,maxX:1,minZ:-1,maxZ:1,originalColumn:(x,z)=>x===0});p.check();p.remove([-1000]);p.remove([0]);
});
test('original occupancy remains usable when caller stores mutate after graph construction',()=>{
 const cells=[cell(1,0,0,0,true),cell(2,1,0,0),cell(3,2,0,0)];const p=pair(cells);p.store.damage(2,5);p.remove([2,2]);p.remove([1]);
});
test('rejects preedited stores instead of silently resurrecting gone or dynamic occupancy',()=>{
 const changed=new CompactStructures([cell(1,0,0,0,true)]);changed.damage(1,5);
 assert.throws(()=>new CompactIncrementalSupport(changed),/pristine/);
 const moving=new CompactStructures([cell(1,0,0,0,true)]);moving.promote(1,'body',{x:4,y:1,z:0},{x:0,y:0,z:0,w:1},'dynamic');
 assert.throws(()=>new CompactIncrementalSupport(moving),/pristine/);
 const cfg={map:'changed',minX:-1,maxX:1,minZ:-1,maxZ:1},terrain=new CompactTerrain(cfg);terrain.damage(-1,99);
 assert.throws(()=>new CompactIncrementalSupport(new CompactStructures([]),{terrain,bounds:cfg,objectId:'ground'}),/pristine/);
});
test('terrain edits after initialization do not hide original neighbors during batch departure',()=>{
 const cfg={map:'after',minX:-2,maxX:2,minZ:-2,maxZ:2},p=pair([cell(1,0,0,0),cell(2,0,1,0)],cfg);
 const id=p.terrain!.idAt(0,-1,0)!;p.terrain!.damage(id,99);p.remove([id,id]);p.remove(p.all.filter(c=>c.anchor).map(c=>c.id));
});
test('input descriptor replacement and returned member mutation cannot alter graph metadata',()=>{
 const cfg={map:'owned',minX:-1,maxX:1,minZ:-1,maxZ:1},terrain=new CompactTerrain(cfg),input={terrain,bounds:{...cfg},objectId:'game:owned:geology'};
 const graph=new CompactIncrementalSupport(new CompactStructures([cell(1,0,0,0)]),input),ref=createSupportGraph([...terrain.staticCellsInBounds(cfg),cell(1,0,0,0)]);
 input.terrain=new CompactTerrain({...cfg,minX:10,maxX:12});input.bounds.minX=10;
 const cuts=[terrain.idAt(0,-1,0)!];graph.remove(cuts);ref.remove(cuts);assert.deepEqual(graph.unsupported(),ref.unsupported());
 const output=graph.unsupported();output[0].cells[0]=99;assert.deepEqual(graph.unsupported(),ref.unsupported());
});
test('empty graph, overlap, duplicate ID, descriptor mismatch, and finite sphere bounds are explicit',()=>{
 assert.deepEqual(new CompactIncrementalSupport(new CompactStructures([])).unsupported(),[]);
 const cfg={map:'invalid',minX:-1,maxX:1,minZ:-1,maxZ:1},terrain=new CompactTerrain(cfg),input={terrain,bounds:cfg,objectId:'ground'};
 assert.throws(()=>new CompactIncrementalSupport(new CompactStructures([cell(-1,0,0,0)]),input),/Duplicate/);
 assert.throws(()=>new CompactIncrementalSupport(new CompactStructures([cell(1,0,-1,0)]),input),/Overlapping/);
 assert.throws(()=>new CompactIncrementalSupport(new CompactStructures([]),{...input,bounds:{...cfg,maxX:2}}),/mismatch/);
 const graph=new CompactIncrementalSupport(new CompactStructures([cell(1,0,0,0,true)]));assert.equal(graph.removeSphere({x:1e100,y:0,z:0},2),0);assert.throws(()=>graph.removeSphere({x:0,y:0,z:0},Infinity),/Invalid/);
});
test('fractional sphere cuts match exact ordered dense MIT results and preserve chunk topology',()=>{
 const cfg={map:'sphere',minX:-8,maxX:8,minZ:-5,maxZ:5},p=pair([cell(1,0,0,0),cell(2,0,1,0)],cfg);
 for(let step=0;step<12;step++){
  const at={x:(step%4-1.5)*2.3,y:-1-step%7,z:(Math.floor(step/4)-1)*2.2},radius=2.1+(step%3)*.8;
  const ids=p.all.filter(c=>Math.hypot(c.position.x-at.x,c.position.y-at.y,c.position.z-at.z)<=radius).map(c=>c.id);
  p.subject.removeSphere(at,radius);p.remove(ids);
 }
});
