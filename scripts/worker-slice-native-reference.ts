/** Native-only deterministic equivalence. No browser, renderer, realtime, or 4x locality claim.
 * node --import tsx --import ./scripts/register-compact-test-assets.mjs scripts/worker-slice-native-reference.ts
 * One actual worker city is fully terminated before the synchronous reference process starts.
 * The reference uses the production game world/projectile host directly, not createAuthorityRuntime.
 */
import assert from 'node:assert/strict';
import {Worker,isMainThread,threadId} from 'node:worker_threads';
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import RAPIER from '@dimforge/rapier3d-compat';
import {createStructuralGameWorld} from '../src/structural/game-world.js';
import {createProjectilePhysics} from '../src/physics.js';
import {createWorld} from '../src/domain.js';
import {createAuthorityRuntime} from '../src/worker-slice/authority-runtime.js';
import {TOOLS} from '../src/content-catalog.js';
import type {AuthorityAck,AuthorityCommand,AuthorityMessage} from '../src/worker-slice/protocol.js';
import type {StructuralCompactQueries} from '../src/structural/types.js';
import type {WorldSnapshot,Loadout,Detonation} from '../src/contracts.js';

type Wire=Record<string,any>;
const STEP=1/120,STEP_MS=1000/120;
const stock:Loadout={charge:0,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:1};
const arg=(name:string,fallback:string)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const output=arg('output','artifacts/worker-slice-reference');
const budgetMs=Number(arg('run-budget-ms','90000'));
const round=(n:number)=>Math.round(n*1000)/1000;
function normalize(value:any,key=''):any{
 if(key==='epoch'&&typeof value==='number')return 0;
 // Only the documented native epoch prefix changes; ticks, IDs, damage and poses do not.
 if(typeof value==='string')return value.replace(/^\d+:(detach|wake|sleep|impact|shot):/,'epoch:$1:');
 if(Array.isArray(value))return value.map(v=>normalize(v));
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,normalize(value[k],k)]));
 return value;
}
const hash=(value:any)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function canonical(saved:WorldSnapshot){
 const s=(saved.structural as any).simulation;
 const normalized=normalize(saved);normalized.structural.simulation.changes.sort((a:number[],b:number[])=>a[0]-b[0]);
 normalized.structural.simulation.bodies.sort((a:Wire,b:Wire)=>a.id.localeCompare(b.id));
 return {rawSnapshotSha256:hash(saved),normalizedSnapshotSha256:hash(normalized),normalization:'Object keys and sparse/body row ordering canonicalized; only numeric epoch fields and known native event-ID epoch prefixes normalized. No state, damage, phase, tick, pose, inventory, event ordering or float rounding.',
  epoch:saved.epoch,simulationEpoch:s.epoch,totalCount:saved.totalCount,destroyedCount:saved.destroyedCount,research:saved.research,round:saved.round,
  tick:s.tick,accumulator:s.accumulator,maxActiveBodies:s.maxActiveBodies,changeRows:s.changes.length,changesSha256:hash(normalized.structural.simulation.changes),bodies:s.bodies.length,bodiesSha256:hash(normalized.structural.simulation.bodies),
  queue:s.queue.length,queueSha256:hash(s.queue),shots:s.shots.length,shotsSha256:hash(s.shots),processed:s.processed.length,processedSha256:hash(normalize(s.processed)),events:s.events.length,eventsSha256:hash(normalize(s.events)),snapshotJsonBytes:Buffer.byteLength(JSON.stringify(saved))};
}
function observeNative(){
 const live=new Set<any>();let peak=0,seen=0;const restore:(()=>void)[]=[];
 for(const method of ['createRigidBody','createCollider','step'] as const){const original=(RAPIER.World.prototype as any)[method];(RAPIER.World.prototype as any)[method]=function(...args:any[]){if(!live.has(this)){live.add(this);seen++;peak=Math.max(peak,live.size);}return original.apply(this,args);};restore.push(()=>{(RAPIER.World.prototype as any)[method]=original;});}
 const free=RAPIER.World.prototype.free;RAPIER.World.prototype.free=function(){const out=free.call(this);live.delete(this);return out;};restore.push(()=>{RAPIER.World.prototype.free=free;});
 return {get:()=>({live:live.size,peak,seen}),restore:()=>restore.reverse().forEach(fn=>fn())};
}
function candidate(binding:StructuralCompactQueries,used:string[]){
 const f=binding.fixture;let best:Wire|undefined;const normals=[{x:1,y:0,z:0},{x:0,y:0,z:1},{x:-1,y:0,z:0},{x:0,y:0,z:-1},{x:0,y:1,z:0}];
 for(let ordinal=0;ordinal<f.structureCount;ordinal++){
  const id=f.idAtOrdinal(ordinal)!;if(f.roleOf(id)!=='building'||!f.objectiveOf(id))continue;
  const objectId=f.objectIdOf(id)!;if(used.includes(objectId))continue;
  const p=f.originalPosition(id)!;if(p.y<1||Math.abs(p.x)>65||Math.abs(p.z)>60)continue;
  const cell=binding.cell(id);if(!cell||cell.state!=='static')continue;
  for(let ni=0;ni<normals.length;ni++){const n=normals[ni];if(binding.source.staticIdAt(p.x+n.x,p.y+n.y,p.z+n.z)!==null)continue;
   const score=Math.abs(p.y-5)+Math.hypot(p.x,p.z)*.04+(n.y?8:0);
   if(!best||score<best.score||score===best.score&&id<best.id)best={id,objectId,score,center:p,surface:{voxelId:id,position:{x:p.x+n.x*.5,y:p.y+n.y*.5,z:p.z+n.z*.5},normal:n}};
  }
 }
 assert.ok(best,'No exposed static building face remains in the documented central search region');return best;
}
function bindingSummary(b:StructuralCompactQueries){return {aggregate:b.aggregate(),storage:b.diagnostics(),bindingRevision:b.revision,fixture:{count:b.fixture.count,structureCount:b.fixture.structureCount,terrainCount:b.fixture.terrainCount,recipeId:b.fixture.recipeId}};}

/** Test host only. The real production runtime and physics are unchanged. */
export async function makeRuntimeHost(transport:(message:Wire,transfer?:any[])=>void){
 const native=observeNative();let wall=0,seq=0,last:AuthorityAck|undefined,pose=0,event=0;
 let damage:Wire[]=[];let eventCount=0,poseBytes=0,maxDebtMs=0,steps=0;
 const runtime=createAuthorityRuntime({now:()=>wall,maxStepsPerPump:1,emit:(m:AuthorityMessage,transfer)=>{
  if(m.kind==='poses'){pose=m.poseSequence;poseBytes+=m.cellIds.byteLength+m.colors.byteLength+m.positions.byteLength+m.rotations.byteLength;transport({kind:'poses',poseSequence:m.poseSequence,cellIds:m.cellIds,colors:m.colors,positions:m.positions,rotations:m.rotations},transfer);}
  if(m.kind==='events'){event=m.eventSequence;eventCount+=m.events.length;for(const e of m.events)if(e.kind==='damage')damage.push(normalize(e));}
 }});
 async function send(body:Wire){const cmd={worldId:'city-native-reference',epoch:last?.epoch??0,mapRecipeHash:last?.mapRecipeHash??'uninitialized',sequence:++seq,commandId:`native-${seq}`,observedRevision:last?.summary?.authorityRevision??0,...body} as AuthorityCommand;
  last=await runtime.handle(cmd);assert.equal(last.status,'accepted',`${body.kind}: ${last.reason}`);assert.equal(last.summary?.fault,null);return last;}
 async function credits(){while(event||pose){if(event){const through=event;event=0;await send({kind:'event-ack',throughEventSequence:through});}if(pose){const id=pose;pose=0;await send({kind:'pose-ack',poseSequence:id});}}}
 const status=()=>{const s=runtime.inspect()!;maxDebtMs=Math.max(maxDebtMs,s.clock.simulationDebtMs);return {pending:s.pendingWork,ordnancePending:s.ordnancePending,objective:s.objective,research:s.research,round:s.round,clock:s.clock,native:native.get(),steps,...bindingSummary(runtime.readBinding()!)};};
 return {async request(action:string,payload:Wire={}){
  if(action==='initialize'){await send({kind:'initialize',mode:'free',fixture:'research-1400',mapId:'city',loadout:stock});await credits();return status();}
  if(action==='candidate')return candidate(runtime.readBinding()!,payload.used);
  if(action==='place'){const a=await send({kind:'place',placement:payload});await credits();return {surface:a.surface,...status()};}
  if(action==='detonate'){damage=[];await send({kind:'detonate'});await credits();return {damage,...status()};}
  if(action==='steps'){let count=0;while(count<payload.count&&runtime.inspect()!.pendingWork>0){steps++;wall=steps*STEP_MS;const s=runtime.pump();assert.equal(s?.clock.lastPumpSteps,1);assert.equal(s?.fault,null);await credits();count++;}return {count,...status()};}
  if(action==='save'){const a=await send({kind:'save'});await credits();return {canonical:canonical(JSON.parse(a.saveText!).snapshot),...status(),transport:{eventCount,poseBytes,maxDebtMs,commands:seq}};}
  if(action==='close'){runtime.dispose();const result=native.get();native.restore();return result;}
  throw new Error(`Unknown runtime host action ${action}`);
 }};
}
async function makeReferenceHost(){
 assert.equal(isMainThread,true);assert.equal(threadId,0);const native=observeNative();let steps=0,solverSteps=0;let world:ReturnType<typeof createStructuralGameWorld>|undefined,physics:Awaited<ReturnType<typeof createProjectilePhysics>>|undefined,off:(()=>void)|undefined;
 const status=()=>({pending:world!.pending(),ordnancePending:physics?.getPendingWorkCount?.()??0,objective:world!.getObjective(),research:world!.getResearch(),round:world!.getRound(),clock:{processedQuanta:steps,solverSteps,processedSimulationMs:steps*STEP_MS,simulationDebtMs:0},native:native.get(),steps,...bindingSummary(world!.getRenderBinding()!)});
 return {async request(action:string,payload:Wire={}){
  if(action==='initialize'){world=createStructuralGameWorld({free:true});const seed=createWorld().getSnapshot();seed.research=1400;assert.equal(await world.restore(seed),true);assert.equal(await world.startRound('city',stock),true);physics=await createProjectilePhysics({host:world.physicsHost!});off=world.physicsHost!.register({afterStep(){solverSteps++;}});return status();}
  if(action==='candidate')return candidate(world!.getRenderBinding()!,payload.used);
  if(action==='place'){assert.equal(physics!.attach({...payload,epoch:world!.epoch} as any),true);assert.equal(world!.recordShot('nova'),true);return {surface:payload.surface,...status()};}
  if(action==='detonate'){const damage=physics!.detonateAttached().map((event:Detonation)=>({kind:'damage',detonation:normalize(event),result:world!.damage({id:event.id,epoch:world!.epoch,target:event.position,weapon:event.weapon,power:event.power},{details:false})}));return {damage,...status()};}
  if(action==='steps'){let count=0;while(count<payload.count&&world!.pending()>0){world!.step(STEP);steps++;count++;}return {count,...status()};}
  if(action==='save')return {canonical:canonical(world!.getSnapshot()),...status()};
  if(action==='close'){off?.();physics?.dispose();world?.suspend();const result=native.get();native.restore();return result;}
  throw new Error(`Unknown reference action ${action}`);
 }};
}
const compact=(s:Wire)=>({pending:s.pending,ordnancePending:s.ordnancePending,objective:s.objective,research:s.research,round:s.round,clock:s.clock,native:s.native,steps:s.steps,aggregate:s.aggregate,storage:s.storage,fixture:s.fixture});
async function scenario(host:{request:(a:string,p?:Wire)=>Promise<any>},name:string,progress:(row:Wire)=>void,expected?:Wire){
 const start=performance.now(),result:Wire={name,status:'running',controllerThread:{isMainThread,threadId},shots:[]};
 const check=()=>assert.ok(performance.now()-start<budgetMs,`${name}: ${budgetMs}ms run budget exhausted; workload incomplete, not a pass`);
 const run=async(action:string,payload:Wire={})=>{check();const t=performance.now(),value=await host.request(action,payload);check();return {value,wallMs:round(performance.now()-t)};};
 const init=await run('initialize');result.initial={...compact(init.value),wallMs:init.wallMs};assert.equal(init.value.native.live,1);assert.equal(init.value.native.peak,1);progress({phase:'initialized',...result.initial});
 const used:string[]=[];
 for(let i=0;i<3;i++){
  const chosen=(await run('candidate',{used})).value;if(expected)assert.deepEqual(chosen,expected.shots[i].chosen,'Same-state surface selection must match');used.push(chosen.objectId);
  const placement={id:`city-native-nova-${i+1}`,weapon:'nova',power:1,surface:chosen.surface};
  const before=await run('place',placement);assert.equal(before.value.ordnancePending,1);
  progress({phase:'before-trigger',shot:i+1,chosen,placeWallMs:before.wallMs});
  const triggered=await run('detonate');assert.equal(triggered.value.damage.length,1);const actual=triggered.value.damage[0];assert.equal(actual.detonation.weapon,'nova');assert.equal(actual.detonation.power,1);assert.equal(actual.detonation.reason,'remote');assert.equal(actual.result.accepted,true);assert.ok(actual.result.newlyDestroyed>0);
  const p=chosen.surface.position,n=chosen.surface.normal;assert.deepEqual(actual.detonation.position,{x:p.x+n.x*.08,y:p.y+n.y*.08,z:p.z+n.z*.08});
  const shot:Wire={index:i+1,chosen,placement,triggerWallMs:triggered.wallMs,damage:actual,afterDamage:compact(triggered.value),settlementSteps:0};result.shots.push(shot);progress({phase:'damage',shot:i+1,triggerWallMs:triggered.wallMs,newlyDestroyed:actual.result.newlyDestroyed,pending:triggered.value.pending});
  let state=triggered.value;const settleStart=performance.now();let maxBatchMs=0,nextProgress=settleStart+10000;
  while(state.pending>0){const remaining=expected?expected.shots[i].settlementSteps-shot.settlementSteps:32;assert.ok(remaining>0,'Reference remains pending after worker fixed-step schedule');const batch=await run('steps',{count:Math.min(32,remaining)});assert.ok(batch.value.count>0);state=batch.value;shot.settlementSteps+=batch.value.count;maxBatchMs=Math.max(maxBatchMs,batch.wallMs);
   if(performance.now()>=nextProgress){progress({phase:'settling',shot:i+1,steps:shot.settlementSteps,pending:state.pending,elapsedMs:round(performance.now()-start)});nextProgress=performance.now()+10000;}
  }
  if(expected)assert.equal(shot.settlementSteps,expected.shots[i].settlementSteps,'Natural settle must occur at the same exact step, not earlier or later');
  assert.equal(state.ordnancePending,0);shot.settlementWallMs=round(performance.now()-settleStart);shot.max32StepBatchWallMs=maxBatchMs;shot.naturalSettlement=true;
  const saved=await run('save');shot.saved=saved.value.canonical;shot.afterSettlement=compact(saved.value);shot.transport=saved.value.transport;shot.saveWallMs=saved.wallMs;
  assert.equal(shot.saved.queue,0);assert.equal(shot.saved.maxActiveBodies,32);assert.equal(shot.saved.research,1400);assert.equal(shot.saved.round.remaining.nova,1);
  progress({phase:'settled',shot:i+1,steps:shot.settlementSteps,wallMs:shot.settlementWallMs,saved:shot.saved});
 }
 assert.equal(new Set(used).size,3);result.status='complete';result.totalWallMs=round(performance.now()-start);return result;
}
async function actualWorker(){
 const bootstrap=String.raw`const {parentPort,workerData,isMainThread,threadId}=require('node:worker_threads');require('tsx/esm/api').register();(async()=>{await import(workerData.assets);const {makeRuntimeHost}=await import(workerData.script);const host=await makeRuntimeHost((message,transfer)=>parentPort.postMessage({kind:'transport',message},transfer||[]));parentPort.postMessage({kind:'ready',isMainThread,threadId});parentPort.on('message',async ({id,action,payload})=>{try{parentPort.postMessage({kind:'result',id,value:await host.request(action,payload)});}catch(e){parentPort.postMessage({kind:'failure',id,error:String(e.stack||e)});}});})().catch(e=>parentPort.postMessage({kind:'boot-failure',error:String(e.stack||e)}));`;
 const worker=new Worker(bootstrap,{eval:true,execArgv:[],workerData:{assets:new URL('./register-compact-test-assets.mjs',import.meta.url).href,script:import.meta.url}});
 let serial=0,readyResolve:(v:Wire)=>void,readyReject:(e:Error)=>void;const ready=new Promise<Wire>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});const pending=new Map<number,{resolve:(v:any)=>void,reject:(e:Error)=>void}>();let bytes=0;
 const fail=(e:Error)=>{readyReject(e);for(const p of pending.values())p.reject(e);pending.clear();};worker.on('error',fail);worker.on('exit',code=>{if(pending.size)fail(new Error(`Worker exited ${code}`));});
 worker.on('message',(m:Wire)=>{if(m.kind==='ready')readyResolve(m);else if(m.kind==='boot-failure')fail(new Error(m.error));else if(m.kind==='transport'){for(const value of Object.values(m.message))if(ArrayBuffer.isView(value))bytes+=value.byteLength;}else{const p=pending.get(m.id);if(p){pending.delete(m.id);m.kind==='failure'?p.reject(new Error(m.error)):p.resolve(m.value);}}});
 const timer=setTimeout(()=>{fail(new Error(`Worker run exceeded ${budgetMs}ms hard wall budget; forcibly terminated incomplete`));void worker.terminate();},budgetMs);
 let info:Wire;try{info=await ready;assert.equal(info.isMainThread,false);assert.ok(info.threadId>0);}catch(error){clearTimeout(timer);await worker.terminate();throw error;}
 return {info,request:(action:string,payload:Wire={})=>new Promise<any>((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({id,action,payload});}),async terminate(){clearTimeout(timer);const code=await worker.terminate();return {terminationCode:code,transportedPoseBytes:bytes};}};
}
function reportProgress(scope:string,row:Wire){console.log(JSON.stringify({scope,...row}));}
async function coordinator(){
 mkdirSync(output,{recursive:true});const report:Wire={schema:'worker-slice-native-reference/v1',status:'running',startedAt:new Date().toISOString(),configuration:{map:'city',shots:3,power:1,uiPercent:100,radius:TOOLS.nova.radius,strength:TOOLS.nova.strength,mode:'free',fixtureResearch:1400,stepSeconds:STEP,runBudgetMs:budgetMs,noResetBetweenShots:true,maxActiveBodies:32},
  scope:'Native deterministic worker-vs-synchronous-reference equivalence only. One city native world at a time; no browser, UI, render, mesh, realtime or 4x locality verdict.',
  clockInterpretation:'Fake clock advances exactly one 1/120 quantum per step. Synthetic debt is NOT realtime throughput or eligible-wall-debt evidence. Actual operation wall durations are separate.',
  gaps:['4x distant-region full-physics locality fixture is not implemented or tested here.','No browser/input/geometry-freshness measurement.','No realtime worker scheduling or fixed-wall-cadence stress verdict.','Free-mode research/inventory remain constant by production rules, so exact equality is not progression-earning coverage.']};
 const save=()=>writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));save();let worker:Awaited<ReturnType<typeof actualWorker>>|undefined;
 try{
  worker=await actualWorker();report.workerThread=worker.info;
  report.worker=await scenario(worker,'actual-worker',row=>{report.lastProgress={scope:'worker',...row};save();reportProgress('worker',row);});
  report.worker.nativeAfterDispose=await worker.request('close');assert.equal(report.worker.nativeAfterDispose.live,0);report.workerTermination=await worker.terminate();worker=undefined;report.workerReleasedBeforeReference=true;save();
  writeFileSync(`${output}/worker-result.json`,JSON.stringify(report.worker,null,2));
  reportProgress('coordinator',{phase:'worker-fully-released-start-reference'});
  await new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx','--import','./scripts/register-compact-test-assets.mjs',fileURLToPath(import.meta.url),'--reference-child',`--output=${output}`,`--run-budget-ms=${budgetMs}`],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});let stderr='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error(`Synchronous reference exceeded ${budgetMs}ms hard wall budget; forcibly terminated incomplete`));},budgetMs);child.stdout.on('data',b=>process.stdout.write(b));child.stderr.on('data',b=>{stderr+=b;process.stderr.write(b);});child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`Reference process exited ${code}: ${stderr.slice(-3000)}`));});});
  report.reference=JSON.parse(readFileSync(`${output}/reference-result.json`,'utf8'));
  report.comparisons=report.worker.shots.map((w:Wire,i:number)=>{const r=report.reference.shots[i];return {shot:i+1,sameSurface:hash(w.chosen)===hash(r.chosen),sameDamage:hash(normalize(w.damage))===hash(normalize(r.damage)),sameFixedSteps:w.settlementSteps===r.settlementSteps,sameTick:w.saved.tick===r.saved.tick,rawSnapshotExact:w.saved.rawSnapshotSha256===r.saved.rawSnapshotSha256,canonicalSnapshotExact:w.saved.normalizedSnapshotSha256===r.saved.normalizedSnapshotSha256,sparseChangesExact:w.saved.changesSha256===r.saved.changesSha256,bodyStateExact:w.saved.bodiesSha256===r.saved.bodiesSha256,researchExact:w.saved.research===r.saved.research,inventoryExact:hash(w.saved.round)===hash(r.saved.round),aggregateExact:hash(w.afterSettlement.aggregate)===hash(r.afterSettlement.aggregate),eventsExact:w.saved.eventsSha256===r.saved.eventsSha256};});
  for(const comparison of report.comparisons)for(const [key,value] of Object.entries(comparison))if(key!=='shot'&&key!=='rawSnapshotExact')assert.equal(value,true,`Shot ${comparison.shot} ${key}`);
  assert.equal(report.reference.nativeAfterDispose.live,0);report.status='passed-native-equivalence';
 }catch(error){report.status=/budget|forcibly terminated/.test(String(error))?'incomplete-wall-budget':'failed';report.error=String((error as Error).stack??error);process.exitCode=1;}
 finally{if(worker){report.workerTermination=await worker.terminate();report.workerReleasedBeforeReference=false;}report.finishedAt=new Date().toISOString();save();reportProgress('coordinator',{status:report.status,error:report.error,report:`${output}/report.json`});}
}
if(isMainThread&&process.argv.includes('--reference-child')){
 const host=await makeReferenceHost();let result:Wire;
 try{const expected=JSON.parse(readFileSync(`${output}/worker-result.json`,'utf8'));result=await scenario(host,'synchronous-direct-reference',row=>reportProgress('reference',row),expected);result.nativeAfterDispose=await host.request('close');writeFileSync(`${output}/reference-result.json`,JSON.stringify(result,null,2));}
 catch(error){console.error(error);process.exitCode=1;try{await host.request('close');}catch{}}
}else if(isMainThread){await coordinator();}
