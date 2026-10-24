import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';

// Actual production UI only. This file does not dispatch CI, launch a local
// fallback, inject damage, replace clocks, change physics, or reset to settle.
// Execution is restricted to the separately authorized preinstalled CI Chrome.
assert.equal(process.env.GITHUB_ACTIONS,'true','Only authorized GitHub CI may execute this browser harness');
assert.equal(process.env.QA_BROWSER_CHANNEL,'chrome');
const startedWall=Date.now();
const url=process.env.GAME_URL??'http://127.0.0.1:5191/';
const output=process.env.QA_OUTPUT??'artifacts/city-nova-browser';
const overallLimit=Number(process.env.QA_OVERALL_TIMEOUT_MS??570000);
const stepTimeout=Number(process.env.QA_STEP_TIMEOUT_MS??150000);
assert.ok(Number.isSafeInteger(overallLimit)&&overallLimit>=60000&&overallLimit<=590000,'Observation plus shutdown must fit within ten real minutes');
assert.ok(Number.isSafeInteger(stepTimeout)&&stepTimeout>=5000&&stepTimeout<=180000);
const weapons=['charge','pulse','shock','echo','split','phase','heavy','nova'];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const evidence={
 schema:'city-nova-actual-ui/v1',startedAt:new Date().toISOString(),url,status:'running',performanceVerdict:'unassessed',
 provenance:{execution:'GitHub Actions standard Ubuntu / preinstalled Chrome',commit:process.env.GITHUB_SHA??null,runId:process.env.GITHUB_RUN_ID??null,attempt:process.env.GITHUB_RUN_ATTEMPT??null},
 fixture:{label:'synthetic-schema9-1400-RP-unlock-fixture',initialResearch:1400,organicUnlocks:false,simulatedGameplayDamage:false},
 scope:{viewport:{width:1440,height:900},actualUI:true,city:{mapId:'city',originalCount:454913,terrainCount:401800,structureCount:53113,buildingCount:36,layers:8},shots:3,placements:1,launches:2,weapon:'nova',powerPercent:100,mode:'free',unlimitedAmmo:true,resetBetweenShots:false,paused:false,slowMotion:false,observationLimitMs:overallLimit},
 interpretation:{
  timing:'Trusted UI click to existing actual renderer.render completion and subsequent scene callback. Not GPU completion or physical monitor presentation. rAF gaps are not invented FPS.',
  samples:'Read-only diagnostics at animation callbacks. Actual render records are retained separately; callback scalar samples are not claimed as samples inside renderer.render. Instrumentation has overhead.',
  revisions:'Authority/surface revision deltas and observed lastRebuild reports only. Existing diagnostics provide no cumulative reset/full-bind counter; null is unknown, never zero.',
  screenshots:'Normal-speed, unpaused screenshots may overlap a shot observation window and add overhead; each capture interval and actual effect age are reported.',
  memory:'CDP JS heap and backingStorageSize reported separately. Geometry typed-buffer bytes are an estimate, not GPU residency. No forced collection during gameplay. Post-settlement samples include diagnostic sparse-snapshot allocations; their count and read duration are reported. Later GC may include probe allocations, so this is instrumented QA, not a probe-free benchmark.',
  persistence:'This harness verifies main-save isolation from free destruction and durable main progress. It does not claim browser restoration of the damaged free city. scripts/profile-city-nova-authority.ts is a separate native save/restore probe, not evidence unless independently run.'
 },
 timings:[],memory:[],blasts:[],screenshots:[],errors:[],consoleErrors:[],gaps:[],statusSamples:[],
};
await fs.mkdir(output,{recursive:true});
const persist=()=>fs.writeFile(`${output}/results.json`,JSON.stringify(evidence,null,2));
const progress=(stage,details={})=>console.log('CITY_NOVA_PROGRESS '+JSON.stringify({stage,at:new Date().toISOString(),wallMs:Date.now()-startedWall,...details}));
let browser,page,cdp,activeStage='fixture',fatal,watchdog;
watchdog=setTimeout(()=>{
 evidence.status='incomplete-observation-limit';evidence.failure=`Real-time observation limit reached during ${activeStage}; unfinished work is not settlement or a performance pass`;
 evidence.failedAt=new Date().toISOString();
 try{writeFileSync(`${output}/results.json`,JSON.stringify(evidence,null,2));}catch{}
 progress('overall-limit',{activeStage});
 void browser?.close().catch(()=>{});
 // Bound shutdown too, including an unresponsive browser or renderer process.
 setTimeout(()=>process.exit(1),Math.min(5000,Math.max(1,599000-(Date.now()-startedWall))));
},Math.max(1,overallLimit-(Date.now()-startedWall)));
watchdog.unref();

try{
 const {createStructuralGameWorld}=await tsImport('../src/structural/game-world.ts',import.meta.url);
 const {createCompactGameFixture}=await tsImport('../src/compact/fixture.ts',import.meta.url);
 const {EFFECT_PROFILES}=await tsImport('../src/structural/effects.ts',import.meta.url);
 const fixtureWorld=createStructuralGameWorld(),fixture=fixtureWorld.getSnapshot();
 fixture.research=1400;
 fixture.round={budget:10,used:0,startResearch:1400,startDestroyed:0,settled:true,
  loadout:Object.fromEntries(weapons.map(id=>[id,id==='charge'?2:0])),
  remaining:Object.fromEntries(weapons.map(id=>[id,id==='charge'?2:0]))};
 assert.equal(fixture.schemaVersion,9);assert.equal(fixture.structural.simulation,null);fixtureWorld.suspend();
 // CPU fixture only: scalar immutable structure columns and bounded candidate
 // IDs. Never activate a native world or materialize 454,913 city CellViews.
 const cityFixture=createCompactGameFixture('city');
 const groups=new Map();
 for(let ordinal=0;ordinal<cityFixture.structureCount;ordinal++){
  const id=cityFixture.idAtOrdinal(ordinal);
  if(!cityFixture.objectiveOf(id)||!['building','foundation'].includes(cityFixture.roleOf(id)))continue;
  const objectId=cityFixture.objectIdOf(id),p=cityFixture.originalPosition(id);
  let group=groups.get(objectId);if(!group){group={objectId,ids:[],minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};groups.set(objectId,group);}
  group.minX=Math.min(group.minX,p.x);group.maxX=Math.max(group.maxX,p.x);group.minZ=Math.min(group.minZ,p.z);group.maxZ=Math.max(group.maxZ,p.z);
  group.ids.push(id);
 }
 assert.equal(groups.size,36);
 const candidates=[];
 for(const group of groups.values()){
  const center={x:(group.minX+group.maxX)/2,z:(group.minZ+group.maxZ)/2};
  if(Math.abs(center.x)>62||Math.abs(center.z)>58)continue;
  const faces=[];
  for(const id of group.ids){
   const p=cityFixture.originalPosition(id);if(p.y<2)continue;
   for(const normal of [{x:1,y:0,z:0},{x:0,y:0,z:1},{x:0,y:1,z:0}]){
    if(cityFixture.idAt(p.x+normal.x,p.y+normal.y,p.z+normal.z)!==null)continue;
    faces.push({id,objectId:group.objectId,original:p,normal,point:{x:p.x+normal.x*.49,y:p.y+normal.y*.49,z:p.z+normal.z*.49},
     score:Math.abs(p.y-5)+Math.hypot(p.x-center.x,p.z-center.z)*.2+(normal.y?8:0),center});
   }
  }
  faces.sort((a,b)=>a.score-b.score||a.id-b.id);
  // Near lower walls first, followed by distributed roof/upper-wall options.
  const selected=[...faces.slice(0,8)];
  const upper=faces.filter(c=>c.normal.y===1).sort((a,b)=>b.original.y-a.original.y||a.score-b.score);
  for(let i=0;i<8&&upper.length;i++)selected.push(upper[Math.floor(i*(upper.length-1)/7)]);
  const seen=new Set();for(const c of selected){const key=`${c.id}/${c.normal.x}/${c.normal.y}`;if(!seen.has(key)){seen.add(key);candidates.push(c);}}
 }
 candidates.sort((a,b)=>Math.hypot(a.center.x,a.center.z)-Math.hypot(b.center.x,b.center.z)||a.score-b.score);
 assert.ok(candidates.length>=24);
 evidence.targetPlan={source:'Immutable production compact city fixture; actual browser ray acceptance still required',candidateCount:candidates.length,rubbleSampling:{source:'actual post-settlement sparse rubble-body member IDs',maxReturnedCells:64},maxCenterAbsX:62,maxCenterAbsZ:58,distinctBuildingsPreferred:true,repeatSurvivingBuildingFallback:true};
 progress('fixture-ready',evidence.targetPlan);

 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl']});
 evidence.provenance.browserVersion=browser.version();
 const context=await browser.newContext({viewport:evidence.scope.viewport,deviceScaleFactor:1});
 await context.addInitScript(snapshot=>{
  const key='city-nova-qa-fixture-installed';
  if(!sessionStorage.getItem(key)){
   localStorage.setItem('hepingmoniqi.structural.v09',JSON.stringify({savedAt:1,snapshot}));
   sessionStorage.setItem(key,'synthetic-unlock-only-not-organic-progression');
  }
  // Observers own only their own storage. No application/clock method wrapping.
  const p={longTasks:[],inputEvents:[],rafGaps:[],clicks:[],renders:[],samples:[],armed:null,lastRAF:null,lastRender:0,lastSurface:null,overflow:false,activeShot:null,milestones:{},observer:null,inputObserver:null};
  const addTask=e=>p.longTasks.push({start:e.startTime,duration:e.duration,name:e.name});
  if(PerformanceObserver.supportedEntryTypes.includes('longtask')){p.observer=new PerformanceObserver(list=>list.getEntries().forEach(addTask));p.observer.observe({type:'longtask',buffered:true});}
  const addInput=e=>p.inputEvents.push({name:e.name,start:e.startTime,duration:e.duration,processingStart:e.processingStart,processingEnd:e.processingEnd,interactionId:e.interactionId??null,queueDelayMs:e.processingStart-e.startTime,handlerMs:e.processingEnd-e.processingStart});
  if(PerformanceObserver.supportedEntryTypes.includes('event')){p.inputObserver=new PerformanceObserver(list=>list.getEntries().forEach(addInput));p.inputObserver.observe({type:'event',buffered:true,durationThreshold:16});}
  p.flush=()=>{p.observer?.takeRecords().forEach(addTask);p.inputObserver?.takeRecords().forEach(addInput);};
  document.addEventListener('click',event=>{
   const button=event.target instanceof Element?event.target.closest('button'):null;
   if(p.armed&&button?.matches(p.armed.selector)){p.clicks.push({label:p.armed.label,at:performance.now(),trusted:event.isTrusted});p.armed=null;}
  },true);
  const observe=now=>{
   if(p.lastRAF!==null)p.rafGaps.push({start:p.lastRAF,end:now,gap:now-p.lastRAF});p.lastRAF=now;
   const h=window.__heping;
   if(h?.sceneDiagnostics){
    const d=h.sceneDiagnostics();
    for(const row of d.recentRenders??[]){const prior=p.renders.findLast(r=>r.count===row.count);if(prior){if(row.nextFrameAt!==null)prior.nextFrameAt=row.nextFrameAt;}else p.renders.push({...row});}
    if(d.renderCount!==p.lastRender){
     const observedAt=performance.now(),c=h.compactDiagnostics(),s=d.voxelRender;
     const previous=p.samples.at(-1),sameEpoch=!!c&&previous?.epoch===c.epoch;
     const sample={observedAt,renderCount:d.renderCount,mapId:d.mapId,screen:h.screen,flow:h.flow,epoch:c?.epoch??null,
      authorityRevision:c?.revision??null,authorityRevisionDelta:sameEpoch?c.revision-previous.authorityRevision:null,
      surfaceRevision:s?.revision??null,surfaceRevisionDelta:previous?.mapId===d.mapId&&previous.surfaceRevision!==null?s.revision-previous.surfaceRevision:null,
      pending:h.pendingWork(),activeEffects:h.activeEffects,renderedProjectiles:h.renderedProjectiles,projectiles:h.projectiles().map(q=>({id:q.id,weapon:q.weapon})),
      effects:d.effects.events.filter(e=>e.kind==='detonation'),aggregate:c?.aggregate??null,
      surface:{registeredChunks:s?.registeredChunks??null,lastBindReused:s?.lastBindReused??null,lastRebuild:s?.lastRebuild??null,faces:s?.faces??null,movingCells:s?.movingCells??null,changedRevisionEntries:s?.changedRevisionEntries??null},
      cumulativeFullBinds:null,cumulativeCursorResets:null};
     p.samples.push(sample);p.lastRender=d.renderCount;
     if(p.activeShot){
      const m=p.milestones[p.activeShot]??={};
      const click=p.clicks.findLast(c=>c.label===p.activeShot),actualRender=d.recentRenders?.at(-1);
      const projectile=sample.projectiles.find(q=>q.weapon==='nova');if(!m.projectile&&projectile&&sample.renderedProjectiles>0&&actualRender?.startedAt>=click?.at)m.projectile={at:observedAt,...projectile,renderCount:d.renderCount,renderedProjectiles:sample.renderedProjectiles,actualRender:{...actualRender}};
      const det=h.lastDetonations().find(q=>q.id===m.projectile?.id);
      if(!m.detonation&&det)m.detonation={observedAt,renderCount:d.renderCount,event:det,effect:sample.effects.find(e=>e.id===det.id)??null};
      if(m.detonation&&!m.settlement&&sample.pending===0&&!sample.activeEffects)m.settlement={observedAt,renderCount:d.renderCount,aggregate:sample.aggregate};
     }
    }
   }
   for(const key of ['rafGaps','renders','samples','longTasks','inputEvents'])if(p[key].length>40000){p[key].splice(0,10000);p.overflow=true;}
   requestAnimationFrame(observe);
  };
  requestAnimationFrame(observe);window.__cityNovaQA=p;
 },fixture);
 page=await context.newPage();page.setDefaultTimeout(Math.min(stepTimeout,30000));
 cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
 page.on('pageerror',error=>{fatal=String(error);evidence.errors.push({at:new Date().toISOString(),error:fatal});progress('runtime-error',{error:fatal});});
 page.on('console',message=>{if(message.type()==='error')evidence.consoleErrors.push({at:new Date().toISOString(),text:message.text()});});
 const remaining=()=>Math.max(1,Math.min(stepTimeout,overallLimit-(Date.now()-startedWall)));
 async function wait(name,predicate,arg){
  activeStage=name;progress('wait-start',{name,timeoutMs:remaining()});
  const ticker=setInterval(()=>progress('wait-pending',{name}),15000);ticker.unref();
  try{await page.waitForFunction(predicate,arg,{timeout:remaining(),polling:'raf'});if(fatal)throw new Error(fatal);}finally{clearInterval(ticker);}
  progress('wait-complete',{name});
 }
 const read=()=>page.evaluate(()=>{const h=window.__heping;return {at:performance.now(),screen:h.screen,mode:h.mode,flow:h.flow,ready:h.physicsReady,pending:h.pendingWork(),activeEffects:h.activeEffects,compact:h.compactDiagnostics(),scene:h.sceneDiagnostics(),lifecycle:h.physicsLifecycle(),objective:h.objective(),round:h.round(),mainResearch:h.mainResearch,detonations:h.lastDetonations(),projectiles:h.projectiles(),surface:h.aimSurface(),actionTiming:h.actionTiming()};});
 async function lifecycle(n){await wait(`active-worlds-${n}`,n=>{const s=window.__heping.physicsLifecycle();return s.activeWorlds===n&&!s.transitioning&&s.projectileBound===(n===1);},n);}
 async function saveReady(){await wait('save-transaction-complete',()=>!window.__heping.saveStatus().pending);const s=await page.evaluate(()=>window.__heping.saveStatus());assert.equal(s.error,null);assert.equal(s.readFailed,false);return s;}
 async function memory(stage){
  const heap=await cdp.send('Runtime.getHeapUsage'),dom=await cdp.send('Memory.getDOMCounters'),state=await read();
  const row={stage,at:new Date().toISOString(),forcedGC:false,priorDiagnosticSparseSnapshotReads:evidence.rubbleSnapshotReads??0,heap,dom,compact:state.compact,surface:state.scene.voxelRender,lifecycle:state.lifecycle,nativeWasmBytes:null,gpuResidentBytes:null,geometryTypedBufferEstimateBytes:state.scene.voxelRender?.typedBufferBytes??null};
  assert.ok(Number.isFinite(heap.usedSize));evidence.memory.push(row);progress('memory',{stage,jsHeapBytes:heap.usedSize,backingStorageBytes:heap.backingStorageSize??null});await persist();return row;
 }
 async function capture(name,shotId=null){
  activeStage=`screenshot-${name}`;const before=await read();progress('screenshot-start',{name});
  const bytes=await page.screenshot({type:'jpeg',quality:65,timeout:Math.min(30000,remaining()),animations:'allow'});const after=await read();
  await fs.writeFile(`${output}/${name}.jpg`,bytes);
  const row={name,path:`${output}/${name}.jpg`,bytes:bytes.length,startedAt:before.at,finishedAt:after.at,paused:false,slowMotion:false,
   actualEffectAtStart:before.scene.effects.events.find(e=>e.id===shotId)??null,actualEffectAtEnd:after.scene.effects.events.find(e=>e.id===shotId)??null,
   renderCountBefore:before.scene.renderCount,renderCountAfter:after.scene.renderCount,aggregateBefore:before.compact?.aggregate??null,aggregateAfter:after.compact?.aggregate??null,
   note:'Capture interval overlaps live simulation; effect before/after do not identify an exact physical presentation instant.'};
  row.logExport={format:'SCREENSHOT_BASE64',emitted:bytes.length<=220000,byteLimit:220000};
  evidence.screenshots.push(row);progress('screenshot-complete',{name,bytes:bytes.length,actualEffectAtStart:row.actualEffectAtStart,actualEffectAtEnd:row.actualEffectAtEnd});
  // Export the SAME JPEG bytes once, never retake a screenshot for log size.
  if(bytes.length<=220000)console.log(`SCREENSHOT_BASE64 ${name} ${bytes.toString('base64')}`);
  else progress('screenshot-log-export-skipped',{name,bytes:bytes.length,byteLimit:220000,reason:'Existing JPEG exceeds log export limit; file retained, screenshot not retaken'});
  await persist();return row;
 }
 async function arm(label,selector,{shot=false,shotId=null}={}){
  await page.locator(selector).scrollIntoViewIfNeeded();
  return page.evaluate(({label,selector,shot,shotId})=>{const p=window.__cityNovaQA;p.flush();p.armed={label,selector};if(shot){p.activeShot=label;if(shotId)p.milestones[label]={projectile:{id:shotId,source:'previously observed real placement'}};}return {label,selector,baselineAt:performance.now(),baselineRender:window.__heping.sceneDiagnostics().renderCount};},{label,selector,shot,shotId});
 }
 async function timing(mark,extra={}){
  await wait(`${mark.label}-actual-render-and-next-scene-callback`,mark=>{
   const p=window.__cityNovaQA,click=p.clicks.findLast(c=>c.label===mark.label);
   return click&&p.renders.some(r=>r.count>mark.baselineRender&&r.startedAt>=click.at&&r.nextFrameAt!==null);
  },mark);
  const result=await page.evaluate(mark=>{
   const p=window.__cityNovaQA;p.flush();const click=p.clicks.findLast(c=>c.label===mark.label),end=performance.now();
   const renders=p.renders.filter(r=>r.count>mark.baselineRender&&r.startedAt>=click.at),first=renders[0];
   const tasks=p.longTasks.filter(t=>t.start<end&&t.start+t.duration>click.at),gaps=p.rafGaps.filter(g=>g.end>click.at&&g.start<end);
   return {click,startedAt:click.at,finishedAt:end,observationMs:end-click.at,firstActualRender:first,
    clickToFirstRenderSubmissionMs:first.finishedAt-click.at,clickToNextSceneCallbackMs:first.nextFrameAt-click.at,actualRenderCount:renders.length,
    renderCpuMs:renders.map(r=>r.finishedAt-r.startedAt),longTaskCount:tasks.length,longTaskTotalMs:tasks.reduce((n,t)=>n+t.duration,0),longTaskMaxMs:Math.max(0,...tasks.map(t=>t.duration)),longTasks:tasks,
    inputEvents:p.inputEvents.filter(e=>e.start<end&&e.start+e.duration>click.at),inputEventTimingAvailable:PerformanceObserver.supportedEntryTypes.includes('event'),inputEventTimingNote:'Browser Event Timing may be duration-rounded and omit events below its threshold; empty is not zero input latency.',
    taskAccounting:'Whole tasks overlapping window, not clipped CPU attribution',rafSamples:gaps.length,maxRAFGapMs:Math.max(0,...gaps.map(g=>g.gap)),
    samples:p.samples.filter(s=>s.observedAt>=click.at&&s.observedAt<=end),milestones:p.milestones[mark.label]??null,observerOverflow:p.overflow};
  },mark);
  assert.equal(result.click.trusted,true);assert.ok(result.clickToFirstRenderSubmissionMs>=0);assert.ok(result.clickToNextSceneCallbackMs>=0);assert.equal(result.observerOverflow,false);
  const row={label:mark.label,...result,...extra};evidence.timings.push(row);progress('timing-complete',{label:mark.label,observationMs:row.observationMs,clickToFirstRenderSubmissionMs:row.clickToFirstRenderSubmissionMs,maxRAFGapMs:row.maxRAFGapMs,longTaskCount:row.longTaskCount});await persist();return row;
 }
 function cityIdentity(state){
  assert.equal(state.compact.mapId,'city');assert.equal(state.compact.originalCount,454913);assert.equal(state.compact.terrainCount,401800);assert.equal(state.compact.structureCount,53113);assert.equal(state.compact.bounds.minY,-8);
  assert.equal(state.scene.representation,'chunk-surfaces');assert.equal(state.scene.voxelRender.retainedCellViews,0);assert.equal(state.compact.storage.retainedPristineStates,0);assert.equal(state.lifecycle.activeWorlds,1);
 }
 const usedBuildings=new Set();
 async function aimBuilding(index){
  activeStage=`aim-building-${index}`;const rejected=[];
  for(const repeat of [false,true]){
   if(repeat&&!usedBuildings.size)continue;
   for(const candidate of candidates){
    if(usedBuildings.has(candidate.objectId)!==repeat)continue;
    const view=await page.evaluate(c=>{const h=window.__heping,cell=h.authorityCell(c.id),pixel=h.project(c.point);return {cell,pixel,uncovered:pixel.visible&&document.elementFromPoint(pixel.x,pixel.y)?.tagName==='CANVAS'};},candidate);
    if(!view.cell||view.cell.state!=='static'||view.cell.hp<=0||!view.uncovered){rejected.push({id:candidate.id,reason:'not surviving static objective or not visible/uncovered'});continue;}
    await page.mouse.click(view.pixel.x,view.pixel.y);
    const hit=await page.evaluate(()=>{const h=window.__heping,surface=h.aimSurface();return {surface,cell:surface?h.authorityCell(surface.voxelId):null};});
    if(hit.surface?.voxelId!==candidate.id||!hit.cell||!['building','foundation'].includes(hit.cell.role)||!cityFixture.objectiveOf(hit.cell.id)||hit.cell.objectId!==candidate.objectId){rejected.push({id:candidate.id,reason:'actual UI ray not the intended objective building',actualId:hit.surface?.voxelId??null});continue;}
    assert.equal(hit.cell.state,'static');assert.equal(await page.locator('#fire').isEnabled(),true);usedBuildings.add(hit.cell.objectId);
    const result={requested:candidate,cell:hit.cell,surface:hit.surface,pixel:view.pixel,repeatedBuildingFallback:repeat,rejectedCandidates:rejected};
    progress('building-aim-confirmed',{index,id:hit.cell.id,objectId:hit.cell.objectId,role:hit.cell.role,position:hit.surface.position,repeatedBuildingFallback:repeat});return result;
   }
  }
  throw new Error(`No real visible surviving objective building ray among ${candidates.length} bounded candidates; ${rejected.length} rejected checks. No soil fallback or synthetic aim allowed.`);
 }
 // The surviving debris can be a single arbitrary terrain or building cell.
 // Sample actual authoritative rubble-body membership, not a fixed grid of
 // original building IDs. All sparse snapshot work is OUTSIDE shot timings and
 // stays inside the page; only scalars and at most 64 owned cell records return.
 async function rubbleSample(stage){
  activeStage=`${stage}-read-current-rubble`;
  const sample=await page.evaluate(limit=>{
   const h=window.__heping,startedAt=performance.now(),before=h.compactDiagnostics();
   if(h.pendingWork()!==0||h.activeEffects)throw new Error('Rubble sampling requires natural completed settlement');
   const snapshot=h.snapshot(),simulation=snapshot.structural?.simulation;
   if(!simulation||!Array.isArray(simulation.bodies)||!Array.isArray(simulation.changes))throw new Error('Missing real sparse snapshot body membership');
   const selected=new Map();let rubbleBodies=0,rubbleBodyMembers=0,nonRubbleBodies=0;
   for(const body of simulation.bodies){
    if(body.status!=='rubble'){nonRubbleBodies++;continue;}rubbleBodies++;
    for(const id of body.cells){rubbleBodyMembers++;if(selected.size<limit&&!selected.has(id))selected.set(id,{bodyId:body.id,rootShotId:body.rootShotId});}
   }
   const saved=new Map();for(const row of simulation.changes)if(selected.has(row[0]))saved.set(row[0],row);
   const cells=[];
   for(const [id,body] of selected){
    const c=h.authorityCell(id),row=saved.get(id);
    if(!c||c.state!=='rubble'||!row||row[3]!==2||row.length!==12)throw new Error(`Rubble body member ${id} has no matching authoritative/saved rubble cell`);
    cells.push({id,...body,role:c.role,objectId:c.objectId,state:c.state,hp:c.hp,position:{...c.position},rotation:{...c.rotation},saved:{hp:row[1],stateIndex:row[3],position:{x:row[4],y:row[5],z:row[6]},rotation:{x:row[7],y:row[8],z:row[9],w:row[10]},bodyId:row[11]}});
   }
   return {startedAt,finishedAt:performance.now(),epoch:before.epoch,revision:before.revision,aggregate:before.aggregate,pending:h.pendingWork(),primaryEffects:h.activeEffects,snapshot:{schemaVersion:snapshot.schemaVersion,simulationSchema:simulation.schema,tick:simulation.tick,sparseChangeRows:simulation.changes.length,rubbleBodies,rubbleBodyMembers,nonRubbleBodies},cells,limit,sampling:'Actual sparse rubble body IDs; no full snapshot or full-city cell array crossed the browser boundary'};
  },64);
  evidence.rubbleSnapshotReads=(evidence.rubbleSnapshotReads??0)+1;
  assert.equal(sample.pending,0);assert.equal(sample.primaryEffects,false);assert.equal(sample.snapshot.nonRubbleBodies,0);
  assert.equal(sample.snapshot.rubbleBodyMembers,sample.aggregate.rubble,'Every aggregate rubble cell must belong to an actual saved rubble body');
  assert.equal(sample.cells.length,Math.min(sample.limit,sample.aggregate.rubble),'Actual current rubble must be sampled even when only one cell survives');
  for(const c of sample.cells){
   const original=cityFixture.originalPosition(c.id);assert.ok(original,`Rubble ${c.id} must exist in the immutable production fixture`);
   assert.equal(c.role,cityFixture.roleOf(c.id));assert.equal(c.objectId,cityFixture.objectIdOf(c.id));assert.equal(c.state,'rubble');assert.ok(c.hp>0);
   assert.equal(c.saved.hp,c.hp);assert.equal(c.saved.bodyId,c.bodyId);assert.deepEqual(c.saved.position,c.position);assert.deepEqual(c.saved.rotation,c.rotation);
   c.original=original;c.originalRole=cityFixture.roleOf(c.id);c.originalObjective=cityFixture.objectiveOf(c.id);
   c.verticalDrop=original.y-c.position.y;c.displacement=Math.hypot(c.position.x-original.x,c.position.y-original.y,c.position.z-original.z);
   c.fallenBelowOriginal=c.verticalDrop>.25;
  }
  sample.stage=stage;sample.snapshotReadMs=sample.finishedAt-sample.startedAt;sample.fallenBelowOriginal=sample.cells.filter(c=>c.fallenBelowOriginal).length;
  sample.roleCounts=Object.fromEntries([...new Set(sample.cells.map(c=>c.role))].map(role=>[role,sample.cells.filter(c=>c.role===role).length]));
  sample.note='Rubble is the authoritative settled-body state. Original terrain and original building debris are distinguished; falling below the original height is reported, not assumed for every surviving cell.';
  if(sample.cells.length){
   // No blast or reset occurs in this interval. Ordinary live callbacks keep
   // running; rereading the same real IDs proves persistence, not a fake pose.
   await wait(`${stage}-rubble-persists-with-live-clock`,at=>{const h=window.__heping,p=window.__cityNovaQA;return performance.now()-at>=350&&p.lastRAF>at&&h.pendingWork()===0&&!h.activeEffects;},sample.finishedAt);
   const later=await page.evaluate(ids=>{const h=window.__heping;return {at:performance.now(),epoch:h.compactDiagnostics().epoch,pending:h.pendingWork(),cells:ids.map(id=>{const c=h.authorityCell(id);return c?{id,state:c.state,hp:c.hp,position:{...c.position},rotation:{...c.rotation}}:null;})};},sample.cells.map(c=>c.id));
   assert.equal(later.epoch,sample.epoch);assert.equal(later.pending,0);assert.ok(later.at-sample.finishedAt>=350);
   assert.deepEqual(later.cells,sample.cells.map(c=>({id:c.id,state:c.state,hp:c.hp,position:c.position,rotation:c.rotation})),'Settled rubble IDs and exact real poses must persist through live unpaused callbacks');
   sample.persistence={verified:true,elapsedMs:later.at-sample.finishedAt,unchangedCells:later.cells.length,at:later.at,resetUsed:false};
  }else sample.persistence={verified:false,reason:'No rubble present at this settlement'};
  progress('actual-rubble-sampled',{stage,aggregateRubble:sample.aggregate.rubble,returnedCells:sample.cells.length,roleCounts:sample.roleCounts,fallenBelowOriginal:sample.fallenBelowOriginal,persistence:sample.persistence,snapshotReadMs:sample.snapshotReadMs});
  return sample;
 }

 progress('navigation-start',{url});await page.goto(url,{waitUntil:'networkidle',timeout:remaining()});
 await wait('formal-game-ready',()=>window.__heping?.physicsReady&&typeof window.__heping.authorityCell==='function'&&typeof window.__heping.actionTiming==='function');await lifecycle(0);await saveReady();
 assert.equal(await page.evaluate(()=>window.__heping.mainResearch),1400);
 const mainBefore=await page.evaluate(()=>window.__heping.mainSnapshot());
 evidence.mainIsolation={before:{research:mainBefore.research,mapId:mainBefore.mapId,round:mainBefore.round,destroyedCount:mainBefore.destroyedCount,sha256:hash(mainBefore)},damagedCityBrowserRestoreVerified:false};
 evidence.provenance.browser=await page.evaluate(()=>({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory??null,longTaskAPI:PerformanceObserver.supportedEntryTypes.includes('longtask')}));
 await memory('fresh-home');
 await page.locator('#mode-free').click();await wait('free-setup',()=>window.__heping.screen==='setup');
 const selection=await arm('city-card-selection','[data-scene="city"]');await page.locator('[data-scene="city"]').click({timeout:remaining()});
 await wait('city-preview-rendered',()=>{const h=window.__heping;return h.screen==='setup'&&h.selectedScene==='city'&&h.previewMap==='city'&&h.sceneDiagnostics().lastRenderedMap==='city';});
 await timing(selection,{endCondition:'city preview selected and actually rendered'});await lifecycle(0);
 for(const id of weapons){const toggle=page.locator(`[data-free-tool="${id}"]`),selected=await toggle.getAttribute('aria-pressed')==='true';if(selected!==(id==='nova'))await toggle.click();}
 const start=await arm('city-experiment-start','#start-experiment');await page.locator('#start-experiment').click({timeout:remaining()});
 await wait('city-playing',()=>{const h=window.__heping;return h.screen==='playing'&&h.physicsReady&&h.sceneDiagnostics().lastRenderedMap==='city';});await lifecycle(1);
 const initial=await read();cityIdentity(initial);assert.equal(initial.pending,0);assert.equal(initial.compact.storage.mutableStates,0);
 assert.equal(initial.scene.voxelRender.lastBindReused,true);assert.equal(initial.scene.voxelRender.lastRebuild.chunks,0);
 assert.equal(await page.evaluate(()=>window.__heping.unlimitedAmmo),true);
 await page.locator('[data-weapon="nova"]').click();await page.locator('#power').press('End');
 assert.equal(await page.locator('#power-value').innerText(),'100%');assert.equal(await page.locator('#power').inputValue(),'100');
 // A real UI collapse keeps center-city rays clear; no DOM/CSS or camera edits.
 if(await page.locator('#tool-rail-toggle').getAttribute('aria-expanded')==='true')await page.locator('#tool-rail-toggle').click();
 await timing(start,{endCondition:'pristine city authority active and actually rendered',startup:await page.evaluate(()=>window.__heping.startupEvidence())});
 await memory('city-pristine');

 for(let index=1;index<=3;index++){
  await page.locator(`[data-delivery="${index===1?'place':'quick'}"]`).click();
  if(index>1)await page.locator('[data-trigger="automatic"]').click();
  assert.equal(await page.locator(`[data-trigger="${index===1?'remote':'automatic'}"]`).getAttribute('aria-pressed'),'true');
  const aim=await aimBuilding(index),before=await read();cityIdentity(before);assert.equal(before.pending,0);assert.equal(before.flow,'active');assert.equal(await page.locator('#power').inputValue(),'100');
  assert.equal(await page.locator('#pause').evaluate(e=>e.classList.contains('active')),false);assert.equal(await page.locator('#slow').evaluate(e=>e.classList.contains('active')),false);
  let label=`nova-${index}-${index===1?'place':'launch'}`,mark=await arm(label,'#fire',{shot:true});await page.locator('#fire').click();
  await wait(`${label}-native-projectile`,label=>!!window.__cityNovaQA.milestones[label]?.projectile,label);
  const projectile=await page.evaluate(label=>window.__cityNovaQA.milestones[label].projectile,label);
  let placementTiming=null;
  if(index===1){
   const placed=await read();assert.ok(placed.projectiles.some(p=>p.id===projectile.id));assert.equal(placed.detonations.length,0,'Surface placement is remote, not an invented fuse');
   placementTiming=await timing(mark,{endCondition:'actual surface placement accepted and native projectile rendered; not yet detonated',shotId:projectile.id});
   label='nova-1-detonate';mark=await arm(label,'#detonate',{shot:true,shotId:projectile.id});
   assert.equal(await page.locator('#detonate').isEnabled(),true);await page.locator('#detonate').click({timeout:remaining()});
  }
  await wait(`${label}-actual-detonation`,id=>window.__heping.lastDetonations().some(e=>e.id===id),projectile.id);
  const detonated=await read(),detonation=detonated.detonations.find(e=>e.id===projectile.id);assert.equal(detonation.weapon,'nova');assert.equal(detonation.power,1);assert.equal(detonation.reason,index===1?'remote':'impact');
  const row={index,weapon:'nova',powerPercent:100,deployment:index===1?'place + real remote detonate':'launch + automatic collision',placementTimingLabel:placementTiming?.label??null,projectileId:projectile.id,aim,detonation,
   actionTiming:detonated.actionTiming.filter(e=>e.id===projectile.id||(e.kind==='remote-trigger-request'&&e.at>=before.at)),
   before:{epoch:before.compact.epoch,revision:before.compact.revision,aggregate:before.compact.aggregate,surface:before.scene.voxelRender},
   detonationObserved:{at:detonated.at,revision:detonated.compact.revision,revisionDelta:detonated.compact.revision-before.compact.revision,aggregate:detonated.compact.aggregate,surface:detonated.scene.voxelRender},naturalSettlement:false};
  evidence.blasts.push(row);progress('nova-detonated',{index,projectileId:projectile.id,position:detonation.position,pending:detonated.pending,revisionDelta:row.detonationObserved.revisionDelta});await persist();
  if(index===1){
   const effect=detonated.scene.effects.events.find(e=>e.id===projectile.id);assert.ok(effect,'The actual nova must enter the real scene effect channel');
   row.effectProfile=EFFECT_PROFILES.nova;row.firstObservedEffect=effect;
   row.firstObservedPhase=effect.age<EFFECT_PROFILES.nova.flash?'flash-and-fire':effect.age<EFFECT_PROFILES.nova.fire?'fire':'smoke';
   await capture('city-nova-1-live-effect',projectile.id);
  }
  await wait(`${label}-natural-pending-zero`,()=>window.__heping.pendingWork()===0&&!window.__heping.activeEffects);
  const after=await read();cityIdentity(after);assert.equal(after.projectiles.length,0);assert.equal(after.flow,'active');assert.equal(after.compact.epoch,initial.compact.epoch,'The three blasts must share one unreset city authority');
  assert.ok(after.objective.destroyed>before.objective.destroyed,'Each objective-building nova must cause additional authoritative building departure');
  row.after={at:after.at,pending:after.pending,primaryEffects:after.activeEffects,aggregate:after.compact.aggregate,storage:after.compact.storage,objective:after.objective,revision:after.compact.revision,revisionDelta:after.compact.revision-before.compact.revision,surface:after.scene.voxelRender};
  row.naturalSettlement=true;row.timingLabel=label;
  const shotTiming=await timing(mark,{endCondition:'actual native nova detonation, natural pending=0, primary envelope ended; decorative smoke may remain',shotId:projectile.id,screenshotOverlap:index===1});
  const event=kind=>row.actionTiming.find(e=>e.kind===kind),startDamage=event('damage-start'),endDamage=event('damage-end'),surfaceEnd=event('surface-sync-end');
  assert.ok(event('deployment-request')&&event('deployment-result')?.accepted&&event('detonation-received')&&startDamage&&endDamage&&event('surface-sync-start')&&surfaceEnd,'Actual action timing phases must be observed, not inferred');
  const renderAfterDamage=await page.evaluate(at=>window.__cityNovaQA.renders.find(r=>r.startedAt>=at&&r.mapId==='city'&&r.nextFrameAt!==null),surfaceEnd.at);assert.ok(renderAfterDamage);
  row.actionLatency={deploymentClickToRequestMs:event('deployment-request').at-(placementTiming?.startedAt??shotTiming.startedAt),deploymentClickToAcceptedMs:event('deployment-result').at-(placementTiming?.startedAt??shotTiming.startedAt),deploymentRequestToAcceptedMs:event('deployment-result').at-event('deployment-request').at,detonationReceivedToDamageStartMs:startDamage.at-event('detonation-received').at,damageMs:endDamage.at-startDamage.at,surfaceSyncMs:surfaceEnd.at-event('surface-sync-start').at,firstActualPostDamageRender:renderAfterDamage,damageStartToRenderSubmissionMs:renderAfterDamage.finishedAt-startDamage.at,damageStartToNextSceneCallbackMs:renderAfterDamage.nextFrameAt-startDamage.at,triggerClickToDetonationReceivedMs:index===1?event('detonation-received').at-shotTiming.startedAt:null,triggerClickToRenderSubmissionMs:index===1?renderAfterDamage.finishedAt-shotTiming.startedAt:null,triggerClickToNextSceneCallbackMs:index===1?renderAfterDamage.nextFrameAt-shotTiming.startedAt:null};
  row.responsiveness={measurement:'Observed actual main-thread damage interval, overlapping long tasks, and real animation callback gaps; no unsupported claim of UI responsiveness during synchronous damage',damageMs:row.actionLatency.damageMs,longTasksOverlappingDamage:shotTiming.longTasks.filter(t=>t.start<endDamage.at&&t.start+t.duration>startDamage.at),maxObservedRAFGapMs:shotTiming.maxRAFGapMs,inputEventTimingAvailable:shotTiming.inputEventTimingAvailable,observedInputEvents:shotTiming.inputEvents};
  await page.evaluate(()=>{window.__cityNovaQA.activeShot=null;});
  row.settledRubble=await rubbleSample(`after-nova-${index}`);
  // Later real novas may legitimately destroy previously persistent debris.
  // Record that history without requiring first-shot debris to survive attacks.
  if(index>1){
   const previous=evidence.blasts[index-2].settledRubble.cells;
   row.previousRubbleAfterThisBlast=await page.evaluate(ids=>ids.map(id=>{const c=window.__heping.authorityCell(id);return {id,state:c?.state??'unavailable',position:c?{...c.position}:null,hp:c?.hp??null};}),previous.map(c=>c.id));
  }
  await memory(`city-after-nova-${index}`);progress('nova-naturally-settled',{index,pending:after.pending,objectiveDestroyed:after.objective.destroyed,rubble:after.compact.aggregate.rubble});await persist();
  if(index===1)await capture('city-nova-1-aftermath',projectile.id);
 }
 assert.equal(evidence.blasts.length,3);assert.equal(new Set(evidence.blasts.map(b=>b.projectileId)).size,3);
 const finalCity=await read();assert.equal(finalCity.pending,0);assert.equal(finalCity.activeEffects,false);assert.ok(finalCity.compact.aggregate.rubble>0,'Natural final state must retain actual rubble');
 const currentRubble=evidence.blasts.at(-1).settledRubble,fallen=currentRubble.cells.filter(c=>c.fallenBelowOriginal);
 evidence.finalCity={aggregate:finalCity.compact.aggregate,objective:finalCity.objective,epoch:finalCity.compact.epoch,distinctTargetBuildings:usedBuildings.size,currentRubbleSample:currentRubble.cells,fallenRubbleSample:fallen.slice(0,24),sampledRubbleCount:currentRubble.cells.length,rubblePersistence:currentRubble.persistence,surface:finalCity.scene.voxelRender};
 assert.equal(currentRubble.aggregate.rubble,finalCity.compact.aggregate.rubble);
 assert.ok(currentRubble.cells.length>0&&currentRubble.persistence.verified,'Bounded real rubble-body IDs and their authoritative settled poses must persist with no reset');
 assert.ok(currentRubble.cells.some(c=>c.displacement>1e-3||Math.abs(c.rotation.w)<1-1e-6),'Actual surviving rubble must differ from its immutable original pose, not just an aggregate or cosmetic effect');
 assert.ok(finalCity.objective.destroyed>0,'True building damage remains a separate strict requirement from the original material of final surviving rubble');
 await capture('city-after-three-novas-persistent-rubble');
 const end=await arm('city-natural-end','#finish-round');await page.locator('#finish-round').click();
 await wait('city-ended-without-reset',()=>{const h=window.__heping;return h.screen==='setup'&&h.flow==='settled'&&h.pendingWork()===0&&!h.activeEffects;});
 await lifecycle(0);await timing(end,{endCondition:'real End control returns naturally settled free city to setup',pendingBeforeEnd:finalCity.pending});
 evidence.end={natural:true,resetUsed:false,screen:await page.evaluate(()=>window.__heping.screen),lifecycle:await page.evaluate(()=>window.__heping.physicsLifecycle())};
 await page.locator('#setup-back').click();await wait('home-after-city',()=>window.__heping.screen==='home');await lifecycle(0);await saveReady();
 const mainAfter=await page.evaluate(()=>window.__heping.mainSnapshot());assert.deepEqual(mainAfter,mainBefore,'Free city destruction must not alter the main snapshot');
 evidence.mainIsolation.after={research:mainAfter.research,destroyedCount:mainAfter.destroyedCount,sha256:hash(mainAfter)};evidence.mainIsolation.exactBeforeReload=true;
 await memory('home-after-three-city-novas');
 // Persist the measured pre-reload observation, because init observers reset.
 evidence.observer=await page.evaluate(()=>{const p=window.__cityNovaQA;p.flush();return {samples:p.samples,renders:p.renders,longTasks:p.longTasks,inputEvents:p.inputEvents,overflow:p.overflow,milestones:p.milestones};});
 assert.equal(evidence.observer.overflow,false);await persist();
 await page.reload({waitUntil:'networkidle',timeout:remaining()});await wait('main-progress-durable-reload',()=>window.__heping?.physicsReady);await lifecycle(0);await saveReady();
 const reloaded=await page.evaluate(()=>window.__heping.mainSnapshot());
 for(const key of ['research','round','destroyedCount','mapId','completedMaps'])assert.deepEqual(reloaded[key],mainBefore[key],`Main ${key} must survive durable reload`);
 evidence.mainIsolation.durableMainProgressVerified=true;evidence.mainIsolation.reload={research:reloaded.research,mapId:reloaded.mapId,round:reloaded.round,destroyedCount:reloaded.destroyedCount};
 assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.consoleErrors,[]);
 evidence.gaps.push('No cumulative renderer reset/full-bind counter exists. Observed lastRebuild reports and revision deltas cannot prove an exhaustive reset count.');
 evidence.gaps.push('No independent native/WASM heap, GPU-resident byte meter, GPU completion fence, or physical-present timing is provided.');
 evidence.gaps.push('Damaged-city save/restore is intentionally not claimed by this free-mode UI run; it requires separate native or main-mode evidence.');
 evidence.status='functional-checks-passed';evidence.finishedAt=new Date().toISOString();progress('functional-checks-complete',{blasts:3,distinctTargetBuildings:usedBuildings.size,performanceVerdict:evidence.performanceVerdict});
}catch(error){
 if(evidence.status==='running')evidence.status='failed';evidence.failure=String(error);evidence.failedAt=new Date().toISOString();evidence.failedStage=activeStage;process.exitCode=1;
 progress('failed',{stage:activeStage,error:String(error)});
 if(page&&!page.isClosed()){
  // Diagnostics only. No cleanup reset, deferred End shortcut, or fake success.
  evidence.failureState=await page.evaluate(()=>{const h=window.__heping,p=window.__cityNovaQA;return h?{screen:h.screen,flow:h.flow,pending:h.pendingWork(),activeEffects:h.activeEffects,compact:h.compactDiagnostics(),scene:h.sceneDiagnostics(),lifecycle:h.physicsLifecycle(),observer:p?{samples:p.samples,renders:p.renders,milestones:p.milestones,overflow:p.overflow}:null}:null;}).catch(()=>null);
 }
}finally{
 evidence.wallMs=Date.now()-startedWall;await persist();console.log('CITY_NOVA_RESULT '+JSON.stringify(evidence));await browser?.close();clearTimeout(watchdog);
}
