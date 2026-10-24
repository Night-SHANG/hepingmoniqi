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
test('city smoke stays inside its physical blast footprint without becoming a fullscreen sphere',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene),timeline=new EffectTimeline();timeline.add({id:'city',epoch:1,tool:'nova',scale:48,position:{x:0,y:0,z:0}});timeline.step(.6);renderer.update(timeline.frames());
 const smoke=scene.getObjectByName('explosion-smoke') as THREE.InstancedMesh;
 for(let i=0;i<smoke.count;i++){const p=instancePosition(smoke,i);assert.ok(Math.abs(p.x)<48&&Math.abs(p.z)<48&&p.y<96,'cosmetics must not create a city-sized opaque sphere');}
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
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene),timeline=new EffectTimeline();timeline.add({id:'nova',epoch:1,tool:'nova',scale:48,position:{x:0,y:0,z:0}});timeline.step(.7);renderer.update(timeline.frames());
 const wave=scene.getObjectByName('explosion-shockwave') as THREE.InstancedMesh;assert.equal(wave.visible,true);assert.ok(Array.from({length:wave.count},(_,i)=>instancePosition(wave,i)).some(p=>Math.hypot(p.x,p.z)>30));
 timeline.step(.2);renderer.update(timeline.frames());assert.equal(wave.visible,false);assert.equal(scene.getObjectByName('explosion-smoke')!.visible,true);renderer.dispose();
});
test('runtime reduced-motion toggle suppresses flash and does not restart particle ages',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene),frames=at('nova',.02);renderer.update(frames);assert.equal(scene.getObjectByName('explosion-flash')!.visible,true);
 renderer.setReducedMotion(true);renderer.update(frames);assert.equal(scene.getObjectByName('explosion-flash')!.visible,false);assert.equal(frames[0].age,.02);renderer.dispose();
});
function projectedLayerSize(mesh:THREE.InstancedMesh):{width:number;height:number}{
 mesh.computeBoundingBox();const bounds=mesh.boundingBox!;const camera=new THREE.PerspectiveCamera(42,1440/900,.8,1600);camera.position.set(250,205,285);camera.lookAt(0,18,0);camera.updateMatrixWorld();
 const projected:THREE.Vector3[]=[];for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])projected.push(new THREE.Vector3(x,y,z).project(camera));
 return {width:(Math.max(...projected.map(p=>p.x))-Math.min(...projected.map(p=>p.x)))*720,height:(Math.max(...projected.map(p=>p.y))-Math.min(...projected.map(p=>p.y)))*450};
}
test('actual city camera sees a cross-building nova fireball at half a second and a legible smoke column at three seconds',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene),timeline=new EffectTimeline();timeline.add({id:'city',epoch:1,tool:'nova',scale:48,position:{x:0,y:0,z:0}});timeline.step(.5);renderer.render(timeline.frames());
 const fire=scene.getObjectByName('explosion-fire') as THREE.InstancedMesh,smoke=scene.getObjectByName('explosion-smoke') as THREE.InstancedMesh;
 assert.ok(projectedLayerSize(fire).width>=80,'the fireball must span multiple 12-unit city buildings, not one tiny lobe');
 assert.ok((smoke.material as THREE.MeshLambertMaterial).opacity<.6,'early opaque smoke must not swallow the fireball');
 timeline.step(2.5);renderer.render(timeline.frames());const size=projectedLayerSize(smoke);assert.ok(size.width>=100&&size.height>=100,'city-scale smoke must remain readable after the fire goes out');assert.ok(size.width<430&&size.height<430,'smoke cannot become a fullscreen opaque wash');renderer.dispose();
});
test('secondary impact saturation cannot evict the primary nova or its visible smoke aftermath',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene),timeline=new EffectTimeline();timeline.add({id:'primary',epoch:1,tool:'nova',scale:48,position:{x:0,y:0,z:0}});timeline.step(.5);
 for(let i=0;i<80;i++)timeline.add({id:`impact-${i}`,epoch:1,kind:'impact',material:'stone',scale:.4,position:{x:i,y:0,z:0}});
 renderer.render(timeline.frames());assert.ok(scene.getObjectByName('explosion:1:primary'),'a live primary must win over cosmetic contact dust');assert.equal(scene.children.length,48);
 timeline.step(1);renderer.render(timeline.frames());assert.ok(scene.getObjectByName('explosion:1:primary'));assert.equal(timeline.activeCount,81,'render prioritization must not mutate event authority');renderer.dispose();
});
test('city dust front remains low rolling sectors rather than rotating into vertical walls',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene),timeline=new EffectTimeline();timeline.add({id:'city',epoch:1,tool:'nova',scale:48,position:{x:0,y:0,z:0}});timeline.step(.5);renderer.render(timeline.frames());
 const wave=scene.getObjectByName('explosion-shockwave') as THREE.InstancedMesh;wave.computeBoundingBox();assert.ok(wave.boundingBox!.getSize(new THREE.Vector3()).y<8,'flattened dust must only rotate around its vertical axis');renderer.dispose();
});
