import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker, isMainThread, threadId} from 'node:worker_threads';

// Independent integration review. The real authority and Rapier execute in a
// separate V8 worker isolate. Only the transport, clock, and native lifecycle
// observation are test-host adapters; damage, physics and saves are unchanged.
const stock={charge:6,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0};
const bootstrap=String.raw`
const {parentPort,workerData,threadId,isMainThread}=require('node:worker_threads');
require('tsx/esm/api').register();
(async()=>{
 await import(workerData.assets);
 const R=(await import('@dimforge/rapier3d-compat')).default;
 const active=new Set();let peak=0,seen=0;
 const observe=world=>{if(!active.has(world)){active.add(world);seen++;peak=Math.max(peak,active.size);}};
 // Observe real native worlds on first use. Delegate every operation unchanged.
 for(const method of ['createRigidBody','createCollider','step']){
  const original=R.World.prototype[method];
  R.World.prototype[method]=function(...args){observe(this);return original.apply(this,args);};
 }
 const originalFree=R.World.prototype.free;
 R.World.prototype.free=function(...args){const result=originalFree.apply(this,args);active.delete(this);return result;};
 let wall=0,meshQueue;
 const {createAuthorityRuntime}=await import(workerData.runtime);
 const runtime=createAuthorityRuntime({now:()=>wall,maxStepsPerPump:8,emit:(message,transfer)=>parentPort.postMessage({kind:'output',message},transfer??[])});
 parentPort.postMessage({kind:'ready',threadId,isMainThread});
 parentPort.on('message',async ({id,action,payload})=>{
  try{
   let value;
   if(action==='command')value=await runtime.handle(payload);
   else if(action==='pump'){wall=payload.now;for(let i=0;i<(payload.count??1);i++)value=runtime.pump();}
   else if(action==='inspect')value=runtime.inspect();
   else if(action==='cell'){const b=runtime.readBinding();const cellId=payload.id??b.source.staticIdAt(payload.x,payload.y,payload.z);value={id:cellId,cell:cellId===null?null:b.cell(cellId)};}
   else if(action==='mesh-transfer'){
    const {buildChunk}=await import(workerData.mesh);
    const {MeshCreditQueue}=await import(workerData.queue);
    const {createCompactSurfaceSource}=await import(workerData.surface);
    const binding=runtime.readBinding(),state=runtime.inspect(),key='10,-1,0',source=createCompactSurfaceSource(binding.source);
    const cellId=source.staticIdAt(20,-1,0),before=source.hpOf(cellId);
    meshQueue=new MeshCreditQueue({envelope:state,chunkKeys:[key]});meshQueue.markDirty(key,state.bindingRevision,wall);
    const out=meshQueue.takeNext(key=>buildChunk(source,key,2),wall);
    if(out.status!=='patch')throw new Error('Expected actual complete mesh output');
    parentPort.postMessage({kind:'mesh-transfer',patch:out.patch},out.transfer);
    value={detached:out.patch.mesh.position.byteLength===0&&out.patch.mesh.normal.byteLength===0&&out.patch.mesh.color.byteLength===0,before,after:source.hpOf(cellId),rebuiltFaces:buildChunk(source,key,2).faces,queue:meshQueue.diagnostics(wall)};
   }
   else if(action==='mesh-ack')value={released:meshQueue.acknowledge(payload),queue:meshQueue.diagnostics(wall)};
   else if(action==='native')value={live:active.size,peak,seen};
   else if(action==='dispose'){runtime.dispose();value={live:active.size,peak,seen};}
   else throw new Error('Unknown test-host request');
   parentPort.postMessage({kind:'result',id,value});
  }catch(error){parentPort.postMessage({kind:'failure',id,message:String(error?.stack??error)});}
 });
})().catch(error=>{parentPort.postMessage({kind:'boot-failure',message:String(error?.stack??error)});process.exitCode=1;});
`;

type Wire=Record<string,any>;
async function harness(initialization:Wire={}){
 assert.equal(isMainThread,true);assert.equal(threadId,0);
 const worker=new Worker(bootstrap,{eval:true,execArgv:[],workerData:{
  assets:new URL('../../scripts/register-compact-test-assets.mjs',import.meta.url).href,
  runtime:new URL('./authority-runtime.ts',import.meta.url).href,
  mesh:new URL('./chunk-mesh.ts',import.meta.url).href,queue:new URL('./mesh-credit-queue.ts',import.meta.url).href,surface:new URL('../compact/surface-source.ts',import.meta.url).href,
 }});
 let next=0,sequence=0,last:Wire|undefined;
 const pending=new Map<number,{resolve:(value:any)=>void,reject:(error:Error)=>void}>(),messages:Wire[]=[],meshes:Wire[]=[];
 let readyResolve:(value:Wire)=>void,readyReject:(error:Error)=>void;
 const ready=new Promise<Wire>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const fail=(error:Error)=>{readyReject(error);for(const p of pending.values())p.reject(error);pending.clear();};
 worker.on('error',fail);
 worker.on('message',(data:Wire)=>{
  if(data.kind==='ready'){readyResolve(data);return;}
  if(data.kind==='boot-failure'){fail(new Error(data.message));return;}
  if(data.kind==='output'){messages.push(data.message);return;}
  if(data.kind==='mesh-transfer'){meshes.push(data.patch);return;}
  const p=pending.get(data.id);if(!p)return;pending.delete(data.id);
  data.kind==='failure'?p.reject(new Error(data.message)):p.resolve(data.value);
 });
 worker.on('exit',code=>{if(pending.size)fail(new Error(`Authority worker exited with code ${code}`));});
 const timer=setTimeout(()=>fail(new Error('Real authority worker failed to initialize within 30 seconds')),30_000);
 try{const started=await ready;assert.equal(started.isMainThread,false);assert.ok(started.threadId>0);}catch(error){await worker.terminate();throw error;}finally{clearTimeout(timer);}
 const rpc=(action:string,payload:unknown={}):Promise<any>=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});worker.postMessage({id,action,payload});});
 const command=(body:Wire):Wire=>({worldId:'independent-review',epoch:last?.epoch??0,mapRecipeHash:last?.mapRecipeHash??'uninitialized',sequence:++sequence,commandId:`review-${sequence}`,observedRevision:last?.summary?.authorityRevision??0,...body});
 const sendRaw=async(value:Wire)=>last=await rpc('command',value);
 const send=(body:Wire)=>sendRaw(command(body));
 const initialized=await send({kind:'initialize',mode:'main',mapId:'courtyard',loadout:stock,...initialization});
 assert.equal(initialized.status,'accepted');
 return {worker,rpc,command,send,sendRaw,messages,meshes,get last(){return last!;},async close(){try{await rpc('dispose');}finally{await worker.terminate();}}};
}
const shot=(id:string)=>({id,weapon:'charge',power:1,origin:{x:20,y:5,z:0},target:{x:20,y:0,z:0}});
const damageEvents=(messages:Wire[])=>messages.filter(m=>m.kind==='events').flatMap(m=>m.events).filter(e=>e.kind==='damage');

// A wrong implementation consuming inventory on enqueue or replay fails here.
test('real Worker accepts one actual projectile and duplicate commands spend stock exactly once',async()=>{
 const h=await harness();try{
  assert.deepEqual(await h.rpc('native'),{live:1,peak:1,seen:1});
  const bad=await h.send({kind:'launch',shot:{...shot('invalid'),target:{x:20,y:5,z:0}}});
  assert.equal(bad.status,'rejected');assert.equal(bad.summary.round.remaining.charge,6);
  const command=h.command({kind:'launch',shot:shot('accepted-once')});
  const accepted=await h.sendRaw(command),duplicate=await h.sendRaw(command);
  assert.equal(accepted.status,'accepted');assert.equal(accepted.committed,true);assert.equal(accepted.commandSequence,command.sequence);assert.equal(accepted.summary.round.remaining.charge,5);
  assert.equal(duplicate.duplicate,true);assert.equal(duplicate.summary.round.remaining.charge,5);
  const state=await h.rpc('inspect');assert.equal(state.projectiles.length,1);assert.equal(state.projectiles[0].id,'accepted-once');
  assert.equal(damageEvents(h.messages).length,0,'Acceptance is an actual launch, never a fake immediate explosion');
  assert.deepEqual(await h.rpc('native'),{live:1,peak:1,seen:1},'Projectiles must share the structural native world');
 }finally{await h.close();}
});

// A delta cap or baseline reset would lose foreground debt and fail these sums.
test('real Worker preserves five seconds of eligible debt and separates pause from hidden time',async()=>{
 const h=await harness();try{
  let state=await h.rpc('pump',{now:5000});
  assert.equal(state.clock.foregroundEligibleMs,5000);assert.ok(state.clock.simulationDebtMs>4900);
  assert.equal(state.clock.discardedSimulationMs,0);assert.ok(state.clock.processedSimulationMs<100);
  state=await h.rpc('pump',{now:5000,count:75});
  assert.ok(Math.abs(state.clock.processedSimulationMs-5000)<1e-6);assert.ok(state.clock.simulationDebtMs<1e-6);
  await h.send({kind:'clock',paused:true});state=await h.rpc('pump',{now:6500});
  assert.equal(state.clock.foregroundEligibleMs,5000);assert.equal(state.clock.pausedWallMs,1500);
  await h.send({kind:'clock',paused:false,hidden:true});state=await h.rpc('pump',{now:8500});
  assert.equal(state.clock.hiddenWallMs,2000);assert.equal(state.clock.foregroundEligibleMs,5000);
  await h.send({kind:'clock',hidden:false,timeScale:.5});state=await h.rpc('pump',{now:9500,count:8});
  assert.equal(state.clock.foregroundEligibleMs,6000);assert.ok(Math.abs(state.clock.processedSimulationMs-5500)<1e-6);
  assert.equal(state.clock.discardedSimulationMs,0);
 }finally{await h.close();}
});

test('real Worker save barrier contains accepted inventory and rejected restore preserves canonical authority',async()=>{
 const h=await harness();try{
  const {id}=await h.rpc('cell',{x:20,y:-1,z:0});assert.notEqual(id,null);
  const placed=await h.send({kind:'place',placement:{id:'barrier-charge',weapon:'charge',power:1,surface:{voxelId:id,position:{x:20,y:-.5,z:0},normal:{x:0,y:1,z:0}}}});
  assert.equal(placed.status,'accepted');assert.equal((await h.send({kind:'save'})).reason,'in-flight-ordnance-unsupported');
  assert.equal((await h.send({kind:'end',criticalEffectsPending:false})).reason,'authority-pending');
  const triggered=await h.send({kind:'detonate'});assert.equal(triggered.status,'accepted');
  assert.equal(damageEvents(h.messages).length,1);
  assert.equal((await h.rpc('cell',{id})).cell.state,'gone');
  const saved=await h.send({kind:'save'});assert.equal(saved.status,'accepted');assert.equal(typeof saved.saveText,'string');
  const before=JSON.parse(saved.saveText);assert.equal(before.snapshot.round.remaining.charge,5);assert.equal(before.committedSequence,saved.commandSequence);assert.ok(before.committedSequence>triggered.commandSequence);
  const broken=structuredClone(before);broken.snapshot.research=-1;
  const rejected=await h.send({kind:'restore',saveText:JSON.stringify(broken)});assert.equal(rejected.status,'rejected');
  const after=JSON.parse((await h.send({kind:'save'})).saveText);
  assert.deepEqual(after.snapshot,before.snapshot,'Invalid restore must leave canonical HP, holes, inventory, events and native bodies unchanged');
  assert.deepEqual(await h.rpc('native'),{live:1,peak:1,seen:1});
  const restored=await h.send({kind:'restore',saveText:saved.saveText});assert.equal(restored.status,'accepted');assert.equal(restored.epoch,saved.epoch+1);
  assert.equal(restored.summary.round.remaining.charge,5);assert.equal((await h.rpc('cell',{id})).cell.state,'gone');
  const native=await h.rpc('native');assert.equal(native.live,1);assert.equal(native.peak,1,'A successful restore may replace, never overlap, active native worlds');
 }finally{await h.close();}
});

test('real Worker reset rejects already-queued old-epoch launch and never overlaps live native worlds',async()=>{
 const h=await harness();try{
  const old=h.last.epoch;
  const reset=h.command({kind:'reset'}),late=h.command({kind:'launch',shot:shot('forbidden-late')});
  const [replaced,rejected]=await Promise.all([h.sendRaw(reset),h.sendRaw(late)]);
  assert.equal(replaced.status,'accepted');assert.equal(replaced.epoch,old+1);assert.equal(rejected.reason,'stale-epoch');
  assert.equal((await h.rpc('inspect')).projectiles.length,0);
  const native=await h.rpc('native');assert.equal(native.live,1);assert.equal(native.peak,1);assert.equal(native.seen,2);
  const disposed=await h.rpc('dispose');assert.equal(disposed.live,0);
 }finally{await h.close();}
});


test('real Worker refuses a save wrapper whose recipe identity does not match its snapshot',async()=>{
 const h=await harness();try{
  const saved=await h.send({kind:'save'}),before=JSON.parse(saved.saveText),corrupt=structuredClone(before);
  corrupt.mapRecipeHash='wrong-recipe-identity';
  const restored=await h.send({kind:'restore',saveText:JSON.stringify(corrupt)});
  assert.equal(restored.status,'rejected','A malformed recipe envelope must not replace the current authority');
  assert.equal(restored.epoch,saved.epoch);
  assert.deepEqual(JSON.parse((await h.send({kind:'save'})).saveText).snapshot,before.snapshot);
 }finally{await h.close();}
});

test('actual worker mesh transfer detaches owned output only and old epochs cannot install or release new credit',async()=>{
 const h=await harness();try{
  const result=await h.rpc('mesh-transfer');assert.equal(result.detached,true);assert.equal(result.after,result.before);
  assert.equal(h.meshes.length,1);const patch=h.meshes[0];assert.ok(patch.mesh.position.byteLength>0);assert.equal(patch.mesh.faces,result.rebuiltFaces);
  const bytes=patch.mesh.position.byteLength+patch.mesh.normal.byteLength+patch.mesh.color.byteLength;
  assert.equal(result.queue.inFlightBytes,bytes);
  const stale=await h.rpc('mesh-ack',{...patch.header,epoch:patch.header.epoch-1});assert.equal(stale.released,0);assert.equal(stale.queue.inFlightBytes,bytes);
  const {MeshPatchRevisionGate}=await import('./mesh-credit-queue.js');
  const gate=new MeshPatchRevisionGate({envelope:patch.header,chunkKeys:[patch.header.key]});assert.equal(gate.installed(patch.header),true);
  gate.reset({...patch.header,epoch:patch.header.epoch+1},[patch.header.key]);assert.equal(gate.canInstall(patch.header),false);
  assert.equal(gate.canInstall({...patch.header,epoch:patch.header.epoch+1,worldId:'another-world'}),false);
  const released=await h.rpc('mesh-ack',patch.header);assert.equal(released.released,bytes);assert.equal(released.queue.inFlightBytes,0);
  assert.equal((await h.rpc('mesh-ack',patch.header)).released,0);gate.dispose();
 }finally{await h.close();}
});

test('real detached bodies prevent end even after attached ordnance has detonated',async()=>{
 const h=await harness({mode:'free',fixture:'research-1400',loadout:{...stock,charge:0,shock:1}});try{
  const {id}=await h.rpc('cell',{x:0,y:1,z:0});assert.notEqual(id,null);
  const placed=await h.send({kind:'place',placement:{id:'physical-pending',weapon:'shock',power:3,surface:{voxelId:id,position:{x:0,y:1.5,z:0},normal:{x:0,y:1,z:0}}}});
  assert.equal(placed.status,'accepted');const blast=await h.send({kind:'detonate'});assert.equal(blast.status,'accepted');
  assert.equal(blast.summary.ordnancePending,0);assert.ok(blast.summary.structuralPending>0,'Real unsupported fragments remain in the native authority');
  assert.equal((await h.send({kind:'end',criticalEffectsPending:false})).reason,'authority-pending');
  assert.equal((await h.send({kind:'end',criticalEffectsPending:true})).reason,'critical-effects-pending');
  assert.equal((await h.send({kind:'save'})).reason,'authority-not-settled');
 }finally{await h.close();}
});
