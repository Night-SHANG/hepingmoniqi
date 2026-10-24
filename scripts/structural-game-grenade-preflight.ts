import * as THREE from 'three';
import assert from 'node:assert/strict';
import {previewGameVoxels} from '../src/structural/game-fixtures.js';
import {createStructuralGameWorld} from '../src/structural/game-world.js';
import {createProjectilePhysics} from '../src/physics.js';
import {getEnvironmentSpec} from '../src/scene-environments.js';
import {getSceneLaunchOrigin} from '../src/scene.js';
import {createVoxelInstanceRenderer} from '../src/voxel-renderer.js';
const vs=previewGameVoxels('courtyard'),spec=getEnvironmentSpec('courtyard',{authoritative:true}),camera=new THREE.PerspectiveCamera(42,1440/900,spec.camera.near,spec.camera.far);
camera.position.set(...spec.camera.position);camera.lookAt(new THREE.Vector3(...spec.camera.target));camera.updateMatrixWorld();
const renderer=createVoxelInstanceRenderer(new THREE.Scene(),new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());renderer.set(vs);renderer.mesh.updateMatrixWorld();const ray=new THREE.Raycaster();
function surface(id:number){const v=vs.find(v=>v.id===id)!;const ndc=new THREE.Vector3(v.position.x,v.position.y,v.position.z).project(camera),pixel={x:(ndc.x+1)*720,y:(1-ndc.y)*450};if(pixel.x<350||pixel.x>1100||pixel.y<150||pixel.y>740)return null;ray.setFromCamera(new THREE.Vector2(pixel.x/720-1,1-pixel.y/450),camera);const h=ray.intersectObject(renderer.mesh)[0];if(h?.instanceId===undefined||renderer.getVoxel(h.instanceId)?.id!==id)return null;return{id,pixel,position:{x:h.point.x,y:h.point.y,z:h.point.z},normal:h.face!.normal.clone()};}
const candidates=vs.filter(v=>v.group==='house'&&v.position.y<=3).sort((a,b)=>Math.abs(a.position.y-1)-Math.abs(b.position.y-1)||Math.hypot(a.position.x,a.position.z)-Math.hypot(b.position.x,b.position.z)).map(v=>surface(v.id)).filter(s=>s).slice(0,12);
const w=createStructuralGameWorld();let success;
try{for(const candidate of [surface(803),...candidates]){if(!candidate)continue;await w.startRound('courtyard',{charge:1,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0});let detonation;
const p=await createProjectilePhysics({host:w.physicsHost!,onDetonation:e=>{detonation=e;w.damage({id:e.id,epoch:e.epoch,weapon:e.weapon,power:e.power,target:e.position});}});
try{w.recordShot('charge');p.launch({id:'exact-surface',epoch:w.epoch,weapon:'charge',power:1,origin:getSceneLaunchOrigin(camera,candidate.position),target:candidate.position});for(let i=0;i<1800&&w.pending();i++)p.step(1/120);const result={candidate,detonation,research:w.getResearch(),pending:w.pending()};console.log(JSON.stringify(result));if(candidate.id!==803&&result.research>0&&result.pending===0){success=result;break;}}finally{p.dispose();}}
assert.ok(success,'A real projected surface must earn building research');console.log('PROVEN_TARGET '+JSON.stringify(success));}finally{w.suspend();renderer.dispose();}
