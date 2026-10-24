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
  upload:'Presentation drain measures CPU geometry installation only; render timing covers JavaScript WebGL submission and possible driver waits, not a GPU completion timer.',
  geometry:'Full queue drainage is a conservative visible-geometry observation, not per-affected-chunk revision-age proof.',
  collision:'Sequential launch proves a real impact, but does not prove the selected building was the authoritative collision host: the damage event exposes no hit voxel ID.',
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
 // Native immutable-recipe ray prefilter: no world, physics, or fixture arrays
 // enter the browser. Trusted canvas picking remains the actual aim authority.
 const nativeVisible=(candidate,camera)=>{
  const p=candidate.point,delta={x:p.x-camera.x,y:p.y-camera.y,z:p.z-camera.z};
  const cell={x:Math.floor(camera.x+.5),y:Math.floor(camera.y+.5),z:Math.floor(camera.z+.5)},step={},next={},stride={};
  for(const axis of ['x','y','z']){step[axis]=Math.sign(delta[axis]);stride[axis]=delta[axis]?Math.abs(1/delta[axis]):Infinity;next[axis]=delta[axis]?(cell[axis]+step[axis]*.5-camera[axis])/delta[axis]:Infinity;}
  for(let count=0;count<5000;count++){
   const id=fixture.idAt(cell.x,cell.y,cell.z);if(id!==null)return id===candidate.id;
   const axis=next.x<=next.y&&next.x<=next.z?'x':next.y<=next.z?'y':'z';if(next[axis]>1)return false;
   cell[axis]+=step[axis];next[axis]+=stride[axis];
  }
  throw new Error('Native candidate ray exceeded its finite traversal bound');
 };
 const aim=async(used,attempted=new Set(),pool=candidates)=>{
  const camera=await page.evaluate(()=>window.__workerSlice.diagnostics().renders.at(-1).camera);
  for(const candidate of pool){
   deadline();
   const token=[candidate.id,candidate.point.x,candidate.point.y,candidate.point.z].join(':');
   // After sequential destruction the immutable recipe cannot establish which
   // occluders remain, so only intact-scene preflight uses this native filter.
   if(used.has(candidate.objectId)||attempted.has(token)||((stress||used.size===0)&&!nativeVisible(candidate,camera)))continue;
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
  const before=await page.evaluate(()=>({at:performance.timeOrigin+performance.now(),render:window.__workerSlice.diagnostics().renders.at(-1)}));
  await page.locator('#probe').click();assert.notEqual(await page.locator('#probe-output').textContent(),beforeText,'Actual probe text must change');
  const dragBefore=await page.evaluate(()=>({at:performance.timeOrigin+performance.now(),render:window.__workerSlice.diagnostics().renders.at(-1)}));
  await page.mouse.move(800,280);await page.mouse.down();await page.mouse.move(825,292,{steps:4});await page.mouse.up();
  await page.waitForFunction(prior=>{const row=window.__workerSlice.diagnostics().renders.at(-1),p=row.camera,c=prior.render.camera;return row.at>=prior.at&&row.renderNo>prior.render.renderNo&&Math.hypot(p.x-c.x,p.y-c.y,p.z-c.z)>.01;},dragBefore);
  const after=await page.evaluate(()=>({at:performance.timeOrigin+performance.now(),render:window.__workerSlice.diagnostics().renders.at(-1)}));
  evidence.probes.push({before,dragBefore,after,textChanged:true,cameraTransformChanged:true});
 };
 await page.locator('#map').selectOption(map);const initialized=await click('initialize');
 const ready=await wait('actual initial mesh installation',d=>d.ready===true&&d.presentation.pending===0&&d.meshStats?.queue?.pendingDirty===0);
 assert.equal(evidence.browserWorkers.length,1,'The isolated visual scenario must create one actual browser Worker');assert.equal(ready.summary.mapId,map);assert.equal(ready.summary.mode,'free');
 evidence.initialize={command:initialized,readyAt:ready.at};await capture('initial-actual-scene');
 evidence.browser=await page.evaluate(()=>({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,longTaskAPI:PerformanceObserver.supportedEntryTypes.includes('longtask')}));
 const used=new Set();
 if(stress){
  // Select/verify every target before pressure. Later blast deletion is a real
  // failed placement, never permission to search, retry, or move a deadline.
  const preselected=[];
  const spread=[...candidates].sort((a,b)=>Math.hypot(b.point.x,b.point.z)-Math.hypot(a.point.x,a.point.z)||a.score-b.score);
  for(let index=0;index<shotCount;index++){
   // Keep the requested central-building first blast. Only later shots choose
   // distant zones; inability to find three intact targets is a preflight fail.
   const pool=index===0?candidates:spread.filter(c=>preselected.every(s=>Math.hypot(c.point.x-s.candidate.point.x,c.point.y-s.candidate.point.y,c.point.z-s.candidate.point.z)>64));
   const aimed=await aim(used,new Set(),pool);used.add(aimed.candidate.objectId);preselected.push(aimed);
  }
  const buttons={};for(const id of ['place','detonate','probe']){const box=await page.locator(`#${id}`).boundingBox();assert.ok(box);buttons[id]={x:box.x+box.width/2,y:box.y+box.height/2};}
  const baseline=await read(),knownCommands=new Set(baseline.commands.map(c=>c.id));
  const clickAt=point=>page.mouse.click(point.x,point.y);
  const prepare=async aimed=>{await clickAt(aimed.pixel);await clickAt(buttons.place);};
  await prepare(preselected[0]);
  const clock=await page.evaluate(()=>performance.timeOrigin+performance.now());
  const nodeOrigin=performance.now()+500,browserOrigin=clock+500,scheduled=[];
  evidence.pressure={startedAt:baseline.at,plannedFirstTriggerAt:browserOrigin,requestedSpacingMs:2000,preselected,dispatches:scheduled,observation:'No screenshots, candidate search, camera drag, acknowledgement wait, or settlement wait during scheduled input dispatch.'};
  for(let index=0;index<shotCount;index++){
   if(index>0)await prepare(preselected[index]);
   const remaining=nodeOrigin+index*2000-performance.now();if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
   const row={index:index+1,plannedTriggerAt:browserOrigin+index*2000,dispatchStartedAt:browserOrigin+performance.now()-nodeOrigin};scheduled.push(row);
   await clickAt(buttons.detonate);row.dispatchFinishedAt=browserOrigin+performance.now()-nodeOrigin;
   await clickAt(buttons.probe);
  }
  // Only now inspect acknowledgements. Interleaved clock/event acks do not
  // change ordered place/detonate pairs. Every trigger must consume one charge.
  const completed=await wait('all fixed-deadline commands accepted and committed',d=>{const rows=d.commands.filter(c=>!knownCommands.has(c.id)&&['place','detonate'].includes(c.kind));return rows.length===6&&rows.every(c=>c.ack);});
  const commandRows=completed.commands.filter(c=>!knownCommands.has(c.id)&&['place','detonate'].includes(c.kind));
  assert.deepEqual(commandRows.map(c=>c.kind),['place','detonate','place','detonate','place','detonate']);
  evidence.commandRows.push(...commandRows);
  let previousDestroyed=baseline.summary.objective.destroyed;
  for(let index=0;index<shotCount;index++){
   const aimed=preselected[index],launch=commandRows[index*2],trigger=commandRows[index*2+1];
   for(const row of [launch,trigger]){assert.equal(row.ack.status,'accepted',`${row.kind} ${index+1}: fixed target/deadline must not be silently retried`);assert.equal(row.ack.committed,true);}
   const actualId=launch.ack.surface?.voxelId;assert.ok(Number.isSafeInteger(actualId),'Worker must return the actual accepted host cell ID');
   const confirmedBuilding=fixture.objectIdOf(actualId);assert.equal(confirmedBuilding,aimed.candidate.objectId,'Selected and actual authoritative host buildings must match');
   const damageId=`placed-${launch.id.slice('cmd-'.length)}`;
   const damaged=await wait(`matching damage for ${damageId}`,d=>d.events.some(batch=>batch.events.some(e=>e.kind==='damage'&&e.detonation.id===damageId)));
   const batch=damaged.events.find(batch=>batch.events.some(e=>e.kind==='damage'&&e.detonation.id===damageId));
   const damage=batch.events.find(e=>e.kind==='damage'&&e.detonation.id===damageId);
   assert.equal(batch.events.filter(e=>e.kind==='damage').length,1,'A trigger must not accumulate multiple remotely attached charges');
   assert.equal(damage.detonation.weapon,'nova');assert.equal(damage.detonation.power,1);assert.equal(damage.detonation.reason,'remote');assert.equal(damage.result.accepted,true);
   assert.ok(Math.hypot(damage.detonation.position.x-aimed.candidate.point.x,damage.detonation.position.y-aimed.candidate.point.y,damage.detonation.position.z-aimed.candidate.point.z)<1.5,'The selected building must be the actual detonation location');
   assert.ok(trigger.ack.summary.objective.destroyed>previousDestroyed,'Every real shot must cause additional building destruction');previousDestroyed=trigger.ack.summary.objective.destroyed;
   const plannedTriggerAt=scheduled[index].plannedTriggerAt;
   evidence.shots.push({index:index+1,aimed,confirmedBuilding,launch,trigger,damageBatch:batch,damageObservedAt:batch.receivedAt,settledAt:null,summary:trigger.ack.summary,plannedTriggerAt,cadenceErrorMs:trigger.sentAt-plannedTriggerAt,geometryDrainAfterCommitMs:null,authorityDamageLatencyMs:batch.committedAtMs-trigger.sentAt,triggerToDamageObservedMs:batch.receivedAt-trigger.sentAt});
  }
  await persist();
 }else for(let index=0;index<shotCount;index++){
  const attempted=new Set();let aimed=await aim(used,attempted);const before=await read(),known=new Set(before.events.flatMap(batch=>batch.events).filter(e=>e.kind==='damage').map(e=>e.detonation.id));
  let launch,trigger,confirmedBuilding=null,plannedTriggerAt=null,cadenceErrorMs=null;
  if(index===0){
   while(true){
    attempted.add(aimed.token);launch=await acknowledged(await issue('place'));
    if(launch.ack.status==='accepted'){assert.equal(launch.ack.committed,true);break;}
    assert.equal(launch.ack.reason,'invalid-placement','Only a genuinely stale/deleted visible surface may be reselected; never hide another rejection');
    aimed=await aim(used,attempted);
   }
   const actualId=launch.ack.surface?.voxelId;assert.ok(Number.isSafeInteger(actualId),'Worker must return the actual accepted host cell ID');
   confirmedBuilding=fixture.objectIdOf(actualId);assert.equal(confirmedBuilding,aimed.candidate.objectId,'Worker-authoritative hit must belong to the distinct selected building');
   const issued=await issue('detonate');
   // Exercise UI while the costly remote-damage acknowledgement is outstanding.
   await probe();trigger=await accepted(issued);
  }else{const issued=await issue('launch');await probe();launch=await accepted(issued);} 
  used.add(aimed.candidate.objectId);
  const damaged=await wait('real worker detonation',d=>d.events.some(batch=>batch.events.some(e=>e.kind==='damage'&&!known.has(e.detonation.id))));
  const batch=damaged.events.find(batch=>batch.events.some(e=>e.kind==='damage'&&!known.has(e.detonation.id))),damage=batch.events.find(e=>e.kind==='damage'&&!known.has(e.detonation.id));
  assert.equal(damage.detonation.weapon,'nova');assert.equal(damage.detonation.power,1);assert.equal(damage.result.accepted,true);
  assert.equal(damage.detonation.reason,index===0?'remote':'impact');
  const geometry=await wait('actual geometry queue drainage',d=>d.presentation.pending===0&&d.meshStats?.queue?.pendingDirty===0&&d.meshStats?.queue?.inFlightPatches===0&&d.meshStats.epoch===batch.epoch&&d.meshStats.at>=batch.committedAtMs&&d.meshStats.authority>=batch.authorityRevision&&d.summary.authorityRevision>=batch.authorityRevision);
  const settled=await wait('natural authority settlement and actual geometry installation',d=>d.summary.pendingWork===0&&d.presentation.pending===0&&d.meshStats?.queue?.pendingDirty===0&&d.meshStats?.queue?.inFlightPatches===0&&d.meshStats.epoch===batch.epoch&&d.meshStats.at>=batch.committedAtMs&&d.meshStats.authority>=batch.authorityRevision&&d.summary.authorityRevision>=batch.authorityRevision);
  assert.ok(settled.summary.objective.destroyed>before.summary.objective.destroyed,'Every real shot must cause additional building destruction');
  const row={index:index+1,aimed,confirmedBuilding,launch,trigger:trigger??null,damageBatch:batch,damageObservedAt:damaged.at,settledAt:settled.at,summary:settled.summary,plannedTriggerAt,cadenceErrorMs,
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
   triggerSentAt:evidence.shots.map(row=>row.trigger.sentAt),authorityTriggerStartedAt:evidence.shots.map(row=>row.trigger.ack.startedAtMs),damageCommittedAt:evidence.shots.map(row=>row.damageBatch.committedAtMs),
   authorityStartSpacingMs:evidence.shots.slice(1).map((row,i)=>row.trigger.ack.startedAtMs-evidence.shots[i].trigger.ack.startedAtMs),damageCommitSpacingMs:evidence.shots.slice(1).map((row,i)=>row.damageBatch.committedAtMs-evidence.shots[i].damageBatch.committedAtMs),
   distinctBuildings:new Set(evidence.shots.map(row=>row.confirmedBuilding)).size,actualDetonationPositions:evidence.shots.map(row=>row.damageBatch.events.find(e=>e.kind==='damage').detonation.position),
   lastComputationCommitAt:lastCommit,recoveredDebtAt:recovery?.at??null,recoveryMs:recovery?recovery.at-lastCommit:null,settledAt:recovered.at};
  evidence.pressure.finishedAt=recovered.at;
  evidence.gaps.push('Per-shot affected geometry freshness remains unmeasured in overlapping stress; final queue drainage is not a substitute.');
  // Camera drag is intentionally outside fixed-cadence pressure and followed
  // through a render that actually has a different camera transform.
  await probe();
 }
 const saved=await click('save');assert.equal(saved.ack.status,'accepted');assert.ok(saved.ack.saveTextBytes>0);const savedState=await read();assert.equal(savedState.saveTextBytes,saved.ack.saveTextBytes);evidence.savedBytes=saved.ack.saveTextBytes;
 const final=await read(),observer=await page.evaluate(()=>window.__workerSliceObserver);assert.equal(observer.overflow,false);
 const inputRows=final.inputs.filter(row=>row.id==='probe'&&Number.isFinite(row.eventAt)&&Number.isFinite(row.renderAt));
 const inputs=measurements(inputRows.map(row=>row.renderAt-row.eventAt));
 const measuredCommands=evidence.commandRows.filter(row=>row.ack&&['place','launch','detonate','clock','save','end'].includes(row.kind));
 const commands=measurements(measuredCommands.map(row=>row.ackAt-row.sentAt));
 const commandLatencyStages={authorityReceipt:measurements(measuredCommands.map(row=>row.ack.receivedAtMs-row.sentAt)),executionQueue:measurements(measuredCommands.map(row=>row.ack.startedAtMs-row.ack.receivedAtMs)),commit:measurements(measuredCommands.map(row=>row.ack.committedAtMs-row.sentAt)),observedCommittedAck:commands,boundary:'The commandAcceptance gate remains the conservative committed-ACK roundtrip. Early receipt is neither committed acceptance nor visible feedback.'};
 const maxDebt=Math.max(0,...evidence.samples.map(row=>row.summary?.clock.peakSimulationDebtMs??0));
 const longTasks=observer.longTasks.filter(row=>row.at>=ready.at),maxLongTask=Math.max(0,...longTasks.map(row=>row.duration));
 const aggregateMainCosts=predicate=>Object.fromEntries(['render','mesh-install','effects','controls','pose-apply','ray-pick'].map(kind=>[kind,measurements((final.mainCosts??[]).filter(row=>row.kind===kind&&predicate(row)).map(row=>row.ms))]));
 const mainCosts=aggregateMainCosts(row=>row.at>=ready.at);
 const inPressure=row=>row.at>=evidence.pressure.startedAt&&row.at<=evidence.pressure.finishedAt;
 const pressureObservations=stress?{mainCosts:aggregateMainCosts(inPressure),longTasks:longTasks.filter(inPressure),maxLongTaskMs:Math.max(0,...longTasks.filter(inPressure).map(row=>row.duration))}:null;
 evidence.observations={inputs,commands,commandLatencyStages,maxDebtMs:maxDebt,longTasks,maxLongTaskMs:maxLongTask,mainCosts,pressureObservations,mainCostsBoundary:'Bounded retained post-ready CPU samples, not complete history or GPU completion timings. Pressure-only costs exclude initial screenshots and target preflight; the conservative main-long-task gate still uses all post-ready observations.',trustedInputs:observer.trustedInputs,final};
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
  shots:evidence.shots.map(row=>({index:row.index,selectedBuilding:row.aimed.candidate.objectId,confirmedBuilding:row.confirmedBuilding,authoritativeHitBuildingVerified:row.confirmedBuilding!==null,position:row.damageBatch.events.find(e=>e.kind==='damage')?.detonation.position,authorityDamageLatencyMs:row.authorityDamageLatencyMs,geometryDrainAfterCommitMs:row.geometryDrainAfterCommitMs,settledAt:row.settledAt})),
  stress:evidence.stress??null,inputs:evidence.observations?.inputs??null,commandAcceptance:evidence.observations?.commands??null,commandLatencyStages:evidence.observations?.commandLatencyStages??null,maxObservedDebtMs:evidence.observations?.maxDebtMs??null,maxMainLongTaskMs:evidence.observations?.maxLongTaskMs??null,mainCosts:evidence.observations?.mainCosts??null,pressureMainCosts:evidence.observations?.pressureObservations?.mainCosts??null,pressureMainLongTaskMaxMs:evidence.observations?.pressureObservations?.maxLongTaskMs??null,mainCostsBoundary:evidence.observations?.mainCostsBoundary??null,
  screenshots:evidence.screenshots,gaps:evidence.gaps,failure:evidence.failure?.slice(0,1500)??null}));
 await browser?.close();
}

