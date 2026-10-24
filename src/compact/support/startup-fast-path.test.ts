import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MAP_IDS} from '../../content-catalog.js';
import {createCompactGameFixture,createDenseFixture,type CompactFixture} from '../fixture.js';
import {CompactSupportLattice} from './lattice.js';
import {_topologyBytes,decodePristineBrowser,validatePristineBrowser} from './runtime.js';
import {writeTopology,type IdentifiedLattice} from './pristine-core.js';
import {IndexedStructure} from './indexed-structure.js';
import oracle from './city-cut-oracle.json';

/** Deliberately uncached scalar oracle: the pre-optimization accessor traversal,
 * with exact public-ID sorting and no production fast-path implementation. */
function reference(f:CompactFixture):IdentifiedLattice&{index:(id:number)=>number}{
 const ground=f.kind==='compact-fixture'?f.terrainCount:0,ids=Array.from({length:f.count-ground},(_,n)=>f.idAtOrdinal(n)!).sort((a,b)=>a-b),below=ids.filter(id=>id< -ground).length;
 const id=(i:number)=>i>=below&&i<below+ground?i-below-ground:ids[i<below?i:i-ground];
 const index=(value:number)=>{if(ground&&value>=-ground&&value<0)return value+ground+below;let lo=0,hi=ids.length-1;while(lo<=hi){const m=(lo+hi)>>>1;if(ids[m]===value)return m<below?m:m+ground;if(ids[m]<value)lo=m+1;else hi=m-1;}return -1;};
 return {count:f.count,id,index,position(i){const v=id(i);return {x:f.xOf(v),y:f.yOf(v),z:f.zOf(v)};},material:i=>f.materialOf(id(i))!,objectId:i=>f.objectIdOf(id(i))!,anchor:i=>f.anchorOf(id(i))===true,neighbours(i,fn){const v=id(i),x=f.xOf(v),y=f.yOf(v),z=f.zOf(v);for(const [axis,[dx,dy,dz]] of [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]].entries()){const n=f.idAt(x+dx,y+dy,z+dz);if(n!==null){const k=index(n);if(k<0)throw new Error('Original neighbor ID missing');fn(k,axis);}}}};
}
const digest=(source:IdentifiedLattice)=>{const hash=createHash('sha256');writeTopology(source,b=>hash.update(b));return hash.digest('hex');};
const neighbors=(source:IdentifiedLattice,i:number)=>{const result:number[]=[];source.neighbours(i,(n,a)=>result.push(n,a));return result;};

test('topology encoder traverses each original cell exactly once and preserves canonical bytes',()=>{
 const source:IdentifiedLattice={count:3,id:i=>i+1,position:i=>({x:i,y:0,z:0}),objectId:()=> '非 ASCII',material:()=> 'wood',anchor:i=>i===0,neighbours:()=>{}};
 const expected=digest(source),calls={position:0,id:0,objectId:0,material:0,anchor:0};
 const measured={...source};for(const key of Object.keys(calls) as Array<keyof typeof calls>)(measured as any)[key]=(i:number)=>{calls[key]++;return source[key](i);};
 assert.equal(createHash('sha256').update(_topologyBytes(measured)).digest('hex'),expected);
 assert.deepEqual(calls,{position:3,id:3,objectId:3,material:3,anchor:3});
});

test('proven implicit soil neighbors do not repeat fixture coordinate lookup',()=>{
 const fixture=createCompactGameFixture('city');let lookups=0;
 const wrapped=new Proxy(fixture,{get(target,key,receiver){if(key==='idAt')return (x:number,y:number,z:number)=>{lookups++;return target.idAt(x,y,z);};return Reflect.get(target,key,receiver);}});
 const source=new CompactSupportLattice(wrapped),id=fixture.idAt(0,-4,0)!;lookups=0;
 assert.deepEqual(neighbors(source,source.index(id)),neighbors(reference(fixture),source.index(id)));
 assert.equal(lookups,0,'Interior soil must use its proven per-column arithmetic');
});

test('single-pass topology handles empty, exact capacity, growth, invalid values, and bounded suffixes',()=>{
 const base:IdentifiedLattice={count:0,id:i=>i,position:i=>({x:i,y:0,z:0}),objectId:()=> 'x'.repeat(10000),material:()=> 'wood',anchor:()=>false,neighbours:()=>{}};
 for(const count of [0,1,17]){
  const source={...base,count},bytes=_topologyBytes(source);assert.equal(createHash('sha256').update(bytes).digest('hex'),digest(source));
  assert.deepEqual(_topologyBytes(source,{maxTopologyBytes:bytes.length}),bytes);
  assert.throws(()=>_topologyBytes(source,{maxTopologyBytes:bytes.length-1}),/capacity/i);
 }
 for(const count of [-1,NaN,1.5,2**31])assert.throws(()=>_topologyBytes({...base,count}),/count|capacity/i);
 for(const maxTopologyBytes of [-1,NaN,1.5,64*1024*1024+1])assert.throws(()=>_topologyBytes(base,{maxTopologyBytes}),/capacity/i);
 assert.throws(()=>_topologyBytes({...base,count:1,id:()=>1.5}),/topology/i);
});

for(const map of MAP_IDS)test(`${map}: fast lattice preserves the full canonical topology and sampled ordered neighbors`,()=>{
 const fixture=createCompactGameFixture(map),source=new CompactSupportLattice(fixture),slow=reference(fixture);
 assert.equal(digest(source),digest(slow));
 const manifest=JSON.parse(readFileSync(new URL(`./assets/${map}-seed-11.manifest.json`,import.meta.url),'utf8'));
 assert.equal(digest(source),manifest.topologySha256);
 for(let i=0;i<source.count;i+=Math.max(1,Math.floor(source.count/101)))assert.deepEqual(neighbors(source,i),neighbors(slow,i));
 for(const i of [-1,.5,source.count])assert.throws(()=>source.neighbours(i,()=>{}),/index/i);
});

test('dense arbitrary IDs and malformed compact soil claims retain exact fallback lookups',()=>{
 const cells=[{id:-91,x:-1},{id:7,x:0},{id:999,x:1}].map(({id,x})=>({id,position:{x,y:0,z:0},objectId:'dense',role:'building' as const,material:'stone' as const,color:0,hp:1,maxHp:1,anchor:x===0}));
 const dense=createDenseFixture({id:'arbitrary',cells}),ds=new CompactSupportLattice(dense),dr=reference(dense);
 for(let i=0;i<ds.count;i++)assert.deepEqual(neighbors(ds,i),neighbors(dr,i));
 assert.equal(digest(ds),digest(dr));assert.equal(ds.index(8),-1);
 const fixture=createCompactGameFixture('courtyard');
 const forged=new Proxy(fixture,{get(target,key,receiver){if(key==='idAt')return (x:number,y:number,z:number)=>target.idAt(x,y,z===0&&x===0&&y===-3?1:z);return Reflect.get(target,key,receiver);}});
 const source=new CompactSupportLattice(forged),slow=reference(forged);
 for(const [x,y,z] of [[0,-3,0],[0,-2,0],[0,-4,0],[-1,-3,0],[0,-3,-1]]){const id=fixture.idAt(x,y,z)!;assert.deepEqual(neighbors(source,source.index(id)),neighbors(slow,slow.index(id)));}
});

test('city fast path preserves all 454913 ordered neighbor lists and all twenty prior cut hashes',async()=>{
 const fixture=createCompactGameFixture('city'),source=new CompactSupportLattice(fixture),slow=reference(fixture);
 assert.equal(source.count,454913);for(let i=0;i<source.count;i++)assert.deepEqual(neighbors(source,i),neighbors(slow,i),`ordered neighbors ${i}`);
 const expectation=JSON.parse(readFileSync(new URL('./assets/city-seed-11.manifest.json',import.meta.url),'utf8'));
 assert.equal(expectation.topologySha256,oracle.topologySha256);
 const decoded=await decodePristineBrowser(readFileSync(new URL('./assets/city-seed-11.bin',import.meta.url)),expectation),graph=IndexedStructure.fromPristine(source,await validatePristineBrowser(source,decoded));
 const bounds=new Map<string,{minX:number;maxX:number;minZ:number;maxZ:number}>();
 for(let n=0;n<fixture.structureCount;n++){
  const id=fixture.idAtOrdinal(n)!,role=fixture.roleOf(id);if(role!=='building'&&role!=='foundation')continue;
  const name=fixture.objectIdOf(id)!,x=fixture.xOf(id),z=fixture.zOf(id),b=bounds.get(name);
  if(b){b.minX=Math.min(b.minX,x);b.maxX=Math.max(b.maxX,x);b.minZ=Math.min(b.minZ,z);b.maxZ=Math.max(b.maxZ,z);}else bounds.set(name,{minX:x,maxX:x,minZ:z,maxZ:z});
 }
 const locations=[...bounds.values()];assert.equal(locations.length,36);
 for(let i=0;i<20;i++){
  const b=locations[(i*7)%36],at={x:(b.minX+b.maxX)/2,y:i%4===3?-5:-1,z:(b.minZ+b.maxZ)/2},radius=5.5+(i%3)*1.2,before=graph.diagnostics().liveMembers;
  graph.leave(fixture.idsInSphere(at,radius).map(id=>source.index(id)));assert.equal(before-graph.diagnostics().liveMembers,oracle.steps[i].removedCells,`cut ${i+1} count`);
  const pieces=graph.unsupported().map(piece=>{const cells=piece.voxels.map(i=>source.id(i)).sort((a,b)=>a-b);return {id:`unsupported-${cells[0]}`,cells};}).sort((a,b)=>a.cells[0]-b.cells[0]);
  assert.equal(createHash('sha256').update(JSON.stringify(pieces)).digest('hex'),oracle.steps[i].exactOrderedMembershipSha256,`cut ${i+1} ordered membership`);
 }
});
