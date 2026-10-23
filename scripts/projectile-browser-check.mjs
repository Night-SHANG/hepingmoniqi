import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';

// All gameplay actions below use visible controls or real canvas pointer input.
// __heping is read-only evidence. No test calls damage(), launch(), or step().
const browser = await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:process.env.QA_BROWSER_CHANNEL?{channel:process.env.QA_BROWSER_CHANNEL}:{}),headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];
page.on('pageerror', error=>errors.push(String(error)));
const evidence={};
await fs.mkdir('artifacts/projectile-regression',{recursive:true});
const read = () => page.evaluate(()=>({snapshot:window.__heping.snapshot(),projectiles:window.__heping.projectiles(),detonations:window.__heping.lastDetonations(),target:window.__heping.target,weapon:window.__heping.weapon}));
async function capture(name){
 await page.screenshot({path:`artifacts/projectile-regression/${name}.png`});
 if(process.env.CI && ['01-roof-in-flight','02-roof-hole','03-repeat-through-hole','06-paused-round','10-fence-damaged','failure'].includes(name)){
  const jpg=await page.screenshot({type:'jpeg',quality:35});
  if(jpg.length<220000)console.log(`SCREENSHOT_BASE64 projectile-${name} ${jpg.toString('base64')}`);
 }
}
const summary = s => ({destroyed:s.snapshot.destroyedCount,epoch:s.snapshot.epoch,projectiles:s.projectiles,detonations:s.detonations,target:s.target});
async function waitForShot(id,timeout=60000){
 try{
  await page.waitForFunction(id=>window.__heping.lastDetonations().some(d=>d.id===id),id,{timeout});
 }catch(error){
  const current=await read();
  const controls=await page.evaluate(()=>({paused:document.querySelector('#pause').classList.contains('active'),slow:document.querySelector('#slow').classList.contains('active'),hidden:document.hidden}));
  evidence.waitTimeout={id,timeout,current:summary(current),controls};
  throw new Error(`Detonation wait failed: ${JSON.stringify(evidence.waitTimeout)}; ${error}`);
 }
 return (await read()).detonations.find(d=>d.id===id);
}
async function aimAt(predicate){
 const state=await read();
 const rect=await page.locator('canvas').boundingBox();
 // Match the public reset-camera view, only to choose real pointer coordinates.
 const camera=new THREE.PerspectiveCamera(42,rect.width/rect.height,.2,250);
 camera.position.set(27,23,32);camera.lookAt(0,4.5,0);camera.updateMatrixWorld();
 const candidates=state.snapshot.voxels.filter(predicate).sort((a,b)=>b.position.z-a.position.z || b.position.y-a.position.y);
 for(const voxel of candidates){
  const p=new THREE.Vector3(voxel.position.x,voxel.position.y,voxel.position.z).project(camera);
  const x=rect.x+(p.x+1)*rect.width/2,y=rect.y+(1-p.y)*rect.height/2;
  if(p.z < -1 || p.z > 1 || x<rect.x || x>=rect.x+rect.width || y<rect.y || y>=rect.y+rect.height)continue;
  const canvasExposed=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)===document.querySelector('canvas'),{x,y});
  if(!canvasExposed)continue;
  await page.mouse.click(x,y);
  const picked=await read();
  if(!picked.target)continue;
  const nearest=picked.snapshot.voxels.reduce((best,v)=>{
   const distance=Math.hypot(v.position.x-picked.target.x,v.position.y-picked.target.y,v.position.z-picked.target.z);
   return !best||distance<best.distance?{v,distance}:best;
  },null);
  if(nearest&&nearest.distance<=1.1&&predicate(nearest.v))return {target:picked.target,voxel:nearest.v,pointer:{x,y}};
 }
 throw new Error('Could not aim at the requested live object through real canvas input');
}
async function launchVisible(name){
 // Real slow-motion control gives software-rendered CI enough interaction time
 // to pause the visible body without changing the game's physics or assertions.
 const wasSlow=await page.locator('#slow').evaluate(e=>e.classList.contains('active'));
 if(!wasSlow)await page.locator('#slow').click();
 const before=await read();
 await page.locator('#fire').click();
 const flying=await read();
 assert.equal(flying.snapshot.destroyedCount,before.snapshot.destroyedCount,'Fire must not apply instant remote damage');
 assert.equal(flying.projectiles.length,before.projectiles.length+1,'Fire must create an active round');
 const round=flying.projectiles.find(p=>!before.projectiles.some(q=>q.id===p.id));
 assert.ok(round,'New round must be independently observable');
 // Freeze through the actual pause control so slow screenshot rendering cannot
 // turn an in-flight evidence capture into an already-finished explosion.
 await page.locator('#pause').click();
 const frozen=await read();
 assert.ok(frozen.projectiles.some(p=>p.id===round.id),'Round must remain visible long enough to observe and pause');
 const frozenRound=frozen.projectiles.find(p=>p.id===round.id);
 const rect=await page.locator('canvas').boundingBox();
 const camera=new THREE.PerspectiveCamera(42,rect.width/rect.height,.2,250);
 camera.position.set(27,23,32);camera.lookAt(0,4.5,0);camera.updateMatrixWorld();
 const bodyCenter=new THREE.Vector3(frozenRound.position.x,frozenRound.position.y,frozenRound.position.z);
 const projected=bodyCenter.clone().project(camera);
 const viewCenter=bodyCenter.clone().applyMatrix4(camera.matrixWorldInverse);
 const radiusPixels=frozenRound.radius*rect.height/(2*Math.tan(THREE.MathUtils.degToRad(42/2))*(-viewCenter.z));
 const bodyScreen={x:rect.x+(projected.x+1)*rect.width/2,y:rect.y+(1-projected.y)*rect.height/2,radiusPixels,age:frozenRound.age};
 const margin=radiusPixels+8;
 assert.ok(projected.z>-1&&projected.z<1&&Number.isFinite(radiusPixels)&&radiusPixels>0,'Frozen projectile must be in front of the camera');
 assert.ok(bodyScreen.x>rect.x+margin&&bodyScreen.x<rect.x+rect.width-margin&&bodyScreen.y>rect.y+margin&&bodyScreen.y<rect.y+rect.height-margin,`Actual projectile body must fit comfortably inside canvas: ${JSON.stringify(bodyScreen)}`);
 const exposed=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)===document.querySelector('canvas'),bodyScreen);
 assert.ok(exposed,`Actual projectile center must not be hidden by UI: ${JSON.stringify(bodyScreen)}`);
 await capture(name);
 evidence[name]={...summary(frozen),bodyScreen};
 if(!wasSlow)await page.locator('#slow').click();
 await page.locator('#pause').click();
 return round;
}
try{
 await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5191',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__heping?.physicsReady && window.__heping?.projectiles && window.__heping?.lastDetonations);
 await page.locator('#dismiss-intro').click();
 await page.locator('#reset').click();
 await page.locator('#camera').click();
 await page.waitForTimeout(400);
 evidence.roofAim=await aimAt(v=>v.group==='house'&&v.material==='roof'&&Math.abs(v.position.x)<4&&Math.abs(v.position.z)<5);
 const first=await launchVisible('01-roof-in-flight');
 const firstImpact=await waitForShot(first.id);
 assert.equal(firstImpact.reason,'impact');
 assert.ok(firstImpact.age>0,'Impact must follow simulation travel');
 assert.ok((await read()).snapshot.destroyedCount>0,'Roof shot must actually remove live voxels');
 evidence.firstImpact=firstImpact;
 await capture('02-roof-hole');
 const second=await launchVisible('03-repeat-through-hole');
 const secondImpact=await waitForShot(second.id);
 evidence.secondImpact=secondImpact;
 assert.ok(secondImpact.position.y<firstImpact.position.y-.5,'Same aim must pass the removed roof instead of exploding at stale aim/collider');
 await capture('04-lower-impact');

 // Enter sandbox through the actual settings dialog to unlock the timed tool.
 await page.locator('#settings').click();await page.locator('#sandbox').check();await page.locator('.done').click();
 await page.locator('[data-weapon="charge"]').click();
 evidence.chargeAim=await aimAt(v=>v.group==='house'&&v.material==='roof'&&Math.abs(v.position.x)<4);
 const charge=await launchVisible('05-timed-in-flight');
 await page.locator('#pause').click();
 const paused=await read();
 await page.waitForTimeout(900);
 assert.deepEqual((await read()).projectiles,paused.projectiles,'Pause must freeze positions, age and fuse');
 assert.deepEqual((await read()).detonations,paused.detonations,'Pause cannot emit a delayed explosion');
 await capture('06-paused-round');
 await page.locator('#pause').click();
 const timed=await waitForShot(charge.id);
 assert.equal(timed.reason,'timer');
 assert.ok(timed.age>=2.95&&timed.age<=3.1,'Timed fuse must expire at three simulation seconds');
 evidence.timedImpact=timed;
 await capture('07-timed-detonation');

 // A reset while an armed round exists must discard it rather than merely hide it.
 const stale=await launchVisible('08-before-reset');
 await page.locator('#reset').click();
 const rebuilt=await read();
 assert.equal(rebuilt.projectiles.length,0);
 await page.waitForTimeout(3600);
 const later=await read();
 assert.equal(later.snapshot.destroyedCount,0,'Reset must prevent old fuse damage');
 assert.ok(!later.detonations.some(d=>d.id===stale.id),'Reset must not emit late detonation');
 evidence.reset=summary(later);

 await page.locator('[data-weapon="pulse"]').click();
 evidence.fenceAim=await aimAt(v=>v.group==='fence');
 const propBefore=await read();
 const fence=await launchVisible('09-fence-in-flight');
 await waitForShot(fence.id);
 const propAfter=await read();
 const surviving=new Set(propAfter.snapshot.voxels.map(v=>v.id));
 const removedProps=propBefore.snapshot.voxels.filter(v=>v.group==='fence'&&!surviving.has(v.id));
 assert.ok(removedProps.length>0,'Visible fence must participate in actual destructive world state');
 evidence.removedFenceIds=removedProps.map(v=>v.id);
 await capture('10-fence-damaged');
 assert.deepEqual(errors,[],'Browser must not emit uncaught errors');
 evidence.errors=errors;
 evidence.status='passed';
}catch(error){
 evidence.status='failed';evidence.failure=String(error);evidence.errors=errors;
 await capture('failure').catch(()=>{});
 throw error;
}finally{
 await fs.writeFile('artifacts/projectile-regression/results.json',JSON.stringify(evidence,null,2));
 await browser.close();
 console.log(JSON.stringify(evidence,null,2));
}
