import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import * as THREE from 'three';
import {createCompactGameFixture} from '../src/compact/fixture';
import {createScaleRuntime} from '../src/scale-slice/runtime';
import {buildMaterialPatch} from '../src/material-slice/patch';
import {getEnvironmentSpec} from '../src/scene-environments';
import {getSceneLaunchOrigin} from '../src/scene';
import {TOOLS} from '../src/content-catalog';
import type {Vec3} from '../src/contracts';

// Native-only test of the real courtyard, real pulse, real rendered surface and
// real Rapier sphere. This neither imports nor launches a browser.
export async function preflightScaleInteraction(){
 const source=createCompactGameFixture('courtyard'),r=await createScaleRuntime(source);
 const spec=getEnvironmentSpec('courtyard',{authoritative:true}),camera=new THREE.PerspectiveCamera(42,1440/900,spec.camera.near,spec.camera.far);
 camera.position.set(...spec.camera.position);camera.lookAt(new THREE.Vector3(...spec.camera.target));camera.updateMatrixWorld();
 const original=source.original(-1383)!;assert.equal(original.role,'terrain');assert.equal(original.material,'soil');assert.equal(original.position.y,-1);
 const target={...original.position,y:original.position.y+.5},ndc=new THREE.Vector3(target.x,target.y,target.z).project(camera),pixel={x:(ndc.x+1)*720,y:(1-ndc.y)*450};
 assert.ok(pixel.x>330&&pixel.x<1100&&pixel.y>100&&pixel.y<750,'Soil target must be on the uncovered real canvas');
 const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(ndc.x,ndc.y),camera);
 const material=new THREE.MeshBasicMaterial();
 const raySurface=()=>{
  const meshes:THREE.Mesh[]=[];
  try{
   source.forEachChunk(32,(x,y,z)=>{
    const m=buildMaterialPatch(r.surface,`${x},${y},${z}`,32);if(!m.faces)return;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(m.position,3));if(m.index)geometry.setIndex(new THREE.BufferAttribute(m.index,1));
    const mesh=new THREE.Mesh(geometry,material);mesh.updateMatrixWorld();meshes.push(mesh);
   });
   const hit=ray.intersectObjects(meshes,false)[0];assert.ok(hit?.face,'Camera ray must intersect an actual generated terrain mesh');
   return {position:{x:hit.point.x,y:hit.point.y,z:hit.point.z},normal:{x:hit.face.normal.x,y:hit.face.normal.y,z:hit.face.normal.z}};
  }finally{for(const mesh of meshes)mesh.geometry.dispose();}
 };
 const dist=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
 try{
  const pristine=raySurface();assert.ok(dist(pristine.position,target)<.0001);assert.ok(pristine.normal.y>.99);
  const pulse=TOOLS.pulse;assert.equal(pulse.radius,3.5);assert.equal(pulse.strength,9);
  const forward=new THREE.Vector3().subVectors(new THREE.Vector3().copy(target),camera.position).normalize(),right=new THREE.Vector3().crossVectors(forward,camera.up).normalize();
  const actualOrigin=camera.position.clone().addScaledVector(forward,8).addScaledVector(right,1.1).add(new THREE.Vector3(0,-2,0));
  const origins={scaleSliceUI:{x:actualOrigin.x,y:actualOrigin.y,z:actualOrigin.z},sceneHelper:getSceneLaunchOrigin(camera,target)};
  const flights:Record<string,unknown>={};let crater:ReturnType<typeof raySurface>|null=null;
  for(const [name,origin]of Object.entries(origins)){
   if(name!=='scaleSliceUI')r.reset();
   const blast=r.blast({id:`${name}-placed-pulse`,epoch:r.model.epoch,sequence:1,position:target,radius:pulse.radius,damage:pulse.strength,impulse:Math.min(16,pulse.strength*.6)});
   assert.equal(blast.transaction.accepted,true);assert.ok(blast.transaction.changedRegionIds.length>0);assert.equal(r.model.cellHp(source.ordinal(original.id)),0,'The chosen top soil cell must actually be removed');
   const hole=raySurface();assert.ok(hole.position.y<target.y-.5,'Real rendered hole must expose a deeper surface');if(name==='scaleSliceUI')crater=hole;
   const craterAliveCells=r.model.stats().aliveCells;
   const time=Math.min(1.5,Math.max(.5,dist(target,origin)/30)),id=`${name}-flight`;
   r.dynamics.launchProjectile({id,position:origin,velocity:{x:(target.x-origin.x)/time,y:(target.y-origin.y)/time+9*time,z:(target.z-origin.z)/time},radius:.3});
   let hit:ReturnType<typeof r.dynamics.drainProjectileContacts>[number]|undefined,passedOldSurface=false,ticks=0;
   const samples:{tick:number;position:Vec3}[]=[];
   for(;ticks<600;ticks++){
    r.advance(1000/120);const projectile=r.dynamics.projectile(id);
    if(projectile&&projectile.position.y<target.y-.3)passedOldSurface=true;
    if(projectile&&ticks%12===0)samples.push({tick:ticks,position:projectile.position});
    hit=r.dynamics.drainProjectileContacts().find(event=>event.id===id);if(hit)break;
   }
   assert.ok(hit,'Real gravity projectile must hit surviving soil within five simulated seconds');
   assert.equal(r.model.region(hit.targetRegionId)?.role,'terrain');
   assert.ok(hit.position.y<target.y-.5,'Projectile must hit below the old selected surface, not explode at its frozen aim point');
   assert.ok(passedOldSurface,'Projectile must visibly travel below the removed top surface');
   assert.ok(dist(hit.position,target)>.5);assert.equal(r.dynamics.removeProjectile(id),true);
   const impact=r.blast({id:`${id}:impact`,epoch:r.model.epoch,sequence:2,position:hit.position,radius:pulse.radius,damage:pulse.strength,impulse:Math.min(16,pulse.strength*.6)});
   assert.equal(impact.transaction.accepted,true);assert.ok(impact.transaction.changedRegionIds.length>0);assert.ok(r.model.stats().aliveCells<craterAliveCells,'Impact must remove more real cells after the first crater');
   flights[name]={origin,time,ticks,hit,passedOldSurface,samples:samples.slice(-6),impactChangedRegions:impact.transaction.changedRegionIds.length,craterAliveCells,impactAliveCells:r.model.stats().aliveCells};
  }
  return {schema:'scale-interaction-native-preflight/v1',map:'courtyard',soilId:original.id,target,pixel,pristine,crater,pulse:{radius:pulse.radius,strength:pulse.strength},fixture:{cellCount:source.count,structureCount:source.structureCount,terrainCount:source.terrainCount},flights};
 }finally{material.dispose();r.dispose();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log('SCALE_INTERACTION_PREFLIGHT '+JSON.stringify(await preflightScaleInteraction()));
