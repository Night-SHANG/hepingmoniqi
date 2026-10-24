import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

// CI authoring is not execution authorization. No browser is imported, installed,
// launched or connected until all independent CI/environment guards succeed.
const THRESHOLDS=Object.freeze({inputMs:100,longTaskMs:100,damageMs:250,geometryMs:500,debtMs:500,recoveredDebtMs:100,recoveryMs:2000});
const PIXEL_RULES=Object.freeze({channelTolerance:2,edgeDelta:24,edgeRadius:1,maxMaskedFraction:.5,maxInteriorDifferentFraction:0,maxAllPixelMeanDifference:.5});
const MAX_SCREENSHOT_LOG_BASE64_CHARS=220*1024;
const measurements=values=>({count:values.length,p95:values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]:null,max:values.length?Math.max(...values):null});
function gates(run){
 const input=measurements(run.inputMs),render=measurements(run.renderMs);
 return {input:input.count>0&&input.p95<THRESHOLDS.inputMs,mainLongTasks:run.longTaskAPI&&run.longTasks.every(t=>t.duration<THRESHOLDS.longTaskMs),damage:Number.isFinite(run.damageMs)&&run.damageMs<THRESHOLDS.damageMs,geometry:Number.isFinite(run.geometryMs)&&run.geometryMs<THRESHOLDS.geometryMs,debtPeak:Number.isFinite(run.maxDebtMs)&&run.maxDebtMs<THRESHOLDS.debtMs,debtRecovery:Number.isFinite(run.recoveryMs)&&run.recoveryMs<=THRESHOLDS.recoveryMs,rendererObserved:render.count>0,settled:run.settled===true};
}
function frameWindow(frames,start,end){
 const sorted=[...frames].sort((a,b)=>a.renderNo-b.renderNo),intervals=[];let gaps=0;
 // Include the previous completed frame when its following interval overlaps
 // pressure. Otherwise a stall before the first post-trigger frame disappears.
 for(let i=1;i<sorted.length;i++){
  const before=sorted[i-1],after=sorted[i];
  if(after.finishedAt<start||before.finishedAt>end)continue;
  intervals.push(after.finishedAt-before.finishedAt);
  if(after.renderNo!==before.renderNo+1)gaps++;
 }
 return {frames:sorted.filter(f=>f.finishedAt>=start&&f.at<=end),intervals,gaps};
}
function selfTest(){
 const good={inputMs:[12,20],longTasks:[{duration:51}],damageMs:100,geometryMs:200,maxDebtMs:70,recoveryMs:500,renderMs:[4,12],longTaskAPI:true,settled:true};
 assert.ok(Object.values(gates(good)).every(Boolean));
 for(const [field,value,gate] of [['inputMs',[100],'input'],['longTasks',[{duration:100}],'mainLongTasks'],['damageMs',250,'damage'],['geometryMs',500,'geometry'],['maxDebtMs',500,'debtPeak']])assert.equal(gates({...good,[field]:value})[gate],false,`${gate} must not relax a strict boundary`);
 assert.equal(gates({...good,renderMs:[]}).rendererObserved,false);assert.equal(gates({...good,longTaskAPI:false}).mainLongTasks,false);assert.equal(gates({...good,inputMs:[]}).input,false);assert.equal(gates({...good,recoveryMs:null}).debtRecovery,false);
 const frames=[{renderNo:1,at:0,finishedAt:10},{renderNo:2,at:110,finishedAt:115},{renderNo:3,at:120,finishedAt:125}];
 assert.deepEqual(frameWindow(frames,20,124).intervals,[105,10]);
 assert.equal(frameWindow([frames[0],frames[2]],20,124).gaps,1);
 pixelSelfTest();
 console.log('Material browser gate and pixel metric self-tests passed; no browser was executed.');
}
if(process.argv.includes('--self-test'))selfTest();
else await main();

async function main(){
 assert.equal(process.env.GITHUB_ACTIONS,'true','This browser harness may run only in separately authorized GitHub CI');
 assert.equal(process.env.QA_MATERIAL_BROWSER_AUTHORIZED,'true','Material A/B requires separate explicit execution authorization; authoring is not permission');
 assert.equal(process.env.QA_BROWSER_CHANNEL,'chrome','Use only the already-authorized preinstalled Chrome');
 const {chromium}=await import('@playwright/test'),{tsImport}=await import('tsx/esm/api'),{PNG}=await import('pngjs');
 const {createCompactGameFixture}=await tsImport('../src/compact/fixture.ts',import.meta.url);
 const fixture=createCompactGameFixture('city'); // Immutable recipe, never a second physics world.
 const url=process.env.GAME_URL??'http://127.0.0.1:5192/worker-slice.html',output=process.env.QA_OUTPUT??'artifacts/material-browser';
 const evidence={schema:'isolated-material-color-mesh-browser-ab/v1',status:'running',startedAt:new Date().toISOString(),provenance:{commit:process.env.GITHUB_SHA??null,runId:process.env.GITHUB_RUN_ID??null,execution:'Separately authorized GitHub CI; preinstalled Chrome; software WebGL'},thresholds:THRESHOLDS,pixelRules:PIXEL_RULES,
  scope:{world:'Unchanged city and original full authority, one power-1 remotely triggered nova per mode',modes:['baseline','material'],authorityChanged:false,regionalBulkIntegrated:false,singleRun:true},
  limitations:['One A/B observation is not a statistical performance guarantee.','This compares presentation modes only. Cell-color tolerance is not bit-exact authority HP, collider, support, secondary impact, or settlement equivalence.','Renderer timing includes renderer.render CPU WebGL submission and possible driver waits, not GPU completion or display latency.','Queue-drained geometry time is a conservative whole-queue observation, not per-affected-chunk upload completion.','The scalar save hash excludes body poses and is not a full-physics equivalence hash.','The three-shot and 4× unrelated-region full-authority gates remain unmeasured.','Read-only diagnostic sampling and software rendering add overhead; no pressure observation contains screenshots or camera drags.','Texture accounting includes actual allocated level-zero typed payloads and palette row padding. The tested adapter disables mipmaps. It is not driver VRAM or proof of upload bandwidth.','A fixed initial-camera pixel tolerance result is not exact pixel equality and does not establish unseen surface or moving-body equivalence. The edge mask is derived only from baseline pixels and its excluded fraction is reported.'],runs:[],comparison:null};
 await fs.mkdir(output,{recursive:true});const persist=()=>fs.writeFile(`${output}/results.json`,JSON.stringify(evidence,null,2));let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  let selection=null;
  for(const mode of ['baseline','material']){
   const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});page.setDefaultTimeout(15_000);
   const run={mode,status:'running',workers:[],errors:[],samples:[],screenshots:[],costs:[],scope:'single identical city nova; original authority, changed mesher only'};evidence.runs.push(run);
   const costs=new Map(),frames=new Map(),started=Date.now(),limit=180_000;
   const deadline=()=>assert.ok(Date.now()-started<limit,`${mode}: observation window expired; unresolved work is not completion`);
   page.on('pageerror',error=>run.errors.push(String(error)));page.on('worker',worker=>run.workers.push(worker.url()));
   // Three shader/link failures commonly only log, without throwing pageerror.
   page.on('console',message=>{if(message.type()==='error'&&/WebGL|shader|GL_INVALID|INVALID_OPERATION|VALIDATE_STATUS/i.test(message.text()))run.errors.push(message.text());});
   await page.addInitScript(()=>{
    const observation={longTasks:[],trustedInputs:[],overflow:false,longTaskAPI:PerformanceObserver.supportedEntryTypes.includes('longtask')};
    const push=(list,row)=>{if(list.length>=16000)observation.overflow=true;else list.push(row);};
    for(const type of ['click','pointerdown','pointerup'])addEventListener(type,event=>{if(event.isTrusted)push(observation.trustedInputs,{type,target:event.target?.id??event.target?.tagName,at:performance.timeOrigin+event.timeStamp});},true);
    if(observation.longTaskAPI)new PerformanceObserver(list=>{for(const row of list.getEntries())push(observation.longTasks,{at:performance.timeOrigin+row.startTime,duration:row.duration});}).observe({entryTypes:['longtask']});
    Object.defineProperty(window,'__materialObserver',{value:observation});
   });
   const targetURL=new URL(url);targetURL.searchParams.set('mesh',mode);await page.goto(targetURL.href);await page.waitForFunction(()=>typeof window.__workerSlice?.diagnostics==='function');
   const read=async()=>{
    deadline();const d=await page.evaluate(()=>({at:performance.timeOrigin+performance.now(),...window.__workerSlice.diagnostics()}));assert.deepEqual(d.errors,[]);assert.deepEqual(run.errors,[]);assert.equal(d.meshMode,mode,'query must select the actual mesher');
    for(const c of d.mainCosts)costs.set(`${c.kind}:${c.at}`,c);
    for(const f of d.renders)frames.set(f.renderNo,f);
    assert.ok(run.samples.length<6000,'Do not truncate pressure or recovery observations');
    run.samples.push({at:d.at,pendingWork:d.summary?.pendingWork,clock:d.summary?.clock,authorityRevision:d.summary?.authorityRevision,bindingRevision:d.summary?.bindingRevision,presentation:d.presentation,meshStats:d.meshStats,meshTotals:d.meshTotals,currentMesh:d.currentMesh,rendererInfo:d.rendererInfo});
    return d;
   };
   const wait=async(label,predicate)=>{while(true){const d=await read();if(predicate(d))return d;deadline();await page.waitForTimeout(50);}};
   const issue=async(kind)=>{
    const before=await read(),known=new Set(before.commands.map(c=>c.id));await page.locator(`#${kind}`).click();
    const d=await wait(`${kind} issued`,d=>d.commands.some(c=>!known.has(c.id)&&c.kind===kind));return d.commands.find(c=>!known.has(c.id)&&c.kind===kind);
   };
   const accepted=async row=>{const d=await wait(`${row.kind} accepted`,d=>d.commands.some(c=>c.id===row.id&&c.ack));const done=d.commands.find(c=>c.id===row.id);assert.equal(done.ack.status,'accepted',`${mode}/${row.kind}: never retry a rejected fixed shot`);assert.equal(done.ack.committed,true);return done;};
   const capture=async(label)=>{
    assert.ok(!run.pressure||run.pressure.finishedAt,'No screenshot during pressure');
    const bytes=await page.locator('#viewport canvas').screenshot({type:'png'}),name=`${mode}-${label}.png`;await fs.writeFile(`${output}/${name}`,bytes);
    const metadata={name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),pressureExcluded:true};run.screenshots.push(metadata);
    // Separate bounded actual scene screenshot for text-log recovery. Exact
    // initial pixel comparison still uses the untouched full-size PNG above.
    let jpeg=null,quality=35;
    for(const candidateQuality of [35,20,10]){
     quality=candidateQuality;jpeg=await page.locator('#viewport canvas').screenshot({type:'jpeg',quality});
     if(jpeg.toString('base64').length<=MAX_SCREENSHOT_LOG_BASE64_CHARS)break;
    }
    const base64=jpeg.toString('base64');assert.ok(base64.length<=MAX_SCREENSHOT_LOG_BASE64_CHARS,'Screenshot log evidence exceeds its explicit size bound');
    const jpegName=`${mode}-${label}-log.jpg`;await fs.writeFile(`${output}/${jpegName}`,jpeg);
    const jpegMetadata={name:jpegName,bytes:jpeg.length,quality,sha256:createHash('sha256').update(jpeg).digest('hex'),pressureExcluded:true,role:'bounded actual canvas screenshot for CI text logs, not pixel comparison'};run.screenshots.push(jpegMetadata);
    console.log('SCREENSHOT_BASE64 '+JSON.stringify({filename:jpegName,mimeType:'image/jpeg',pressureExcluded:true,sha256:jpegMetadata.sha256,base64}));
    return bytes;
   };
   await page.locator('#map').selectOption('city');run.initialize=await accepted(await issue('initialize'));
   await wait('initial complete mesh',d=>d.ready&&d.presentation.pending===0&&d.meshStats?.queue?.pendingDirty===0&&d.meshStats?.queue?.inFlightPatches===0);
   await page.waitForTimeout(250);const ready=await read();assert.equal(run.workers.length,1);assert.equal(ready.worldsReported,1);assert.equal(ready.summary.mapId,'city');assert.equal(ready.summary.mode,'free');
   assertAccounting(ready,mode);
   if(mode==='material')assert.ok(ready.currentMesh.textureBytes>0,'The material route must actually install cell textures, not geometry-only colors');
   run.initial={camera:ready.renders.at(-1).camera,recipe:ready.summary.mapRecipeHash,meshTotals:ready.meshTotals,currentMesh:ready.currentMesh};
   const initialPNG=await capture('initial-frozen-camera');Object.defineProperty(run,'initialPNG',{value:initialPNG,enumerable:false});
   if(!selection){
    const candidates=[];
    for(let ordinal=0;ordinal<fixture.structureCount;ordinal++){
     const id=fixture.idAtOrdinal(ordinal);if(!fixture.objectiveOf(id)||fixture.roleOf(id)!=='building')continue;const p=fixture.originalPosition(id);
     if(p.y<1||Math.abs(p.x)>65||Math.abs(p.z)>60)continue;
     for(const n of [{x:1,y:0,z:0},{x:0,y:0,z:1},{x:0,y:1,z:0}])if(fixture.idAt(p.x+n.x,p.y+n.y,p.z+n.z)===null)candidates.push({id,objectId:fixture.objectIdOf(id),point:{x:p.x+n.x*.49,y:p.y+n.y*.49,z:p.z+n.z*.49},score:Math.abs(p.y-5)+Math.hypot(p.x,p.z)*.04+(n.y?8:0)});
    }
    candidates.sort((a,b)=>a.score-b.score||a.id-b.id);
    for(const candidate of candidates){
     if(!visibleInRecipe(fixture,candidate,run.initial.camera))continue;
     const pixel=await page.evaluate(point=>window.__workerSlice.project(point),candidate.point);
     if(!pixel.visible||!await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS',pixel))continue;
     await page.mouse.click(pixel.x,pixel.y);const d=await read(),actual=d.target?.position,normal=d.target?.normal;
     const owner=actual&&normal?fixture.idAt(Math.floor(actual.x-normal.x*1e-4+.5),Math.floor(actual.y-normal.y*1e-4+.5),Math.floor(actual.z-normal.z*1e-4+.5)):null;
     if(actual&&owner===candidate.id&&distance(actual,candidate.point)<1.2){selection={candidate,pixel,actualTarget:d.target};break;}
    }
    assert.ok(selection,'No actual exposed central building: never inject a synthetic target');
   }else{
    assert.deepEqual(run.initial.camera,evidence.runs[0].initial.camera,'A/B requires the same actual camera');assert.equal(run.initial.recipe,evidence.runs[0].initial.recipe);
    await page.mouse.click(selection.pixel.x,selection.pixel.y);const d=await read();assert.ok(d.target,'Material ray must hit the same actual surface');assert.ok(distance(d.target.position,selection.actualTarget.position)<1e-7,'A/B ray positions must agree before any shot');assert.deepEqual(d.target.normal,selection.actualTarget.normal);
   }
   run.aim=selection;run.place=await accepted(await issue('place'));assert.equal(run.place.ack.surface?.voxelId,selection.candidate.id,'Authority must confirm the exact selected voxel, not merely the visual building');
   const before=await read();run.preBlast={summary:before.summary,meshTotals:before.meshTotals,currentMesh:before.currentMesh};
   const triggerBox=await page.locator('#detonate').boundingBox(),probeBox=await page.locator('#probe').boundingBox();assert.ok(triggerBox&&probeBox);
   const buttonCenter=box=>({x:box.x+box.width/2,y:box.y+box.height/2}),triggerPoint=buttonCenter(triggerBox),probePoint=buttonCenter(probeBox),known=new Set(before.commands.map(c=>c.id));
   run.pressure={startedAt:await page.evaluate(()=>performance.timeOrigin+performance.now()),finishedAt:null};
   // Trusted physical input path; no aim, damage, clock, or world state is injected.
   await page.mouse.click(triggerPoint.x,triggerPoint.y);await page.mouse.click(probePoint.x,probePoint.y);
   const issued=await wait('one trigger',d=>d.commands.some(c=>!known.has(c.id)&&c.kind==='detonate'));const newTriggers=issued.commands.filter(c=>!known.has(c.id)&&c.kind==='detonate');assert.equal(newTriggers.length,1);
   run.trigger=await accepted(newTriggers[0]);
   const damageId=`placed-${run.place.id.slice('cmd-'.length)}`;
   const damaged=await wait('matching committed damage event',d=>d.events.some(b=>b.events.some(e=>e.kind==='damage'&&e.detonation.id===damageId)));
   const batch=damaged.events.find(b=>b.events.some(e=>e.kind==='damage'&&e.detonation.id===damageId)),damage=batch.events.find(e=>e.kind==='damage'&&e.detonation.id===damageId);
   assert.equal(batch.events.length,1);assert.equal(damage.detonation.weapon,'nova');assert.equal(damage.detonation.power,1);assert.equal(damage.detonation.reason,'remote');assert.equal(damage.result.accepted,true);assert.ok(distance(damage.detonation.position,selection.actualTarget.position)<1.5);run.damage={batch,event:damage};
   const geometryReady=d=>d.presentation.pending===0&&d.meshStats?.queue?.pendingDirty===0&&d.meshStats?.queue?.inFlightPatches===0&&d.meshStats.epoch===batch.epoch&&d.meshStats.at>=batch.committedAtMs&&d.meshStats.authority>=batch.authorityRevision&&d.summary.authorityRevision>=batch.authorityRevision&&d.renders.at(-1).finishedAt>=batch.committedAtMs;
   const geometry=await wait('complete changed mesh plus renderer submission',geometryReady);
   const settled=await wait('natural pending-work and eligible-debt recovery',d=>geometryReady(d)&&d.summary.pendingWork===0&&d.summary.clock.simulationDebtMs<=THRESHOLDS.recoveredDebtMs);
   run.pressure.finishedAt=settled.at;assert.ok(settled.summary.objective.destroyed>before.summary.objective.destroyed);
   assertAccounting(settled,mode);
   run.postBlast={summary:settled.summary,meshTotals:settled.meshTotals,currentMesh:settled.currentMesh,rendererInfo:settled.rendererInfo};
   run.save=await accepted(await issue('save'));assert.ok(run.save.ack.saveTextBytes>0);const saved=await wait('actual asynchronous save hash',d=>typeof d.savedScalarHash==='string'&&d.savedScalarHash.length>0);run.savedScalarHash=saved.savedScalarHash;
   const observer=await page.evaluate(()=>window.__materialObserver);assert.equal(observer.overflow,false,'Never silently truncate observed stalls');assert.ok(observer.trustedInputs.some(r=>r.target==='detonate'&&r.type==='click'));
   const pressureCost=[...costs.values()].filter(c=>c.at>=run.pressure.startedAt&&c.at<=run.pressure.finishedAt),inPressure=t=>t.at+t.duration>=run.pressure.startedAt&&t.at<=run.pressure.finishedAt;
   run.costs=pressureCost;run.renderMs=pressureCost.filter(c=>c.kind==='render').map(c=>c.ms);
   const observedFrames=frameWindow(frames.values(),run.pressure.startedAt,run.pressure.finishedAt);
   run.pressureFrames=observedFrames.frames;run.frameIntervalsMs=observedFrames.intervals;
   run.gapsInFrameObservation=observedFrames.gaps;run.longTasks=observer.longTasks.filter(inPressure);run.longTaskAPI=observer.longTaskAPI;
   run.inputMs=saved.inputs.filter(i=>i.id==='probe'&&i.eventAt>=run.pressure.startedAt&&i.eventAt<=run.pressure.finishedAt&&Number.isFinite(i.renderAt)).map(i=>i.renderAt-i.eventAt);
   run.damageMs=batch.committedAtMs-run.trigger.sentAt;run.damageObservedMs=batch.receivedAt-run.trigger.sentAt;run.geometryMs=geometry.at-batch.committedAtMs;
   const pressureSamples=run.samples.filter(s=>s.at>=run.pressure.startedAt&&s.at<=run.pressure.finishedAt);
   run.maxDebtMs=Math.max(...pressureSamples.map(s=>s.clock?.peakSimulationDebtMs??0));
   run.sampledPressurePeakDebtMs=Math.max(...pressureSamples.map(s=>s.clock?.simulationDebtMs??0));
   run.prePressureLifetimePeakDebtMs=before.summary.clock.peakSimulationDebtMs;
   run.debtPeakBasis='Authority lifetime high-water mark is a conservative upper bound, not an isolated pressure-window measurement. Sampled pressure debt is separately reported and can miss between-sample peaks.';
   // A momentarily low debt while structural/mesh work is still pending is not
   // completed recovery. Use the observed natural all-work-drained point.
   run.recoveryMs=settled.at-batch.committedAtMs;run.settled=true;run.gates=gates(run);
   run.commandAcceptanceMs=run.trigger.ackAt-run.trigger.sentAt;run.gates.commandAcceptance=run.commandAcceptanceMs<100;
   run.gates.completeFrameObservation=run.frameIntervalsMs.length>0&&run.gapsInFrameObservation===0;
   run.measurements={input:measurements(run.inputMs),rendererRender:measurements(run.renderMs),frameInterval:measurements(run.frameIntervalsMs),observedFrames:run.pressureFrames.length,gapsInFrameObservation:run.gapsInFrameObservation,meshInstall:measurements(pressureCost.filter(c=>c.kind==='mesh-install').map(c=>c.ms)),mainLongTasks:measurements(run.longTasks.map(c=>c.duration)),actualInstalledTypedBytes:settled.meshTotals.installedBytes-before.meshTotals.installedBytes,actualInstalledGeometryBytes:settled.meshTotals.installedGeometryBytes-before.meshTotals.installedGeometryBytes,actualInstalledTextureBytes:settled.meshTotals.installedTextureBytes-before.meshTotals.installedTextureBytes,postBlastCurrentTypedBytes:settled.currentMesh.bytes,postBlastGeometryBytes:settled.currentMesh.geometryBytes,postBlastTextureBytes:settled.currentMesh.textureBytes};
   await capture('settled-outside-pressure');run.status='complete-observations';await accepted(await issue('dispose'));await page.close();
   // PNG bytes are retained only in process until comparison, not serialized as giant arrays.
   await persist();
  }
  const [baseline,material]=evidence.runs;
  const pixels=comparePNG(PNG,baseline.initialPNG,material.initialPNG);
  const sameDamagePosition=distance(baseline.damage.event.detonation.position,material.damage.event.detonation.position)<1e-7;
  evidence.comparison={sameRecipe:baseline.initial.recipe===material.initial.recipe,sameSelectedVoxel:baseline.place.ack.surface.voxelId===material.place.ack.surface.voxelId,sameDamagePosition,initialCanvasPixels:pixels,savedScalarHashEqual:baseline.savedScalarHash===material.savedScalarHash,scalarHashScope:'Sorted saved scalar rows and gameplay summary only, excluding poses; mismatch needs investigation, not automatic proof of physics corruption.',initialTypedBytesRatio:material.initial.currentMesh.bytes/baseline.initial.currentMesh.bytes,changedTypedBytesRatio:material.measurements.actualInstalledTypedBytes/baseline.measurements.actualInstalledTypedBytes,baselineRenderer:baseline.measurements.rendererRender,materialRenderer:material.measurements.rendererRender,baselineFrameInterval:baseline.measurements.frameInterval,materialFrameInterval:material.measurements.frameInterval,initialGeometryBytesRatio:material.initial.currentMesh.geometryBytes/baseline.initial.currentMesh.geometryBytes,initialMaterialTextureBytes:material.initial.currentMesh.textureBytes,automaticFullPhysicsPass:false,automaticVisualEquivalencePass:false};
  assert.ok(sameDamagePosition,'A/B actual nova positions differ');
  evidence.status='completed-observations';
  const failed=evidence.runs.some(run=>Object.values(run.gates).some(v=>v!==true));
  evidence.verdict=failed?'failed-component-gates':!evidence.comparison.savedScalarHashEqual||!pixels.tolerancePass?'incomplete-equivalence-needs-review':'single-shot-component-evidence-only';
  if(failed)process.exitCode=1;await persist();
 }catch(error){evidence.status='failed-or-incomplete';evidence.verdict='not-passed';evidence.failure=String(error?.stack??error);await persist();throw error;}
 finally{
  console.log('MATERIAL_BROWSER_AB_RESULT '+JSON.stringify({status:evidence.status,verdict:evidence.verdict,comparison:evidence.comparison,runs:evidence.runs.map(run=>({mode:run.mode,status:run.status,gates:run.gates,measurements:run.measurements,damageMs:run.damageMs,geometryMs:run.geometryMs,maxDebtMs:run.maxDebtMs,sampledPressurePeakDebtMs:run.sampledPressurePeakDebtMs,prePressureLifetimePeakDebtMs:run.prePressureLifetimePeakDebtMs,debtPeakBasis:run.debtPeakBasis,recoveryMs:run.recoveryMs,savedScalarHash:run.savedScalarHash,screenshots:run.screenshots})),failure:evidence.failure?.slice(0,1800)??null,limitations:evidence.limitations}));
  await browser?.close();
 }
}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);}
function visibleInRecipe(fixture,candidate,camera){
 const p=candidate.point,delta={x:p.x-camera.x,y:p.y-camera.y,z:p.z-camera.z},cell={x:Math.floor(camera.x+.5),y:Math.floor(camera.y+.5),z:Math.floor(camera.z+.5)},step={},next={},stride={};
 for(const a of ['x','y','z']){step[a]=Math.sign(delta[a]);stride[a]=delta[a]?Math.abs(1/delta[a]):Infinity;next[a]=delta[a]?(cell[a]+step[a]*.5-camera[a])/delta[a]:Infinity;}
 for(let count=0;count<5000;count++){
  const id=fixture.idAt(cell.x,cell.y,cell.z);if(id!==null)return id===candidate.id;
  const a=next.x<=next.y&&next.x<=next.z?'x':next.y<=next.z?'y':'z';if(next[a]>1)return false;cell[a]+=step[a];next[a]+=stride[a];
 }
 throw new Error('Immutable recipe ray exceeded its finite traversal bound');
}
function assertAccounting(d,mode){
 for(const [label,object] of [['currentMesh',d.currentMesh],['meshTotals',d.meshTotals]])assert.ok(object&&Object.values(object).every(Number.isFinite),`${label}: actual installed typed accounting is required`);
 for(const [label,parts,total] of [['currentMesh',['geometryBytes','textureBytes'],'bytes'],['meshTotals',['installedGeometryBytes','installedTextureBytes'],'installedBytes']]){
  const row=d[label];for(const name of [...parts,total])assert.ok(Number.isSafeInteger(row[name])&&row[name]>=0,`${label}.${name} must be actual nonnegative allocated bytes`);
  assert.equal(row[total],parts.reduce((sum,name)=>sum+row[name],0),`${label} must include geometry plus padded texture payloads`);
 }
 if(mode==='baseline')assert.equal(d.currentMesh.textureBytes,0);
}
function comparePNG(PNG,a,b){
 const first=PNG.sync.read(a),second=PNG.sync.read(b);assert.equal(first.width,second.width);assert.equal(first.height,second.height);
 return compareRGBA(first.width,first.height,first.data,second.data);
}
function compareRGBA(width,height,a,b,rules=PIXEL_RULES){
 assert.ok(Number.isInteger(width)&&width>0&&Number.isInteger(height)&&height>0);assert.equal(a.length,width*height*4);assert.equal(b.length,a.length);
 const count=width*height,edges=new Uint8Array(count),mask=new Uint8Array(count);
 // Only baseline gradients can mask an edge. A candidate-created edge never
 // gets to hide its own error. All pixels also remain in the global metrics.
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x;
  for(const [nx,ny] of [[x+1,y],[x,y+1]])if(nx<width&&ny<height){
   const j=ny*width+nx;let delta=0;for(let c=0;c<3;c++)delta=Math.max(delta,Math.abs(a[i*4+c]-a[j*4+c]));
   if(delta>=rules.edgeDelta)edges[i]=edges[j]=1;
  }
 }
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(edges[y*width+x])for(let dy=-rules.edgeRadius;dy<=rules.edgeRadius;dy++)for(let dx=-rules.edgeRadius;dx<=rules.edgeRadius;dx++){
  const nx=x+dx,ny=y+dy;if(nx>=0&&nx<width&&ny>=0&&ny<height)mask[ny*width+nx]=1;
 }
 let changed=0,maxChannelDifference=0,totalDifference=0,maskedPixels=0,interiorDifferentPixels=0,alphaDifferentPixels=0;
 for(let i=0;i<count;i++){
  let different=false,aboveTolerance=false;
  for(let c=0;c<4;c++){
   const delta=Math.abs(a[i*4+c]-b[i*4+c]);different||=delta>0;aboveTolerance||=delta>(c===3?0:rules.channelTolerance);
   maxChannelDifference=Math.max(maxChannelDifference,delta);totalDifference+=delta;
  }
  if(different)changed++;if(a[i*4+3]!==b[i*4+3])alphaDifferentPixels++;
  if(mask[i])maskedPixels++;else if(aboveTolerance)interiorDifferentPixels++;
 }
 const interiorPixels=count-maskedPixels,maskedFraction=maskedPixels/count,interiorDifferentFraction=interiorPixels?interiorDifferentPixels/interiorPixels:null,meanChannelDifference=totalDifference/a.length;
 return {width,height,changedPixels:changed,fractionChanged:changed/count,maxChannelDifference,meanChannelDifference,exact:changed===0,alphaDifferentPixels,
  maskedPixels,maskedFraction,interiorPixels,interiorDifferentPixels,interiorDifferentFraction,rules,
  tolerancePass:interiorPixels>0&&maskedFraction<=rules.maxMaskedFraction&&interiorDifferentFraction<=rules.maxInteriorDifferentFraction&&meanChannelDifference<=rules.maxAllPixelMeanDifference&&alphaDifferentPixels===0,
  interpretation:'Tolerance comparison only. Exact equality is reported separately. Baseline-derived masked edges remain included in the all-pixel difference metrics.'};
}
function pixelSelfTest(){
 const width=20,height=20,solid=value=>{const data=new Uint8Array(width*height*4);for(let i=0;i<data.length;i+=4)data.set([value,value,value,255],i);return data;};
 const a=solid(100),same=compareRGBA(width,height,a,a);assert.equal(same.exact,true);assert.equal(same.tolerancePass,true);assert.equal(same.maskedPixels,0);
 const within=a.slice();within[0]+=2;const close=compareRGBA(width,height,a,within);assert.equal(close.exact,false);assert.equal(close.tolerancePass,true);assert.equal(close.changedPixels,1);
 const wrong=a.slice();wrong[0]+=3;const bad=compareRGBA(width,height,a,wrong);assert.equal(bad.tolerancePass,false);assert.equal(bad.interiorDifferentPixels,1);assert.equal(bad.maskedPixels,0,'candidate-only edges must not hide errors');
 const wrongAlpha=a.slice();wrongAlpha[3]--;assert.equal(compareRGBA(width,height,a,wrongAlpha).tolerancePass,false);
 const edge=a.slice();for(let y=0;y<height;y++)for(let x=10;x<width;x++)edge.set([200,200,200,255],(y*width+x)*4);
 const edgeCandidate=edge.slice();edgeCandidate[(10*width+9)*4]++;const masked=compareRGBA(width,height,edge,edgeCandidate);assert.ok(masked.maskedPixels>0);assert.ok(masked.maskedPixels<width*height);assert.equal(masked.exact,false);assert.equal(masked.changedPixels,1);assert.ok(masked.meanChannelDifference>0);assert.equal(masked.tolerancePass,true);
 const checker=solid(0);for(let y=0;y<height;y++)for(let x=0;x<width;x++)if((x+y)%2)checker.set([255,255,255,255],(y*width+x)*4);
 assert.equal(compareRGBA(width,height,checker,checker).tolerancePass,false,'a fully masked image is inconclusive, not a free pass');
 assert.throws(()=>assertAccounting({currentMesh:{bytes:10,geometryBytes:10,textureBytes:3},meshTotals:{installedBytes:10,installedGeometryBytes:10,installedTextureBytes:0}},'material'));
 assert.throws(()=>assertAccounting({currentMesh:{bytes:10},meshTotals:{installedBytes:10}},'material'));
 assertAccounting({currentMesh:{bytes:13,geometryBytes:10,textureBytes:3},meshTotals:{installedBytes:13,installedGeometryBytes:10,installedTextureBytes:3}},'material');
}
