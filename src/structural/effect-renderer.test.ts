import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {StructuralEffects} from './effect-renderer.js';import {EffectTimeline} from './effects.js';
test('flash is a real independently fading mesh, not an unused profile value',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene),t=new EffectTimeline();
 t.add({id:'blast',epoch:1,tool:'charge',position:{x:2,y:3,z:4}});renderer.update(t.frames());
 const flash=scene.getObjectByName('explosion-flash') as THREE.Mesh;assert.ok(flash);assert.equal(flash.visible,true);assert.ok((flash.material as THREE.MeshBasicMaterial).opacity>0);
 t.step(.15);renderer.update(t.frames());assert.equal(flash.visible,false);assert.ok(scene.getObjectByName('explosion-fire')!.visible);renderer.dispose();assert.equal(scene.children.length,0);
});
test('cosmetic budget retires old instances without touching timeline authority',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene),t=new EffectTimeline();
 for(let i=0;i<60;i++){t.add({id:`blast${i}`,epoch:1,tool:'nova',position:{x:i,y:0,z:0}});renderer.update(t.frames());}
 assert.equal(t.frames().length,60);assert.equal(scene.children.length,48);renderer.dispose();
});
const at=(tool:'charge'|'nova'='nova',age=.6)=>{const timeline=new EffectTimeline();timeline.add({id:'visual',epoch:1,tool,position:{x:0,y:4,z:0}});timeline.step(age);return timeline.frames();};
function instancePosition(mesh:THREE.InstancedMesh,index=0){const matrix=new THREE.Matrix4();mesh.getMatrixAt(index,matrix);return new THREE.Vector3().setFromMatrixPosition(matrix);}
test('smoke uses many shaded instanced lobes, not six transparent coarse meshes',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene);renderer.update(at());
 const smoke=scene.getObjectByName('explosion-smoke') as THREE.InstancedMesh;assert.ok(smoke?.isInstancedMesh);assert.ok(smoke.count>=20);
 assert.equal((smoke.material as THREE.MeshLambertMaterial).transparent,false);assert.equal((smoke.material as THREE.MeshLambertMaterial).depthWrite,true);
 const locations=new Set(Array.from({length:smoke.count},(_,i)=>instancePosition(smoke,i).toArray().map(v=>v.toFixed(3)).join(',')));assert.ok(locations.size>=20);
 assert.equal(scene.getObjectByName('explosion-shockwave') instanceof THREE.InstancedMesh,true);
 renderer.dispose();
});
test('cosmetic fragments travel under drag and gravity using event age, not update count',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene);renderer.update(at('nova',.2));
 const fragments=scene.getObjectByName('explosion-fragments') as THREE.InstancedMesh;assert.ok(fragments?.isInstancedMesh);
 const a=instancePosition(fragments);renderer.update(at('nova',.6));const b=instancePosition(fragments);renderer.update(at('nova',1));const c=instancePosition(fragments);
 assert.ok(b.distanceTo(a)>.05);assert.ok(c.y-b.y<b.y-a.y,'gravity reduces the vertical increment');
 assert.ok(Math.hypot(c.x-b.x,c.z-b.z)<Math.hypot(b.x-a.x,b.z-a.z),'drag reduces horizontal speed');
 const frozen=Array.from(fragments.instanceMatrix.array);renderer.update(at('nova',1));assert.deepEqual(Array.from(fragments.instanceMatrix.array),frozen);
 renderer.dispose();
});
test('reduced motion suppresses bright flash and wave without deleting cosmetic smoke',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene,{reducedMotion:true});renderer.render(at('nova',.02));
 assert.equal(scene.getObjectByName('explosion-flash')!.visible,false);assert.equal(scene.getObjectByName('explosion-shockwave')!.visible,false);
 renderer.render(at('nova',.6));assert.equal(scene.getObjectByName('explosion-smoke')!.visible,true);renderer.clear();assert.equal(scene.children.length,0);renderer.dispose();
});
test('impact effects emit material-colored dust without fire, flash or shockwave',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene),timeline=new EffectTimeline();
 timeline.add({id:'stone',epoch:1,kind:'impact',material:'stone',intensity:.8,position:{x:0,y:2,z:0}});timeline.step(.2);renderer.render(timeline.frames());
 assert.equal(scene.getObjectByName('explosion-flash')!.visible,false);assert.equal(scene.getObjectByName('explosion-fire')!.visible,false);assert.equal(scene.getObjectByName('explosion-shockwave')!.visible,false);assert.equal(scene.getObjectByName('explosion-smoke')!.visible,true);renderer.dispose();
});
test('event identity includes epoch and all allocated resources dispose exactly once',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene);renderer.update(at());
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
 scene.traverse(object=>{if(object instanceof THREE.Mesh){geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);}});
 let geometryDisposals=0,materialDisposals=0;geometries.forEach(g=>g.addEventListener('dispose',()=>geometryDisposals++));materials.forEach(m=>m.addEventListener('dispose',()=>materialDisposals++));
 const previousRoot=scene.children[0];renderer.update(at().map(f=>({...f,epoch:2,position:{x:9,y:0,z:0}})));assert.notEqual(scene.children[0],previousRoot);assert.equal(scene.children[0].position.x,9);
 renderer.dispose();renderer.dispose();assert.equal(scene.children.length,0);assert.equal(geometryDisposals,geometries.size);assert.equal(materialDisposals,materials.size);
});
test('city blast radius is compressed into a bounded cosmetic footprint, not multiplied by nova spread',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene),timeline=new EffectTimeline();timeline.add({id:'city',epoch:1,tool:'nova',scale:48,position:{x:0,y:0,z:0}});timeline.step(.6);renderer.update(timeline.frames());
 const smoke=scene.getObjectByName('explosion-smoke') as THREE.InstancedMesh;
 for(let i=0;i<smoke.count;i++){const p=instancePosition(smoke,i);assert.ok(Math.abs(p.x)<12&&Math.abs(p.z)<12&&p.y<25,'cosmetics must not create a city-sized opaque sphere');}
 assert.equal(timeline.frames()[0].scale,48,'timeline preserves physical effect radius');renderer.dispose();
});
test('all eight tools produce distinct rendered silhouettes, not color-only variants',()=>{
 const tools=['charge','pulse','shock','echo','split','phase','heavy','nova'] as const,signatures=new Set<string>();
 for(const tool of tools){const scene=new THREE.Scene(),renderer=new StructuralEffects(scene),timeline=new EffectTimeline();timeline.add({id:'same',epoch:1,tool,scale:3,position:{x:0,y:0,z:0}});timeline.step(.25);renderer.update(timeline.frames());
  const smoke=scene.getObjectByName('explosion-smoke') as THREE.InstancedMesh;const positions=Array.from({length:smoke.count},(_,i)=>instancePosition(smoke,i));
  signatures.add([smoke.count,...['x','y','z'].map(axis=>Math.max(...positions.map(p=>p[axis as 'x'|'y'|'z'])).toFixed(3))].join(':'));renderer.dispose();}
 assert.equal(signatures.size,8);
});
test('shock front follows physical reach and is gone while nova smoke still rolls',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene),timeline=new EffectTimeline();timeline.add({id:'nova',epoch:1,tool:'nova',scale:48,position:{x:0,y:0,z:0}});timeline.step(.3);renderer.update(timeline.frames());
 const wave=scene.getObjectByName('explosion-shockwave') as THREE.InstancedMesh;assert.equal(wave.visible,true);const position=instancePosition(wave);assert.ok(Math.hypot(position.x,position.z)>30);
 timeline.step(.2);renderer.update(timeline.frames());assert.equal(wave.visible,false);assert.equal(scene.getObjectByName('explosion-smoke')!.visible,true);renderer.dispose();
});
test('runtime reduced-motion toggle suppresses flash and does not restart particle ages',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene),frames=at('nova',.02);renderer.update(frames);assert.equal(scene.getObjectByName('explosion-flash')!.visible,true);
 renderer.setReducedMotion(true);renderer.update(frames);assert.equal(scene.getObjectByName('explosion-flash')!.visible,false);assert.equal(frames[0].age,.02);renderer.dispose();
});
