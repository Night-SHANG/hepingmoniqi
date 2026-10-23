import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWeaponGeometry, projectileOrientation } from './weapon-models';
import type { ProjectileView } from './contracts';
const base:ProjectileView={id:'test',position:{x:0,y:0,z:0},radius:.2,weapon:'pulse',age:1,fuseRemaining:null};
test('rocket nose follows real velocity and stays stable when stopped',()=>{const q=projectileOrientation({...base,velocity:{x:1,y:2,z:3}});assert.ok(new THREE.Vector3(0,1,0).applyQuaternion(q).distanceTo(new THREE.Vector3(1,2,3).normalize())<1e-6);assert.ok(projectileOrientation({...base,velocity:{x:0,y:0,z:0}},q).equals(q));});
test('grenade follows physics rotation, package front follows surface normal',()=>{const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.7);assert.ok(projectileOrientation({...base,weapon:'charge',rotation:q}).equals(q));const p=projectileOrientation({...base,weapon:'shock',normal:{x:1,y:0,z:0}});assert.ok(new THREE.Vector3(0,0,1).applyQuaternion(p).distanceTo(new THREE.Vector3(1,0,0))<1e-6);});
test('a launched package follows its real physics body quaternion instead of an absent surface normal',()=>{
  const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.8);
  assert.ok(projectileOrientation({...base,weapon:'shock',state:'flying',rotation}).equals(rotation));
});
test('all attached weapons orient their authored contact axis to the actual surface normal',()=>{
  const normal={x:1,y:0,z:0};
  for(const weapon of ['charge','pulse','shock'] as const){
    const orientation=projectileOrientation({...base,weapon,state:'attached',normal,rotation:new THREE.Quaternion()});
    const axis=weapon==='shock'?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0);
    assert.ok(axis.applyQuaternion(orientation).distanceTo(new THREE.Vector3(1,0,0))<1e-6,weapon);
  }
});
test('three authored silhouettes have bounded collider-compatible primary envelopes',()=>{const sizes=[];for(const w of ['charge','pulse','shock'] as const){const g=createWeaponGeometry(w);g.computeBoundingBox();const size=g.boundingBox!.getSize(new THREE.Vector3());sizes.push(size.toArray().join(','));assert.ok(Math.max(size.x,size.y,size.z)<=2.21);assert.ok(g.getAttribute('color'));g.dispose();}assert.equal(new Set(sizes).size,3);});
test('rocket uses collider envelope for a wider contrasted silhouette without extending its hit proxy',()=>{const g=createWeaponGeometry('pulse');g.computeBoundingBox();const size=g.boundingBox!.getSize(new THREE.Vector3());assert.ok(size.x>=1.3);const pos=g.getAttribute('position');for(let i=0;i<pos.count;i++)assert.ok(Math.hypot(pos.getX(i),pos.getY(i),pos.getZ(i))<=1.1);g.dispose();});
test('attached annotation is a depth-free overlay with a camera-plane offset, not a relocated body',async()=>{const { ATTACHED_ANNOTATION, attachedAnnotationPosition }=await import('./weapon-models');assert.equal(ATTACHED_ANNOTATION.depthTest,false);assert.equal(ATTACHED_ANNOTATION.depthWrite,false);assert.ok(ATTACHED_ANNOTATION.renderOrder>20);const camera=new THREE.PerspectiveCamera(42,1.6,.2,250);camera.position.set(27,23,32);camera.lookAt(0,4.5,0);camera.updateMatrixWorld();const anchor={x:0,y:4,z:0};const label=attachedAnnotationPosition(anchor,camera.quaternion);const a=new THREE.Vector3(anchor.x,anchor.y,anchor.z).project(camera),b=label.clone().project(camera);assert.ok(b.x>a.x);assert.ok(b.y>a.y);assert.ok(Math.abs(b.x)<1&&Math.abs(b.y)<1);assert.deepEqual(anchor,{x:0,y:4,z:0});});

test('expanded tool models have explicit distinct silhouettes bounded by the physical radius',()=>{
  const signatures=[];
  for(const [weapon,stage] of [['echo','parent'],['split','parent'],['split','child']] as const){
    const g=createWeaponGeometry(weapon,stage),positions=g.getAttribute('position');
    for(let i=0;i<positions.count;i++)assert.ok(Math.hypot(positions.getX(i),positions.getY(i),positions.getZ(i))<=1.000001);
    g.computeBoundingBox();signatures.push(`${positions.count}:${g.boundingBox!.getSize(new THREE.Vector3()).toArray()}`);
    assert.ok(g.getAttribute('color'));g.dispose();
  }
  assert.equal(new Set(signatures).size,3);
});
test('echo front faces attached and emitting surface while free tools follow physics rotation',()=>{
  const normal={x:1,y:0,z:0};
  for(const stage of ['parent','emitter'] as const){
    const q=projectileOrientation({...base,weapon:'echo',state:'attached',stage,normal});
    assert.ok(new THREE.Vector3(0,0,1).applyQuaternion(q).distanceTo(new THREE.Vector3(1,0,0))<1e-6);
  }
  const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.9);
  for(const weapon of ['echo','split'] as const)assert.ok(projectileOrientation({...base,weapon,state:'flying',rotation}).equals(rotation));
});
test('all weapon and child render paths are explicit, unsupported IDs never become a package',async()=>{
  const {WEAPON_MODEL_KEYS,projectileModelKey}=await import('./weapon-models');
  assert.deepEqual(WEAPON_MODEL_KEYS,['charge','pulse','shock','echo','split','split-child']);
  for(const weapon of ['charge','pulse','shock','echo','split'] as const)assert.equal(projectileModelKey({...base,weapon}),weapon);
  assert.equal(projectileModelKey({...base,weapon:'split',stage:'child'}),'split-child');
  assert.equal(projectileModelKey({...base,weapon:'echo',stage:'emitter'}),'echo');
  assert.throws(()=>createWeaponGeometry('unknown' as never),/Unsupported weapon/);
});

test('every concrete tool and split child grows beyond 48 and keeps its real radius and transform',async()=>{
  const {WEAPON_MODEL_KEYS,projectileModelKey}=await import('./weapon-models');
  const {createGrowingInstancePool}=await import('./scene-runtime');
  const scene=new THREE.Scene(),material=new THREE.MeshBasicMaterial(),actual=new THREE.Matrix4();
  for(const key of WEAPON_MODEL_KEYS){
    const weapon=key==='split-child'?'split':key,stage=key==='split-child'?'child':'parent';
    const radius=stage==='child'?.16:.2,geometry=createWeaponGeometry(weapon,stage);
    const pool=createGrowingInstancePool(scene,geometry,material,1);pool.reserve(129);
    for(let i=0;i<129;i++){
      const p={...base,weapon,stage,radius,position:{x:i,y:2,z:-i}} as const;
      assert.equal(projectileModelKey(p),key);
      pool.mesh.setMatrixAt(i,new THREE.Matrix4().compose(new THREE.Vector3(p.position.x,p.position.y,p.position.z),projectileOrientation(p),new THREE.Vector3(radius,radius,radius)));
    }
    pool.mesh.count=129;pool.mesh.getMatrixAt(128,actual);
    assert.deepEqual(actual.elements.slice(12,15),[128,2,-128]);
    assert.ok(Math.abs(new THREE.Vector3().setFromMatrixScale(actual).x-radius)<1e-6);
    pool.dispose();geometry.dispose();
  }
  assert.equal(scene.children.length,0);material.dispose();
});

test('existing reset camera contains all bridge and tower voxel corners without changing QA projection',async()=>{
  const {bridgeVoxels,towerVoxels}=await import('./map-generators');
  for(const aspect of [1,1.6,2]){
    const camera=new THREE.PerspectiveCamera(42,aspect,.2,250);camera.position.set(27,23,32);camera.lookAt(0,4.5,0);camera.updateMatrixWorld();
    for(const voxels of [bridgeVoxels(),towerVoxels()])for(const {position:p} of voxels)for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){
      const projected=new THREE.Vector3(p.x+x,p.y+y,p.z+z).project(camera);
      assert.ok(Math.abs(projected.x)<1&&Math.abs(projected.y)<1&&Math.abs(projected.z)<1,`voxel ${JSON.stringify(p)}, aspect ${aspect}`);
    }
  }
});
