import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createVoxelInstanceRenderer} from './voxel-renderer';
import type {Voxel} from './contracts';

// Regression coverage for cross-map ID reuse; exercises the real CPU renderer.
// All records have unit size and identical opaque appearance; changing their IDs
// or assignment to occupied coordinates must not change the exposed geometry.
const voxel=(id:number,x:number,y:number,z:number):Voxel=>({id,position:{x,y,z},size:{x:1,y:1,z:1},rotation:{x:0,y:0,z:0,w:1},structuralState:'static',role:'terrain',color:0x897548,material:'stone',hp:10,maxHp:10});
const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const;
const key=(x:number,y:number,z:number)=>`${x},${y},${z}`;
function expectedSurfaceIds(voxels:readonly Voxel[]){
 const occupied=new Set(voxels.map(v=>key(v.position.x,v.position.y,v.position.z)));
 return voxels.filter(v=>directions.some(([dx,dy,dz])=>!occupied.has(key(v.position.x+dx,v.position.y+dy,v.position.z+dz)))).map(v=>v.id).sort((a,b)=>a-b);
}
function cube(width=3){const result:Voxel[]=[];let id=-1;for(let x=-1;x<width-1;x++)for(let y=-1;y<width-1;y++)for(let z=-1;z<width-1;z++)result.push(voxel(id--,x,y,z));return result;}
function shiftSharedIds(cells:readonly Voxel[],width=3){return cells.map(v=>voxel(v.id,v.position.x===width-2?-1:v.position.x+1,v.position.y,v.position.z));}
function harness(){
 const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshBasicMaterial(),renderer=createVoxelInstanceRenderer(scene,geometry,material);
 return {renderer,renderedIds:()=>Array.from({length:renderer.mesh.count},(_,i)=>renderer.getVoxel(i)!.id).sort((a,b)=>a-b),dispose(){renderer.dispose();geometry.dispose();material.dispose();}};
}

test('fresh seven-cell enclosure hides exactly the center',()=>{
 const h=harness(),cells=[voxel(-1,0,0,0),...directions.map(([x,y,z],i)=>voxel(-i-2,x,y,z))];
 try{h.renderer.set(cells);assert.deepEqual(h.renderedIds(),expectedSurfaceIds(cells));assert.equal(h.renderer.getDiagnostics().visible,6);}finally{h.dispose();}
});

test('shared negative IDs moving between occupied coordinates preserve the exact surface',()=>{
 const h=harness(),first=cube(),second=shiftSharedIds(first);
 try{
  h.renderer.set(first);assert.deepEqual(h.renderedIds(),expectedSurfaceIds(first));
  h.renderer.set(second);
  assert.deepEqual(h.renderedIds(),expectedSurfaceIds(second),'replacing one old coordinate must not erase a different cell already installed there');
  h.renderer.set(first);assert.deepEqual(h.renderedIds(),expectedSurfaceIds(first),'returning to the first map must preserve exact surface membership');
 }finally{h.dispose();}
});

test('removing an old ID does not erase its replacement at the same coordinate',()=>{
 const h=harness(),first=[voxel(-1,0,0,0),...directions.map(([x,y,z],i)=>voxel(-i-2,x,y,z))];
 const second=first.map(v=>v.id===-2?voxel(-100,v.position.x,v.position.y,v.position.z):v);
 try{
  h.renderer.set(first);assert.deepEqual(h.renderedIds(),expectedSurfaceIds(first));
  h.renderer.set(second);
  assert.deepEqual(h.renderedIds(),expectedSurfaceIds(second),'stale-ID cleanup must not erase the new owner of the same occupied coordinate');
 }finally{h.dispose();}
});

test('identical occupied geometry does not spuriously double the instance capacity on map rebind',()=>{
 const h=harness(),first=cube(4);
 try{
  h.renderer.set(first);const capacity=h.renderer.getDiagnostics().capacity;assert.equal(capacity,56);
  h.renderer.set(shiftSharedIds(first,4));
  assert.equal(h.renderer.getDiagnostics().capacity,capacity,'the same 56 surface cells must not expose interior cells and double capacity');
 }finally{h.dispose();}
});
