import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
const width=1440,height=900;
const camera=new THREE.PerspectiveCamera(42,width/height,.2,250);
camera.position.set(27,23,32);camera.lookAt(0,4.5,0);camera.updateMatrixWorld();
const project=p=>{const v=new THREE.Vector3(p.x,p.y,p.z).project(camera);return {x:(v.x+1)*width/2,y:(1-v.y)*height/2,z:v.z};};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:process.env.QA_BROWSER_CHANNEL?{channel:process.env.QA_BROWSER_CHANNEL}:{}),headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width,height}}),evidence={},errors=[];
page.on('pageerror',e=>errors.push(String(e)));
await fs.mkdir('artifacts/weapon-visual',{recursive:true});
const read=()=>page.evaluate(()=>({snapshot:window.__heping.snapshot(),projectiles:window.__heping.projectiles(),detonations:window.__heping.lastDetonations(),target:window.__heping.target,weapon:window.__heping.weapon}));
async function capture(name){await page.screenshot({path:`artifacts/weapon-visual/${name}.png`});if(process.env.CI){let jpeg=await page.screenshot({type:'jpeg',quality:60});if(jpeg.length>=220000)jpeg=await page.screenshot({type:'jpeg',quality:35});if(jpeg.length<220000)console.log(`SCREENSHOT_BASE64 weapon-${name} ${jpeg.toString('base64')}`);}}
async function active(id){return page.locator(`#${id}`).evaluate(e=>e.classList.contains('active'));}
async function clean(){
 await page.locator('#reset').click();if(await active('pause'))await page.locator('#pause').click();if(await active('slow'))await page.locator('#slow').click();
 await page.locator('#camera').click();await page.waitForTimeout(400);assert.equal((await read()).projectiles.length,0);
}
async function aim(predicate){
 const state=await read();
 const candidates=state.snapshot.voxels.filter(predicate).map(v=>({v,p:project(v.position)})).sort((a,b)=>Math.hypot(a.p.x-width/2,a.p.y-height/2)-Math.hypot(b.p.x-width/2,b.p.y-height/2));
 let attempts=0;
 for(const {v,p} of candidates){
  if(attempts>=80)break;
  if(p.z< -1||p.z>1||p.x<250||p.x>width-180||p.y<180||p.y>height-180)continue;
  if(!await page.evaluate(({x,y})=>document.elementFromPoint(x,y)===document.querySelector('canvas'),p))continue;
  attempts++;await page.mouse.click(p.x,p.y);const current=await read();if(!current.target)continue;
  const picked=current.snapshot.voxels.reduce((best,x)=>!best||distance(x.position,current.target)<distance(best.position,current.target)?x:best,null);
  if(picked&&distance(picked.position,current.target)<1.1&&predicate(picked))return {voxel:picked,pointer:p,target:current.target};
 }
 throw new Error(`No visible target after ${attempts} real clicks`);
}
function checkFrame(body){const p=project(body.position);assert.ok(p.z>-1&&p.z<1&&p.x>40&&p.x<width-40&&p.y>100&&p.y<height-130,`Default camera body outside readable frame: ${JSON.stringify({body,p})}`);return p;}
async function flight(weapon,name){
 await clean();await page.locator(`[data-weapon="${weapon}"]`).click();const aimed=await aim(v=>v.group==='house'&&v.material==='roof'&&Math.abs(v.position.x)<=3&&Math.abs(v.position.z)<=4);
 await page.locator('#slow').click();const before=await read();await page.locator('#fire').click();
 const launched=await read();assert.equal(launched.snapshot.destroyedCount,before.snapshot.destroyedCount);const round=launched.projectiles[0];assert.ok(round&&round.weapon===weapon);
 await page.locator('#pause').click();const frozen=await read(),body=frozen.projectiles.find(p=>p.id===round.id);assert.ok(body,'Actual model still in flight');
 const screen=checkFrame(body);assert.ok(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)===document.querySelector('canvas'),screen),'Body center not hidden by interface');
 if(weapon==='charge'){assert.ok(body.rotation);assert.ok(body.fuseRemaining>0&&body.fuseRemaining<3);}else assert.ok(body.velocity&&Math.hypot(body.velocity.x,body.velocity.y,body.velocity.z)>0);
 evidence[name]={camera:'default reset view',aimed,body,screen};await capture(name);
}
try{
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:5191',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__heping?.physicsReady,null,{timeout:60000});
 await page.locator('#dismiss-intro').click();await page.locator('#settings').click();await page.locator('#sandbox').check();await page.locator('.done').click();
 await flight('charge','01-grenade-default');await flight('pulse','02-rocket-default');
 await clean();await page.locator('[data-weapon="shock"]').click();
 const aimed=await aim(v=>v.group==='house'&&v.position.z===5&&v.position.x>=4&&v.position.x<=6&&v.position.y>=3&&v.position.y<=5);
 await page.locator('#fire').click();let state=await read();const pack=state.projectiles.find(p=>p.state==='attached');assert.ok(pack);assert.ok(pack.normal.z>.99,'Package is on visible front wall, not roof/side');
 // Aim away through real pointer input so the crosshair does not conceal the package.
 await aim(v=>v.group==='house'&&v.material==='roof'&&distance(v.position,pack.position)>5);
 await page.locator('#pause').click();state=await read();assert.ok(state.projectiles.some(p=>p.id===pack.id));assert.ok(distance(state.target,pack.position)>5);
 const screen=checkFrame(pack);assert.ok(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)===document.querySelector('canvas'),screen),'Package center not behind UI');
 evidence['03-package-default']={camera:'default reset view',aimed,body:pack,screen,aimMovedTo:state.target};await capture('03-package-default');
 assert.deepEqual(errors,[]);evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=String(error);evidence.current=await read().catch(()=>null);await capture('failure').catch(()=>{});throw error;}
finally{evidence.errors=errors;await fs.writeFile('artifacts/weapon-visual/results.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));await browser.close();}
