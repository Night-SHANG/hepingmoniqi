import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWeaponGeometry, projectileOrientation } from './weapon-models';
import type { ProjectileView } from './contracts';
const base:ProjectileView={id:'test',position:{x:0,y:0,z:0},radius:.2,weapon:'pulse',age:1,fuseRemaining:null};
test('rocket nose follows real velocity and stays stable when stopped',()=>{const q=projectileOrientation({...base,velocity:{x:1,y:2,z:3}});assert.ok(new THREE.Vector3(0,1,0).applyQuaternion(q).distanceTo(new THREE.Vector3(1,2,3).normalize())<1e-6);assert.ok(projectileOrientation({...base,velocity:{x:0,y:0,z:0}},q).equals(q));});
test('grenade follows physics rotation, package front follows surface normal',()=>{const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.7);assert.ok(projectileOrientation({...base,weapon:'charge',rotation:q}).equals(q));const p=projectileOrientation({...base,weapon:'shock',normal:{x:1,y:0,z:0}});assert.ok(new THREE.Vector3(0,0,1).applyQuaternion(p).distanceTo(new THREE.Vector3(1,0,0))<1e-6);});
test('three authored silhouettes have bounded collider-compatible primary envelopes',()=>{const sizes=[];for(const w of ['charge','pulse','shock'] as const){const g=createWeaponGeometry(w);g.computeBoundingBox();const size=g.boundingBox!.getSize(new THREE.Vector3());sizes.push(size.toArray().join(','));assert.ok(Math.max(size.x,size.y,size.z)<=2.21);assert.ok(g.getAttribute('color'));g.dispose();}assert.equal(new Set(sizes).size,3);});
