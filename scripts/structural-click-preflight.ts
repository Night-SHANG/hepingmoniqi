import * as THREE from 'three';
import assert from 'node:assert/strict';
import {createStructuralFixture} from '../src/structural/fixtures.js';
import {createStructuralSimulation} from '../src/structural/simulation.js';
const fixture=createStructuralFixture('lab'),sim=await createStructuralSimulation(fixture,{maxActiveBodies:24});
const bounds=new THREE.Box3();fixture.cells.forEach(c=>bounds.expandByPoint(new THREE.Vector3(c.position.x,c.position.y,c.position.z)));
const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()).length();
const camera=new THREE.PerspectiveCamera(42,1440/900,.1,1000);camera.position.copy(center).add(new THREE.Vector3(size*.65,size*.55,size*.75));camera.lookAt(center);camera.updateMatrixWorld();
const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(.98,.98,.98),new THREE.MeshBasicMaterial(),fixture.cells.length),ray=new THREE.Raycaster(),matrix=new THREE.Matrix4();
function sync(){const views=sim.views();views.forEach((v,i)=>{matrix.compose(new THREE.Vector3(v.position.x,v.position.y,v.position.z),new THREE.Quaternion(v.rotation.x,v.rotation.y,v.rotation.z,v.rotation.w),new THREE.Vector3().setScalar(v.state==='gone'?0:1));mesh.setMatrixAt(i,matrix);});mesh.computeBoundingSphere();mesh.updateMatrixWorld();return views;}
const plan=[];let before=sim.views();
for(let shot=0;shot<6;shot++){
 const views=sync();const candidates=views.filter(v=>v.state==='static'&&(v.role==='foundation'||v.role==='terrain')&&v.position.y>=-1&&v.position.x>=-14&&v.position.x<=0&&v.position.z>=-9&&v.position.z<=3).sort((a,b)=>Math.hypot(a.position.x+8,a.position.z)-Math.hypot(b.position.x+8,b.position.z));
 let found=false;for(const v of candidates){const ndc=new THREE.Vector3(v.position.x,v.position.y,v.position.z).project(camera);ray.setFromCamera(new THREE.Vector2(ndc.x,ndc.y),camera);const hit=ray.intersectObject(mesh)[0];if(hit?.instanceId===undefined||views[hit.instanceId].id!==v.id)continue;
  const point={x:hit.point.x,y:hit.point.y,z:hit.point.z};sim.blast({id:`lab:${shot+1}`,epoch:sim.epoch,position:point,radius:5,damage:12,impulse:12});plan.push({id:v.id,point});found=true;break;
 }
 if(!found)break;
 const post=sim.views();console.log(JSON.stringify({shot:shot+1,hit:plan.at(-1),buildingDynamic:post.filter(v=>(v.role==='building'||v.role==='foundation')&&v.state==='dynamic').length,pending:sim.pending()}));
 if(post.some(v=>(v.role==='building'||v.role==='foundation')&&v.state==='dynamic')){before=post;break;}
}
let maxDrop=0,holeCross:any=null;
const topHoles=new Set(sim.views().filter(v=>v.role==='terrain'&&v.state==='gone'&&v.position.y===-1).map(v=>`${v.position.x},${v.position.z}`));
const initialById=new Map(before.map(v=>[v.id,v]));
for(let i=0;i<3600&&sim.pending()>0;i++){
 sim.step(1/120);if(i%12===0){for(const v of sim.views().filter(v=>v.role==='building'||v.role==='foundation')){const b=initialById.get(v.id)!;if(v.state!=='gone')maxDrop=Math.max(maxDrop,b.position.y-v.position.y);if(!holeCross&&v.state==='dynamic'&&v.position.y< -1.5&&topHoles.has(`${Math.round(v.position.x)},${Math.round(v.position.z)}`))holeCross={id:v.id,position:v.position};}}
}
const after=sim.views(),impacts=sim.events().filter(e=>e.kind==='impact');console.log(JSON.stringify({plan,maxDrop,holeCross,pending:sim.pending(),rubble:after.filter(v=>v.state==='rubble').length,impacts:impacts.slice(0,5),independentDamage:impacts.filter(e=>{const b=before.find(v=>v.id===e.targetId),a=after.find(v=>v.id===e.targetId);return b&&a&&a.hp<b.hp;}).length}));assert.deepEqual(plan.map(p=>p.id),[3716,3689,3712,3680]);assert.ok(maxDrop>.5&&holeCross);assert.equal(sim.pending(),0);assert.ok(impacts.some(e=>{const b=initialById.get(e.targetId!);return b&&after.find(v=>v.id===e.targetId)!.hp<b.hp;}));sim.dispose();

// A second explicitly labelled calibration fixture proves persistent landed rubble.
const {createContactFixture}=await import('../src/structural/contact-fixture.js');
const contact=createContactFixture(),landing=await createStructuralSimulation(contact,{maxActiveBodies:24});
try{
 const box=new THREE.Box3();contact.cells.forEach(c=>box.expandByPoint(new THREE.Vector3(c.position.x,c.position.y,c.position.z)));const c=box.getCenter(new THREE.Vector3()),d=box.getSize(new THREE.Vector3()).length();
 camera.position.copy(c).add(new THREE.Vector3(d*.65,d*.55,d*.75));camera.lookAt(c);camera.updateMatrixWorld();
 const m=new THREE.InstancedMesh(new THREE.BoxGeometry(.98,.98,.98),new THREE.MeshBasicMaterial(),contact.cells.length);
 contact.cells.forEach((v,i)=>{matrix.makeTranslation(v.position.x,v.position.y,v.position.z);m.setMatrixAt(i,matrix);});m.computeBoundingSphere();m.updateMatrixWorld();
 const ndc=new THREE.Vector3(0,0,0).project(camera);ray.setFromCamera(new THREE.Vector2(ndc.x,ndc.y),camera);const hit=ray.intersectObject(m)[0];assert.ok(hit&&contact.cells[hit.instanceId!].id===1,'Calibration cut must actually be visible');
 const point={x:hit.point.x,y:hit.point.y,z:hit.point.z};console.log(JSON.stringify({calibrationPointer:{x:(ndc.x+1)*720,y:(1-ndc.y)*450},point}));landing.blast({id:'real-ray-cut',epoch:landing.epoch,position:point,radius:.8,damage:100,impulse:0});const hpAfterCut=landing.views().find(v=>v.id===11)!.hp;
 for(let i=0;i<2400&&landing.pending();i++)landing.step(1/120);
 const settled=landing.views(),rp=landing.research();assert.equal(landing.pending(),0);assert.ok(settled.some(v=>v.role==='building'&&v.state==='rubble'));assert.ok(settled.find(v=>v.id===11)!.hp<hpAfterCut);
 for(let i=0;i<240;i++)landing.step(1/120);assert.deepEqual(landing.views(),settled);assert.equal(landing.research(),rp);
 console.log(JSON.stringify({calibration:{point,hpAfterCut,receiverHP:settled.find(v=>v.id===11)!.hp,rubble:settled.filter(v=>v.state==='rubble').map(v=>v.id),pending:landing.pending()}}));
}finally{landing.dispose();}
