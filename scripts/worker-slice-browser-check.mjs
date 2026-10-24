import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';

// Authoring this harness does not authorize its execution. Never fall back to a
// local browser or install another browser. This guard precedes any launch.
assert.equal(process.env.GITHUB_ACTIONS,'true','This browser harness may run only in separately authorized GitHub CI');
assert.equal(process.env.QA_BROWSER_CHANNEL,'chrome','Use only the already-authorized preinstalled Chrome');
const url=process.env.GAME_URL??'http://127.0.0.1:5192/worker-slice.html';
const output=process.env.QA_OUTPUT??'artifacts/worker-slice-browser';
const scenario=process.env.QA_WORKER_SCENARIO??'courtyard-smoke';
assert.ok(['courtyard-smoke','city-three-sequential','city-three-stress'].includes(scenario));
const map=scenario==='courtyard-smoke'?'courtyard':'city',shotCount=map==='city'?3:1,stress=scenario==='city-three-stress';
const evidence={
 schema:'isolated-authority-worker-browser/v1',startedAt:new Date().toISOString(),url,scenario,status:'running',verdict:'incomplete',
 provenance:{execution:'separately authorized CI / preinstalled Chrome',commit:process.env.GITHUB_SHA??null,runId:process.env.GITHUB_RUN_ID??null},
 scope:{actualWorker:true,actualCanvasAndControls:true,map,shots:shotCount,power:1,firstShot:'place then remote trigger',laterShots:stress?'actual place/remote trigger at fixed 2-second wall cadence':'real collision launches',fixture:'explicit free-mode research-1400 synthetic unlock; not earned progression'},
 thresholds:{inputP95Ms:100,mainLongTaskMaxMs:100,acceptanceP95Ms:100,damageAfterTriggerMs:250,geometryAfterCommitMs:500,maxEligibleDebtMs:500,recoveredDebtMs:100,recoveryAfterLastComputationMs:2000},
 interpretation:{input:'Trusted input handler to submitted renderer feedback, not physical monitor or GPU completion.',
  authority:'An ack is counted only after the worker reports accepted and committed. Button highlight is not acceptance.',
  geometry:'Full queue drainage is a conservative visible-geometry observation, not per-affected-chunk revision-age proof.',
  measurement:'Software renderer and diagnostic observation costs must be reported. UI response is never a substitute for authority or mesh freshness.'},
 browserWorkers:[],shots:[],probes:[],commandRows:[],samples:[],errors:[],screenshots:[],gaps:[
  'No baseline synchronous browser A/B measurement in this harness.',
  ...(!stress?['The 2-second fixed-cadence three-shot stress sequence is not exercised by this selected scenario.']:[]),
  'The 4× independent distant-map locality fixture and connected-support comparison are planned, not implemented or measured.',
  'Natural settlement is observed, but no equal-simulation-tick canonical reference comparison is made.',
  'Probe click-to-render is measured; camera movement is verified, but a trusted pointer-move-to-corresponding-camera-render timestamp is not yet exposed.',
  'Queued-body count/oldest age and per-affected-chunk commit-to-install age require additional diagnostics.',
  'Main/free isolation, damaged-save reload, pause/slow-motion and reset-in-flight browser cases are not established by this smoke harness.',
 ],
};
await fs.mkdir(output,{recursive:true});
const persist=()=>fs.writeFile(`${output}/results.json`,JSON.stringify(evidence,null,2));
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(p*values.length)-1]:null;
const measurements=values=>({count:values.length,p95:percentile(values,.95),max:values.length?Math.max(...values):null});
let browser,page;
const started=Date.now(),observationLimitMs=180_000;
const deadline=()=>{assert.ok(Date.now()-started<observationLimitMs,'Observation window expired: unresolved work is not settlement or a timing pass');};
try{
 const {createCompactGameFixture}=await tsImport('../src/compact/fixture.ts',import.meta.url);
 const fixture=createCompactGameFixture(map),candidates=[];
 // Immutable scalar recipe only, never instantiate a second simulation world.
 for(let ordinal=0;ordinal<fixture.structureCount;ordinal++){
  const id=fixture.idAtOrdinal(ordinal);if(!fixture.objectiveOf(id)||fixture.roleOf(id)!=='building')continue;
  const p=fixture.originalPosition(id);if(p.y<1||map==='city'&&(Math.abs(p.x)>65||Math.abs(p.z)>60))continue;
  for(const n of [{x:1,y:0,z:0},{x:0,y:0,z:1},{x:0,y:1,z:0}])if(fixture.idAt(p.x+n.x,p.y+n.y,p.z+n.z)===null)candidates.push({id,objectId:fixture.objectIdOf(id),point:{x:p.x+n.x*.49,y:p.y+n.y*.49,z:p.z+n.z*.49},score:Math.abs(p.y-5)+Math.hypot(p.x,p.z)*.04+(n.y?8:0)});
 }
 candidates.sort((a,b)=>a.score-b.score||a.id-b.id);
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(15_000);
 page.on('pageerror',error=>evidence.errors.push(String(error)));page.on('worker',worker=>evidence.browserWorkers.push({url:worker.url(),observedAt:new Date().toISOString()}));
 await page.addInitScript(()=>{
  const state={longTasks:[],trustedInputs:[],overflow:false};
  const append=(list,row)=>{if(list.length<12000)list.push(row);else state.overflow=true;};
  for(const type of ['pointerdown','pointerup','click'])addEventListener(type,event=>{if(event.isTrusted)append(state.trustedInputs,{type,target:event.target?.id??event.target?.tagName,at:performance.timeOrigin+performance.now()});},true);
  if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>{for(const row of list.getEntries())append(state.longTasks,{at:performance.timeOrigin+row.startTime,duration:row.duration});}).observe({entryTypes:['longtask']});
  Object.defineProperty(window,'__workerSliceObserver',{value:state});
 });
 await page.goto(url);await page.waitForFunction(()=>typeof window.__workerSlice?.diagnostics==='function');
 const read=async()=>{
  const value=await page.evaluate(()=>({at:performance.timeOrigin+performance.now(),...window.__workerSlice.diagnostics()}));
  assert.ok(Array.isArray(value.errors),'Missing required read-only error diagnostics');assert.deepEqual(value.errors,[]);assert.deepEqual(evidence.errors,[]);
  if(evidence.samples.length<4000)evidence.samples.push({at:value.at,summary:value.summary,presentation:{pending:value.presentation.pending,bytes:value.presentation.bytes},meshStats:value.meshStats});
  else throw new Error('Diagnostic sample capacity exceeded; do not silently truncate debt history');
  return value;
 };
 const capture=async label=>{
  const began=await page.evaluate(()=>performance.timeOrigin+performance.now());
  const bytes=await page.screenshot({type:'jpeg',quality:48,scale:'css'}),filename=`${scenario}-${label}.jpg`;
  const ended=await page.evaluate(()=>performance.timeOrigin+performance.now());
  await fs.writeFile(`${output}/${filename}`,bytes);
  const metadata={label,filename,startedAt:began,finishedAt:ended,durationMs:ended-began,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),timingNote:'Actual screenshot capture duration is not a frame-time or FPS measurement; overlap may add measurement overhead.'};
  evidence.screenshots.push(metadata);
  if(bytes.length<=220_000)console.log('SCREENSHOT_BASE64 '+JSON.stringify({...metadata,mimeType:'image/jpeg',base64:bytes.toString('base64')}));
  else evidence.gaps.push(`Screenshot ${label} is ${bytes.length} bytes and exceeds the 220 KB log-preview limit; the actual file was preserved but no oversized preview was emitted.`);
  return metadata;
 };
 const wait=async(label,predicate,limitMs=90_000)=>{
  const began=Date.now();while(true){deadline();const value=await read();if(predicate(value))return value;assert.ok(Date.now()-began<limitMs,`${label}: still incomplete, not a pass`);await page.waitForTimeout(50);}
 };
 const issue=async(kind,selector=`#${kind}`)=>{
  const before=await read(),known=new Set(before.commands.map(c=>c.id));await page.locator(selector).click();
  const value=await wait(`${kind} issued`,d=>d.commands.some(c=>!known.has(c.id)&&c.kind===kind));
  return value.commands.find(c=>!known.has(c.id)&&c.kind===kind);
 };
 const acknowledged=async(sent)=>{
  const value=await wait(`${sent.kind} accepted/committed`,d=>d.commands.some(c=>c.id===sent.id&&c.ack));
  const row=value.commands.find(c=>c.id===sent.id&&c.ack);
  evidence.commandRows.push(row);return row;
 };
 const accepted=async(sent)=>{const row=await acknowledged(sent);assert.equal(row.ack.status,'accepted',`${sent.kind} must be accepted by authority, not merely highlighted`);assert.equal(row.ack.committed,true);return row;};
 const click=async(kind,selector=`#${kind}`)=>accepted(await issue(kind,selector));
 const aim=async(used,attempted=new Set())=>{
  for(const candidate of candidates){
   const token=[candidate.id,candidate.point.x,candidate.point.y,candidate.point.z].join(':');
   if(used.has(candidate.objectId)||attempted.has(token))continue;deadline();
   const pixel=await page.evaluate(point=>window.__workerSlice.project(point),candidate.point);
   if(!pixel.visible||!await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS',pixel))continue;
   await page.mouse.click(pixel.x,pixel.y);const d=await read(),actual=d.target?.position;
   if(actual&&Math.hypot(actual.x-candidate.point.x,actual.y-candidate.point.y,actual.z-candidate.point.z)<1.2)return {candidate,token,pixel,actualTarget:d.target};
  }
  throw new Error('No actual exposed building surface is available; never inject an aim or damage command');
 };
 const probe=async()=>{
  // Both are actual trusted UI inputs. The button is reversible and independent
  // of authority, so its response is reported separately from command latency.
  const beforeText=await page.locator('#probe-output').textContent();
  const before=await page.evaluate(()=>({at:performance.timeOrigin+performance.now(),point:window.__workerSlice.project({x:0,y:5,z:0}),render:window.__workerSlice.diagnostics().renders.at(-1)}));
  await page.locator('#probe').click();assert.notEqual(await page.locator('#probe-output').textContent(),beforeText,'Actual probe text must change');
  await page.mouse.move(800,280);await page.mouse.down();await page.mouse.move(825,292,{steps:4});await page.mouse.up();
  await page.waitForFunction(renderNo=>window.__workerSlice.diagnostics().renders.at(-1).renderNo>renderNo,before.render.renderNo);
  const after=await page.evaluate(()=>({at:performance.timeOrigin+performance.now(),point:window.__workerSlice.project({x:0,y:5,z:0}),render:window.__workerSlice.diagnostics().renders.at(-1)}));
  assert.ok(Math.hypot(after.point.x-before.point.x,after.point.y-before.point.y)>.1,'Actual camera projection must change, not just a button highlight');
  evidence.probes.push({before,after,textChanged:true});
 };
 await page.locator('#map').selectOption(map);const initialized=await click('initialize');
 const ready=await wait('actual initial mesh installation',d=>d.ready===true&&d.presentation.pending===0&&d.meshStats?.queue?.pendingDirty===0);
 assert.equal(evidence.browserWorkers.length,1,'The isolated visual scenario must create one actual browser Worker');assert.equal(ready.summary.mapId,map);assert.equal(ready.summary.mode,'free');
 evidence.initialize={command:initialized,readyAt:ready.at};await capture('initial-actual-scene');
 evidence.browser=await page.evaluate(()=>({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,longTaskAPI:PerformanceObserver.supportedEntryTypes.includes('longtask')}));
 const used=new Set();let cadenceOrigin=null;
 for(let index=0;index<shotCount;index++){
  const attempted=new Set();let aimed=await aim(used,attempted);const before=await read(),known=new Set(before.events.flatMap(batch=>batch.events).filter(e=>e.kind==='damage').map(e=>e.detonation.id));
  let launch,trigger,confirmedBuilding=null,plannedTriggerAt=null,cadenceErrorMs=null;
  if(index===0||stress){
   while(true){
    attempted.add(aimed.token);launch=await acknowledged(await issue('place'));
    if(launch.ack.status==='accepted'){assert.equal(launch.ack.committed,true);break;}
    assert.equal(launch.ack.reason,'invalid-placement','Only a genuinely stale/deleted visible surface may be reselected; never hide another rejection');
    aimed=await aim(used,attempted);
   }
   const actualId=launch.ack.surface?.voxelId;assert.ok(Number.isSafeInteger(actualId),'Worker must return the actual accepted host cell ID');
   confirmedBuilding=fixture.objectIdOf(actualId);assert.equal(confirmedBuilding,aimed.candidate.objectId,'Worker-authoritative hit must belong to the distinct selected building');
   if(stress&&cadenceOrigin!==null){
    plannedTriggerAt=cadenceOrigin+index*2000;
    const current=await read();if(plannedTriggerAt>current.at)await page.waitForTimeout(plannedTriggerAt-current.at);
   }
   const issued=await issue('detonate');
   if(stress){cadenceOrigin??=issued.sentAt;plannedTriggerAt??=cadenceOrigin;cadenceErrorMs=issued.sentAt-plannedTriggerAt;}
   // Exercise UI while the costly remote-damage acknowledgement is outstanding.
   const capturing=index===0?capture('response-during-real-blast'):Promise.resolve();await probe();await capturing;trigger=await accepted(issued);
  }else{const issued=await issue('launch');await probe();launch=await accepted(issued);} 
  used.add(aimed.candidate.objectId);
  const damaged=await wait('real worker detonation',d=>d.events.some(batch=>batch.events.some(e=>e.kind==='damage'&&!known.has(e.detonation.id))));
  const batch=damaged.events.find(batch=>batch.events.some(e=>e.kind==='damage'&&!known.has(e.detonation.id))),damage=batch.events.find(e=>e.kind==='damage'&&!known.has(e.detonation.id));
  assert.equal(damage.detonation.weapon,'nova');assert.equal(damage.detonation.power,1);assert.equal(damage.result.accepted,true);
  assert.equal(damage.detonation.reason,index===0||stress?'remote':'impact');
  if(stress)assert.ok(Math.hypot(damage.detonation.position.x-aimed.candidate.point.x,damage.detonation.position.y-aimed.candidate.point.y,damage.detonation.position.z-aimed.candidate.point.z)<1.5,'The distinct selected building must be the actual detonation location');
  const geometry=stress?null:await wait('actual geometry queue drainage',d=>d.presentation.pending===0&&d.meshStats?.queue?.pendingDirty===0&&d.meshStats?.queue?.inFlightPatches===0&&d.meshStats.epoch===batch.epoch&&d.meshStats.at>=batch.committedAtMs&&d.meshStats.authority>=batch.authorityRevision&&d.summary.authorityRevision>=batch.authorityRevision);
  const settled=stress?damaged:await wait('natural authority settlement and actual geometry installation',d=>d.summary.pendingWork===0&&d.presentation.pending===0&&d.meshStats?.queue?.pendingDirty===0&&d.meshStats?.queue?.inFlightPatches===0&&d.meshStats.epoch===batch.epoch&&d.meshStats.at>=batch.committedAtMs&&d.meshStats.authority>=batch.authorityRevision&&d.summary.authorityRevision>=batch.authorityRevision);
  assert.ok(settled.summary.objective.destroyed>before.summary.objective.destroyed,'Every real shot must cause additional building destruction');
  const row={index:index+1,aimed,confirmedBuilding,launch,trigger:trigger??null,damageBatch:batch,damageObservedAt:damaged.at,settledAt:stress?null:settled.at,summary:settled.summary,plannedTriggerAt,cadenceErrorMs,
   geometryDrainAfterCommitMs:geometry?geometry.at-batch.committedAtMs:null,
   authorityDamageLatencyMs:trigger?batch.committedAtMs-trigger.sentAt:null,
   triggerToDamageObservedMs:trigger?damaged.at-trigger.sentAt:null};
  // Collision timing needs its own worker collision timestamp; do not label
  // projectile flight duration as post-collision authority latency.
  evidence.shots.push(row);await persist();
 }
 if(stress){
  const lastBatch=evidence.shots.at(-1).damageBatch,lastCommit=lastBatch.committedAtMs;
  const recovered=await wait('eligible debt recovery and final natural settlement',d=>d.summary.pendingWork===0&&d.summary.clock.simulationDebtMs<=100&&d.presentation.pending===0&&d.meshStats?.queue?.pendingDirty===0&&d.meshStats?.queue?.inFlightPatches===0&&d.meshStats.epoch===lastBatch.epoch&&d.meshStats.at>=lastCommit&&d.meshStats.authority>=lastBatch.authorityRevision&&d.summary.authorityRevision>=lastBatch.authorityRevision);
  const recovery=evidence.samples.find(row=>row.at>=lastCommit&&row.summary?.epoch===lastBatch.epoch&&row.summary?.authorityRevision>=lastBatch.authorityRevision&&row.summary?.clock.simulationDebtMs<=100);
  evidence.stress={requestedSpacingMs:2000,actualSpacingMs:evidence.shots.slice(1).map((row,i)=>row.trigger.sentAt-evidence.shots[i].trigger.sentAt),cadenceErrorsMs:evidence.shots.map(row=>row.cadenceErrorMs),
   distinctBuildings:new Set(evidence.shots.map(row=>row.confirmedBuilding)).size,actualDetonationPositions:evidence.shots.map(row=>row.damageBatch.events.find(e=>e.kind==='damage').detonation.position),
   lastComputationCommitAt:lastCommit,recoveredDebtAt:recovery?.at??null,recoveryMs:recovery?recovery.at-lastCommit:null,settledAt:recovered.at};
  evidence.gaps.push('Per-shot affected geometry freshness remains unmeasured in overlapping stress; final queue drainage is not a substitute.');
 }
 const saved=await click('save');assert.equal(saved.ack.status,'accepted');assert.ok(saved.ack.saveTextBytes>0);const savedState=await read();assert.equal(savedState.saveTextBytes,saved.ack.saveTextBytes);evidence.savedBytes=saved.ack.saveTextBytes;
 const final=await read(),observer=await page.evaluate(()=>window.__workerSliceObserver);assert.equal(observer.overflow,false);
 const inputRows=final.inputs.filter(row=>row.id==='probe'&&Number.isFinite(row.eventAt)&&Number.isFinite(row.renderAt));
 const inputs=measurements(inputRows.map(row=>row.renderAt-row.eventAt));
 const commands=measurements(evidence.commandRows.filter(row=>row.ack&&['place','launch','detonate','clock','save','end'].includes(row.kind)).map(row=>row.ackAt-row.sentAt));
 const maxDebt=Math.max(0,...evidence.samples.map(row=>row.summary?.clock.simulationDebtMs??0));
 const longTasks=observer.longTasks.filter(row=>row.at>=ready.at),maxLongTask=Math.max(0,...longTasks.map(row=>row.duration));
 evidence.observations={inputs,commands,maxDebtMs:maxDebt,longTasks,maxLongTaskMs:maxLongTask,trustedInputs:observer.trustedInputs,final};
 evidence.componentGates={probeInputFeedback:inputs.count>0&&inputs.p95<100,mainLongTasks:maxLongTask<=100,cameraInputFeedback:null,commandAcceptance:commands.count>0&&commands.p95<100,
  remoteDamage:evidence.shots.filter(row=>row.trigger).every(row=>row.authorityDamageLatencyMs<250),conservativeFullGeometryDrain:stress?null:evidence.shots.every(row=>row.geometryDrainAfterCommitMs<500),eligibleDebt:maxDebt<=500,
  ...(stress?{fixedCadence:evidence.stress.cadenceErrorsMs.every(value=>Math.abs(value)<100)&&evidence.stress.distinctBuildings===3,debtRecovery:evidence.stress.recoveryMs!==null&&evidence.stress.recoveryMs<=2000}:{})};
 await capture('after-actual-destruction');
 const ended=await click('end');assert.equal(ended.ack.summary.round.settled,true);await click('dispose');
 evidence.status='completed-observations';
 evidence.verdict=Object.values(evidence.componentGates).some(value=>value===false)?'failed-component-gates':'incomplete-unmeasured-targets';
 await persist();
 if(evidence.verdict==='failed-component-gates')process.exitCode=1;
}catch(error){evidence.status='failed-or-incomplete';evidence.verdict='not-passed';evidence.failure=String(error?.stack??error);await persist();throw error;}
finally{
 console.log('WORKER_SLICE_RESULT '+JSON.stringify({scenario,status:evidence.status,verdict:evidence.verdict,componentGates:evidence.componentGates??null,browserWorkers:evidence.browserWorkers,
  shots:evidence.shots.map(row=>({index:row.index,confirmedBuilding:row.confirmedBuilding,position:row.damageBatch.events.find(e=>e.kind==='damage')?.detonation.position,authorityDamageLatencyMs:row.authorityDamageLatencyMs,geometryDrainAfterCommitMs:row.geometryDrainAfterCommitMs,settledAt:row.settledAt})),
  stress:evidence.stress??null,inputs:evidence.observations?.inputs??null,commandAcceptance:evidence.observations?.commands??null,maxObservedDebtMs:evidence.observations?.maxDebtMs??null,maxMainLongTaskMs:evidence.observations?.maxLongTaskMs??null,
  screenshots:evidence.screenshots,gaps:evidence.gaps,failure:evidence.failure?.slice(0,1500)??null}));
 await browser?.close();
}

