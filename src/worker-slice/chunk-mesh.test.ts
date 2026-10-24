import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type {CompactSurfaceSource} from '../compact/surface-source';
import {createCompactSurfaceRenderer} from '../compact/surface-renderer';
import {buildChunk} from './chunk-mesh';

function fixture() {
 const coordinates=[[-2,-1,-1],[-1,-1,-1],[0,-1,-1],[1,-1,-1],[0,0,-1],[0,1,-1],[0,0,0],[1,0,0],[0,1,0],[2,0,0],[3,0,0],[3,1,0],[3,0,1]];
 const hp=new Float64Array(coordinates.map((_,i)=>i%3===0?2.5:10));
 const live=new Uint8Array(coordinates.length).fill(1),ids=coordinates.map((_,i)=>i%2?-(2**40)-i:2**40+i);
 const byId=new Map(ids.map((id,i)=>[id,i])),byPosition=new Map(coordinates.map((p,i)=>[p.join(','),i]));
 const source:CompactSurfaceSource={bounds:{minX:-2,maxX:3,minY:-1,maxY:1,minZ:-1,maxZ:1},
  staticIdAt(x,y,z){const i=byPosition.get(`${x},${y},${z}`);return i===undefined||!live[i]?null:ids[i];},
  colorOf(id){return byId.get(id)!%2?0x8b9650:0x995533;},hpOf:id=>hp[byId.get(id)!],maxHpOf:()=>10,
  forEachChunk(size,visit){const keys=new Set(coordinates.map(([x,y,z])=>`${Math.floor(x/size)},${Math.floor(y/size)},${Math.floor(z/size)}`));for(const key of keys)visit(...key.split(',').map(Number) as [number,number,number]);}};
 return {source,hp,live,ids};
}

function assertMatchesRenderer(source:CompactSurfaceSource,size:number) {
 const scene=new THREE.Scene(),box=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),renderer=createCompactSurfaceRenderer(scene,box,material,{chunkSize:size});
 try {
  renderer.bind(source);
  source.forEachChunk(size,(x,y,z)=>{
   const key=`${x},${y},${z}`,mesh=buildChunk(source,key,size),reference=renderer.group.children.find(child=>child.name===key) as THREE.Mesh|undefined;
   if(!reference){assert.equal(mesh.faces,0);assert.equal(mesh.bounds,null);return;}
   const geometry=reference.geometry;
   for(const name of ['position','normal','color'] as const)assert.deepEqual(mesh[name],geometry.getAttribute(name).array,`${key} ${name}`);
   assert.equal(mesh.faces,geometry.getAttribute('position').count/6);
   const bounds=geometry.boundingBox!;
   assert.deepEqual(mesh.bounds,{minX:bounds.min.x,maxX:bounds.max.x,minY:bounds.min.y,maxY:bounds.max.y,minZ:bounds.min.z,maxZ:bounds.max.z});
   assert.equal(mesh.stats.outputBytes,mesh.faces*18*9);
   assert.equal(mesh.stats.temporaryBytes,mesh.stats.queriedCells*9);
  });
 } finally {renderer.dispose();box.dispose();material.dispose();}
}

test('CPU chunks exactly match native Three geometry, linear damage colors, signed large IDs and winding',()=>{
 const f=fixture();for(const size of [1,2,32])assertMatchesRenderer(f.source,size);
 f.live[6]=0;f.live[10]=0;f.hp[4]=1;for(const size of [1,2,32])assertMatchesRenderer(f.source,size);
});

test('boundary removal exposes the neighboring chunk face rather than filling a bounding box',()=>{
 const f=fixture(),before=buildChunk(f.source,'0,0,0',2);f.live[9]=0;
 const after=buildChunk(f.source,'0,0,0',2);assert.equal(after.faces,before.faces+1);assertMatchesRenderer(f.source,2);
});

test('transferring mesh output detaches only newly owned arrays, never the authority scalar storage',()=>{
 const f=fixture(),mesh=buildChunk(f.source,'0,0,0',2),expectedHp=Array.from(f.hp),expectedPosition=Array.from(mesh.position);
 const buffers=[mesh.position.buffer,mesh.normal.buffer,mesh.color.buffer];assert.equal(new Set(buffers).size,3);
 const received=structuredClone(mesh,{transfer:buffers});
 assert.equal(mesh.position.byteLength,0);assert.equal(mesh.normal.byteLength,0);assert.equal(mesh.color.byteLength,0);
 assert.deepEqual(Array.from(received.position),expectedPosition);assert.deepEqual(Array.from(f.hp),expectedHp);
 assert.ok(f.hp.byteLength>0);assert.equal(f.source.hpOf(f.ids[4]),10);
 assert.deepEqual(buildChunk(f.source,'0,0,0',2).position,received.position);
});

test('complete deletion and outside chunks return owned empty replacements with null bounds',()=>{
 const f=fixture();f.live.fill(0);const empty=buildChunk(f.source,'0,0,0',2);
 assert.equal(empty.faces,0);assert.equal(empty.bounds,null);assert.equal(empty.position.length,0);
 assert.equal(empty.stats.outputBytes,0);assert.ok(empty.stats.queriedCells>0);
 const outside=buildChunk(f.source,'100,0,0',2);assert.equal(outside.faces,0);assert.equal(outside.stats.queriedCells,0);
});

test('invalid chunk dimensions or keys fail before scanning the source',()=>{
 const f=fixture();let scans=0;const source={...f.source,staticIdAt(){scans++;return null;}};
 for(const size of [0,-1,1.5,65,NaN])assert.throws(()=>buildChunk(source,'0,0,0',size));
 for(const key of ['','0,0','0,0,0,0','1e2,0,0','-0,0,0','NaN,0,0'])assert.throws(()=>buildChunk(source,key));
 assert.equal(scans,0);
});
