/** Read-only CPU-side diagnostic. No WebGL context, browser, simulation writes, or gameplay changes.
 * Run: node --import tsx scripts/profile-structural-vfx-native.mjs
 * Timings and projected AABBs are NOT GPU timings or measured pixel overdraw.
 */
import * as THREE from 'three';
import {createStructuralFixture} from '../src/structural/fixtures.ts';
import {EffectTimeline} from '../src/structural/effects.ts';
import {StructuralEffects} from '../src/structural/effect-renderer.ts';
const fixture=createStructuralFixture('lab');
const impactPosition={x:-7.517558138033756,y:11.245314161180527,z:-4.509999990463264};
const views=fixture.cells.map((v,i)=>({...v,position:{...v.position},rotation:{x:0,y:0,z:0,w:1},state:i<fixture.cells.length-4440?'gone':'static'}));
const scene=new THREE.Scene(),effects=new StructuralEffects(scene),timeline=new EffectTimeline();
timeline.add({id:'primary',epoch:1,tool:'nova',kind:'detonation',scale:5,position:impactPosition});timeline.step(.64581);
for(let i=0;i<6;i++)timeline.add({id:`impact:${i}`,epoch:1,tool:'nova',kind:'impact',scale:.4,position:{x:impactPosition.x+i*.2,y:impactPosition.y-.3,z:impactPosition.z}});
const frames=timeline.frames().map(f=>f.kind==='impact'?{...f,age:.2,flash:0,fire:0,ring:0,smoke:.8}:f);
const box=new THREE.BoxGeometry(.98,.98,.98),worldMaterial=new THREE.MeshLambertMaterial(),mesh=new THREE.InstancedMesh(box,worldMaterial,fixture.cells.length);
const matrix=new THREE.Matrix4(),scale=new THREE.Vector3(1,1,1),p=new THREE.Vector3(),q=new THREE.Quaternion();
function renderStateCpu(input){input.forEach((v,i)=>{p.set(v.position.x,v.position.y,v.position.z);q.set(v.rotation.x,v.rotation.y,v.rotation.z,v.rotation.w);matrix.compose(p,q,v.state==='gone'?new THREE.Vector3(0,0,0):scale);mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,new THREE.Color(v.color));});mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();}
function measure(name,fn,iterations=600){for(let i=0;i<100;i++)fn(i);const samples=[];for(let i=0;i<iterations;i++){const start=performance.now();fn(i);samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);return{name,iterations,meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p50Ms:samples[Math.floor(samples.length*.5)],p95Ms:samples[Math.floor(samples.length*.95)],maxMs:samples.at(-1)};}
const measures=[];
measures.push(measure('lab matrix/color uploads preparation + bounding sphere (without sim.views or GPU)',()=>renderStateCpu(views)));
measures.push(measure('lab full CellView cloning analogue + same upload preparation (not sim.views measurement)',()=>renderStateCpu(views.map(v=>({...v,position:{...v.position},rotation:{...v.rotation}})))));
try{effects.update(frames);}catch(error){console.error(JSON.stringify({scope:'CPU-only profile stopped at a production VFX exception, no browser or renderer context created',inputs:{fixtureCells:fixture.cells.length,primary:{tool:'nova',scale:5,age:.64581},impacts:{count:6,tool:'nova',scale:.4}},measures,failure:String(error),stack:error.stack},null,2));process.exitCode=1;effects.dispose();mesh.dispose();box.dispose();worldMaterial.dispose();process.exit(1);}
const materialIdentities=new Map(),geometryIds=new Set();let shaderLike=new Set();scene.traverse(o=>{if(o instanceof THREE.Mesh){materialIdentities.set(o.material.uuid,o.material.version);geometryIds.add(o.geometry.uuid);shaderLike.add(JSON.stringify({type:o.material.type,alphaHash:o.material.alphaHash,transparent:o.material.transparent,toneMapped:o.material.toneMapped,instancing:!!o.isInstancedMesh,instancingColor:!!o.instanceColor}));}});
measures.push(measure('7-event VFX repeated frozen-age update',()=>effects.update(frames)));
measures.push(measure('7-event VFX changing-age update',i=>effects.update(frames.map(f=>({...f,age:f.age+(i%40)*.001})))));
effects.update(frames);
let materialsStable=true;scene.traverse(o=>{if(o instanceof THREE.Mesh&&materialIdentities.get(o.material.uuid)!==o.material.version)materialsStable=false;});
const fixtureBounds=new THREE.Box3();fixture.cells.forEach(c=>fixtureBounds.expandByPoint(new THREE.Vector3(c.position.x,c.position.y,c.position.z)));const center=fixtureBounds.getCenter(new THREE.Vector3()),length=fixtureBounds.getSize(new THREE.Vector3()).length();
const camera=new THREE.PerspectiveCamera(42,1440/900,.1,1000);camera.position.copy(center).add(new THREE.Vector3(length*.65,length*.55,length*.75));camera.lookAt(center);camera.updateMatrixWorld();scene.updateMatrixWorld(true);
const instanceMatrix=new THREE.Matrix4(),worldMatrix=new THREE.Matrix4();let visibleDraws=0,visibleTriangles=0,allInstances=0,visibleInstances=0,projectedBoxArea=0;const layerBudget={};
scene.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const count=o.isInstancedMesh?o.count:1;allInstances+=count;if(!o.visible)return;visibleDraws++;visibleInstances+=count;const triangles=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*count;visibleTriangles+=triangles;layerBudget[o.name]??={draws:0,instances:0,triangles:0};layerBudget[o.name].draws++;layerBudget[o.name].instances+=count;layerBudget[o.name].triangles+=triangles;
 o.geometry.computeBoundingBox();const b=o.geometry.boundingBox;
 for(let i=0;i<count;i++){if(o.isInstancedMesh){o.getMatrixAt(i,instanceMatrix);worldMatrix.multiplyMatrices(o.matrixWorld,instanceMatrix);}else worldMatrix.copy(o.matrixWorld);const points=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])points.push(new THREE.Vector3(x,y,z).applyMatrix4(worldMatrix).project(camera));const minX=Math.max(-1,Math.min(...points.map(p=>p.x))),maxX=Math.min(1,Math.max(...points.map(p=>p.x))),minY=Math.max(-1,Math.min(...points.map(p=>p.y))),maxY=Math.min(1,Math.max(...points.map(p=>p.y)));projectedBoxArea+=Math.max(0,maxX-minX)*720*Math.max(0,maxY-minY)*450;}
});
let disposedMaterials=0;scene.traverse(o=>{if(o instanceof THREE.Mesh)o.material.addEventListener('dispose',()=>disposedMaterials++);});effects.clear();
const report={scope:'Native CPU-only: mirrors lab render preparation and real VFX class. Not browser/driver/GPU timing. Impact ages/positions are labelled approximations around actual CI detonation.',inputs:{totalInstanceSlots:fixture.cells.length,visibleCells:views.filter(v=>v.state!=='gone').length,primaryAge:.64581,scale:5,impactCount:6,impactAgeAssumed:.2,impactPosition},measures,resources:{events:frames.length,materials:materialIdentities.size,geometries:geometryIds.size,shaderFeatureSignatures:shaderLike.size,materialIdentityAndVersionStableAcross1400Updates:materialsStable,materialsDisposedOnClear:disposedMaterials},renderBudget:{visibleDraws,visibleTriangles,allInstances,visibleInstances,worldDraws:1,worldTrianglesIncludingZeroScaleSlots:fixture.cells.length*12,layerBudget,projectedAabbAreaPixels:Math.round(projectedBoxArea),projectedAabbAreaPerViewport:projectedBoxArea/(1440*900),caveat:'AABB sum is only a conservative coverage proxy, not actual fragment count or measured overdraw.'}};
console.log(JSON.stringify(report,null,2));effects.dispose();mesh.dispose();box.dispose();worldMaterial.dispose();
