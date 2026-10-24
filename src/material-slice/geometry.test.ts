import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type {SurfaceBounds} from '../compact/surface-source';
import {buildChunk,type ChunkMesh} from '../worker-slice/chunk-mesh';
import {buildMaterialGreedyChunk,type MaterialGreedyChunkMesh,type MaterialSurfaceSource} from './geometry';

type Cell={x:number;y:number;z:number;material?:string;color?:number;hp?:number;maxHp?:number};
function fixture(cells:Cell[],bounds?:SurfaceBounds){
 const ids=cells.map((_,i)=>i%2?-(2**40)-i:2**40+i),byPosition=new Map(cells.map((c,i)=>[`${c.x},${c.y},${c.z}`,ids[i]])),byId=new Map(ids.map((id,i)=>[id,cells[i]]));
 const source:MaterialSurfaceSource={bounds:bounds??{minX:Math.min(...cells.map(c=>c.x)),maxX:Math.max(...cells.map(c=>c.x)),minY:Math.min(...cells.map(c=>c.y)),maxY:Math.max(...cells.map(c=>c.y)),minZ:Math.min(...cells.map(c=>c.z)),maxZ:Math.max(...cells.map(c=>c.z))},
 staticIdAt:(x,y,z)=>byPosition.get(`${x},${y},${z}`)??null,materialOf:id=>byId.get(id)!.material,colorOf:id=>byId.get(id)!.color??0x995533,hpOf:id=>byId.get(id)!.hp??10,maxHpOf:id=>byId.get(id)!.maxHp??10,
 forEachChunk(size,visit){const keys=new Set(cells.map(c=>`${Math.floor(c.x/size)},${Math.floor(c.y/size)},${Math.floor(c.z/size)}`));for(const key of keys)visit(...key.split(',').map(Number) as [number,number,number]);}};
 return {source,remove:(x:number,y:number,z:number)=>byPosition.delete(`${x},${y},${z}`),byId};
}

/** Independent unit-face expansion catches missing area, phantom surfaces,
 * overlaps, non-planar quads, material-crossing rectangles and bad winding. */
function expanded(mesh:ChunkMesh,source?:MaterialSurfaceSource):Set<string>{
 const result=new Set<string>(),stride=mesh.index?4:6;
 for(let f=0;f<mesh.faces;f++){
  const start=f*stride*3,normal=Array.from(mesh.normal.slice(start,start+3)),axis=normal.findIndex(n=>n!==0),tangents=[0,1,2].filter(a=>a!==axis),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  assert.equal(normal.filter(n=>n!==0).length,1);assert.equal(Math.abs(normal[axis]),1);
  for(let v=0;v<stride;v++)for(let a=0;a<3;a++){
   lo[a]=Math.min(lo[a],mesh.position[start+v*3+a]);hi[a]=Math.max(hi[a],mesh.position[start+v*3+a]);assert.equal(mesh.normal[start+v*3+a],normal[a]);
  }
  assert.equal(lo[axis],hi[axis]);for(const a of tangents){assert.ok(hi[a]>lo[a]);assert.equal(hi[a]-lo[a],Math.round(hi[a]-lo[a]));}
  const materials=new Set<string|undefined>();
  for(let u=lo[tangents[0]]+.5;u<hi[tangents[0]];u++)for(let v=lo[tangents[1]]+.5;v<hi[tangents[1]];v++){
   const center=[0,0,0];center[axis]=lo[axis];center[tangents[0]]=u;center[tangents[1]]=v;
   const key=[...center,...normal].join(',');assert.ok(!result.has(key),`overlapping face ${key}`);result.add(key);
   if(source){const owner=center.map((n,a)=>n-normal[a]*.5),id=source.staticIdAt(...owner as [number,number,number]);assert.notEqual(id,null,`missing owner ${owner}`);materials.add(source.materialOf(id!));}
  }
  if(source)assert.equal(materials.size,1,'a rectangle may not cross an actual material boundary');
  if(mesh.index)for(let t=0;t<2;t++){
   const triangle:number[]=Array.from(mesh.index.slice(f*6+t*3,f*6+t*3+3));assert.ok(triangle.every(i=>i>=f*4&&i<f*4+4));
   const points:THREE.Vector3[]=triangle.map(i=>new THREE.Vector3().fromArray(mesh.position,i*3));
   const cross:THREE.Vector3=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
   assert.ok(cross.dot(new THREE.Vector3(...normal as [number,number,number]))>0,'triangle winding must face outward');assert.equal(cross.length(),(hi[tangents[0]]-lo[tangents[0]])*(hi[tangents[1]]-lo[tangents[1]]));
  }
 }
 return result;
}
function assertParity(source:MaterialSurfaceSource,size=32){
 source.forEachChunk(size,(x,y,z)=>{
  const key=`${x},${y},${z}`,oracle=buildChunk(source,key,size),greedy=buildMaterialGreedyChunk(source,key,size);
  assert.deepEqual(expanded(greedy,source),expanded(oracle),key);assert.equal(greedy.unitFaces,oracle.faces);assert.deepEqual(greedy.bounds,oracle.bounds);
  assert.equal(greedy.stats.outputBytes,greedy.position.byteLength+greedy.normal.byteLength+greedy.color.byteLength+greedy.index.byteLength);assert.equal(greedy.position.length,greedy.faces*12);assert.equal(greedy.index.length,greedy.faces*6);
 });
}
function meshOf(data:ChunkMesh){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(data.position,3));geometry.setAttribute('normal',new THREE.BufferAttribute(data.normal,3));if(data.index)geometry.setIndex(new THREE.BufferAttribute(data.index,1));const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.FrontSide}));mesh.updateMatrixWorld();return mesh;}

// Removing greedy merging, or making color/HP part of the token, must fail.
test('same-material mixed-color mixed-HP slab merges into six quads and retains every exposed unit face',()=>{
 const cells:Cell[]=[];for(let x=0;x<32;x++)for(let z=0;z<32;z++)cells.push({x,y:0,z,material:'brick',color:0x990000+x*31+z,hp:(x+z)%10+.25});
 const {source}=fixture(cells),mesh=buildMaterialGreedyChunk(source,'0,0,0');
 assert.equal(mesh.faces,6);assert.equal(mesh.unitFaces,2176);assert.equal(mesh.position.length/3,24);assert.equal(mesh.index.length,36);assert.ok(mesh.index instanceof Uint32Array);assert.equal(mesh.stats.outputBytes,792);assertParity(source);
 assert.ok(mesh.color.every(c=>c===1),'geometry color is only a neutral shader multiplier, not reconstructed cell color');
});

// Treating material as color, or coercing missing material to text, must fail.
test('actual material identity prevents merging even when colors and HP match',()=>{
 for(const materials of [['brick','steel'],[undefined,'undefined'],['','undefined'],[undefined,'']] as const){
  const {source}=fixture(materials.map((material,x)=>({x,y:0,z:0,material})));assert.equal(buildMaterialGreedyChunk(source,'0,0,0').faces,10);assertParity(source);
 }
 const {source}=fixture([{x:0,y:0,z:0},{x:1,y:0,z:0}]);assert.equal(buildMaterialGreedyChunk(source,'0,0,0').faces,6);assertParity(source);
});

// A hidden appearance dependency would turn this geometry-only operation into a failure.
test('geometry reads material identity but never color or HP',()=>{
 const {source}=fixture([{x:0,y:0,z:0,material:'brick'},{x:1,y:0,z:0,material:'brick'}]);
 const forbidden=()=>{throw new Error('appearance belongs to the cell-data payload');};
 assert.equal(buildMaterialGreedyChunk({...source,colorOf:forbidden,hpOf:forbidden,maxHpOf:forbidden},'0,0,0').faces,6);
});

// Filling a chunk AABB, ignoring a halo or truncating signed IDs must fail.
test('all normals, negative seams, sparse holes and large signed IDs preserve exact occupancy and material areas',()=>{
 const cells:Cell[]=[];for(let x=-3;x<=3;x++)for(let y=-2;y<=2;y++)for(let z=-3;z<=3;z++)if((x*x+y*y+z*z)%5!==0)cells.push({x,y,z,material:(x+y)%3===0?'steel':'brick',color:(x+z)%2?0x8b9650:0x995533,hp:(Math.abs(x*7+y*3+z)%4)/4+2.5});
 const {source}=fixture(cells);for(const size of [1,2,3,32])assertParity(source,size);
});

// Caching original occupancy or appearance-keyed geometry across damage must fail.
test('rebuild sees removed cells and preserves geometry after HP-only changes',()=>{
 const cells:Cell[]=[];for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)cells.push({x,y:-1,z,material:'concrete'});
 const {source,remove,byId}=fixture(cells),before=buildMaterialGreedyChunk(source,'-1,-1,-1',8);
 for(const cell of byId.values())cell.hp=1.25;
 assert.deepEqual(buildMaterialGreedyChunk(source,'-1,-1,-1',8),before);remove(-1,-1,-1);assertParity(source,8);
 const after=buildMaterialGreedyChunk(source,'-1,-1,-1',8);assert.notDeepEqual(after.position,before.position);
});

// Reversed winding or patched-over holes must fail with Three's real front-side Raycaster.
test('actual Three rays hit the same boundaries and pass through the same damage hole at negative coordinates',()=>{
 const cells:Cell[]=[];for(let x=-4;x<=2;x++)for(let z=-4;z<=2;z++)cells.push({x,y:-1,z,material:x%2?'brick':'steel'});
 const {source,remove}=fixture(cells);remove(-1,-1,-1);const oracle:THREE.Mesh[]=[],greedy:THREE.Mesh[]=[];
 source.forEachChunk(3,(x,y,z)=>{const key=`${x},${y},${z}`;oracle.push(meshOf(buildChunk(source,key,3)));greedy.push(meshOf(buildMaterialGreedyChunk(source,key,3)));});
 try{for(let x=-4;x<=2;x++)for(let z=-4;z<=2;z++)for(const sign of [-1,1]){
  const ray=new THREE.Raycaster(new THREE.Vector3(x+.123,sign*8,z+.234),new THREE.Vector3(0,-sign,0)),want=ray.intersectObjects(oracle,false),got=ray.intersectObjects(greedy,false);
  assert.equal(got.length>0,want.length>0);if(x===-1&&z===-1){assert.equal(got.length,0);continue;}
  assert.equal(got[0].distance,want[0].distance);assert.deepEqual(got[0].point.toArray(),want[0].point.toArray());assert.deepEqual(got[0].face!.normal.toArray(),want[0].face!.normal.toArray());
 }}finally{for(const mesh of [...oracle,...greedy]){mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}}
});

// Reading malformed chunk keys or emitting fake bounds for no geometry must fail.
test('empty and outside chunks have no bounds and invalid input fails before querying authority',()=>{
 const {source}=fixture([],{minX:-2,maxX:3,minY:-2,maxY:3,minZ:-2,maxZ:3});let scans=0;const counted={...source,staticIdAt(){scans++;return null;}};
 for(const size of [0,-1,1.5,65,NaN])assert.throws(()=>buildMaterialGreedyChunk(counted,'0,0,0',size));
 for(const key of ['','0,0','0,0,0,0','1e2,0,0','-0,0,0','NaN,0,0'])assert.throws(()=>buildMaterialGreedyChunk(counted,key));assert.equal(scans,0);
 assert.throws(()=>buildMaterialGreedyChunk({...counted,bounds:{...source.bounds,minX:NaN}},'0,0,0'));
 const outside=buildMaterialGreedyChunk(counted,'100,0,0');assert.equal(outside.stats.queriedCells,0);assert.equal(outside.bounds,null);assert.equal(outside.stats.outputBytes,0);
 const empty=buildMaterialGreedyChunk(counted,'0,0,0');assert.equal(empty.faces,0);assert.equal(empty.unitFaces,0);assert.equal(empty.bounds,null);assert.equal(empty.stats.outputBytes,0);assert.ok(empty.stats.queriedCells>0);
});

// Aliasing or retaining source buffers would detach authority or undercount transfers.
test('transfer owns four entire separate buffers and leaves source cells untouched',()=>{
 const {source}=fixture([{x:0,y:0,z:0,material:'brick',hp:3.75}]),mesh=buildMaterialGreedyChunk(source,'0,0,0'),id=source.staticIdAt(0,0,0)!,buffers=[mesh.position.buffer,mesh.normal.buffer,mesh.color.buffer,mesh.index.buffer];
 assert.equal(new Set(buffers).size,4);for(const array of [mesh.position,mesh.normal,mesh.color,mesh.index])assert.equal(array.byteLength,array.buffer.byteLength);
 assert.equal(mesh.faces,6);assert.ok(buffers.every(b=>b.byteLength>0));
 const received:MaterialGreedyChunkMesh=structuredClone(mesh,{transfer:buffers});assert.ok(buffers.every(b=>b.byteLength===0));assert.equal(source.hpOf(id),3.75);assert.deepEqual(buildMaterialGreedyChunk(source,'0,0,0'),received);
});

// Omitting a palette, HP texture, or index texture from total bytes must fail.
test('payload measurement counts geometry plus every actually allocated color-data array',async()=>{
 const {measureMaterialPayload}=await import('../../scripts/material-payload-benchmark');
 const {source}=fixture([{x:0,y:0,z:0,material:'brick',color:0xff0000,hp:5},{x:1,y:0,z:0,material:'brick',color:0x00ff00}]);
 const report=measureMaterialPayload(source,'two-cell-byte-fixture');
 assert.equal(report.totals.unitFaces,10);assert.equal(report.totals.quads,6);assert.equal(report.totals.baselineBytes,1620);assert.equal(report.totals.geometryBytes,792);
 assert.equal(report.totals.indexTextureBytes,2);assert.equal(report.totals.paletteTextureBytes,48);assert.equal(report.totals.shadeTextureBytes,8);assert.equal(report.totals.totalTextureBytes,58);assert.equal(report.totals.totalPayloadBytes,850);
});

// Serializing a texture for a mesh-deletion result must fail the transfer contract.
test('payload measurement does not allocate cell data for a fully occluded chunk',async()=>{
 const {measureMaterialPayload}=await import('../../scripts/material-payload-benchmark');
 const {source}=fixture([{x:0,y:0,z:0,material:'brick'}]);
 const enclosed={...source,staticIdAt:()=>2**40};
 const report=measureMaterialPayload(enclosed,'occluded-byte-fixture');
 assert.equal(report.chunks.length,1);assert.equal(report.totals.unitFaces,0);assert.equal(report.totals.quads,0);assert.equal(report.totals.totalPayloadBytes,0);assert.equal(report.totals.totalTextureBytes,0);
});

// Reporting runtime endpoints as GC-retained evidence, or omitting tracked array bytes, must fail.
test('payload memory evidence labels GC availability and tracks retained payload bytes separately',async()=>{
 const {measureMaterialPayload}=await import('../../scripts/material-payload-benchmark');
 const {source}=fixture([{x:0,y:0,z:0,material:'brick',color:0xff0000}]);
 const report=measureMaterialPayload(source,'memory-byte-fixture') as {memory?:{gcAvailable:boolean;gcInvoked:boolean;retainedPayloadArrayBytes:number;before:{arrayBuffers:number};afterBuildRetained:{arrayBuffers:number};afterRelease:{arrayBuffers:number}}};
 assert.ok(report.memory,'Payload benchmark must include explicitly labelled memory evidence');assert.equal(report.memory.retainedPayloadArrayBytes,825);
 assert.equal(report.memory.gcAvailable,typeof globalThis.gc==='function');assert.equal(report.memory.gcInvoked,report.memory.gcAvailable);
 for(const value of [report.memory.before.arrayBuffers,report.memory.afterBuildRetained.arrayBuffers,report.memory.afterRelease.arrayBuffers])assert.ok(Number.isFinite(value)&&value>=0);
});
