import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createVoxelInstanceRenderer} from './scene';
import type {Voxel} from './contracts';
const voxel=(id:number,x:number,y:number,z:number):Voxel=>({id,position:{x,y,z},size:{x:1,y:1,z:1},structuralState:'static',role:'terrain',color:0x897548,material:'stone',hp:10,maxHp:10});
function fixture(){const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();const render=createVoxelInstanceRenderer(scene,geometry,material);return {render,dispose(){render.dispose();geometry.dispose();material.dispose();}};}

test('authority dynamic and rubble geometry uses exact quaternion and stable voxel picking IDs',()=>{
 const f=fixture(),q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/4);
 const chunk={...voxel(71,4,5,6),size:{x:4,y:1,z:1},rotation:{x:q.x,y:q.y,z:q.z,w:q.w},structuralState:'dynamic' as const};
 f.render.set([chunk]);const matrix=new THREE.Matrix4();f.render.mesh.getMatrixAt(0,matrix);
 assert.ok(Math.abs(matrix.elements[0]-Math.sqrt(8))<1e-6,'rotation must not be reset to identity');
 const ray=new THREE.Raycaster(new THREE.Vector3(4,10,6),new THREE.Vector3(0,-1,0)),hit=ray.intersectObject(f.render.mesh,false)[0];
 assert.ok(hit);assert.ok(Math.abs(hit.point.y-(5+Math.SQRT1_2))<1e-5,'ray must hit the actual tilted face');
 const normal=hit.face!.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix));
 assert.ok(Math.abs(normal.x)>0.7&&Math.abs(normal.y)>0.7);
 assert.equal(f.render.getVoxel(hit.instanceId!)?.id,71);
 f.render.set([{...chunk,structuralState:'rubble'}]);assert.equal(f.render.mesh.count,1);f.dispose();
});

test('enclosed static soil is hidden, removed neighbors expose the exact next live cell',()=>{
 const f=fixture(),cells:Voxel[]=[];let id=1;
 for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)cells.push(voxel(id++,x,y,z));
 f.render.set(cells);assert.equal(f.render.mesh.count,26,'only fully enclosed center is culled');
 const center=cells.find(v=>v.position.x===0&&v.position.y===0&&v.position.z===0)!;
 const top=cells.find(v=>v.position.x===0&&v.position.y===1&&v.position.z===0)!;
 f.render.set(cells.filter(v=>v!==top));assert.equal(f.render.mesh.count,26,'new crater face must appear in same update');
 const ray=new THREE.Raycaster(new THREE.Vector3(0,10,0),new THREE.Vector3(0,-1,0)),hit=ray.intersectObject(f.render.mesh,false)[0];
 assert.equal(hit.point.y,.5);assert.equal(f.render.getVoxel(hit.instanceId!)?.id,center.id);f.dispose();
});

test('unchanged frames do not rewrite static GPU transforms or colors and mutations remain live',()=>{
 const f=fixture(),cells=[voxel(1,0,0,0),voxel(2,2,0,0)];f.render.set(cells);
 const matrixVersion=f.render.mesh.instanceMatrix.version,colorVersion=f.render.mesh.instanceColor!.version;
 f.render.set(cells);assert.equal(f.render.mesh.instanceMatrix.version,matrixVersion);assert.equal(f.render.mesh.instanceColor!.version,colorVersion);
 cells[1].position.x=8;cells[1].hp=5;f.render.set(cells);
 const hit=new THREE.Raycaster(new THREE.Vector3(8,5,0),new THREE.Vector3(0,-1,0)).intersectObject(f.render.mesh,false)[0];
 assert.equal(f.render.getVoxel(hit.instanceId!)?.id,2);assert.equal(f.render.getDiagnostics().matrixWrites,1);f.dispose();
});

test('dynamic and rubble cells are never hidden by the static enclosure index',()=>{
 const f=fixture(),cells:Voxel[]=[];let id=1;
 for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)cells.push(voxel(id++,x,y,z));
 const center=cells.find(v=>v.position.x===0&&v.position.y===0&&v.position.z===0)!;
 center.structuralState='dynamic';f.render.set(cells);assert.equal(f.render.mesh.count,27);
 center.structuralState='rubble';f.render.set(cells);assert.equal(f.render.mesh.count,27);
 center.structuralState='static';f.render.set(cells);assert.equal(f.render.mesh.count,26);f.dispose();
});

test('frozen authority snapshots skip idle scans but do not mistake a frozen container for frozen cells',()=>{
 const f=fixture(),v=voxel(8,0,0,0);Object.freeze(v.position);Object.freeze(v.size);Object.freeze(v);const snapshot=Object.freeze([v]);
 f.render.set(snapshot);f.render.set(snapshot);assert.equal(f.render.getDiagnostics().scanned,0);
 const mutable=voxel(9,0,0,0),container=Object.freeze([mutable]);f.render.set(container);mutable.position.x=9;f.render.set(container);
 assert.equal(f.render.getDiagnostics().matrixWrites,1);f.dispose();
});

test('reordered and removed authority entries preserve compact hit identities',()=>{
 const f=fixture(),cells=[voxel(1,0,0,0),voxel(2,2,0,0),voxel(3,4,0,0)];f.render.set(cells);
 f.render.set([cells[2],cells[0]]);
 for(const cell of [cells[2],cells[0]]){
  const hit=new THREE.Raycaster(new THREE.Vector3(cell.position.x,5,0),new THREE.Vector3(0,-1,0)).intersectObject(f.render.mesh,false)[0];
  assert.equal(f.render.getVoxel(hit.instanceId!)?.id,cell.id);
 }
 f.dispose();
});
