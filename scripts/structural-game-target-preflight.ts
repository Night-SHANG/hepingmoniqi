import * as THREE from 'three';
import assert from 'node:assert/strict';
import {previewGameVoxels} from '../src/structural/game-fixtures.js';
import {getEnvironmentSpec} from '../src/scene-environments.js';
import {createVoxelInstanceRenderer} from '../src/voxel-renderer.js';
for(const map of ['courtyard','neighborhood','city'] as const){
 const voxels=previewGameVoxels(map),spec=getEnvironmentSpec(map,{authoritative:true}),camera=new THREE.PerspectiveCamera(42,1440/900,spec.camera.near,spec.camera.far);
 camera.position.set(...spec.camera.position);camera.lookAt(new THREE.Vector3(...spec.camera.target));camera.updateMatrixWorld();
 const renderer=createVoxelInstanceRenderer(new THREE.Scene(),new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());renderer.set(voxels);renderer.mesh.updateMatrixWorld();const ray=new THREE.Raycaster();let target;
 for(let y=450;y<=700&&!target;y+=50)for(let x=550;x<=1000&&!target;x+=50){ray.setFromCamera(new THREE.Vector2(x/720-1,1-y/450),camera);const hit=ray.intersectObject(renderer.mesh)[0];if(hit?.instanceId===undefined)continue;const v=renderer.getVoxel(hit.instanceId);if(v?.role!=='terrain')continue;const projected=new THREE.Vector3(v.position.x,v.position.y,v.position.z).project(camera);ray.setFromCamera(new THREE.Vector2(projected.x,projected.y),camera);const exact=ray.intersectObject(renderer.mesh)[0];if(exact?.instanceId===undefined||renderer.getVoxel(exact.instanceId)?.id!==v.id)continue;target={id:v.id,position:v.position,pixel:{x:(projected.x+1)*720,y:(1-projected.y)*450}};}
 assert.ok(target,`Visible soil must exist in ${map}`);console.log(JSON.stringify({map,target,render:renderer.getDiagnostics()}));if(map==='courtyard'){const v=voxels.find(v=>v.id===360)!;const ndc=new THREE.Vector3(v.position.x,v.position.y,v.position.z).project(camera);ray.setFromCamera(new THREE.Vector2(ndc.x,ndc.y),camera);const hit=ray.intersectObject(renderer.mesh)[0];assert.equal(renderer.getVoxel(hit.instanceId!)?.id,360);console.log(JSON.stringify({map,building:{id:360,position:v.position,pixel:{x:(ndc.x+1)*720,y:(1-ndc.y)*450},surface:hit.point,normal:hit.face!.normal}}));}renderer.dispose();
}
