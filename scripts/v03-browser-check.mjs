import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { tsImport } from 'tsx/esm/api';
const {createWorld}=await tsImport('../src/domain.ts',import.meta.url);
const {createProjectilePhysics}=await tsImport('../src/physics.ts',import.meta.url);
const WIDTH=1440,HEIGHT=900,MAX_SHOTS=60,MAX_CANDIDATES=18;
const camera=new THREE.PerspectiveCamera(42,WIDTH/HEIGHT,.2,250);
camera.position.set(27,23,32);camera.lookAt(0,4.5,0);camera.updateMatrixWorld();
const vec=p=>new THREE.Vector3(p.x,p.y,p.z);
const xyz=p=>({x:p.x,y:p.y,z:p.z});
function project(p){const n=vec(p).project(camera);return {x:(n.x+1)*WIDTH/2,y:(1-n.y)*HEIGHT/2,z:n.z};}
function origin(target){const d=vec(target).sub(camera.position).normalize(),distance=camera.position.distanceTo(vec(target)),f=Math.min(8,distance*.25),k=f/8;return xyz(camera.position.clone().addScaledVector(d,f).addScaledVector(new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),1.1*k).addScaledVector(new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion),-2*k));}
function candidates(snapshot){
 const geometry=new THREE.BoxGeometry(.965,.965,.965),material=new THREE.MeshBasicMaterial();
 const mesh=new THREE.InstancedMesh(geometry,material,snapshot.voxels.length),matrix=new THREE.Matrix4();
 snapshot.voxels.forEach((v,i)=>mesh.setMatrixAt(i,matrix.makeTranslation(v.position.x,v.position.y,v.position.z)));
 mesh.computeBoundingSphere();mesh.updateMatrixWorld();
 const ray=new THREE.Raycaster(),seen=new Set(),result=[];
 for(const voxel of snapshot.voxels){
  if(voxel.group!=='house')continue;
  const screen=project(voxel.position);
  if(screen.z< -1||screen.z>1||screen.x<330||screen.x>WIDTH-150||screen.y<190||screen.y>HEIGHT-170)continue;
  ray.setFromCamera(new THREE.Vector2(screen.x/WIDTH*2-1,1-screen.y/HEIGHT*2),camera);
  const hit=ray.intersectObject(mesh,false)[0];if(!hit||hit.instanceId===undefined)continue;
  const host=snapshot.voxels[hit.instanceId];if(host.group!=='house'||seen.has(host.id))continue;
  seen.add(host.id);
  const nearby=snapshot.voxels.filter(v=>v.group==='house'&&vec(v.position).distanceTo(hit.point)<4.8).length;
  result.push({screen,surface:{position:xyz(hit.point),normal:xyz(hit.face.normal),voxelId:host.id},heuristic:nearby+(host.position.y<=3?35:0)});
 }
 mesh.dispose();geometry.dispose();material.dispose();
 // Spatial diversity avoids evaluating eighteen nearly identical surfaces.
 const chosen=[];
 for(const c of result.sort((a,b)=>b.heuristic-a.heuristic))if(!chosen.some(p=>vec(p.surface.position).distanceTo(vec(c.surface.position))<2.3)){chosen.push(c);if(chosen.length>=MAX_CANDIDATES)break;}
 return chosen;
}
async function rankShots(snapshot,weapon){
 const plans=candidates(snapshot),physics=await createProjectilePhysics(),prediction=createWorld();
 try{
  physics.syncVoxels(snapshot.voxels,snapshot.epoch);
  for(let i=0;i<plans.length;i++){
   const plan=plans[i],epoch=snapshot.epoch+i+1;physics.syncVoxels(snapshot.voxels,epoch);
   let event;
   if(weapon==='shock'){
    assert.ok(physics.attach({id:`predict-${i}`,epoch,surface:plan.surface,power:1}));event=physics.detonateAttached()[0];
   }else{
    assert.ok(physics.launch({id:`predict-${i}`,epoch,origin:origin(plan.surface.position),target:plan.surface.position,weapon,power:1}));
    for(let step=0;step<1440&&!event;step++)event=physics.step(1/120)[0];
   }
   if(!event){plan.score=-1;continue;}
   assert.ok(prediction.restore(snapshot),'Read-only native prediction must restore authoritative snapshot');
   const before=prediction.getObjective().destroyed;
   const result=prediction.damage({id:`damage-${i}`,epoch:prediction.epoch,target:event.position,weapon,power:1});
   plan.expectedBuilding=prediction.getObjective().destroyed-before;plan.event=event;
   plan.score=plan.expectedBuilding*1000+result.removed.length+result.detached.length;
  }
  return plans.sort((a,b)=>b.score-a.score);
 }finally{physics.dispose();}
}
const chooseWeapon=s=>s.research>=90?'shock':s.research>=40?'pulse':'charge';
if(process.env.PREFLIGHT_ONLY){
 const world=createWorld(),report=[];
 for(const map of ['courtyard','warehouse']){
  if(map==='warehouse')assert.ok(world.loadMap(map));
  for(let i=0;i<MAX_SHOTS&&!world.getObjective().complete;i++){
   const snapshot=world.getSnapshot(),weapon=chooseWeapon(snapshot),plan=(await rankShots(snapshot,weapon))[0];
   assert.ok(plan?.score>0,`Native planner stalled: ${map} ${JSON.stringify(world.getObjective())}`);
   world.damage({id:`preflight-${map}-${i}`,epoch:world.epoch,target:plan.event.position,weapon,power:1});
   report.push({map,shot:i+1,weapon,building:world.getObjective().fraction,research:world.getSnapshot().research,target:plan.surface.position});
  }
  assert.ok(world.getObjective().complete,`${map} exceeded ${MAX_SHOTS} shot budget`);
 }
 console.log(JSON.stringify({status:'native-preflight-passed',report},null,2));
 process.exit(0);
}

const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:process.env.QA_BROWSER_CHANNEL?{channel:process.env.QA_BROWSER_CHANNEL}:{}),headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:WIDTH,height:HEIGHT}}),errors=[],evidence={shots:[]};
page.on('pageerror',e=>errors.push(String(e)));
await fs.mkdir('artifacts/v03-browser',{recursive:true});
const read=()=>page.evaluate(()=>({snapshot:window.__heping.snapshot(),objective:window.__heping.objective(),projectiles:window.__heping.projectiles(),detonations:window.__heping.lastDetonations(),target:window.__heping.target,weapon:window.__heping.weapon}));
const compact=s=>({objective:s.objective,research:s.snapshot.research,epoch:s.snapshot.epoch,projectiles:s.projectiles,detonations:s.detonations,target:s.target,weapon:s.weapon});
async function capture(name){await page.screenshot({path:`artifacts/v03-browser/${name}.png`});if(process.env.CI){const jpg=await page.screenshot({type:'jpeg',quality:35});if(jpg.length<220000)console.log(`SCREENSHOT_BASE64 v03-${name} ${jpg.toString('base64')}`);}}
async function waitEvent(id){try{await page.waitForFunction(id=>window.__heping.lastDetonations().some(e=>e.id===id),id,{timeout:60000});}catch(error){evidence.timeout={id,current:compact(await read()),controls:await page.evaluate(()=>({paused:document.querySelector('#pause').classList.contains('active'),slow:document.querySelector('#slow').classList.contains('active'),hidden:document.hidden}))};throw new Error(JSON.stringify(evidence.timeout)+String(error));}return (await read()).detonations.find(e=>e.id===id);}
async function clickPlan(plan){
 const {x,y}=plan.screen;
 if(!await page.evaluate(({x,y})=>document.elementFromPoint(x,y)===document.querySelector('canvas'),{x,y}))return false;
 await page.mouse.click(x,y);const s=await read();
 return s.target&&vec(s.target).distanceTo(vec(plan.surface.position))<.12;
}
async function aim(weapon){
 const state=await read(),plans=await rankShots(state.snapshot,weapon);
 for(const plan of plans)if(plan.score>0&&await clickPlan(plan))return plan;
 throw new Error(`No useful, exposed real-pointer target: ${JSON.stringify(compact(await read()))}`);
}
async function setSandbox(enabled){await page.locator('#settings').click();await page.locator('#sandbox').setChecked(enabled);await page.locator('.done').click();}
async function select(weapon){await page.locator(`[data-weapon="${weapon}"]`).click();assert.equal((await read()).weapon,weapon);}
async function fire(){const before=await read();await page.locator('#fire').click();const after=await read();assert.equal(after.snapshot.destroyedCount,before.snapshot.destroyedCount,'No immediate damage on launch/attach');const round=after.projectiles.find(p=>!before.projectiles.some(q=>q.id===p.id));assert.ok(round,'Real fire button creates projectile/package');return round;}
async function captureFlight(weapon,name){
 await select(weapon);await aim(weapon);await page.locator('#slow').click();
 const round=await fire();await page.locator('#pause').click();const frozen=await read(),body=frozen.projectiles.find(p=>p.id===round.id);assert.ok(body,'Body persists until visible paused capture');
 const screen=project(body.position);assert.ok(screen.x>50&&screen.x<WIDTH-50&&screen.y>110&&screen.y<HEIGHT-130,`Body center inside visible canvas: ${JSON.stringify(screen)}`);
 assert.ok(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)===document.querySelector('canvas'),screen),'Body center not under HUD');
 if(weapon==='charge'){assert.ok(body.fuseRemaining>0&&body.fuseRemaining<3);assert.ok(body.rotation);assert.ok(Math.abs(body.rotation.w-1)>.00001,'Grenade really spins');}
 else assert.ok(body.velocity&&Math.hypot(body.velocity.x,body.velocity.y,body.velocity.z)>0,'Rocket has physical orientation vector');
 evidence[name]=compact(frozen);await capture(name);await page.locator('#slow').click();await page.locator('#pause').click();const event=await waitEvent(round.id);assert.equal(event.reason,weapon==='charge'?'timer':'impact');return event;
}
async function completeMap(map){
 for(let i=0;i<MAX_SHOTS;i++){
  const state=await read();if(state.objective.complete)return;
  assert.equal(state.objective.mapId,map);const weapon=chooseWeapon(state.snapshot);await select(weapon);const plan=await aim(weapon);
  const round=await fire();if(weapon==='shock')await page.locator('#detonate').click();const event=await waitEvent(round.id);
  const after=await read();evidence.shots.push({map,shot:i+1,weapon,predictedBuilding:plan.expectedBuilding,actualBuilding:after.objective.destroyed-state.objective.destroyed,research:after.snapshot.research,event});
  console.log(`V03_PROGRESS ${JSON.stringify(evidence.shots.at(-1))}`);
 }
 assert.ok((await read()).objective.complete,`Exceeded ${MAX_SHOTS} real shots on ${map}`);
}
try{
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:5191',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__heping?.physicsReady);await page.locator('#dismiss-intro').click();
 const initial=await read();assert.equal(initial.weapon,'charge');assert.equal(initial.snapshot.research,0);assert.equal(initial.objective.mapId,'courtyard');
 assert.ok(await page.locator('#map-warehouse').isDisabled());
 await page.locator('[data-weapon="pulse"]').click();assert.equal((await read()).weapon,'charge','Rocket cannot bypass40RP unlock');
 await page.locator('[data-weapon="shock"]').click();assert.equal((await read()).weapon,'charge','Package cannot bypass90RP unlock');
 await setSandbox(true);
 await captureFlight('charge','01-grenade-spin-fuse');
 await captureFlight('pulse','02-rocket-oriented');
 await select('shock');await aim('shock');const packageBefore=await read(),pack=await fire();assert.equal(pack.state,'attached');assert.equal(pack.fuseRemaining,null);assert.ok(pack.normal&&Number.isSafeInteger(pack.hostVoxelId));
 await capture('03-package-attached');
 await page.waitForFunction(id=>window.__heping.projectiles().some(p=>p.id===id&&p.age>3.2),pack.id,{timeout:60000});
 const armed=await read();assert.ok(armed.projectiles.some(p=>p.id===pack.id));assert.equal(armed.snapshot.destroyedCount,packageBefore.snapshot.destroyedCount,'Package never auto-explodes after3seconds');
 await page.locator('#detonate').click();assert.equal((await waitEvent(pack.id)).reason,'remote');assert.ok((await read()).snapshot.destroyedCount>packageBefore.snapshot.destroyedCount,'Manual detonator causes actual damage');
 // Find exposed ground by real canvas clicks. A package must not attach there.
 let ground=false;
 for(let y=670;y>=430&&!ground;y-=40)for(let x=400;x<=1100&&!ground;x+=55){if(!await page.evaluate(({x,y})=>document.elementFromPoint(x,y)===document.querySelector('canvas'),{x,y}))continue;await page.mouse.click(x,y);const s=await read();ground=!!s.target&&Math.abs(s.target.y)<.001&&await page.locator('#fire').isDisabled();}
 assert.ok(ground,'Ground aim disables package placement');
 await setSandbox(false);const restored=await read();assert.equal(restored.snapshot.research,initial.snapshot.research);assert.deepEqual(restored.snapshot.voxels,initial.snapshot.voxels);assert.deepEqual(restored.objective.completedMaps,initial.objective.completedMaps);assert.equal(restored.projectiles.length,0);
 await completeMap('courtyard');await page.locator('#completion-dialog').waitFor({state:'visible'});const courtyard=await read();assert.ok(courtyard.objective.fraction>=.7);assert.ok(courtyard.objective.completedMaps.includes('courtyard'));assert.ok(courtyard.snapshot.voxels.some(v=>v.group==='tree'),'Yard cleanup is not required');await capture('04-courtyard-complete');
 await page.locator('#next-map').click();const warehouse=await read();assert.equal(warehouse.objective.mapId,'warehouse');assert.equal(warehouse.objective.destroyed,0);assert.ok(!await page.locator('#map-warehouse').isDisabled());await capture('05-warehouse-unlocked');
 await completeMap('warehouse');await page.locator('#completion-dialog').waitFor({state:'visible'});assert.ok(await page.locator('#next-map').isHidden());await page.locator('#retry-map').click();const retried=await read();assert.equal(retried.objective.mapId,'warehouse');assert.equal(retried.objective.destroyed,0);assert.ok(retried.objective.completedMaps.includes('warehouse'));assert.equal(retried.projectiles.length,0);
 await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.__heping?.physicsReady);const reloaded=await read();assert.equal(reloaded.objective.mapId,'warehouse');assert.deepEqual(reloaded.objective.completedMaps,retried.objective.completedMaps);assert.equal(reloaded.snapshot.research,retried.snapshot.research);assert.deepEqual(reloaded.snapshot.voxels,retried.snapshot.voxels);
 // The completion's free-play action keeps earned growth isolated as well.
 await page.locator('#dismiss-intro').click();await completeMap('warehouse');await page.locator('#continue-free').click();const freeBaseline=await read();assert.ok(await page.locator('#sandbox').isChecked());await select('shock');await aim('shock');const freePack=await fire();await page.locator('#detonate').click();await waitEvent(freePack.id);await setSandbox(false);const freeRestored=await read();assert.equal(freeRestored.snapshot.research,freeBaseline.snapshot.research);assert.deepEqual(freeRestored.snapshot.voxels,freeBaseline.snapshot.voxels);
 await page.setViewportSize({width:844,height:390});await page.locator('#settings').click();await page.locator('.done').click();await select('shock');await capture('06-mobile-controls');
 const mobile=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,controls:['settings','pause','reset','fire','detonate','map-courtyard','map-warehouse'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {id,reachable:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&(hit===e||e.contains(hit))};})}));assert.equal(mobile.overflow,false);assert.ok(mobile.controls.every(c=>c.reachable),JSON.stringify(mobile));
 assert.deepEqual(errors,[]);evidence.final=compact(await read());evidence.mobile=mobile;evidence.status='passed';
}catch(error){evidence.status='failed';evidence.failure=String(error);evidence.current=await read().then(compact).catch(()=>null);await capture('failure').catch(()=>{});throw error;}
finally{evidence.errors=errors;await fs.writeFile('artifacts/v03-browser/results.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));await browser.close();}
