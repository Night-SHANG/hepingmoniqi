/** Native, instrumented production-city authority profile. No rendering/FPS claim.
 * Run from the repository root (one city-world process at a time):
 * node --import tsx --import ./scripts/register-compact-test-assets.mjs scripts/profile-city-nova-authority.ts
 * Optional: --output=artifacts/<directory> --blasts=3 --phase-budget-ms=120000
 * Prototype wrappers and Node CPU sampling observe unchanged production methods.
 * A wall-budget abort intentionally leaves an incomplete workload, never claims
 * settlement, and is only checked between measured production method calls.
 */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {mkdirSync,writeFileSync} from 'node:fs';
import {Session} from 'node:inspector';
import {createHash} from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';
import {createStructuralGameWorld} from '../src/structural/game-world.js';
import {createProjectilePhysics} from '../src/physics.js';
import {TOOLS} from '../src/content-catalog.js';
import {CompactStaticColliders} from '../src/compact/static-colliders.js';
import {CompactAuthorityStore} from '../src/compact/store.js';
import {IndexedStructure} from '../src/compact/support/indexed-structure.js';
import type {Detonation,WorldSnapshot} from '../src/contracts.js';

const arg=(key:string,fallback:string)=>process.argv.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const output=arg('output',`artifacts/city-nova-authority/${new Date().toISOString().replace(/[:.]/g,'-')}`);
const phaseBudgetMs=Number(arg('phase-budget-ms','120000'));
const blastLimit=Number(arg('blasts','3'));
assert.ok(Number.isFinite(phaseBudgetMs)&&phaseBudgetMs>0);
assert.ok(Number.isSafeInteger(blastLimit)&&blastLimit>=1&&blastLimit<=3);
mkdirSync(output,{recursive:true});
const round=(n:number)=>Math.round(n*1000)/1000;
const memory=()=>({...process.memoryUsage(),maxRSSKiB:process.resourceUsage().maxRSS});
const sha=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const result:any={scope:'Instrumented Node production city authority, shared native projectile host; no browser, rendering, VFX or FPS measurement',configuration:{weapon:'nova',uiPowerPercent:100,internalPower:1,radius:TOOLS.nova.radius,strength:TOOLS.nova.strength,maxActiveBodies:'production default 32',center:{x:0,y:3,z:0},blastLimit,phaseBudgetMs},notes:['All phase and wrapper times include instrumentation overhead. Inclusive nested timers must not be summed. Exclusive wrapper time excludes only other wrapped methods, not all child functions.','Each shot creates a real remote nova on the shared host at city center and immediately detonates it, so this measures production ordnance/damage, not travel or aim. No power, damage, body budget, settlement, or VFX settings are altered.','Settlement advances the production shared clock at 1/120 second and stops only at pending=0 or the explicit wall-budget abort.'],phases:[],blasts:[],status:'running',before:memory()};
const saveReport=()=>writeFileSync(`${output}/report.json`,JSON.stringify(result,null,2));
const log=(event:string,data:object={})=>{console.log(JSON.stringify({at:new Date().toISOString(),event,...data}));};
type Metric={calls:number,inclusiveMs:number,exclusiveMs:number,maxMs:number,items:number};
let metrics:Record<string,Metric>|undefined,phaseName='',phaseStart=0,nextHeartbeat=0,enforceBudget=false;
const stack:{childMs:number}[]=[];
class BudgetExceeded extends Error{}
function checkpoint(){
 if(!enforceBudget)return;
 const elapsed=performance.now()-phaseStart;
 if(elapsed>=nextHeartbeat){nextHeartbeat=elapsed+10000;log('phase-progress',{phase:phaseName,elapsedMs:round(elapsed),leaveCalls:metrics?.['support.leave']?.calls??0,splitCalls:metrics?.['support.split']?.calls??0,nativeSteps:metrics?.['rapier.step']?.calls??0});}
 if(elapsed>phaseBudgetMs)throw new BudgetExceeded(`Wall budget exceeded in ${phaseName}: ${round(elapsed)}ms; workload unfinished`);
}
const restores:(()=>void)[]=[];
function wrap(target:any,key:string,label:string|((args:any[])=>string),count?:(args:any[])=>number){
 const original=target[key];assert.equal(typeof original,'function',`Missing method ${key}`);
 target[key]=function(...args:any[]){
  if(!metrics)return original.apply(this,args);
  checkpoint();const name=typeof label==='function'?label(args):label;
  const metric=metrics[name]??={calls:0,inclusiveMs:0,exclusiveMs:0,maxMs:0,items:0};
  const frame={childMs:0},at=performance.now();stack.push(frame);metric.calls++;metric.items+=count?.(args)??0;
  try{return original.apply(this,args);}finally{const ms=performance.now()-at;stack.pop();if(stack.length)stack[stack.length-1].childMs+=ms;metric.inclusiveMs+=ms;metric.exclusiveMs+=ms-frame.childMs;metric.maxMs=Math.max(metric.maxMs,ms);}
 };
 restores.push(()=>{target[key]=original;});
}
wrap(IndexedStructure.prototype,'leave','support.leave',a=>a[0].length);
wrap(IndexedStructure.prototype,'split','support.split');
wrap(IndexedStructure.prototype,'unsupported','support.unsupported');
for(const key of ['pack','add','remove','flush','colliderForCell','resolveCollider'])wrap(CompactStaticColliders.prototype,key,`staticColliders.${key}`);
for(const key of ['writable','markChanged','queryStaticSphere','changedIds','changesSince'])wrap(CompactAuthorityStore.prototype,key,`authority.${key}`);
for(const key of ['step','createRigidBody','removeRigidBody','removeCollider','contactPairsWith','contactPair'])wrap(RAPIER.World.prototype,key,`rapier.${key}`);
wrap(RAPIER.World.prototype,'createCollider',a=>a[1]?'rapier.createDebrisOrProjectileCollider':'rapier.createStaticOrRubbleCollider');
wrap(RAPIER.Collider.prototype,'contactCollider','rapier.rubbleSupportContact');
const inspector=new Session();inspector.connect();
const post=(method:string,params:object={})=>new Promise<any>((resolve,reject)=>inspector.post(method as any,params,(error,value)=>error?reject(error):resolve(value)));
await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:1000});
function cpuSummary(profile:any){
 const nodes=new Map<number,any>(profile.nodes.map((n:any)=>[n.id,n])),parent=new Map<number,number>();
 for(const node of profile.nodes)for(const id of node.children??[])parent.set(id,node.id);
 const self=new Map<number,number>(),inclusive=new Map<number,number>();
 for(let i=0;i<(profile.samples?.length??0);i++){let id=profile.samples[i];const us=profile.timeDeltas[i]??1000;self.set(id,(self.get(id)??0)+us);while(id!==undefined){inclusive.set(id,(inclusive.get(id)??0)+us);id=parent.get(id);}}
 const rows=[...nodes.values()].map(node=>({name:node.callFrame.functionName||'(anonymous)',url:node.callFrame.url,line:node.callFrame.lineNumber+1,selfMs:round((self.get(node.id)??0)/1000),inclusiveMs:round((inclusive.get(node.id)??0)/1000)}));
 return {sampleCount:profile.samples?.length??0,durationMs:round((profile.endTime-profile.startTime)/1000),topSelf:rows.filter(n=>n.selfMs>0).sort((a,b)=>b.selfMs-a.selfMs).slice(0,30),topInclusive:rows.filter(n=>n.inclusiveMs>0).sort((a,b)=>b.inclusiveMs-a.inclusiveMs).slice(0,30)};
}
async function phase<T>(name:string,fn:()=>T|Promise<T>,budget=true):Promise<T>{
 phaseName=name;metrics={};phaseStart=performance.now();nextHeartbeat=10000;enforceBudget=budget;log('phase-start',{phase:name});
 await post('Profiler.start');const at=performance.now();let value:T|undefined,error:unknown;
 try{value=await fn();}catch(e){error=e;}finally{enforceBudget=false;}
 const elapsed=performance.now()-at,{profile}=await post('Profiler.stop');
 const measured=metrics;metrics=undefined;writeFileSync(`${output}/${name}.cpuprofile`,JSON.stringify(profile));
 const entry={name,ms:round(elapsed),status:error?'failed':'complete',...(error?{error:String(error)}:{}),wrappers:Object.fromEntries(Object.entries(measured!).map(([key,m])=>[key,{...m,inclusiveMs:round(m.inclusiveMs),exclusiveMs:round(m.exclusiveMs),maxMs:round(m.maxMs)}])),cpu:cpuSummary(profile),memory:memory()};
 result.phases.push(entry);saveReport();log('phase-end',{phase:name,ms:entry.ms,status:entry.status,topSelf:entry.cpu.topSelf.slice(0,7),topWrappers:Object.entries(entry.wrappers).sort(([,a],[,b])=>b.inclusiveMs-a.inclusiveMs).slice(0,8)});
 if(error)throw error;return value!;
}
let world:ReturnType<typeof createStructuralGameWorld>|undefined,ordnance:Awaited<ReturnType<typeof createProjectilePhysics>>|undefined;
const summary=()=>{const binding=world!.getRenderBinding()!;return{epoch:world!.epoch,revision:binding.revision,pending:world!.pending(),aggregate:binding.aggregate(),storage:binding.diagnostics(),objective:world!.getObjective(),native:{bodies:world!.physicsHost!.world.bodies.len(),colliders:world!.physicsHost!.world.colliders.len()}};};
function snapshotSummary(saved:WorldSnapshot){const s=(saved.structural as any).simulation;return{jsonBytes:Buffer.byteLength(JSON.stringify(saved)),totalCount:saved.totalCount,destroyedCount:saved.destroyedCount,changeRows:s.changes.length,changeSha256:sha([...s.changes].sort((a:any,b:any)=>a[0]-b[0])),bodies:s.bodies.length,bodySha256:sha(s.bodies),queue:s.queue.length,shots:s.shots.length,processed:s.processed.length,tick:s.tick,epoch:s.epoch};}
try{
 world=createStructuralGameWorld({free:true});wrap(world,'damage','game.damage');
 assert.equal(await phase('initialize-city',()=>world!.loadMap('city',true)),true);
 result.initial=summary();log('city-ready',result.initial);
 let baseline:WorldSnapshot|undefined;
 await phase('baseline-snapshot',()=>{baseline=world!.getSnapshot();result.baselineSnapshot=snapshotSummary(baseline);});baseline=undefined;
 ordnance=await createProjectilePhysics({host:world.physicsHost!});
 for(let blast=1;blast<=blastLimit;blast++){
  const record:any={blast,before:summary()};result.blasts.push(record);
  await phase(`nova-${blast}-damage`,()=>{
   const origin={x:0,y:3,z:0};
   assert.equal(ordnance!.launch({id:`profile-city-nova-${blast}`,epoch:world!.epoch,weapon:'nova',power:1,trigger:'remote',origin,target:{x:0,y:-1,z:0}}),true);
   const events=ordnance!.detonateAttached();assert.equal(events.length,1);const event:Detonation=events[0];record.detonation=event;
   const at=performance.now(),damage=world!.damage({id:event.id,epoch:event.epoch,target:event.position,weapon:event.weapon,power:event.power,reward:false});
   record.directDamageMs=round(performance.now()-at);assert.equal(damage.accepted,true);record.damage={accepted:damage.accepted,removed:damage.removed.length,detached:damage.detached.length,newlyDestroyed:damage.newlyDestroyed,researchEarned:damage.researchEarned,destruction:damage.destruction};
  });
  record.afterDamage=summary();record.damage.revisionDelta=record.afterDamage.revision-record.before.revision;log('nova-damaged',{blast,...record.damage,pending:record.afterDamage.pending});saveReport();
  let steps=0,maxStepMs=0,maxStepRevisionDelta=0,stepsOverJournalCapacity=0;const slowSteps:{step:number,ms:number,pending:number}[]=[];
  await phase(`nova-${blast}-settlement`,()=>{
   while(world!.pending()>0){checkpoint();const changesBefore=metrics?.['authority.markChanged']?.calls??0;const at=performance.now();world!.step(1/120);const ms=performance.now()-at;const revisionDelta=(metrics?.['authority.markChanged']?.calls??0)-changesBefore;maxStepRevisionDelta=Math.max(maxStepRevisionDelta,revisionDelta);if(revisionDelta>16384)stepsOverJournalCapacity++;steps++;maxStepMs=Math.max(maxStepMs,ms);if(ms>50&&slowSteps.length<50)slowSteps.push({step:steps,ms:round(ms),pending:world!.pending()});}
   record.settlement={natural:true,steps,simulatedSeconds:steps/120,maxStepMs:round(maxStepMs),maxStepRevisionDelta,stepsOverJournalCapacity,slowSteps};
  }).catch(error=>{record.settlement={natural:false,steps,simulatedSeconds:steps/120,maxStepMs:round(maxStepMs),maxStepRevisionDelta,stepsOverJournalCapacity,slowSteps,pending:world!.pending()};throw error;});
  record.afterSettlement=summary();log('nova-settled',{blast,...record.settlement,aggregate:record.afterSettlement.aggregate});saveReport();
 }
 let saved:WorldSnapshot|undefined;
 await phase('final-snapshot',()=>{saved=world!.getSnapshot();result.saved=snapshotSummary(saved);});
 const beforeRestore=summary();
 await phase('restore-same-world',async()=>{assert.equal(await world!.restore(saved!),true);});
 await phase('verify-restored-snapshot',()=>{const after=world!.getSnapshot();result.restored=snapshotSummary(after);assert.equal(result.restored.changeSha256,result.saved.changeSha256);assert.equal(result.restored.bodySha256,result.saved.bodySha256);assert.equal(after.destroyedCount,saved!.destroyedCount);assert.equal(world!.pending(),beforeRestore.pending);assert.deepEqual(world!.getRenderBinding()!.aggregate(),beforeRestore.aggregate);result.restoreVerified={sparseChangesExact:true,bodyTransformsExact:true,aggregateExact:true,pendingExact:true,epochAdvanced:world!.epoch>beforeRestore.epoch};});
 saved=undefined;result.status='complete';
}catch(error){result.status=error instanceof BudgetExceeded?'incomplete-wall-budget':'failed';result.error=String(error);if(world?.physicsHost){try{result.stopped=summary();}catch(e){result.stopSummaryError=String(e);}}log('workload-stopped',{status:result.status,error:result.error});
}finally{
 enforceBudget=false;metrics=undefined;ordnance?.dispose();
 if(world?.physicsHost){log('cleanup-start');const at=performance.now();try{world.suspend();result.suspendMs=round(performance.now()-at);}catch(error){result.cleanupError=String(error);}log('cleanup-end',{ms:round(performance.now()-at)});}
 inspector.disconnect();for(const restore of restores.reverse())restore();result.after=memory();saveReport();log('report-written',{output,status:result.status});
}
