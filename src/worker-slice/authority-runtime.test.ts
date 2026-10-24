import test from 'node:test';
import assert from 'node:assert/strict';
import type {AuthorityCommand,AuthorityMessage,AuthorityAck} from './protocol.js';
const stock={charge:6,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0};
async function harness(extra:Partial<import('./authority-runtime.js').AuthorityRuntimeOptions>={},initial:object={}){
 const module=await import('./authority-runtime.js').catch(()=>null);
 assert.ok(module?.createAuthorityRuntime,'the isolated actual-physics authority runtime must exist');
 let wall=0,seq=0,last:AuthorityAck|undefined;const messages:AuthorityMessage[]=[];
 const runtime=module.createAuthorityRuntime({now:()=>wall,emit:message=>messages.push(message),maxStepsPerPump:8,...extra});
 const command=(body:object):AuthorityCommand=>({worldId:'test',epoch:last?.epoch??0,mapRecipeHash:last?.mapRecipeHash??'uninitialized',sequence:++seq,commandId:`c${seq}`,observedRevision:last?.summary?.authorityRevision??0,...body} as AuthorityCommand);
 const send=async(body:object)=>last=await runtime.handle(command(body));
 await send({kind:'initialize',mode:'main',mapId:'courtyard',loadout:stock,...initial});
 assert.equal(last?.status,'accepted');
 return {runtime,messages,command,send,setWall:(n:number)=>wall=n,get last(){return last!;}};
}

test('actual authority rejects bad launch without stock loss and deduplicates an accepted shot',async()=>{
 const h=await harness();try{
 const bad=await h.send({kind:'launch',shot:{id:'bad',weapon:'charge',power:1,origin:{x:0,y:4,z:0},target:{x:0,y:4,z:0}}});
 assert.equal(bad.status,'rejected');assert.equal(bad.summary!.round.remaining!.charge,6);
 const command=h.command({kind:'launch',shot:{id:'one',weapon:'charge',power:1,origin:{x:20,y:5,z:0},target:{x:20,y:0,z:0}}});
 const first=await h.runtime.handle(command),duplicate=await h.runtime.handle(command);
 assert.equal(first.status,'accepted');assert.equal(first.summary!.round.remaining!.charge,5);
 assert.equal(duplicate.duplicate,true);assert.equal(duplicate.summary!.round.remaining!.charge,5);
 assert.equal(h.runtime.inspect()!.projectiles.length,1);
 }finally{h.runtime.dispose();}
});

test('five seconds of foreground overload is retained across bounded fixed-step pumps',async()=>{
 const h=await harness();try{
 h.setWall(5000);let state=h.runtime.pump();
 assert.equal(state!.clock.foregroundEligibleMs,5000);assert.ok(state!.clock.processedSimulationMs<100);
 assert.ok(state!.clock.simulationDebtMs>4900);assert.equal(state!.clock.discardedSimulationMs,0);
 for(let i=0;i<75;i++)state=h.runtime.pump();
 assert.ok(Math.abs(state!.clock.processedSimulationMs-5000)<1e-6);assert.ok(state!.clock.simulationDebtMs<1e-6);assert.equal(state!.clock.peakSimulationDebtMs,5000);
 const paused=await h.send({kind:'clock',paused:true});assert.equal(paused.status,'accepted');h.setWall(6000);state=h.runtime.pump();
 assert.equal(state!.clock.foregroundEligibleMs,5000);assert.equal(state!.clock.pausedWallMs,1000);
 await h.send({kind:'clock',paused:false,hidden:true});h.setWall(7000);state=h.runtime.pump();
 assert.equal(state!.clock.hiddenWallMs,1000);assert.equal(state!.clock.foregroundEligibleMs,5000);
 }finally{h.runtime.dispose();}
});

test('actual placement validates the current cell face; remote blast arrives only on trigger',async()=>{
 const h=await harness();try{
 const source=h.runtime.readBinding()!.source,id=source.staticIdAt(20,-1,0)!;assert.ok(id!==null);
 const placement={id:'placed',weapon:'charge',power:1,surface:{voxelId:id,position:{x:20,y:-.5,z:0},normal:{x:0,y:1,z:0}}};
 assert.equal((await h.send({kind:'place',placement:{...placement,surface:{...placement.surface,position:{x:20,y:2,z:0}}}})).status,'rejected');
 assert.equal((await h.send({kind:'place',placement})).status,'accepted');
 assert.equal(h.messages.filter(m=>m.kind==='events').flatMap(m=>m.events).filter(e=>e.kind==='damage').length,0);
 assert.equal((await h.send({kind:'save'})).reason,'in-flight-ordnance-unsupported');
 assert.equal((await h.send({kind:'end',criticalEffectsPending:false})).reason,'authority-pending');
 const triggered=await h.send({kind:'detonate'});assert.equal(triggered.status,'accepted');
 const damage=h.messages.filter(m=>m.kind==='events').flatMap(m=>m.events).find(e=>e.kind==='damage');
 assert.ok(damage&&damage.kind==='damage'&&damage.result.accepted);assert.deepEqual(damage.result.removed,[]);assert.deepEqual(damage.result.detached,[]);
 assert.equal(h.runtime.readBinding()!.cell(id)!.state,'gone');
 }finally{h.runtime.dispose();}
});

test('settled save includes preceding inventory and invalid restore is atomic; reset rejects queued old epoch',async()=>{
 const h=await harness();try{
 const saved=await h.send({kind:'save'});assert.equal(saved.status,'accepted');assert.ok(saved.saveText);
 const before=h.runtime.inspect();
 const bad=JSON.parse(saved.saveText!);bad.snapshot.research=-1;
 assert.equal((await h.send({kind:'restore',saveText:JSON.stringify(bad)})).status,'rejected');
 assert.deepEqual(h.runtime.inspect(),before);
 const reset=h.command({kind:'reset'}),late=h.command({kind:'launch',shot:{id:'late',weapon:'charge',power:1,origin:{x:20,y:4,z:0},target:{x:20,y:0,z:0}}});
 const resetPromise=h.runtime.handle(reset),latePromise=h.runtime.handle(late);
 const resetResult=await resetPromise,lateResult=await latePromise;
 assert.equal(resetResult.status,'accepted');assert.equal(resetResult.epoch,saved.epoch+1);assert.equal(lateResult.reason,'stale-epoch');assert.equal(h.runtime.inspect()!.projectiles.length,0);
 const restore={...h.command({kind:'restore',saveText:saved.saveText}),epoch:resetResult.epoch,mapRecipeHash:resetResult.mapRecipeHash};
 const restored=await h.runtime.handle(restore);assert.equal(restored.status,'accepted');assert.equal(restored.epoch,resetResult.epoch+1);
 }finally{h.runtime.dispose();}
});

test('charge timing follows 120 Hz actual physics and no damage is emitted before three simulated seconds',async()=>{
 const h=await harness();try{
 await h.send({kind:'launch',shot:{id:'timer',weapon:'charge',power:1,origin:{x:20,y:4,z:0},target:{x:20,y:0,z:0}}});
 for(let i=1;i<=44;i++){h.setWall(i*8*1000/120);h.runtime.pump();}
 assert.equal(h.messages.filter(m=>m.kind==='events').flatMap(m=>m.events).filter(e=>e.kind==='damage').length,0);
 h.setWall(3000);h.runtime.pump();
 const damages=h.messages.filter(m=>m.kind==='events').flatMap(m=>m.events).filter(e=>e.kind==='damage');
 assert.equal(damages.length,1);assert.equal(damages[0].kind,'damage');if(damages[0].kind==='damage')assert.ok(damages[0].detonation.age>=3-1e-9);
 }finally{h.runtime.dispose();}
});


test('placement resolves a mesh-only candidate against live authority without a main-thread fixture',async()=>{
 const h=await harness();try{
 const result=await h.send({kind:'place',placement:{id:'candidate',weapon:'charge',power:1,surface:{position:{x:20,y:-.5,z:0},normal:{x:0,y:1,z:0}}}});
 assert.equal(result.status,'accepted');assert.ok(h.runtime.inspect()!.projectiles[0].hostVoxelId!==undefined);
 }finally{h.runtime.dispose();}
});


test('pose buffers have independently owned current colors and one-batch credit',async()=>{
 const h=await harness();try{
 const initial=h.messages.find(m=>m.kind==='poses');assert.ok(initial&&initial.kind==='poses');
 assert.ok(initial.colors instanceof Uint32Array);assert.equal(initial.colors.length,initial.cellIds.length);
 h.setWall(100);h.runtime.pump();assert.equal(h.messages.filter(m=>m.kind==='poses').length,1);
 await h.send({kind:'pose-ack',poseSequence:initial.poseSequence});h.setWall(200);h.runtime.pump();assert.equal(h.messages.filter(m=>m.kind==='poses').length,2);
 }finally{h.runtime.dispose();}
});


test('a presentation hook fault cannot relabel committed inventory as a rejected command',async()=>{
 const h=await harness({onCommitted:(_binding,_events,state)=>{if(state.round.used)throw new Error('mesh-hook-test');}});try{
 const result=await h.send({kind:'launch',shot:{id:'hook',weapon:'charge',power:1,origin:{x:20,y:4,z:0},target:{x:20,y:0,z:0}}});
 assert.equal(result.status,'accepted');assert.equal(result.summary!.round.remaining!.charge,5);assert.equal(result.summary!.state,'fault');
 }finally{h.runtime.dispose();}
});

test('fixed-step changes advance the canonical authority revision and summary transport shares pose credit',async()=>{
 const h=await harness();try{
 const initial=h.last.summary!.authorityRevision;h.setWall(100);const state=h.runtime.pump();assert.ok(state!.authorityRevision>initial);
 for(let i=0;i<20;i++){h.setWall(200+i*50);h.runtime.pump();}
 assert.ok(h.messages.filter(m=>m.kind==='summary').length<=1,'a stalled pose consumer cannot accumulate periodic summary messages');
 }finally{h.runtime.dispose();}
});


test('pose transport acknowledgements cannot exhaust consequential command history',async()=>{
 const h=await harness({maxCommandHistory:3});try{
 for(let i=1;i<=4;i++){h.setWall(i*40);const pose=h.messages.filter(m=>m.kind==='poses').at(-1)!;assert.equal((await h.send({kind:'pose-ack',poseSequence:pose.poseSequence})).status,'accepted');}
 const result=await h.send({kind:'launch',shot:{id:'after-credits',weapon:'charge',power:1,origin:{x:20,y:4,z:0},target:{x:20,y:0,z:0}}});assert.equal(result.status,'accepted');
 }finally{h.runtime.dispose();}
});

test('dispose invalidates the prior transport epoch and malformed input is rejected without destroying authority',async()=>{
 const h=await harness();try{
 const invalid=await h.runtime.handle(null as unknown as AuthorityCommand);assert.equal(invalid.status,'rejected');assert.equal(invalid.reason,'invalid-envelope');
 const epoch=h.last.epoch,result=await h.send({kind:'dispose'});assert.equal(result.status,'accepted');assert.equal(result.epoch,epoch+1);assert.equal(h.runtime.readBinding(),null);
 }finally{h.runtime.dispose();}
});

test('the existing placed-only tools cannot be launched by bypassing the UI',async()=>{
 const h=await harness({}, {mode:'free',fixture:'research-1400',loadout:{...stock,charge:0,shock:1}});try{
 const result=await h.send({kind:'launch',shot:{id:'forbidden',weapon:'shock',power:1,origin:{x:20,y:4,z:0},target:{x:20,y:0,z:0}}});
 assert.equal(result.status,'rejected');assert.equal(result.reason,'placed-only-tool');assert.equal(h.runtime.inspect()!.projectiles.length,0);
 }finally{h.runtime.dispose();}
});

test('synchronous commit work remains eligible debt in the returned acknowledgement',async()=>{
 let now=0,blocked=false;
 const h=await harness({now:()=>now,onCommitted:(_binding,_events,state)=>{if(state.round.used&&!blocked){blocked=true;now+=500;}}});try{
 const result=await h.send({kind:'launch',shot:{id:'stall',weapon:'charge',power:1,origin:{x:20,y:4,z:0},target:{x:20,y:0,z:0}}});
 assert.equal(result.summary!.clock.foregroundEligibleMs,500);assert.equal(result.summary!.clock.simulationDebtMs,500);
 }finally{h.runtime.dispose();}
});
