import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';

// This script is an actual-game UI test, not the isolated compact preview.
// Run only on the already-authorized GitHub standard Ubuntu/preinstalled Chrome.
// Never launch a local browser as a fallback and never materialize full CellViews.
assert.equal(process.env.GITHUB_ACTIONS,'true','Only the authorized CI browser may run this harness');
assert.equal(process.env.QA_BROWSER_CHANNEL,'chrome');
const url=process.env.GAME_URL??'http://127.0.0.1:5192/';
const output=process.env.QA_OUTPUT??'artifacts/compact-game-browser';
const stepTimeout=Number(process.env.QA_STEP_TIMEOUT_MS??180000);
assert.ok(Number.isInteger(stepTimeout)&&stepTimeout>=5000&&stepTimeout<=300000);
const weapons=['charge','pulse','shock','echo','split','phase','heavy','nova'];
const expectedCity={mapId:'city',originalCount:454913,terrainCount:401800,structureCount:53113,buildingCount:36,layers:8};

// Clearly labelled schema-9 unlock fixture. This does NOT claim organic unlocks.
// No physics world is created here. The fixture has pristine courtyard geometry.
const {createStructuralGameWorld}=await tsImport('../src/structural/game-world.ts',import.meta.url);
const {EFFECT_PROFILES}=await tsImport('../src/structural/effects.ts',import.meta.url);
const fixtureWorld=createStructuralGameWorld(),fixture=fixtureWorld.getSnapshot();
fixture.research=1400;
fixture.round={budget:10,used:0,startResearch:1400,startDestroyed:0,settled:true,
 loadout:Object.fromEntries(weapons.map(id=>[id,id==='charge'?2:0])),
 remaining:Object.fromEntries(weapons.map(id=>[id,id==='charge'?2:0]))};
assert.equal(fixture.schemaVersion,9);assert.equal(fixture.structural.simulation,null);
fixtureWorld.suspend();
const evidence={
 schema:'compact-actual-game-qa/v1',startedAt:new Date().toISOString(),url,
 provenance:{execution:'GitHub Actions standard Ubuntu / preinstalled Chrome',commit:process.env.GITHUB_SHA??null,runId:process.env.GITHUB_RUN_ID??null,attempt:process.env.GITHUB_RUN_ATTEMPT??null},
 fixture:{label:'synthetic-schema9-1400-RP-unlock-fixture',initialResearch:1400,organicUnlocks:false,simulatedGameplayDamage:false},
 scope:{viewport:{width:1440,height:900},actualUI:true,hiddenRuntimeMutations:false,city:expectedCity,
  cityBlastPlan:{pulse:19,heavy:1,nova:0,powerPercent:100},cityEnterLeaveCycles:10,
  semantics:'Native/lab tests, not this browser perf run, separately prove full-depth holes, second-projectile passage, falling and persistent rubble.'},
 interpretation:{
  timing:'Pointer click capture to actual renderer.render completion plus a subsequent animation-frame opportunity. Not a GPU fence or physical monitor presentation measurement.',
  cold:'First city selection in a fresh browser context. App startup and courtyard/main smoke happen first. This is not a cold browser process or empty HTTP cache benchmark.',
  warm:'Repeated real card selection after returning from a different scene in the same browser session.',
  memory:'CDP JavaScript heap and backing storage are separate fields. Forced-GC samples are labelled and excluded from natural gameplay timing.',
  gpu:'Surface typed-buffer bytes are a geometry-allocation estimate, not measured GPU residency. Native/WASM allocation is not separately measurable by this harness.',
  verdict:'Functional assertions can pass. No invented FPS, latency, or leak threshold turns this into a product-performance pass.'
 },
 timings:[],memory:[],cycles:[],blasts:[],screenshots:[],errors:[],consoleErrors:[],gaps:[],status:'running',performanceVerdict:'unassessed',
};
await fs.mkdir(output,{recursive:true});
const persist=()=>fs.writeFile(`${output}/results.json`,JSON.stringify(evidence,null,2));
const progress=(stage,details={})=>console.log('QA_PROGRESS '+JSON.stringify({stage,at:new Date().toISOString(),...details}));
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl']});
evidence.provenance.browserVersion=browser.version();
const context=await browser.newContext({viewport:evidence.scope.viewport,deviceScaleFactor:1});
await context.addInitScript(snapshot=>{
 const key='compact-actual-game-fixture-installed';
 if(!sessionStorage.getItem(key)){
  localStorage.setItem('hepingmoniqi.structural.v09',JSON.stringify({savedAt:1,snapshot}));
  sessionStorage.setItem(key,'synthetic-schema9-unlock-fixture-not-organic-progression');
 }
 // Observation only: no DOM, gameplay, camera, clock or authority mutations.
 const probe={longTasks:[],rafGaps:[],clicks:[],armed:null,observer:null,lastRAF:null};
 const saveLongTask=entry=>probe.longTasks.push({start:entry.startTime,duration:entry.duration,name:entry.name});
 if(PerformanceObserver.supportedEntryTypes.includes('longtask')){
  probe.observer=new PerformanceObserver(list=>list.getEntries().forEach(saveLongTask));
  probe.observer.observe({type:'longtask',buffered:true});
 }
 document.addEventListener('click',event=>{
  const element=event.target instanceof Element?event.target.closest('button'):null;
  if(!probe.armed||!element?.matches(probe.armed.selector))return;
  probe.clicks.push({label:probe.armed.label,at:performance.now(),trusted:event.isTrusted});probe.armed=null;
 },true);
 const raf=now=>{
  if(probe.lastRAF!==null)probe.rafGaps.push({start:probe.lastRAF,end:now,gap:now-probe.lastRAF});
  probe.lastRAF=now;if(probe.rafGaps.length>120000)probe.rafGaps.splice(0,60000);requestAnimationFrame(raf);
 };
 requestAnimationFrame(raf);
 probe.flush=()=>probe.observer?.takeRecords().forEach(saveLongTask);
 window.__compactGameQA=probe;
},fixture);
const page=await context.newPage();page.setDefaultTimeout(Math.min(stepTimeout,30000));
const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
let fatal;
page.on('pageerror',error=>{fatal=String(error);evidence.errors.push({at:new Date().toISOString(),error:fatal});progress('runtime-error',{error:fatal});});
page.on('console',message=>{if(message.type()==='error')evidence.consoleErrors.push({at:new Date().toISOString(),text:message.text()});});
let activeStage='boot',watchdog;
const overallLimit=Number(process.env.QA_OVERALL_TIMEOUT_MS??18*60*1000);
assert.ok(Number.isInteger(overallLimit)&&overallLimit>=60000&&overallLimit<=24*60*1000);
watchdog=setTimeout(async()=>{
 evidence.status='timed-out';evidence.failure=`Overall harness observation limit ${overallLimit} ms at ${activeStage}; not a performance pass/fail threshold`;
 progress('overall-timeout',{activeStage});await persist().catch(()=>{});await browser.close().catch(()=>{});
},overallLimit);
watchdog.unref();

async function wait(name,predicate,arg,timeout=stepTimeout){
 activeStage=name;progress('wait-start',{name,timeoutMs:timeout});
 const heartbeat=setInterval(()=>progress('wait-pending',{name,elapsedObservationOnly:true}),15000);heartbeat.unref();
 try{await page.waitForFunction(predicate,arg,{timeout,polling:'raf'});if(fatal)throw new Error(fatal);}
 finally{clearInterval(heartbeat);}
 progress('wait-complete',{name});
}
const read=()=>page.evaluate(()=>{
 const h=window.__heping;
 return {at:performance.now(),screen:h.screen,mode:h.mode,ready:h.physicsReady,flow:h.flow,
  selectedScene:h.selectedScene,previewMap:h.previewMap,compact:h.compactDiagnostics(),scene:h.sceneDiagnostics(),
  pending:h.pendingWork(),activeEffects:h.activeEffects,lifecycle:h.physicsLifecycle(),surface:h.aimSurface(),
  projectileCount:h.projectiles().length,detonations:h.lastDetonations(),round:h.round(),mainResearch:h.mainResearch,objective:h.objective()};
});
async function lifecycle(expected){
 await wait(`active-worlds-${expected}`,n=>{const h=window.__heping,l=h.physicsLifecycle();return l.activeWorlds===n&&!l.transitioning;},expected);
 const state=await page.evaluate(()=>window.__heping.physicsLifecycle());assert.equal(state.projectileBound,expected===1);return state;
}
async function saveReady(){
 await wait('save-transaction-complete',()=>!window.__heping.saveStatus().pending);
 const state=await page.evaluate(()=>window.__heping.saveStatus());assert.equal(state.error,null);assert.equal(state.readFailed,false);return state;
}
async function memory(stage,forcedGC=false){
 const at=new Date().toISOString();if(forcedGC)await cdp.send('HeapProfiler.collectGarbage');
 const heap=await cdp.send('Runtime.getHeapUsage'),dom=await cdp.send('Memory.getDOMCounters'),metrics=await cdp.send('Performance.getMetrics');
 const state=await read();const row={stage,at,forcedGC,heap,dom,
  performanceMetrics:Object.fromEntries(metrics.metrics.filter(m=>['JSHeapUsedSize','JSHeapTotalSize','Nodes','Documents','JSEventListeners'].includes(m.name)).map(m=>[m.name,m.value])),
  compact:state.compact,lifecycle:state.lifecycle,sceneGeometry:state.scene.voxelRender,
  nativeWasmBytes:null,gpuResidentBytes:null,gpuGeometryEstimateBytes:state.scene.voxelRender?.typedBufferBytes??null};
 assert.ok(Number.isFinite(heap.usedSize));evidence.memory.push(row);progress('memory-sample',{stage,forcedGC,jsHeapBytes:heap.usedSize,backingStorageBytes:heap.backingStorageSize??null});await persist();return row;
}
async function capture(name){
 progress('screenshot-start',{name});const start=Date.now();
 const bytes=await page.screenshot({type:'jpeg',quality:55,timeout:120000});
 await fs.writeFile(`${output}/${name}.jpg`,bytes);
 const record={name,path:`${output}/${name}.jpg`,at:new Date().toISOString(),bytes:bytes.length,wallMs:Date.now()-start,
  note:'Screenshot is outside measured timing windows; capture wall time is not game FPS.'};
 evidence.screenshots.push(record);progress('screenshot-complete',record);
 if(bytes.length<220000)console.log(`SCREENSHOT_BASE64 compact-game-${name} ${bytes.toString('base64')}`);
 await persist();
}
async function arm(label,selector){
 const button=page.locator(selector);await button.scrollIntoViewIfNeeded();
 const baseline=await page.evaluate(({label,selector})=>{
  const p=window.__compactGameQA;p.flush();p.armed={label,selector};
  return {at:performance.now(),renderCount:window.__heping.sceneDiagnostics().renderCount};
 },{label,selector});
 return {label,selector,baseline};
}
async function finishTiming(mark,extra={}){
 // Let the observer deliver the task containing the real action and its first
 // rAF opportunity before collecting. Do not force GC or capture screenshots.
 const result=await page.evaluate(async mark=>{
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const end=performance.now(),p=window.__compactGameQA;p.flush();
  const click=p.clicks.findLast(c=>c.label===(mark.clickLabel??mark.label)),start=click?.at??mark.baseline.at;
  const tasks=p.longTasks.filter(t=>t.start<end&&t.start+t.duration>start);
  const frames=p.rafGaps.filter(f=>f.end>start&&f.start<end);
  return {click,startedAt:start,finishedAt:end,durationMs:end-start,
   longTaskAccounting:'Whole durations of tasks overlapping the observation window; not clipped CPU attribution.',
   longTaskCount:tasks.length,longTaskTotalMs:tasks.reduce((n,t)=>n+t.duration,0),longTaskMaxMs:Math.max(0,...tasks.map(t=>t.duration)),longTasks:tasks,
   rafSamples:frames.length,maxRAFGapMs:Math.max(0,...frames.map(f=>f.gap)),rafGapP95Ms:frames.length?[...frames.map(f=>f.gap)].sort((a,b)=>a-b)[Math.floor((frames.length-1)*.95)]:null};
 },mark);
 assert.equal(result.click?.trusted,true,'Latency must start from a real trusted UI click');
 const row={label:mark.label,at:new Date().toISOString(),...result,...extra};evidence.timings.push(row);
 progress('timing-complete',{label:row.label,durationMs:row.durationMs,maxRAFGapMs:row.maxRAFGapMs,longTaskCount:row.longTaskCount,...extra});await persist();return row;
}
async function firstRenderAfter(mark,map){
 await wait(`${mark.label}-first-render-frame-milestone`,({previous,map})=>{
  const frames=window.__heping.sceneDiagnostics().recentRenders??[];
  return frames.some(r=>r.count>previous&&r.mapId===map&&r.nextFrameAt!==null);
 },{previous:mark.baseline.renderCount,map});
 return page.evaluate(({previous,map})=>{
  const record=window.__heping.sceneDiagnostics().recentRenders.find(r=>r.count>previous&&r.mapId===map);
  return {...record,measurement:'First matching render CPU submission and next scene animation callback, not GPU completion or physical presentation'};
 },{previous:mark.baseline.renderCount,map});
}
async function chooseMap(map,label){
 const selector=`[data-scene="${map}"]`,mark=await arm(label,selector);
 await page.locator(selector).click({timeout:stepTimeout});
 await wait(`${label}-real-render`,({map,previous})=>{
  const h=window.__heping,d=h.sceneDiagnostics();
  return h.screen==='setup'&&h.selectedScene===map&&h.previewMap===map&&d.lastRenderedMap===map&&d.renderCount>previous;
 },{map,previous:mark.baseline.renderCount});
 const firstFrame=await firstRenderAfter(mark,map);
 const submitted=await page.evaluate(()=>{const d=window.__heping.sceneDiagnostics();return {renderCount:d.renderCount,renderSubmittedAt:d.lastRenderAt,faces:d.renderedSurfaceFaces};});
 const timing=await finishTiming(mark,{...submitted,firstFrame});timing.clickToRenderSubmissionMs=firstFrame.finishedAt-timing.startedAt;timing.clickToFirstNextFrameMs=firstFrame.nextFrameAt-timing.startedAt;timing.firstRenderCpuMs=firstFrame.finishedAt-firstFrame.startedAt;
 assert.ok(timing.clickToRenderSubmissionMs>=0);assert.ok(submitted.faces>0);await persist();return timing;
}
function cityIdentity(state){
 const d=state.compact;assert.ok(d,'Active city must expose a compact scalar binding');
 assert.equal(d.mapId,'city');assert.equal(d.originalCount,454913);assert.equal(d.terrainCount,401800);assert.equal(d.structureCount,53113);
 assert.equal(d.bounds.minY,-8);assert.equal(d.bounds.minX,-122);assert.equal(d.bounds.maxX,122);assert.equal(d.bounds.minZ,-102);assert.equal(d.bounds.maxZ,102);
 assert.equal(state.scene.representation,'chunk-surfaces');assert.equal(state.lifecycle.activeWorlds,1);
 assert.equal(d.storage.retainedPristineStates,0);assert.equal(state.scene.voxelRender.retainedCellViews,0);
 return {mapId:d.mapId,recipeId:d.recipeId,originalCount:d.originalCount,terrainCount:d.terrainCount,structureCount:d.structureCount,layers:8,
  buildingCount:36,buildingCountEvidence:'Exact native compact-fixture recipe parity test, not a diagnostic full-city runtime scan'};
}
async function selectTools(ids){
 for(const id of weapons){const b=page.locator(`[data-free-tool="${id}"]`),chosen=await b.getAttribute('aria-pressed')==='true';
  if(chosen&&!ids.includes(id))await b.click();}
 for(const id of ids){const b=page.locator(`[data-free-tool="${id}"]`);if(await b.getAttribute('aria-pressed')!=='true')await b.click();}
}
async function setPower(value){
 assert.ok(value===25||value===100,'Only actual range endpoints are used in this QA plan');
 // Playwright fill() does not support range inputs. Real Home/End key events
 // exercise the existing slider input handler without writing runtime state.
 await page.locator('#power').press(value===25?'Home':'End');assert.equal(await page.locator('#power-value').innerText(),`${value}%`);
}
async function aimCell(id,top=true){
 const cell=await page.evaluate(id=>window.__heping.cell(id),id);assert.ok(cell,`Target ${id} must exist`);
 const point={...cell.position,y:cell.position.y+(top?.5:0)},pixel=await page.evaluate(p=>window.__heping.project(p),point);
 assert.ok(pixel.visible);assert.ok(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS',pixel),'Real target must not be obscured by UI');
 await page.mouse.click(pixel.x,pixel.y);
 const surface=await page.evaluate(()=>window.__heping.aimSurface());assert.equal(surface?.voxelId,id);
 if(top){assert.ok(surface.normal.y>.99);assert.ok(Math.abs(surface.position.x-cell.position.x)<.1&&Math.abs(surface.position.z-cell.position.z)<.1);}
 return {cell,surface,pixel};
}

// Known native-proven first soil target. Later shots use a bounded set of
// separated candidate columns and verify the actual rendered ray hit; this is
// not a hidden aim/detonate API. Targets that are UI-covered or occluded are
// skipped before firing and recorded. No arbitrary center-of-city blast.
const candidates=[{x:-45,y:-.5,z:43}];
for(let radius=1;radius<=5;radius++)for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++){
 if(Math.max(Math.abs(dx),Math.abs(dz))!==radius)continue;
 const p={x:-45+dx*9,y:-.5,z:43+dz*9};if(p.x>=-120&&p.x<=120&&p.z>=-100&&p.z<=100)candidates.push(p);
}
let candidateCursor=0;
async function aimFreshSoil(){
 const rejected=[];
 for(;candidateCursor<candidates.length;candidateCursor++){
  const point=candidates[candidateCursor],pixel=await page.evaluate(p=>window.__heping.project(p),point);
  if(!pixel.visible||!await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS',pixel)){rejected.push({point,reason:'outside view or covered by unchanged UI'});continue;}
  await page.mouse.click(pixel.x,pixel.y);
  const actual=await page.evaluate(()=>{const h=window.__heping,surface=h.aimSurface();return {surface,cell:surface?h.authorityCell(surface.voxelId):null};});
  const {surface,cell}=actual;
  if(!surface||!cell||cell.role!=='terrain'||cell.state!=='static'||cell.hp!==cell.maxHp||surface.normal.y<.99||Math.abs(surface.position.x-point.x)>.1||Math.abs(surface.position.z-point.z)>.1){rejected.push({point,reason:'real ray did not hit the pristine intended soil top',hit:surface?.voxelId??null});continue;}
  candidateCursor++;return {cell,surface,pixel,rejected};
 }
 throw new Error(`No further valid visible soil target among ${candidates.length} bounded candidates`);
}
async function startCity(cycle){
 const mark=await arm(`city-start-${cycle}`,'#start-experiment');
 await page.locator('#start-experiment').click({timeout:stepTimeout});
 await wait(`city-${cycle}-real-playing`,previous=>{const h=window.__heping,d=h.sceneDiagnostics();return h.screen==='playing'&&h.physicsReady&&d.lastRenderedMap==='city'&&d.renderCount>previous;},mark.baseline.renderCount);
 const firstFrame=await firstRenderAfter(mark,'city'),startup=await page.evaluate(()=>window.__heping.startupEvidence());
 await lifecycle(1);const state=await read(),identity=cityIdentity(state);assert.equal(state.pending,0);assert.equal(state.compact.storage.mutableStates,0);
 assert.equal(state.scene.voxelRender.lastBindReused,true,'Pristine city preview must hand off existing geometry to the fresh authority');assert.equal(state.scene.voxelRender.lastRebuild.chunks,0,'Same-scene pristine handoff must not rebuild static chunks');
 const aim=await aimCell(-4649);assert.equal(aim.cell.role,'terrain');
 const timing=await finishTiming(mark,{endCondition:'actual city bound, rendered, real terrain ray picked; fire enabled',firstFrame,startup,identity,aimedCell:aim.cell.id});
 assert.equal(await page.locator('#fire').isEnabled(),true);
 timing.clickToFirstRenderMs=firstFrame.finishedAt-timing.startedAt;timing.clickToFirstNextFrameMs=firstFrame.nextFrameAt-timing.startedAt;timing.firstRenderCpuMs=firstFrame.finishedAt-firstFrame.startedAt;await persist();
 return {state,identity,timing,aim,mark};
}
async function fireOne(index,tool,aim,{visual=false,startMark=null}={}){
 await page.locator(`[data-weapon="${tool}"]`).click();await setPower(100);
 if(visual)await page.locator('#slow').click();
 const before=await read(),mark=await arm(`city-blast-${index}-${tool}`,'#fire');
 await page.locator('#fire').click();
 // launch is synchronous in the click handler. Observe both authoritative
 // projectile and its rendered model before allowing a finished blast count.
 const flying=await page.evaluate(()=>({shots:window.__heping.projectiles(),rendered:window.__heping.renderedProjectiles,pending:window.__heping.pendingWork(),at:performance.now()}));
 const projectile=flying.shots.find(p=>p.weapon===tool);assert.ok(projectile,'Actual fire must create a native projectile');assert.ok(flying.rendered>0);assert.ok(flying.pending>0);
 await wait(`blast-${index}-projectile-render-submitted`,previous=>window.__heping.sceneDiagnostics().renderCount>previous,before.scene.renderCount);
 if(startMark){
  await finishTiming({...startMark,label:'city-start-first-projectile',clickLabel:startMark.label},{endCondition:'first native projectile and rendered projectile model observed',firstProjectileId:projectile.id});
  await memory('city-first-projectile-launched-natural');
 }
 await wait(`blast-${index}-detonation`,id=>window.__heping.lastDetonations().some(e=>e.id===id),projectile.id);
 const detonation=await page.evaluate(id=>window.__heping.lastDetonations().find(e=>e.id===id),projectile.id);assert.equal(detonation.weapon,tool);
 let visibleEffect=null,visualObservation=null,settlementMark=mark,timing;
 if(visual){
  visibleEffect=await page.evaluate(id=>window.__heping.sceneDiagnostics().effects.events.find(e=>e.id===id),projectile.id);
  assert.ok(visibleEffect,'Heavy detonation must enter the real scene effect channel');
  timing=await finishTiming(mark,{endCondition:'heavy detonation and real effect observed in UI slow motion',tool,shotId:projectile.id,slowMotion:true,notNormalSpeedBlastTiming:true});
  await page.locator('#pause').click();
  const pausedEffect=await page.evaluate(id=>window.__heping.sceneDiagnostics().effects.events.find(e=>e.id===id),projectile.id);
  assert.ok(pausedEffect,'Heavy effect must still exist when the real Pause control is pressed');
  const profile=EFFECT_PROFILES[tool];
  visualObservation={slowMotion:true,paused:true,effectAgeAtPause:pausedEffect.age,
   phase:pausedEffect.age<profile.flash?'flash-and-fire':pausedEffect.age<profile.fire?'fire':'gray-smoke',
   profile:{flash:profile.flash,fire:profile.fire,smoke:profile.smoke},screenshot:'city-heavy-real-effect'};
  await capture('city-heavy-real-effect');
  // Resume through the real UI, restore normal speed, then separately measure
  // the remaining natural drain. The screenshot/pause interval is excluded.
  await page.locator('#slow').click();
  settlementMark=await arm(`city-heavy-natural-drain-${index}`,'#pause');await page.locator('#pause').click();
 }
 // activeEffects is the gameplay's PRIMARY blast envelope, not decorative
 // smoke. Preserve the actual gameplay completion gate and report it exactly.
 await wait(`blast-${index}-natural-pending-zero`,()=>window.__heping.pendingWork()===0&&!window.__heping.activeEffects);
 const after=await read();assert.equal(after.projectileCount,0);assert.equal(after.flow,'active');
 const settledTiming=await finishTiming(settlementMark,{endCondition:'actual detonation followed by natural pending=0 and primary blast envelope ended; cosmetic smoke may remain',tool,shotId:projectile.id,afterVisualPause:visual});
 timing??=settledTiming;
 const row={index,tool,powerPercent:100,at:new Date().toISOString(),projectileId:projectile.id,aim:{cellId:aim.cell.id,position:aim.surface.position,normal:aim.surface.normal},
  rejectedCandidates:aim.rejected??[],detonation,visibleEffect,visualObservation,timingLabel:timing.label,settlementTimingLabel:settledTiming.label,
  before:{pending:before.pending,aggregate:before.compact.aggregate},after:{pending:after.pending,effectCount:after.scene.effects.active,aggregate:after.compact.aggregate,storage:after.compact.storage},naturalSettlement:true};
 evidence.blasts.push(row);progress('blast-completed',{index,tool,shotId:projectile.id,pending:after.pending,durationMs:timing.durationMs});await persist();return row;
}
async function endCity(cycle){
 const before=await read();assert.equal(before.pending,0);
 await page.locator('#finish-round').click();
 await wait(`city-${cycle}-settled-setup`,()=>{const h=window.__heping;return h.screen==='setup'&&h.flow==='settled'&&h.pendingWork()===0&&!h.activeEffects;});
 await lifecycle(0);await page.locator('#setup-back').click();await wait(`city-${cycle}-home`,()=>window.__heping.screen==='home');
 await lifecycle(0);return {at:new Date().toISOString(),pending:0,naturalEnd:true};
}

try{
 progress('navigation-start',{url,fixture:evidence.fixture});
 await page.goto(url,{waitUntil:'networkidle',timeout:stepTimeout});
 await wait('formal-game-ready',()=>window.__heping?.physicsReady&&typeof window.__heping.compactDiagnostics==='function'&&typeof window.__heping.authorityCell==='function');
 await lifecycle(0);assert.equal(await page.evaluate(()=>window.__heping.mainResearch),1400);
 evidence.provenance.browser=await page.evaluate(()=>({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory??null,longTaskAPI:PerformanceObserver.supportedEntryTypes.includes('longtask')}));
 await memory('fresh-home-natural');

 // One real default-power main round establishes actual earned partial research,
 // inventory use, deferred End, retry and durable schema-9 reload.
 progress('main-single-default-grenade-start');await page.locator('#mode-main').click();await wait('main-setup',()=>window.__heping.screen==='setup');
 for(const id of weapons){const desired=id==='charge'?2:0;let current=Number(await page.locator(`#loadout-${id}`).innerText());
  for(let budget=0;current!==desired&&budget<15;budget++){const delta=current>desired?-1:1;await page.locator(`[data-adjust="${id}"][data-delta="${delta}"]`).click();current=Number(await page.locator(`#loadout-${id}`).innerText());}assert.equal(current,desired);}
 await page.locator('#start-experiment').click({timeout:stepTimeout});await wait('main-playing',()=>window.__heping.screen==='playing'&&window.__heping.physicsReady);await lifecycle(1);
 const mainStart=await read();await aimCell(360,false);assert.equal(await page.locator('#power').inputValue(),'100');await page.locator('#slow').click();await page.locator('#fire').click();
 const mainFlying=await read();assert.equal(mainFlying.round.used,1);assert.equal(mainFlying.round.remaining.charge,1);assert.ok(mainFlying.projectileCount>0);
 await page.locator('#finish-round').click();const ending=await read();assert.equal(ending.flow,'ending');assert.equal(ending.screen,'playing');assert.ok(ending.pending>0);
 await wait('main-natural-results',()=>window.__heping.screen==='results'&&window.__heping.pendingWork()===0&&!window.__heping.activeEffects);
 const mainResult=await read();assert.ok(mainResult.mainResearch>mainStart.mainResearch,'Actual default-power main projectile earns research');
 assert.ok(mainResult.mainResearch-mainStart.mainResearch<200,'Only partial scene research earned, not a fabricated complete unlock');
 assert.equal(mainResult.detonations.length,1);assert.equal(mainResult.detonations[0].weapon,'charge');assert.equal(mainResult.detonations[0].reason,'timer');
 assert.ok(Math.abs(mainResult.detonations[0].age-3)<1e-8,'Main grenade retains its actual three-second simulation fuse');
 await saveReady();const savedBeforeRetry=await page.evaluate(()=>window.__heping.mainSnapshot());
 assert.equal(savedBeforeRetry.schemaVersion,9);assert.ok(savedBeforeRetry.structural.simulation.changes.length>0);
 await capture('main-real-default-grenade-results');
 await page.locator('#retry-map').click();await wait('main-real-retry',()=>window.__heping.screen==='playing'&&window.__heping.physicsReady);
 const retry=await read();assert.equal(retry.round.used,0);assert.deepEqual(retry.round.remaining,mainStart.round.remaining);assert.equal(retry.pending,0);assert.equal(retry.compact.storage.mutableStates,0);assert.equal(retry.mainResearch,mainResult.mainResearch);
 await page.locator('#finish-round').click();await wait('retry-empty-results',()=>window.__heping.screen==='results');
 await page.locator('#result-home').click();await wait('main-home',()=>window.__heping.screen==='home');await lifecycle(0);await saveReady();
 const persisted=await page.evaluate(()=>window.__heping.mainSnapshot());
 await page.reload({waitUntil:'networkidle',timeout:stepTimeout});await wait('durable-schema9-reload',()=>window.__heping?.physicsReady);await lifecycle(0);
 const reloaded=await page.evaluate(()=>window.__heping.mainSnapshot());
 assert.equal(reloaded.research,persisted.research);assert.deepEqual(reloaded.round,persisted.round);assert.equal(reloaded.destroyedCount,persisted.destroyedCount);
 evidence.main={powerPercent:100,baselineRP:mainStart.mainResearch,earnedRP:mainResult.mainResearch-mainStart.mainResearch,finalRP:reloaded.research,
  initialInventory:mainStart.round.remaining,afterShot:mainFlying.round.remaining,endRequested:{flow:ending.flow,pending:ending.pending},
  actualDetonation:mainResult.detonations[0],sparseSaveChangesBeforeRetry:savedBeforeRetry.structural.simulation.changes.length,retryPristine:true,
  reloadVerified:{research:true,inventory:true,retryPristineState:true,damagedWorld:false},fixtureUnlocksAreNotOrganic:true};
 const preservedMain=await page.evaluate(()=>window.__heping.mainSnapshot());

 // Exactly ten real selections/enters/leaves; the first session completes all
 // twenty shots cumulatively before any reset/leave. Remaining nine sessions
 // measure lifecycle churn without erasing the twenty-blast observation.
 for(let cycle=1;cycle<=10;cycle++){
  progress('city-cycle-start',{cycle});await page.locator('#mode-free').click();await wait(`free-setup-${cycle}`,()=>window.__heping.screen==='setup');
  if(await page.evaluate(()=>window.__heping.selectedScene)==='city')await chooseMap('courtyard',`warm-baseline-courtyard-${cycle}`);
  const selection=await chooseMap('city',cycle===1?'cold-city-selection':`warm-city-selection-${cycle}`);await lifecycle(0);
  await selectTools(['pulse','heavy']);
  const entered=await startCity(cycle);
  if(cycle>1)assert.equal(entered.state.scene.renderedSurfaceFaces,evidence.cycles[0].intactSurfaceFaces,'The same pristine city must rebuild identical exposed-face membership count');
  if(cycle>1)await memory(`city-${cycle}-entered-natural`);
  if(cycle===1){
   candidateCursor=1;
   for(let index=1;index<=20;index++){
    const aim=index===1?entered.aim:await aimFreshSoil();
    await fireOne(index,index===20?'heavy':'pulse',aim,{visual:index===20,startMark:index===1?entered.mark:null});
    if(index===1){await memory('city-after-first-blast-natural');await capture('city-first-real-crater');}
    if(index===10)await memory('city-after-ten-completed-blasts-natural');
   }
   assert.equal(evidence.blasts.length,20);assert.equal(evidence.blasts.filter(b=>b.tool==='pulse').length,19);assert.equal(evidence.blasts.filter(b=>b.tool==='heavy').length,1);
   await memory('city-after-twenty-completed-blasts-natural');await capture('city-after-twenty-completed-blasts');
  }
  const ended=await endCity(cycle),left=await memory(`city-${cycle}-left-natural`);
  evidence.cycles.push({cycle,selectionTiming:selection.label,startTiming:entered.timing.label,identity:entered.identity,enteredEpoch:entered.state.compact.epoch,intactSurfaceFaces:entered.state.scene.renderedSurfaceFaces,
   completedBlasts:cycle===1?20:0,ended,leftHeapBytes:left.heap.usedSize,leftActiveWorlds:left.lifecycle.activeWorlds});
  assert.deepEqual(await page.evaluate(()=>window.__heping.mainSnapshot()),preservedMain,'Free selection, destruction and leave cannot alter main progress');
  progress('city-cycle-complete',{cycle,completedBlasts:cycle===1?20:0});await persist();
 }
 assert.equal(evidence.cycles.length,10);assert.equal(evidence.cycles.reduce((n,c)=>n+c.completedBlasts,0),20);
 // Forced GC belongs after all natural cycle samples, never between normal
 // samples, so the churn series is not silently helped by manual collection.
 await memory('after-ten-cycles-before-forced-gc');await memory('after-ten-cycles-forced-gc',true);await capture('final-home-after-ten-real-cycles');
 await page.reload({waitUntil:'networkidle',timeout:stepTimeout});await wait('final-main-save-reload',()=>window.__heping?.physicsReady);await lifecycle(0);
 assert.equal(await page.evaluate(()=>window.__heping.mainResearch),preservedMain.research);await saveReady();
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.consoleErrors,[]);
 evidence.status='functional-checks-passed';evidence.finishedAt=new Date().toISOString();
 evidence.gaps.push('No physical GPU-present fence, independent native/WASM memory meter, or GPU-resident allocation meter is available.');
 evidence.gaps.push('Heavy gameplay is exercised once; nova explosion phase aesthetics remain the separate eight-profile render/lab test.');
 progress('functional-checks-complete',{cycles:evidence.cycles.length,completedBlasts:evidence.blasts.length,performanceVerdict:evidence.performanceVerdict});
}catch(error){
 if(evidence.status!=='timed-out')evidence.status='failed';evidence.failure=String(error);evidence.failedAt=new Date().toISOString();evidence.failedStage=activeStage;
 evidence.current=await read().catch(()=>null);progress('failed',{stage:activeStage,error:String(error)});
 await capture('failure').catch(captureError=>{evidence.gaps.push(`Failure screenshot unavailable: ${captureError}`);});
 process.exitCode=1;
}finally{
 clearTimeout(watchdog);await persist();console.log('QA_RESULT '+JSON.stringify(evidence));await browser.close();
}
