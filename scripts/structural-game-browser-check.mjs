import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
import {createSchema7Fixture} from './v08-qa-fixtures.mjs';
// Synthetic migration/unlock fixture only; no fabricated gameplay damage or hidden runtime writes.
assert.equal(process.env.GITHUB_ACTIONS,'true','Run only on the authorized CI browser');
assert.equal(process.env.QA_BROWSER_CHANNEL,'chrome');
const qaScope=process.env.QA_SCOPE??'full';assert.ok(['full','city-effects'].includes(qaScope));const cityEffectsOnly=qaScope==='city-effects';
const {createWorld}=await tsImport('../src/domain.ts',import.meta.url),save=createSchema7Fixture(createWorld);
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl']});
const context=await browser.newContext({viewport:{width:1440,height:900}});
await context.addInitScript(save=>{if(!sessionStorage.getItem('structural-game-qa')){localStorage.setItem('hepingmoniqi.first-playable.v1',JSON.stringify(save));sessionStorage.setItem('structural-game-qa','labelled-schema7-unlock-fixture');}},save);
const page=await context.newPage();page.setDefaultTimeout(30000);
const output='artifacts/structural-game-browser',evidence={scope:'Formal UI smoke on three maps; synthetic legacy unlock fixture, not organic progression',qaScope,maps:[],memory:[],errors:[]};await fs.mkdir(output,{recursive:true});
const cdp=await context.newCDPSession(page);
page.on('pageerror',e=>evidence.errors.push(String(e)));
const read=()=>page.evaluate(()=>{const h=window.__heping,vs=h.voxels(),snapshot=h.snapshot(),bounds={courtyard:[27,22],neighborhood:[52,42],city:[122,102]}[snapshot.mapId]??[27,22],width=2*bounds[0]+1,masks=new Uint8Array(width*(2*bounds[1]+1));let hp=0,soilHP=0,soilMinY=Infinity,soilCount=0,hash=2166136261;const states={};
 for(const v of vs){hp+=v.hp;if(v.role==='terrain'){soilHP+=v.hp;soilCount++;soilMinY=Math.min(soilMinY,v.position.y);const {x,y,z}=v.position;if(Number.isInteger(x)&&Number.isInteger(y)&&Number.isInteger(z)&&Math.abs(x)<=bounds[0]&&Math.abs(z)<=bounds[1]&&y>=-8&&y<=-1)masks[(z+bounds[1])*width+x+bounds[0]]|=1<<(-y-1);}states[v.structuralState]=(states[v.structuralState]??0)+1;for(const n of [v.id,v.hp,v.position.x,v.position.y,v.position.z,v.rotation?.x??0,v.rotation?.y??0,v.rotation?.z??0,v.rotation?.w??1]){hash=Math.imul(hash^Math.round(n*100000),16777619)>>>0;}}
 const coverage={expectedColumns:masks.length,missingTop:Array.from(masks).filter(m=>!(m&1)).length,incompleteColumns:Array.from(masks).filter(m=>m!==255).length};return{screen:h.screen,mode:h.mode,ready:h.physicsReady,snapshot:{mapId:snapshot.mapId,epoch:snapshot.epoch,research:snapshot.research},geometry:{count:vs.length,hp,soilHP,soilMinY,soilCount,coverage,hash,states},main:h.mainSnapshot(),round:h.round(),projectiles:h.projectiles(),events:h.lastDetonations(),pending:h.pendingWork(),surface:h.aimSurface(),flow:h.flow,activeEffects:h.activeEffects,lastFinishEvidence:h.lastFinishEvidence};});

const wait=(fn,arg,timeout=180000)=>page.waitForFunction(fn,arg,{timeout});
async function capture(name){await page.screenshot({path:`${output}/${name}.png`});let bytes=await page.screenshot({type:'jpeg',quality:60});if(bytes.length>220000)bytes=await page.screenshot({type:'jpeg',quality:35});if(bytes.length<220000)console.log(`SCREENSHOT_BASE64 structural-game-${name} ${bytes.toString('base64')}`);}
async function lifecycle(expected){await wait(n=>window.__heping.physicsLifecycle().activeWorlds===n&&!window.__heping.physicsLifecycle().transitioning,expected);const value=await page.evaluate(()=>window.__heping.physicsLifecycle());assert.equal(value.projectileBound,expected===1);return value;}
async function memory(stage,forcedGC=false){if(forcedGC)await cdp.send('HeapProfiler.collectGarbage');const heap=await cdp.send('Runtime.getHeapUsage');assert.ok(Number.isFinite(heap.usedSize));evidence.memory.push({stage,forcedGC,heap,lifecycle:await page.evaluate(()=>window.__heping.physicsLifecycle()),note:'Browser heap metrics, not GPU memory or a normal-FPS benchmark'});}
async function saved(){await wait(()=>!window.__heping.saveStatus().pending);const status=await page.evaluate(()=>window.__heping.saveStatus());assert.equal(status.error,null);assert.equal(status.readFailed,false);return status;}
async function tools(ids){for(const id of ['charge','pulse','shock','echo','split','phase','heavy','nova']){const b=page.locator(`[data-free-tool="${id}"]`),selected=await b.getAttribute('aria-pressed')==='true';if(selected!==ids.includes(id)){await b.scrollIntoViewIfNeeded();await b.click();}}}
async function aimSoil(map){
 const ids={courtyard:-1383,neighborhood:-4264,city:-4649},v=await page.evaluate(id=>window.__heping.voxels().find(v=>v.id===id),ids[map]);assert.ok(v?.role==='terrain','Native-proven soil ID must exist');
 const p=await page.evaluate(point=>window.__heping.project(point),{...v.position,y:v.position.y+.5});assert.ok(p.visible);assert.ok(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS',p),'Target must not be covered by UI');
 await page.mouse.click(p.x,p.y);const surface=(await read()).surface;assert.equal(surface?.voxelId,v.id,'Actual top-face ray hit must match native preflight');assert.ok(surface.normal.y>.99&&Math.abs(surface.position.x-v.position.x)<.1&&Math.abs(surface.position.z-v.position.z)<.1,'Aim must hit inside the soil top face, not a shared-cell boundary');return v;
}

try{
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:5191/',{waitUntil:'networkidle'});await wait(()=>window.__heping?.physicsReady);
 await lifecycle(0);await memory('initial-home');assert.equal((await read()).main.research,1400);const oldStored=await page.evaluate(()=>localStorage.getItem('hepingmoniqi.first-playable.v1'));
 if(!cityEffectsOnly){
 // One genuine main round proves inventory, active-End waiting, retry and persistence.
 await page.locator('#mode-main').click();await wait(()=>window.__heping.screen==='setup');await lifecycle(0);
 await page.locator('[data-scene="courtyard"]').click();
 for(const id of ['charge','pulse','shock','echo','split','phase','heavy','nova']){const desired=id==='charge'?2:0;let count=Number(await page.locator(`#loadout-${id}`).innerText());let budget=12;while(count!==desired&&budget-->0){const delta=count>desired?'-1':'1',button=page.locator(`[data-adjust="${id}"][data-delta="${delta}"]`);await button.scrollIntoViewIfNeeded();await button.click();count=Number(await page.locator(`#loadout-${id}`).innerText());}assert.equal(count,desired);}
 await page.locator('#start-experiment').click();await wait(()=>window.__heping.screen==='playing'&&window.__heping.physicsReady);
 await lifecycle(1);const mainStart=await read(),building=await page.evaluate(()=>window.__heping.voxels().find(v=>v.id===360));assert.ok(building?.group==='house');const buildingPixel=await page.evaluate(p=>window.__heping.project(p),building.position);assert.ok(buildingPixel.visible);assert.ok(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS',buildingPixel));await page.mouse.click(buildingPixel.x,buildingPixel.y);assert.equal((await read()).surface?.voxelId,360);
 await page.locator('#slow').click();await page.locator('#fire').click();const mainFlying=await read();assert.equal(mainFlying.round.remaining.charge,mainStart.round.remaining.charge-1);assert.equal(mainFlying.round.used,mainStart.round.used+1);assert.ok(mainFlying.projectiles.length>0);assert.deepEqual(mainFlying.geometry,mainStart.geometry);
 await page.locator('#finish-round').click();const ending=await read();assert.equal(ending.flow,'ending');assert.notEqual(ending.screen,'results');assert.ok(ending.pending>0);await capture('main-active-end-waits');
 await wait(()=>window.__heping.screen==='results');const mainResult=await read();assert.equal(mainResult.pending,0);assert.equal(mainResult.activeEffects,false);assert.ok(mainResult.main.research>mainStart.main.research,'Actual building grenade earns research');await capture('main-real-results');
 await saved();const stored=await page.evaluate(()=>localStorage.getItem('hepingmoniqi.structural.v09'));assert.ok(stored);const envelope=JSON.parse(stored);assert.ok(Number.isFinite(envelope.savedAt));if(envelope.snapshot)assert.equal(envelope.snapshot.schemaVersion,9);else assert.equal(envelope.storage,'indexeddb');assert.ok(stored.length*2<4500000,'Real main save must fit the persistence budget');
 await page.locator('#retry-map').click();await wait(()=>window.__heping.screen==='playing'&&window.__heping.physicsReady);const retry=await read();assert.equal(retry.round.used,0);assert.deepEqual(retry.round.remaining,mainStart.round.remaining);assert.equal(retry.pending,0);assert.deepEqual(retry.geometry,mainStart.geometry);
 await page.locator('#finish-round').click();await wait(()=>window.__heping.screen==='results');await page.locator('#result-home').click();await wait(()=>window.__heping.screen==='home');const persistedResearch=(await read()).main.research;
 await saved();await lifecycle(0);await page.reload({waitUntil:'networkidle'});await wait(()=>window.__heping?.physicsReady);assert.equal((await read()).main.research,persistedResearch);
 evidence.main={inventoryBefore:mainStart.round.remaining,inventoryAfter:mainFlying.round.remaining,ending:{flow:ending.flow,pending:ending.pending},researchBefore:mainStart.main.research,researchAfter:mainResult.main.research,saveBytes:stored.length*2};
 }
 for(const map of (cityEffectsOnly?['city']:['courtyard','neighborhood','city'])){
  await page.locator('#mode-free').click();await wait(()=>window.__heping.screen==='setup');const b=page.locator(`[data-scene="${map}"]`);await b.scrollIntoViewIfNeeded();await b.click();await tools(map==='city'?['pulse','nova']:['pulse']);await lifecycle(0);
  await page.locator('#start-experiment').click();await wait(()=>window.__heping.screen==='playing'&&window.__heping.physicsReady);
  await lifecycle(1);if(map==='city')await memory('entered-city');const intact=await read();assert.equal(intact.snapshot.mapId,map);assert.equal(intact.mode,'free');assert.ok(intact.geometry.soilCount>0);assert.equal(intact.geometry.coverage.missingTop,0,'No visible ground columns may be absent at map start');assert.equal(intact.geometry.coverage.incompleteColumns,0,'Every formal column must retain all eight soil layers');assert.equal(intact.pending,0);await capture(`${map}-intact`);
  await page.locator('[data-weapon="pulse"]').click();const aimed=await aimSoil(map);await page.locator('#slow').click();const before=await read();await page.locator('#fire').click();const launched=await read();assert.ok(launched.projectiles.length>0,'Fire creates an actual body');assert.deepEqual(launched.geometry,before.geometry,'No damage at launch');
  await page.locator('#pause').click();await capture(`${map}-real-projectile`);await page.locator('#pause').click();await page.locator('#slow').click();
  await wait(()=>window.__heping.lastDetonations().length>0);await wait(()=>window.__heping.pendingWork()===0);
  const damaged=await read();assert.ok(damaged.geometry.soilCount<before.geometry.soilCount||damaged.geometry.soilHP<before.geometry.soilHP,'Actual detonation must damage authoritative soil, not an unrelated roof');assert.deepEqual(damaged.main,intact.main,'Free destruction cannot mutate main save/research/inventory');
  assert.ok(damaged.geometry.soilMinY<aimed.position.y-2,'Finite deep terrain remains below the crater');await capture(`${map}-crater`);if(map==='city')await memory('city-after-pulse');
  await page.locator('#reset').click();await wait(epoch=>window.__heping.physicsReady&&window.__heping.snapshot().epoch>epoch,damaged.snapshot.epoch);const reset=await read();assert.equal(reset.pending,0);assert.equal(reset.projectiles.length,0);assert.deepEqual(reset.geometry,intact.geometry);assert.deepEqual(reset.main,intact.main);
  if(map==='city'){
   const novaButton=page.locator('[data-weapon="nova"]');await novaButton.scrollIntoViewIfNeeded();await novaButton.click();await aimSoil(map);await page.locator('#slow').click();await page.locator('#fire').click();assert.ok((await read()).projectiles.some(p=>p.weapon==='nova'));
   await wait(()=>window.__heping.scene().effects.events.some(e=>e.tool==='nova'&&e.kind==='detonation'),undefined,120000);
   const novaId=await page.evaluate(()=>window.__heping.scene().effects.events.find(e=>e.tool==='nova'&&e.kind==='detonation').id);
   evidence.cityNova={id:novaId,stages:[],scope:'Actual city event, real UI slow/pause and End; natural pending settlement required, no post-nova reset'};
   for(const [requestedAge,tolerance] of [[.1,.06],[.5,.1],[1,.15],[3,.2]]){
    const priorAge=evidence.cityNova.stages.at(-1)?.actualAge??-1;await wait(({id,age,priorAge})=>window.__heping.scene().effects.events.some(e=>e.id===id&&e.age>=age&&e.age>priorAge),{id:novaId,age:requestedAge,priorAge},60000);
    await page.locator('#pause').click();const frame=await page.evaluate(id=>window.__heping.scene().effects.events.find(e=>e.id===id),novaId);
    const captured=!!frame&&frame.age>=requestedAge&&frame.age<=requestedAge+tolerance;
    const phaseVisible=!!frame&&frame.age>=0&&frame.age<6.2;evidence.cityNova.stages.push({requestedAge,tolerance,actualAge:frame?.age??null,captured,exactTimingMiss:!captured,phaseVisible,phase:frame?.age<.18?'flash-and-fire':frame?.age<1.7?'fire':'gray-smoke',flashCaptured:!!frame&&frame.age<.18});
    await capture(`city-nova-${requestedAge.toFixed(1)}s-${captured?'captured':'missed'}`);
    if(requestedAge===.1)await memory('city-after-nova');
    await page.locator('#pause').click();
   }
   evidence.cityNova.exactTimingComplete=evidence.cityNova.stages.every(s=>s.captured);
   evidence.cityNova.timelineComplete=evidence.cityNova.stages.length===4&&evidence.cityNova.stages.every((s,i,all)=>s.phaseVisible&&(i===0||s.actualAge>all[i-1].actualAge))&&evidence.cityNova.stages.filter(s=>s.actualAge<1.7).length>=2&&evidence.cityNova.stages.at(-1).actualAge>=3&&evidence.cityNova.stages.at(-1).actualAge<6.2;
   const beforeEnd=await read();evidence.cityNova.beforeEnd={pending:beforeEnd.pending,flow:beforeEnd.flow,screen:beforeEnd.screen,activeEffects:beforeEnd.activeEffects};
   await page.locator('#finish-round').click();const endRequested=await read();evidence.cityNova.endRequested={pending:endRequested.pending,flow:endRequested.flow,screen:endRequested.screen};
   if(endRequested.pending>0){assert.equal(endRequested.flow,'ending');assert.equal(endRequested.screen,'playing','Cannot leave while structural work is pending');}
   await wait(()=>window.__heping.pendingWork()===0&&window.__heping.flow==='settled'&&['setup','results'].includes(window.__heping.screen),undefined,180000);
   const naturallySettled=await read();assert.deepEqual(naturallySettled.main,intact.main);evidence.cityNova.naturallySettled={pending:naturallySettled.pending,flow:naturallySettled.flow,screen:naturallySettled.screen,observeScene:'Not exercised: current free-mode End returns to setup rather than the main-mode results dialog'};
   await capture('city-nova-naturally-ended');

  }
  evidence.maps.push({map,target:aimed.id,detonations:damaged.events,remaining:damaged.geometry.count,resetEpoch:reset.snapshot.epoch});
  if(map==='city'){const endedScreen=await page.evaluate(()=>window.__heping.screen);await page.locator(endedScreen==='setup'?'#setup-back':'#result-home').click();}else{await page.locator('#game-home').click();if(await page.locator('#navigation-dialog').evaluate(e=>e.open))await page.locator('#confirm-leave').click();}await wait(()=>window.__heping.screen==='home');await lifecycle(0);if(map==='city'){await memory('left-city-before-gc');await memory('left-city-forced-gc',true);assert.ok(evidence.cityNova.timelineComplete,'Need four increasing-age visible frames, at least two live-fire frames and a later 3–6.2s gray-smoke frame; exact-time misses are diagnostic only');}
 }
 assert.equal(await page.evaluate(()=>localStorage.getItem('hepingmoniqi.first-playable.v1')),oldStored,'Migration must not overwrite the old save key');assert.deepEqual(evidence.errors,[]);evidence.status='passed';
}catch(error){evidence.status='failed';evidence.failure=String(error);evidence.current=await read().then(({main,round,...rest})=>({...rest,main:{epoch:main.epoch,research:main.research,mapId:main.mapId},round})).catch(()=>null);await capture('failure').catch(()=>{});throw error;}
finally{await fs.writeFile(`${output}/results.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));await browser.close();}
