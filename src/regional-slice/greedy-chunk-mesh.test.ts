import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type {CompactSurfaceSource,SurfaceBounds} from '../compact/surface-source';
import {buildChunk,type ChunkMesh} from '../worker-slice/chunk-mesh';
import {buildGreedyChunk,type GreedyChunkMesh} from './greedy-chunk-mesh';

type Cell={x:number;y:number;z:number;color?:number;hp?:number;maxHp?:number};
function fixture(cells:Cell[],bounds?:SurfaceBounds):CompactSurfaceSource {
 const ids=cells.map((_,i)=>i%2?-(2**40)-i:2**40+i),byPosition=new Map(cells.map((c,i)=>[`${c.x},${c.y},${c.z}`,ids[i]])),byId=new Map(ids.map((id,i)=>[id,cells[i]]));
 return {bounds:bounds??{minX:Math.min(...cells.map(c=>c.x)),maxX:Math.max(...cells.map(c=>c.x)),minY:Math.min(...cells.map(c=>c.y)),maxY:Math.max(...cells.map(c=>c.y)),minZ:Math.min(...cells.map(c=>c.z)),maxZ:Math.max(...cells.map(c=>c.z))},
 staticIdAt:(x,y,z)=>byPosition.get(`${x},${y},${z}`)??null,colorOf:id=>byId.get(id)!.color??0x995533,hpOf:id=>byId.get(id)!.hp??10,maxHpOf:id=>byId.get(id)!.maxHp??10,
 forEachChunk(size,visit){const keys=new Set(cells.map(c=>`${Math.floor(c.x/size)},${Math.floor(c.y/size)},${Math.floor(c.z/size)}`));for(const key of keys)visit(...key.split(',').map(Number) as [number,number,number]);}};
}

function faceKey(center:number[],normal:number[],color:number[]){return [...center,...normal,...color].join(',');}
/** Independent expansion: triangle oracle supplies literal unit boundaries;
 * greedy quad AABBs supply integer area. Duplicate keys mean overlap. */
function expanded(mesh:ChunkMesh|GreedyChunkMesh):Set<string> {
 const result=new Set<string>(),indices='index' in mesh?mesh.index:undefined,stride=indices?4:6;
 for(let f=0;f<mesh.faces;f++){
  const start=f*stride*3,normal=Array.from(mesh.normal.slice(start,start+3)),color=Array.from(mesh.color.slice(start,start+3));
  const axis=normal.findIndex(n=>n!==0),tangents=[0,1,2].filter(a=>a!==axis),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  assert.equal(normal.filter(n=>n!==0).length,1);assert.equal(Math.abs(normal[axis]),1);
  for(let v=0;v<stride;v++)for(let a=0;a<3;a++){
   lo[a]=Math.min(lo[a],mesh.position[start+v*3+a]);hi[a]=Math.max(hi[a],mesh.position[start+v*3+a]);
   assert.equal(mesh.normal[start+v*3+a],normal[a]);assert.equal(mesh.color[start+v*3+a],color[a]);
  }
  assert.equal(lo[axis],hi[axis]);
  for(const a of tangents){assert.ok(hi[a]>lo[a]);assert.equal(hi[a]-lo[a],Math.round(hi[a]-lo[a]));}
  for(let u=lo[tangents[0]]+.5;u<hi[tangents[0]];u++)for(let v=lo[tangents[1]]+.5;v<hi[tangents[1]];v++){
   const center=[0,0,0];center[axis]=lo[axis];center[tangents[0]]=u;center[tangents[1]]=v;
   const key=faceKey(center,normal,color);assert.ok(!result.has(key),`overlapping face ${key}`);result.add(key);
  }
  if(indices)for(let t=0;t<2;t++){
   const triangle:number[]=Array.from(indices.slice(f*6+t*3,f*6+t*3+3));
   assert.ok(triangle.every(i=>i>=f*4&&i<f*4+4));
   const points:THREE.Vector3[]=triangle.map(i=>new THREE.Vector3().fromArray(mesh.position,i*3));
   const cross:THREE.Vector3=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
   assert.ok(cross.dot(new THREE.Vector3(...normal as [number,number,number]))>0,'triangle winding must face outward');
   assert.equal(cross.length(),(hi[tangents[0]]-lo[tangents[0]])*(hi[tangents[1]]-lo[tangents[1]]));
  }
 }
 return result;
}
function assertParity(source:CompactSurfaceSource,size=32){
 source.forEachChunk(size,(x,y,z)=>{
  const key=`${x},${y},${z}`,oracle=buildChunk(source,key,size),greedy=buildGreedyChunk(source,key,size);
  assert.deepEqual(expanded(greedy),expanded(oracle),key);assert.equal(greedy.unitFaces,oracle.faces);assert.deepEqual(greedy.bounds,oracle.bounds);
  assert.equal(greedy.stats.outputBytes,greedy.position.byteLength+greedy.normal.byteLength+greedy.color.byteLength+greedy.index.byteLength);
  assert.equal(greedy.position.length,greedy.faces*12);assert.equal(greedy.index.length,greedy.faces*6);
 });
}
function meshOf(data:ChunkMesh|GreedyChunkMesh){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(data.position,3));geometry.setAttribute('normal',new THREE.BufferAttribute(data.normal,3));geometry.setAttribute('color',new THREE.BufferAttribute(data.color,3));if('index' in data&&data.index)geometry.setIndex(new THREE.BufferAttribute(data.index,1));const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.FrontSide}));mesh.updateMatrixWorld();return mesh;}

test('uniform 32 by 32 slab merges into six indexed quads without changing a unit boundary',()=>{
 const cells:Cell[]=[];for(let x=0;x<32;x++)for(let z=0;z<32;z++)cells.push({x,y:0,z});
 const source=fixture(cells),mesh=buildGreedyChunk(source,'0,0,0');
 assert.equal(mesh.faces,6);assert.equal(mesh.unitFaces,2176);assert.equal(mesh.position.length/3,24);assert.equal(mesh.index.length,36);assert.ok(mesh.index instanceof Uint32Array);assert.equal(mesh.stats.outputBytes,792);assertParity(source);
});

test('all six directions retain holes, concavities, exact fractional HP colors and negative chunk seams',()=>{
 const cells:Cell[]=[];for(let x=-3;x<=3;x++)for(let y=-2;y<=2;y++)for(let z=-3;z<=3;z++)if((x*x+y*y+z*z)%5!==0)cells.push({x,y,z,color:(x+z)%2?0x8b9650:0x995533,hp:(Math.abs(x*7+y*3+z)%4)/4+2.5,maxHp:10});
 const source=fixture(cells);for(const size of [1,2,3,32])assertParity(source,size);
});

test('merge key is final Float32 linear shade, not material, raw HP or approximate color',()=>{
 const same=fixture([{x:0,y:0,z:0,hp:5,maxHp:10},{x:1,y:0,z:0,hp:10,maxHp:20},{x:2,y:0,z:0,hp:5+1e-10,maxHp:10}]);
 assert.equal(buildGreedyChunk(same,'0,0,0').faces,6);assertParity(same);
 const different=fixture([{x:0,y:0,z:0,hp:5},{x:1,y:0,z:0,hp:5.001},{x:2,y:0,z:0,hp:5,color:0x995534}]);
 assert.equal(buildGreedyChunk(different,'0,0,0').faces,14);assertParity(different);
 const black=fixture([{x:0,y:0,z:0,color:0,hp:1},{x:1,y:0,z:0,color:0,hp:10}]);assert.equal(buildGreedyChunk(black,'0,0,0').faces,6);assertParity(black);
});

test('actual Three Raycaster preserves front-face hits and through-holes at negative bounds',()=>{
 const cells:Cell[]=[];for(let x=-4;x<=2;x++)for(let z=-4;z<=2;z++)if(x!==-1||z!==-1)cells.push({x,y:-1,z});
 const source=fixture(cells),oracle:THREE.Mesh[]=[],greedy:THREE.Mesh[]=[];
 source.forEachChunk(3,(x,y,z)=>{const key=`${x},${y},${z}`;oracle.push(meshOf(buildChunk(source,key,3)));greedy.push(meshOf(buildGreedyChunk(source,key,3)));});
 try {
  for(let x=-4;x<=2;x++)for(let z=-4;z<=2;z++)for(const sign of [-1,1]){
   const ray=new THREE.Raycaster(new THREE.Vector3(x+.123,sign*8,z+.234),new THREE.Vector3(0,-sign,0)),want=ray.intersectObjects(oracle,false),got=ray.intersectObjects(greedy,false);
   assert.equal(got.length>0,want.length>0);if(x===-1&&z===-1){assert.equal(got.length,0);continue;}
   assert.equal(got[0].distance,want[0].distance);assert.deepEqual(got[0].point.toArray(),want[0].point.toArray());assert.deepEqual(got[0].face!.normal.toArray(),want[0].face!.normal.toArray());
  }
 }finally{for(const mesh of [...oracle,...greedy]){mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}}
});

test('empty/outside chunks own empty buffers and invalid keys fail before source reads',()=>{
 const source=fixture([],{minX:-2,maxX:3,minY:-2,maxY:3,minZ:-2,maxZ:3});let scans=0;const counted={...source,staticIdAt(){scans++;return null;}};
 for(const size of [0,-1,1.5,65,NaN])assert.throws(()=>buildGreedyChunk(counted,'0,0,0',size));
 for(const key of ['','0,0','0,0,0,0','1e2,0,0','-0,0,0','NaN,0,0'])assert.throws(()=>buildGreedyChunk(counted,key));assert.equal(scans,0);
 const outside=buildGreedyChunk(counted,'100,0,0');assert.equal(outside.stats.queriedCells,0);assert.equal(outside.bounds,null);assert.equal(outside.stats.outputBytes,0);
 const empty=buildGreedyChunk(counted,'0,0,0');assert.equal(empty.faces,0);assert.equal(empty.unitFaces,0);assert.equal(empty.bounds,null);assert.equal(empty.stats.outputBytes,0);assert.ok(empty.stats.queriedCells>0);
});

test('transfer owns all four buffers and leaves authority data untouched',()=>{
 const source=fixture([{x:0,y:0,z:0,hp:3.75}]),mesh=buildGreedyChunk(source,'0,0,0'),id=source.staticIdAt(0,0,0)!,buffers=[mesh.position.buffer,mesh.normal.buffer,mesh.color.buffer,mesh.index.buffer];
 assert.equal(new Set(buffers).size,4);for(const array of [mesh.position,mesh.normal,mesh.color,mesh.index])assert.equal(array.byteLength,array.buffer.byteLength);
 const received=structuredClone(mesh,{transfer:buffers});assert.ok(buffers.every(b=>b.byteLength===0));assert.equal(source.hpOf(id),3.75);assert.deepEqual(buildGreedyChunk(source,'0,0,0'),received);
});
