import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {WebGLShadowMap} from 'three/src/renderers/webgl/WebGLShadowMap.js';
import * as scene from './scene.js';
const pose=(x=0)=>new THREE.Matrix4().makeTranslation(x,0,0).elements;

test('static authority shadows refresh once and ignore idle frames and color-only updates',()=>{
 assert.equal(typeof scene.createShadowRefreshPolicy,'function','shadow invalidation policy must exist');
 const policy=scene.createShadowRefreshPolicy();assert.equal(policy.consume(),true);assert.equal(policy.consume(),false);
 policy.voxels({matrixWrites:2,visible:2,rebuilt:false});assert.equal(policy.consume(),true);
 for(let i=0;i<120;i++){policy.voxels({matrixWrites:0,visible:2,rebuilt:false});assert.equal(policy.consume(),false);}
});

test('shadow refresh covers falling poses, last-instance removal, newly exposed faces, rebuild and map lighting',()=>{
 assert.equal(typeof scene.createShadowRefreshPolicy,'function');const policy=scene.createShadowRefreshPolicy();policy.voxels({matrixWrites:2,visible:2,rebuilt:false});policy.consume();
 for(let frame=0;frame<5;frame++){policy.voxels({matrixWrites:1,visible:2,rebuilt:false});assert.equal(policy.consume(),true,'moving authority must refresh every rendered frame');}
 policy.voxels({matrixWrites:0,visible:1,rebuilt:false});assert.equal(policy.consume(),true,'deleting the last slot leaves no matrix write');
 policy.voxels({matrixWrites:2,visible:3,rebuilt:false});assert.equal(policy.consume(),true);
 policy.voxels({matrixWrites:0,visible:3,rebuilt:true});assert.equal(policy.consume(),true);
 policy.invalidate();assert.equal(policy.consume(),true);assert.equal(policy.consume(),false);
});

test('projectile shadows track rendered matrices and models, not timers or ordering',()=>{
 assert.equal(typeof scene.createShadowRefreshPolicy,'function');const policy=scene.createShadowRefreshPolicy();policy.consume();
 const update=(items:readonly {id:string;model:string;matrix:readonly number[]}[])=>{policy.beginProjectiles();for(const p of items)policy.projectile(p.id,p.model,p.matrix);policy.endProjectiles();return policy.consume();};
 const a={id:'a',model:'charge',matrix:pose(1)},b={id:'b',model:'pulse',matrix:pose(2)};
 assert.equal(update([a,b]),true);assert.equal(update([b,a]),false);assert.equal(update([a,b]),false);
 assert.equal(update([{...a,matrix:pose(3)},b]),true);assert.equal(update([{...a,matrix:pose(3)},b]),false);
 assert.equal(update([{...a,model:'split-child',matrix:pose(3)},b]),true);
 assert.equal(update([b]),true);assert.equal(update([]),true);assert.equal(update([]),false);
});

test('projectile shadow history owns matrix values even when a caller reuses its transform array',()=>{
 assert.equal(typeof scene.createShadowRefreshPolicy,'function');const policy=scene.createShadowRefreshPolicy(),matrix=pose(1);policy.consume();
 policy.beginProjectiles();policy.projectile('a','charge',matrix);policy.endProjectiles();assert.equal(policy.consume(),true);
 matrix[12]=4;policy.beginProjectiles();policy.projectile('a','charge',matrix);policy.endProjectiles();assert.equal(policy.consume(),true);
 policy.beginProjectiles();policy.projectile('a','charge',matrix);policy.endProjectiles();assert.equal(policy.consume(),false);
});

test('actual renderer diagnostics invalidate moved casters and removals without rebuilding identical geometry',()=>{
 const world=new THREE.Scene(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
 const renderer=scene.createVoxelInstanceRenderer(world,geometry,material),policy=scene.createShadowRefreshPolicy();
 const voxel={id:1,position:{x:0,y:0,z:0},size:{x:1,y:1,z:1},structuralState:'static' as const,role:'terrain' as const,color:0x888888,material:'stone' as const,hp:10,maxHp:10};
 const apply=(voxels:readonly typeof voxel[])=>{const old=renderer.mesh;renderer.set(voxels);const result=renderer.getDiagnostics();policy.voxels({matrixWrites:result.matrixWrites,visible:result.visible,rebuilt:old!==renderer.mesh});return policy.consume();};
 try{
  assert.equal(apply([voxel]),true);assert.equal(apply([voxel]),false);
  voxel.hp=9;assert.equal(apply([voxel]),false,'color-only health change leaves shadow geometry intact');
  voxel.position.y=1;assert.equal(apply([voxel]),true);
  assert.equal(apply([]),true);assert.equal(renderer.getDiagnostics().matrixWrites,0,'last-instance removal does not write a matrix');assert.equal(apply([]),false);
 }finally{renderer.dispose();geometry.dispose();material.dispose();}
});

test('installed Three shadow pass gate skips unchanged maps but executes every requested refresh',()=>{
 let passes=0;
 const renderer={
  coordinateSystem:THREE.WebGLCoordinateSystem,
  getRenderTarget(){passes++;return null;},getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
  setRenderTarget(){},clear(){},
  state:{setBlending(){},setScissorTest(){},viewport(){},buffers:{
   depth:{getReversed:()=>false,setTest(){}},color:{setClear(){}}
  }}
 } as unknown as THREE.WebGLRenderer;
 const shadows=new WebGLShadowMap(renderer,{} as any,{maxTextureSize:4096} as any),world=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),light=new THREE.DirectionalLight();
 shadows.enabled=true;for(let frame=0;frame<120;frame++)shadows.render([light],world,camera);assert.equal(passes,120,'default renderer regenerates even unchanged shadow maps');
 passes=0;shadows.autoUpdate=false;shadows.needsUpdate=true;for(let frame=0;frame<120;frame++)shadows.render([light],world,camera);assert.equal(passes,1);assert.equal(shadows.needsUpdate,false);
 shadows.needsUpdate=true;shadows.render([light],world,camera);assert.equal(passes,2);light.shadow.map?.dispose();
});
