import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// PREPARED HARNESS ONLY until separately authorized CI dispatch. --self-test
// imports/launches/connects no browser. Never use a local-computer fallback.
const TARGETS=Object.freeze({inputMs:100,mainLongTaskMs:100,damageCommitMs:250,staticVisibleMs:500,visibleMs:500});
const stats=values=>({count:values.length,p95:values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]:null,max:values.length?Math.max(...values):null});
const gates=row=>({
 trustedInputObserved:row.inputMs.length>0&&row.trustedProbe===true,
 input:row.inputMs.length>0&&stats(row.inputMs).p95<TARGETS.inputMs,
 mainLongTasks:row.longTaskAPI===true&&row.longTasks.every(t=>t.duration<TARGETS.mainLongTaskMs),
 damageCommit:Number.isFinite(row.damageCommitMs)&&row.damageCommitMs<TARGETS.damageCommitMs,
 staticVisible:Number.isFinite(row.staticVisibleMs)&&row.staticVisibleMs<TARGETS.staticVisibleMs,
 completeVisible:Number.isFinite(row.visibleMs)&&row.visibleMs<TARGETS.visibleMs,
 actualRender:row.renderCount>0,
 naturalRecovery:row.settled===true&&row.finalDebtMs<100,
});
function selfTest(){
 assert.equal(distance({x:0,y:0,z:0},{x:3,y:4,z:0}),5);
 const good={inputMs:[9,12],trustedProbe:true,longTaskAPI:true,longTasks:[],damageCommitMs:249,staticVisibleMs:499,visibleMs:499,renderCount:1,settled:true,finalDebtMs:0};
 assert.ok(Object.values(gates(good)).every(Boolean));
 for(const [field,value,gate] of [['inputMs',[100],'input'],['longTasks',[{duration:100}],'mainLongTasks'],['damageCommitMs',250,'damageCommit'],['staticVisibleMs',500,'staticVisible'],['visibleMs',500,'completeVisible'],['inputMs',[],'trustedInputObserved'],['longTaskAPI',false,'mainLongTasks'],['renderCount',0,'actualRender'],['settled',false,'naturalRecovery']])assert.equal(gates({...good,[field]:value})[gate],false);
 console.log('Scale browser gate self-tests passed. No browser imported, launched or connected.');
}
if(process.argv.includes('--self-test'))selfTest();else await main();

async function main(){
 assert.equal(process.env.GITHUB_ACTIONS,'true','Only separately authorized GitHub CI may run this harness');
 assert.equal(process.env.QA_BROWSER_CHANNEL,'chrome','Use existing preinstalled Chrome only');
 assert.equal(process.env.QA_SCALE_SLICE_AUTHORIZED,'true','This new isolated slice needs its authorized bounded CI run');
 const {chromium}=await import('@playwright/test'),{tsImport}=await import('tsx/esm/api');
 const {createCompactGameFixture}=await tsImport('../src/compact/fixture.ts',import.meta.url);
 const fixture=createCompactGameFixture('city');
 assert.equal(fixture.count,454913);assert.equal(fixture.terrainCount,401800);assert.equal(fixture.structureCount,53113);assert.equal(fixture.bounds.minY,-8);
 const url=process.env.GAME_URL??'http://127.0.0.1:5192/scale-slice.html',output=process.env.QA_OUTPUT??'artifacts/scale-slice-browser';
 const limit=Number(process.env.QA_OVERALL_TIMEOUT_MS??540000);assert.ok(Number.isSafeInteger(limit)&&limit>=60000&&limit<=570000);
 const evidence={schema:'scale-priority-real-browser/v1',status:'running',startedAt:new Date().toISOString(),url,targets:TARGETS,
  provenance:{execution:'Separately authorized GitHub CI, preinstalled Chrome, software WebGL',commit:process.env.GITHUB_SHA??null,runId:process.env.GITHUB_RUN_ID??null,attempt:process.env.GITHUB_RUN_ATTEMPT??null},
  scope:{entry:'isolated scale-slice.html; normal game untouched',city:{cells:454913,terrain:401800,structures:53113,buildings:36,layers:8,bounds:fixture.bounds},novaCount:3,distinctCenters:true,radius:48,damage:20,power:1,resetBetweenShots:false,hiddenStateMutations:false,clockOverrides:false,observationLimitMs:limit},
  limitations:['One bounded software-rendered run is evidence, not a statistical performance guarantee.','Static visible update means changed mesh queues drained and a subsequent real render submission; not GPU completion or physical screen presentation.','Dynamic pose delivery is separately reported when the entry exposes a pose revision; absent evidence remains unknown.','Natural recovery is real wall-clock unpaused work; reset, forced GC, artificial clock jumps and screenshots are forbidden during pressure.','Browser read-only diagnostics add overhead. CDP heap measures the page realm, not the Node candidate inventory; WASM/GPU residency is unknown. Candidate inventory generation uses the same immutable city but no second native physics world.','Regional HP/support is intentionally approximate; no exact legacy per-voxel damage equivalence is asserted.'],
  shots:[],errors:[],consoleErrors:[],workers:[],screenshots:[],memory:[],statusSamples:[],performanceVerdict:'unassessed'};
 await fs.mkdir(output,{recursive:true});const persist=()=>fs.writeFile(`${output}/results.json`,JSON.stringify(evidence,null,2));
 const start=Date.now(),deadline=()=>assert.ok(Date.now()-start<limit,'Observation limit reached; unfinished work is not settlement or a pass');
 let browser,page,fatal,stage='boot';const costs=new Map(),renders=new Map();
 const watchdog=setTimeout(()=>{evidence.status='incomplete-observation-limit';evidence.failure=`Timed out during ${stage}`;void persist().finally(()=>browser?.close());},limit);watchdog.unref();
 try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl']});
  evidence.provenance.browserVersion=browser.version();page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});page.setDefaultTimeout(15000);
  page.on('pageerror',error=>{fatal=String(error);evidence.errors.push(fatal);});page.on('console',message=>{if(message.type()==='error')evidence.consoleErrors.push(message.text());});page.on('worker',worker=>evidence.workers.push(worker.url()));
  await page.addInitScript(()=>{
   const probe={longTaskAPI:PerformanceObserver.supportedEntryTypes.includes('longtask'),longTasks:[],trusted:[],rafGaps:[],lastRAF:null,overflow:false};
   const add=(list,row)=>{if(list.length>=80000)probe.overflow=true;else list.push(row);};
   if(probe.longTaskAPI){probe.observer=new PerformanceObserver(list=>{for(const t of list.getEntries())add(probe.longTasks,{at:performance.timeOrigin+t.startTime,duration:t.duration});});probe.observer.observe({type:'longtask',buffered:true});}
   addEventListener('click',event=>{if(event.isTrusted)add(probe.trusted,{at:performance.timeOrigin+event.timeStamp,target:event.target?.id??event.target?.tagName});},true);
   const raf=at=>{if(probe.lastRAF!==null)add(probe.rafGaps,{at:performance.timeOrigin+probe.lastRAF,gap:at-probe.lastRAF});probe.lastRAF=at;requestAnimationFrame(raf);};requestAnimationFrame(raf);
   Object.defineProperty(window,'__scaleObserver',{value:probe});
  });
  await page.goto(url);await page.waitForFunction(()=>typeof window.__scaleSlice?.diagnostics==='function');
  const read=async()=>{
   deadline();if(fatal)throw new Error(fatal);
   const d=await page.evaluate(()=>({at:performance.timeOrigin+performance.now(),...window.__scaleSlice.diagnostics()}));
   assert.deepEqual(d.errors,[]);for(const c of d.costs)costs.set(`${c.kind}:${c.at}`,c);for(const r of d.renders)renders.set(r.renderNo,r);
   if(evidence.statusSamples.length>=6000)throw new Error('Read-only status record limit exceeded; do not silently truncate recovery');
   evidence.statusSamples.push({at:d.at,stats:d.summary?.stats,geometryRevision:d.summary?.geometryRevision,mesh:d.summary?.mesh,presentation:d.presentation,currentMesh:d.currentMesh});return d;
  };
  const wait=async(label,predicate,{probe=false}={})=>{
   stage=label;let lastProbe=0;
   while(true){const d=await read();if(predicate(d))return d;if(probe&&Date.now()-lastProbe>250){await page.locator('#probe').click();lastProbe=Date.now();}await page.waitForTimeout(100);}
  };
  const issue=async kind=>{
   const before=await read(),known=new Set(before.commands.map(c=>c.id));await page.locator(`#${kind}`).click();
   const issued=await wait(`${kind} command`,d=>d.commands.some(c=>!known.has(c.id)&&c.kind===kind));
   return issued.commands.find(c=>!known.has(c.id)&&c.kind===kind);
  };
  const accepted=async row=>{const d=await wait(`${row.kind} acknowledgment`,d=>d.commands.some(c=>c.id===row.id&&c.ack));const done=d.commands.find(c=>c.id===row.id);assert.equal(done.ack.accepted,true,`${row.kind} rejected: ${done.ack.reason??''}`);return done;};
  const meshReady=d=>!!d.summary&&!d.summary.mesh.pendingDirty&&!d.summary.mesh.inFlightPatches&&!d.presentation.pending;
  const idle=d=>meshReady(d)&&d.summary.stats.physics.activeBodyCount===0&&d.summary.stats.physics.pendingGroups===0&&d.summary.stats.physics.projectileCount===0&&d.summary.stats.clock.debtMs<100;
  const cdp=await page.context().newCDPSession(page);
  const memory=async label=>{const heap=await cdp.send('Runtime.getHeapUsage');const d=await read();evidence.memory.push({label,at:d.at,forcedGC:false,heap,geometryTypedBytes:d.currentMesh.bytes,nativeWasmResidentBytes:null,gpuResidentBytes:null});};
  const capture=async label=>{let data=await page.locator('#viewport canvas').screenshot({type:'jpeg',quality:60});const name=`${label}.jpg`;if((label==='pristine'||label==='shot-3-settled')&&data.length>240000)data=await page.locator('#viewport canvas').screenshot({type:'jpeg',quality:30});await fs.writeFile(`${output}/${name}`,data);evidence.screenshots.push({name,bytes:data.length,outsidePressure:true});if(label==='pristine'||label==='shot-3-settled'){assert.ok(data.length<=300000,'Bounded screenshot log exceeded; do not emit an unbounded file');console.log('SCREENSHOT_BASE64 '+JSON.stringify({name,data:data.toString('base64')}));}};
  await page.locator('#map').selectOption('city');const initStart=Date.now();evidence.initialize=await accepted(await issue('initialize'));
  const pristine=await wait('complete initial city mesh',d=>d.ready&&meshReady(d));
  evidence.initialize.wallToInitialMeshMs=Date.now()-initStart;evidence.initial=pristine.summary;
  assert.equal(evidence.workers.length,1);assert.equal(pristine.worldsReported,1);assert.equal(pristine.summary.stats.model.aliveCells,454913);assert.equal(pristine.summary.stats.model.regionCount,18447);assert.equal(pristine.summary.stats.physics.colliderCount,23339);
  assert.ok(pristine.summary.fixture,'immutable actual runtime inventory identity is required');assert.equal(pristine.summary.fixture.cellCount,454913);assert.equal(pristine.summary.fixture.buildingCount,36);assert.equal(pristine.summary.fixture.terrainCount,401800);assert.equal(pristine.summary.fixture.structureCount,53113);assert.deepEqual(pristine.summary.fixture.bounds,fixture.bounds);
  await page.locator('#weapon').selectOption('nova');await memory('pristine');await capture('pristine');
  const candidates=makeCandidates(fixture),usedObjects=new Set(),centers=[];
  for(let shot=1;shot<=3;shot++){
   let selection;const camera=(await read()).renders.at(-1)?.camera;assert.ok(camera);
   const eligible=candidates.filter(candidate=>!usedObjects.has(candidate.objectId)&&!centers.some(p=>distance(p,candidate.point)<20)&&visibleInRecipe(fixture,candidate,camera));
   const projected=await page.evaluate(points=>points.map(point=>{const p=window.__scaleSlice.project(point);return {...p,canvas:p.visible&&document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS'};}),eligible.map(c=>c.point));
   for(let candidateIndex=0;candidateIndex<eligible.length;candidateIndex++){const candidate=eligible[candidateIndex],pixel=projected[candidateIndex];
    if(usedObjects.has(candidate.objectId)||centers.some(p=>distance(p,candidate.point)<20))continue;
    if(!pixel.visible||!pixel.canvas)continue;
    await page.mouse.click(pixel.x,pixel.y);const aimed=await read();
    if(aimed.target&&distance(aimed.target.position,candidate.point)<1.2){selection={candidate,pixel,target:aimed.target};break;}
   }
   assert.ok(selection,`Shot ${shot} requires a distinct actual surviving visible surface; never inject a target or reuse a center`);
   usedObjects.add(selection.candidate.objectId);centers.push(selection.target.position);
   const place=await accepted(await issue('place'));const before=await read();
   const row={shot,selection,place,before:before.summary,startedAt:before.at};evidence.shots.push(row);
   const trigger=await issue('detonate');await page.locator('#probe').click();row.trigger=await accepted(trigger);
   const committed=await wait(`shot ${shot} committed`,d=>d.events.some(e=>e.kind==='damage'&&e.id===`${trigger.id}:0`),{probe:true});
   const damage=committed.events.find(e=>e.id===`${trigger.id}:0`);assert.equal(damage.weapon,'nova');assert.equal(damage.transaction.accepted,true);assert.ok(distance(damage.position,selection.target.position)<1e-6);
   assert.ok(Number.isSafeInteger(damage.geometryRevision),'damage must identify its geometry revision separately from authority revision');row.damage=damage;row.damageCommitMs=damage.committedAt-trigger.sentAt;row.nativeTransactionMs=damage.totalMs;row.authorityMs=damage.modelMs;row.colliderSyncMs=damage.collisionSyncMs;
   const geometry=await wait(`shot ${shot} changed mesh installed`,d=>meshReady(d)&&d.summary.geometryRevision>=damage.geometryRevision&&d.renders.at(-1).finishedAt>=Math.max(damage.committedAt,...d.uploads.map(u=>u.at)),{probe:true});
   row.staticVisibleMs=geometry.at-damage.committedAt;row.staticVisibleEvidence={observedAt:geometry.at,geometryRevision:geometry.summary.geometryRevision,presentation:geometry.presentation,mesh:geometry.summary.mesh,render:geometry.renders.at(-1),dynamicPose:geometry.lastPose??null};
   const visible=await wait(`shot ${shot} post-damage dynamic pose rendered`,d=>meshReady(d)&&d.lastPose?.epoch===damage.epoch&&d.lastPose.geometryRevision>=damage.geometryRevision&&d.lastPose.sentAt>=damage.committedAt&&d.renders.at(-1).pose?.receivedAt>=d.lastPose.receivedAt,{probe:true});
   row.visibleMs=visible.at-damage.committedAt;row.completeVisibleEvidence={pose:visible.lastPose,render:visible.renders.at(-1)};
   const settled=await wait(`shot ${shot} natural recovery`,idle,{probe:true});row.finishedAt=settled.at;row.naturalRecoveryWallMs=settled.at-damage.committedAt;row.after=settled.summary;
   assert.ok(settled.summary.stats.model.research>before.summary.stats.model.research,'accepted nova must commit actual objective loss, not only VFX');
   assert.equal(settled.summary.paused,false);assert.equal(settled.summary.hidden,false);assert.equal(settled.summary.stats.clock.discardedMs,0,'no reset/clock truncation can fake natural recovery');
   const observer=await page.evaluate(()=>{const p=window.__scaleObserver;for(const t of p.observer?.takeRecords()??[])p.longTasks.push({at:performance.timeOrigin+t.startTime,duration:t.duration});return {...p,observer:undefined};});assert.equal(observer.overflow,false);
   const overlapping=t=>t.at+t.duration>row.startedAt&&t.at<row.finishedAt;
   row.longTaskAPI=observer.longTaskAPI;row.longTasks=observer.longTasks.filter(overlapping);
   row.trustedProbe=observer.trusted.some(t=>t.target==='probe'&&t.at>=row.startedAt&&t.at<=row.finishedAt);
   row.inputMs=settled.inputs.filter(i=>i.eventAt>=row.startedAt&&i.eventAt<=row.finishedAt&&Number.isFinite(i.renderAt)).map(i=>i.renderAt-i.eventAt);
   row.renderCount=[...renders.values()].filter(r=>r.at>=row.startedAt&&r.at<=row.finishedAt).length;
   row.renderCpu=stats([...costs.values()].filter(c=>c.kind==='render'&&c.at>=row.startedAt&&c.at<=row.finishedAt).map(c=>c.ms));
   row.rafGaps=stats(observer.rafGaps.filter(r=>r.at>=row.startedAt&&r.at<=row.finishedAt).map(r=>r.gap));
   row.settled=true;row.finalDebtMs=settled.summary.stats.clock.debtMs;row.gates=gates(row);await memory(`shot-${shot}-settled`);await capture(`shot-${shot}-settled`);await persist();
  }
  assert.equal(new Set(centers.map(p=>JSON.stringify(p))).size,3);assert.equal(usedObjects.size,3);
  const final=await read();assert.equal(final.summary.stats.physics.activeBodyCount,0);assert.ok(final.summary.stats.model.rubbleRegions>0,'city run cannot pass solely by deleting coarse bodies');
  evidence.save=await accepted(await issue('save'));await wait('save text received',d=>d.savedBytes>0);evidence.savedBytes=(await read()).savedBytes;
  evidence.restore=await accepted(await issue('restore'));const restored=await wait('restored city mesh and sleeping bodies',idle);evidence.restored=restored.summary;
  for(const field of ['research','aliveCells','staticRegions','rubbleRegions','goneRegions','lastSequence'])assert.equal(restored.summary.stats.model[field],final.summary.stats.model[field],`restored ${field}`);
  assert.equal(restored.summary.stats.physics.bodyCount,final.summary.stats.physics.bodyCount);assert.equal(restored.summary.stats.physics.escapedRegions,final.summary.stats.physics.escapedRegions);
  evidence.end=await accepted(await issue('end'));evidence.dispose=await accepted(await issue('dispose'));
  evidence.status='completed-real-browser-observations';evidence.performanceVerdict=evidence.shots.every(r=>Object.values(r.gates).every(Boolean))?'single-run-static-and-input-targets-observed':'one-or-more-targets-failed';
  if(evidence.performanceVerdict==='one-or-more-targets-failed')process.exitCode=1;
 }catch(error){evidence.status='failed-or-incomplete';evidence.performanceVerdict='not-passed';evidence.failure=String(error?.stack??error);process.exitCode=1;}
 finally{clearTimeout(watchdog);evidence.finishedAt=new Date().toISOString();await persist();console.log('SCALE_BROWSER_RESULT '+JSON.stringify({status:evidence.status,performanceVerdict:evidence.performanceVerdict,initialize:evidence.initialize,initial:evidence.initial,memory:evidence.memory,savedBytes:evidence.savedBytes,restored:evidence.restored,screenshots:evidence.screenshots,shots:evidence.shots.map(r=>({shot:r.shot,gates:r.gates,damageCommitMs:r.damageCommitMs,staticVisibleMs:r.staticVisibleMs,visibleMs:r.visibleMs,naturalRecoveryWallMs:r.naturalRecoveryWallMs,input:stats(r.inputMs??[]),longTasks:stats((r.longTasks??[]).map(t=>t.duration)),after:r.after})),failure:evidence.failure??null,limitations:evidence.limitations}));await browser?.close();}
}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);}
function makeCandidates(fixture){
 const result=[],objects=new Set();
 for(let ordinal=0;ordinal<fixture.structureCount;ordinal++){
  const id=fixture.idAtOrdinal(ordinal);if(!fixture.objectiveOf(id)||!['building','foundation'].includes(fixture.roleOf(id)))continue;
  const objectId=fixture.objectIdOf(id);objects.add(objectId);const p=fixture.originalPosition(id);if(p.y<2)continue;
  for(const normal of [{x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:0,z:1},{x:0,y:1,z:0}])if(fixture.idAt(p.x+normal.x,p.y+normal.y,p.z+normal.z)===null)result.push({id,objectId,normal,point:{x:p.x+normal.x*.49,y:p.y+normal.y*.49,z:p.z+normal.z*.49},score:Math.abs(p.y-5)+Math.hypot(p.x,p.z)*.04+(normal.y?8:0)});
 }
 assert.equal(objects.size,36);const selected=[];for(const objectId of objects){const rows=result.filter(r=>r.objectId===objectId).sort((a,b)=>a.score-b.score||a.id-b.id),roofs=rows.filter(r=>r.normal.y===1).sort((a,b)=>b.point.y-a.point.y||a.score-b.score);selected.push(...rows.slice(0,12));for(let i=0;i<8&&roofs.length;i++)selected.push(roofs[Math.floor(i*(roofs.length-1)/7)]);}
 const unique=[...new Map(selected.map(r=>[`${r.id}/${r.normal.x}/${r.normal.y}/${r.normal.z}`,r])).values()];return unique.sort((a,b)=>a.score-b.score||a.id-b.id);
}
function visibleInRecipe(fixture,candidate,camera){
 const p=candidate.point,delta={x:p.x-camera.x,y:p.y-camera.y,z:p.z-camera.z},cell={x:Math.floor(camera.x+.5),y:Math.floor(camera.y+.5),z:Math.floor(camera.z+.5)},step={},next={},stride={};
 for(const axis of ['x','y','z']){step[axis]=Math.sign(delta[axis]);stride[axis]=delta[axis]?Math.abs(1/delta[axis]):Infinity;next[axis]=delta[axis]?(cell[axis]+step[axis]*.5-camera[axis])/delta[axis]:Infinity;}
 for(let count=0;count<5000;count++){const id=fixture.idAt(cell.x,cell.y,cell.z);if(id!==null)return id===candidate.id;const axis=next.x<=next.y&&next.x<=next.z?'x':next.y<=next.z?'y':'z';if(next[axis]>1)return false;cell[axis]+=step[axis];next[axis]+=stride[axis];}
 throw new Error('Immutable recipe ray exceeded its finite traversal bound');
}
