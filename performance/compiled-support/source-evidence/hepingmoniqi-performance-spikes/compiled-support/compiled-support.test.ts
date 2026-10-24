import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as api from './codec.ts';
import * as validation from './pristine-validation.ts';
import { IndexedStructure, type IndexedLattice } from '../incremental-support/indexed-structure.ts';
import * as wrapper from '../incremental-support/incremental-support.ts';
import { CompactStructures } from '../structure-store/compact-structures.ts';
import { CompactTerrain } from '../terrain/compact-terrain.ts';
import type { Cell } from '../../hepingmoniqi-v09/src/structural/types.ts';
const codec=api as any, v=validation as any;
const recipe={mapId:'bounded',seed:11,sourceChecksums:{'test-fixture':'a'.repeat(64),'indexed-algorithm':'b'.repeat(64)}};
const cell=(id:number,x:number,y:number,z:number,anchor=false,objectId='object',material:Cell['material']='wood'):Cell=>({id,position:{x,y,z},objectId,material,role:'building',color:1,hp:5,maxHp:5,...(anchor?{anchor:true}:{})});
function fixture(){
 const cells:Cell[]=[];for(let x=-9;x<=9;x++)for(let y=0;y<3;y++)for(let z=-2;z<=2;z++)cells.push(cell(1000+cells.length*2,x,y,z,x===-9&&y===0,x<0?'left':'right',(x+y+z)%3?'wood':'stone'));
 const store=new CompactStructures(cells),cfg={map:'bounded',minX:-10,maxX:10,minZ:-3,maxZ:3},terrain=new CompactTerrain(cfg);
 assert.equal(typeof (wrapper as any).CompactLattice,'function','the lattice must be exported without algorithm duplication');
 const source=new (wrapper as any).CompactLattice(store,{terrain,bounds:cfg,objectId:'ground'});
 // Prove the codec needs accessors, not ground or structure Cell/CellView enumeration.
 terrain.cell=()=>{throw new Error('ground Cells forbidden');};store.cell=()=>{throw new Error('structure CellViews forbidden');};
 return {source,store,terrain,cells};
}
function pair(){
 assert.equal(typeof codec.encodePristine,'function','missing codec');assert.equal(typeof codec.decodePristine,'function','missing decoder');
 const f=fixture(),oracle=new IndexedStructure(f.source,recipe.seed),encoded=codec.encodePristine(f.source,oracle,recipe),decoded=codec.decodePristine(encoded.bytes,encoded.manifest);
 const token=v.validatePristine(f.source,decoded),hydrated=(IndexedStructure as any).fromPristine(f.source,token);
 return {...f,oracle,encoded,decoded,hydrated};
}
const snapshot=(s:IndexedStructure)=>({chunk:[...s.chunk],chunks:s.chunks.map(ch=>({objectId:ch.objectId,voxels:ch.voxels,ground:ch.ground,edges:[...ch.edges]}))});
test('binary round trip preserves exact seeded member order, roots, reciprocal edge order and later splits',()=>{
 const p=pair();assert.deepEqual(snapshot(p.hydrated),snapshot(p.oracle));
 assert.deepEqual(codec.encodePristine(p.source,p.oracle,recipe),p.encoded,'generation is byte-for-byte reproducible');
 for(let x=-9;x<=9;x+=2){const cut=[];for(let i=0;i<p.source.count;i++)if(p.source.position(i).x===x)cut.push(i);p.oracle.leave(cut);p.hydrated.leave([...cut,...cut]);assert.deepEqual(snapshot(p.hydrated),snapshot(p.oracle));assert.deepEqual(p.hydrated.unsupported(),p.oracle.unsupported());}
});
test('rejects corruption, truncation, trailing bytes, wrong map, format, recipe, seed and payload digest',()=>{
 const {encoded}=pair();const b=encoded.bytes;
 for(const bytes of [b.slice(0,0),b.slice(0,12),b.slice(0,-1),new Uint8Array([...b,0])])assert.throws(()=>codec.decodePristine(bytes,encoded.manifest));
 for(const at of [0,4,8,12,b.length-1]){const changed=b.slice();changed[at]^=255;assert.throws(()=>codec.decodePristine(changed,encoded.manifest));}
 for(const change of [{mapId:'wrong'},{formatVersion:99},{seed:12},{recipeSha256:'f'.repeat(64)},{payloadSha256:'0'.repeat(64)},{topologySha256:'e'.repeat(64)}])assert.throws(()=>codec.decodePristine(b,{...encoded.manifest,...change}));
});
test('semantic validator rejects missing/duplicate members, bad offsets/index/object/root and geometrically invalid edges',()=>{
 const p=pair(),raw=p.decoded.tables;
 const cases:Array<(t:any)=>void>=[t=>t.members[0]=t.members[1],t=>t.members[0]=p.source.count,t=>t.chunk[0]=t.chunk.length,t=>t.memberOffsets[1]=0,t=>t.memberOffsets[t.memberOffsets.length-1]--,t=>t.roots[0]++,t=>t.objectIndex[0]=t.objectIds.length,t=>t.objectIds[0]='wrong',t=>t.edgeDest[0]=t.roots.length,t=>t.edgeFaces[0]=0,t=>t.edgeFaces[0]++,t=>t.edgeOffsets[1]=t.edgeOffsets[t.edgeOffsets.length-1]+1];
 const before=snapshot(p.hydrated);
 const candidate=(tables:any)=>{const packed=v.packPristineTables(tables);return {tables,manifest:{...p.decoded.manifest,payloadSha256:v.sha256(packed.bytes),payloadBytes:packed.bytes.length,objectBytes:packed.objectBytes}};};
 for(const change of cases){const t=structuredClone(raw);change(t);assert.throws(()=>v.validatePristine(p.source,candidate(t)));assert.deepEqual(snapshot(p.hydrated),before,'invalid candidate cannot mutate active graph');}
 // Keep reciprocity yet corrupt the true face count, proving geometry is checked.
 const t=structuredClone(raw),from=0,to=t.edgeDest[t.edgeOffsets[0]],a=t.edgeOffsets[0];let reciprocal=-1;
 for(let e=t.edgeOffsets[to];e<t.edgeOffsets[to+1];e++)if(t.edgeDest[e]===from)reciprocal=e;
 assert.ok(reciprocal>=0);t.edgeFaces[a]++;t.edgeFaces[reciprocal]++;assert.throws(()=>v.validatePristine(p.source,candidate(t)));
});
test('opaque tokens reject forged/reused/wrong-source hydration and do not alias mutable decoded tables',()=>{
 const p=pair();assert.throws(()=>(IndexedStructure as any).fromPristine(p.source,{}));
 const token=v.validatePristine(p.source,p.decoded),other=fixture().source;
 assert.throws(()=>(IndexedStructure as any).fromPristine(other,token));
 p.decoded.tables.members.fill(0);p.decoded.tables.chunk.fill(-1);p.decoded.tables.objectIds[0]='tampered';
 const hydrated=(IndexedStructure as any).fromPristine(p.source,token);assert.deepEqual(snapshot(hydrated),snapshot(p.oracle));
 assert.throws(()=>(IndexedStructure as any).fromPristine(p.source,token));
});
test('topology digest binds stable logical IDs, positions, materials, objects and anchor flags',()=>{
 const p=pair();
 for(const key of ['id','position','material','objectId','anchor']){
  const altered:any={count:p.source.count};for(const method of ['id','position','material','objectId','anchor','neighbours'])altered[method]=p.source[method].bind(p.source);altered[key]=(i:number)=>i===0?(key==='id'?42:key==='position'?{x:999,y:0,z:0}:key==='anchor'?!p.source.anchor(i):'wrong'):p.source[key](i);
  assert.throws(()=>v.validatePristine(altered,p.decoded),/topology/i);
 }
});
test('empty pristine graph round trips and modified graphs cannot be compiled as pristine',()=>{
 assert.equal(typeof codec.encodePristine,'function');
 const source:IndexedLattice & {id:(i:number)=>number}={count:0,id:i=>i,position:()=>({x:0,y:0,z:0}),material:()=>'',objectId:()=>'',anchor:()=>false,neighbours:()=>{}};
 const oracle=new IndexedStructure(source),encoded=codec.encodePristine(source,oracle,recipe),token=v.validatePristine(source,codec.decodePristine(encoded.bytes,encoded.manifest));
 assert.deepEqual((IndexedStructure as any).fromPristine(source,token).unsupported(),[]);
 const p=pair();p.oracle.leave([0]);assert.throws(()=>codec.encodePristine(p.source,p.oracle,recipe));
});
test('a valid-but-reordered decoded member table cannot bypass the pinned seeded payload digest',()=>{
 const p=pair(),tables=p.decoded.tables;let c=0;while(tables.memberOffsets[c+1]-tables.memberOffsets[c]<2)c++;
 const a=tables.memberOffsets[c],b=a+1;[tables.members[a],tables.members[b]]=[tables.members[b],tables.members[a]];
 assert.throws(()=>v.validatePristine(p.source,p.decoded),/payload|digest/i);
});
test('Buffer subviews decode by their exact byte range and never alias caller-owned bytes',()=>{
 const p=pair(),container=Buffer.alloc(p.encoded.bytes.length+32);container.set(p.encoded.bytes,16);
 const decoded=codec.decodePristine(container.subarray(16,-16),p.encoded.manifest);container.fill(0);
 const hydrated=(IndexedStructure as any).fromPristine(p.source,v.validatePristine(p.source,decoded));assert.deepEqual(snapshot(hydrated),snapshot(p.oracle));
});
