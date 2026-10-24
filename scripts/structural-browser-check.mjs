import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:process.env.QA_BROWSER_CHANNEL?{channel:process.env.QA_BROWSER_CHANNEL}:{}),headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900}}),evidence={clicks:[]},errors=[];
page.on('pageerror',e=>errors.push(String(e)));
await fs.mkdir('artifacts/structural-browser',{recursive:true});
const read=()=>page.evaluate(()=>({views:window.__structural.views(),events:window.__structural.events(),pending:window.__structural.pending(),epoch:window.__structural.epoch(),tick:window.__structural.tick(),elapsed:window.__structural.elapsed(),research:window.__structural.research()}));
const brief=s=>({epoch:s.epoch,pending:s.pending,states:s.views.reduce((a,v)=>(a[v.state]=(a[v.state]??0)+1,a),{}),events:s.events.slice(-12)});
async function capture(name){await page.screenshot({path:`artifacts/structural-browser/${name}.png`});if(process.env.CI){let jpg=await page.screenshot({type:'jpeg',quality:60});if(jpg.length>=220000)jpg=await page.screenshot({type:'jpeg',quality:35});if(jpg.length<220000)console.log(`SCREENSHOT_BASE64 structural-${name} ${jpg.toString('base64')}`);}}
async function clickCell(cell){const p=await page.evaluate(id=>window.__structural.project(id),cell.id);if(!p?.visible||!await page.evaluate(p=>document.elementFromPoint(p.x,p.y)===document.querySelector('#world'),p))return false;await page.mouse.click(p.x,p.y);evidence.clicks.push({id:cell.id,role:cell.role,objectId:cell.objectId,position:cell.position,pointer:p});return true;}
try{
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:5191/structural-lab.html',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__structural?.project,null,{timeout:60000});const initial=await read();assert.ok(initial.views.length>100);assert.equal(initial.pending,0,'Intact authored fixture must start supported');await capture('01-intact-lab');
 // This isolated lab uses canvas blasts. Selecting a profile is NOT an eight-weapon gameplay test.
 await page.locator('#tool').selectOption('heavy');
 // Native preflight proves this exposed soil face at approximately (632,581),
 // outside the HUD. Keep live ray-hit/DOM checks instead of trusting a screen coordinate.
 const soil=initial.views.find(v=>v.id===3037);assert.ok(soil&&soil.role==='terrain'&&soil.position.y===-1);
 assert.ok(await clickCell(soil),'Preflight soil 3037 must be visibly clickable through the real canvas');
 await page.waitForFunction(()=>window.__structural.views().some(v=>v.role==='terrain'&&v.state==='gone'),null,{timeout:15000});await page.locator('#pause').click();const dug=await read();assert.ok(dug.views.some(v=>v.role==='terrain'&&v.state==='gone'));await capture('02-real-terrain-cut');
 await page.locator('#save').click();const saved=await read();await page.locator('#reset').click();const reset=await read();assert.ok(reset.epoch>saved.epoch);assert.equal(reset.pending,0);assert.ok(reset.views.every(v=>v.state==='static'));
 await page.locator('#load').click();const loaded=await read();assert.ok(loaded.epoch>reset.epoch);assert.deepEqual(loaded.views,saved.views,'Snapshot restores exact authority, not merely a crater picture');
 // Paused motion/effects must not cause delayed terrain or collider state changes.
 await page.waitForTimeout(500);assert.deepEqual((await read()).views,loaded.views);await capture('03-restored-cut');
 await page.locator('#reset').click();await page.locator('#pause').click();await page.locator('#slow').check();await page.locator('#tool').selectOption('nova');
 // Native Three raycast preflight proves this fixed visible foundation route.
 // No target search/repeated blind blasts: unexpected geometry is a failure.
 for(const id of [3716,3689,3712,3680]){
  const state=await read(),cell=state.views.find(v=>v.id===id);assert.ok(cell&&cell.state==='static'&&cell.role==='foundation',`Expected foundation ${id}`);
  assert.ok(await clickCell(cell),`Preflight foundation ${id} must remain visible`);
  await page.waitForFunction(n=>window.__structural.events().filter(e=>e.kind==='detonation').length>=n,evidence.clicks.length-1,{timeout:15000});
 }
 await page.locator('#pause').click();const released=await read();
 const falling=released.views.filter(v=>(v.role==='building'||v.role==='foundation')&&v.state==='dynamic');assert.ok(falling.length>0,'A building must release, not just soil');
 assert.ok(released.views.some(v=>v.role==='terrain'&&v.state==='gone'));await capture('04-building-released');
 const baseline=Object.fromEntries(released.views.map(v=>[v.id,{hp:v.hp,position:v.position,state:v.state,role:v.role}]));
 await page.locator('#pause').click();
 // Capture actual simulated movement, not merely the detach event. Monitor at each rendered frame.
 await page.waitForFunction(base=>window.__structural.views().some(v=>(v.role==='building'||v.role==='foundation')&&v.state==='dynamic'&&base[v.id].position.y-v.position.y>.5),baseline,{timeout:180000});
 await page.locator('#pause').click();const moving=await read();await capture('05-building-falling');
 await page.locator('#pause').click();
 await page.waitForFunction(()=>{const vs=window.__structural.views(),holes=new Set(vs.filter(t=>t.role==='terrain'&&t.state==='gone'&&t.position.y===-1).map(t=>`${t.position.x},${t.position.z}`));return vs.some(v=>(v.role==='building'||v.role==='foundation')&&v.state==='dynamic'&&v.position.y< -1.5&&holes.has(`${Math.round(v.position.x)},${Math.round(v.position.z)}`));},null,{timeout:180000});
 await page.locator('#pause').click();const crossed=await read();await capture('06-building-through-real-hole');
 await page.locator('#slow').uncheck();await page.locator('#pause').click();await page.waitForFunction(()=>window.__structural.pending()===0,null,{timeout:180000});
 const settled=await read();const secondary=settled.events.filter(e=>e.kind==='impact'&&baseline[e.targetId]?.hp>settled.views.find(v=>v.id===e.targetId)?.hp);
 assert.ok(secondary.length>0,'Collision events must match independent HP loss after the final direct blast');
 const elapsed=settled.elapsed;await page.waitForFunction(t=>window.__structural.elapsed()>=t+2,elapsed,{timeout:60000});const quiet=await read();
 assert.deepEqual(quiet.views,settled.views,'Settled world cannot move or lose HP without new input');assert.equal(quiet.research,settled.research,'No resting reward farming');
 evidence.motion={moving:brief(moving),crossed:brief(crossed),settled:brief(settled),secondary};
 evidence.rubbleCoverage={count:settled.views.filter(v=>v.state==='rubble').length,scope:'Warm preflight exits finite terrain; persistent rubble requires separate landing fixture'};
 await capture('07-settled-warm-world');
 await page.locator('#reset').click();const resetElapsed=(await read()).elapsed;await page.waitForFunction(t=>window.__structural.elapsed()>=t+1,resetElapsed,{timeout:60000});const final=await read();assert.equal(final.pending,0);assert.ok(final.views.every(v=>v.state==='static'));assert.deepEqual(errors,[]);
 // Independent diagnostic landing fixture, explicitly not the warm playable map.
 const contactUrl=new URL(process.env.GAME_URL||'http://127.0.0.1:5191/structural-lab.html');contactUrl.searchParams.set('fixture','rubble');
 await page.goto(contactUrl.href,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__structural?.tick,null,{timeout:60000});
 assert.ok(await page.locator('#calibration').isVisible());assert.ok(await page.locator('#precise').isChecked());await page.locator('#slow').check();
 const contactInitial=await read();assert.equal(contactInitial.pending,0);const support=contactInitial.views.find(v=>v.id===1);assert.ok(support);assert.ok(await clickCell(support),'Diagnostic soil bridge must be genuinely visible');
 await page.waitForFunction(()=>window.__structural.views().find(v=>v.id===1)?.state==='gone',null,{timeout:15000});await page.locator('#pause').click();
 const contactCut=await read(),receiverBefore=contactCut.views.find(v=>v.id===11);assert.ok(receiverBefore&&receiverBefore.hp===30,'Cut probe must not directly damage receiver');
 assert.ok(contactCut.views.some(v=>[2,3,4].includes(v.id)&&v.state==='dynamic'));await capture('08-calibration-cut');
 await page.locator('#slow').uncheck();await page.locator('#pause').click();await page.waitForFunction(()=>window.__structural.pending()===0,null,{timeout:180000});
 const landed=await read();assert.ok(landed.views.some(v=>[2,3,4].includes(v.id)&&v.state==='rubble'),'Actual building remnants must survive at rest');
 assert.ok(landed.events.some(e=>e.kind==='impact'&&e.targetId===11));assert.ok(landed.views.find(v=>v.id===11).hp<receiverBefore.hp,'Separate receiver loses HP only after physical contact');
 const landedElapsed=landed.elapsed;await page.waitForFunction(t=>window.__structural.elapsed()>=t+2,landedElapsed,{timeout:60000});const persistent=await read();
 assert.deepEqual(persistent.views,landed.views);assert.equal(persistent.research,landed.research);assert.equal(persistent.pending,0);await capture('09-persistent-building-rubble');
 await page.locator('#pause').click();await page.locator('#save').click();await page.locator('#reset').click();await page.locator('#load').click();const restoredRubble=await read();assert.deepEqual(restoredRubble.views,persistent.views);assert.equal(restoredRubble.research,persistent.research);
 evidence.calibration={initial:brief(contactInitial),cut:brief(contactCut),landed:brief(landed),restored:brief(restoredRubble)};assert.deepEqual(errors,[]);
 evidence.initial=brief(initial);evidence.dug=brief(dug);evidence.released=brief(released);evidence.final=brief(final);evidence.status='passed';
}catch(error){evidence.status='failed';evidence.failure=String(error);evidence.current=await read().then(brief).catch(()=>null);await capture('failure').catch(()=>{});throw error;}
finally{evidence.errors=errors;await fs.writeFile('artifacts/structural-browser/results.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));await browser.close();}
