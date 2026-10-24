import {createStructuralGameWorld,type StructuralGameWorld} from '../structural/game-world.js';
import {createProjectilePhysics} from '../physics.js';
import {createWorld} from '../domain.js';
import {getManagedCompactGameFixture} from '../compact/managed-fixture.js';
import {MAP_IDS,WEAPON_IDS,toolAvailable,weaponCost,mapAvailable} from '../content-catalog.js';
import {requiresLoadoutReselection,validateLoadout,validateToolSelection} from '../gameplay.js';
import type {AimSurface,Detonation,Loadout,MapId,ProjectilePhysics,WeaponId,WorldSnapshot} from '../contracts.js';
import type {StructuralCompactQueries,StructuralEventCursor} from '../structural/types.js';
import type {AuthorityAck,AuthorityClock,AuthorityCommand,AuthorityEnvelope,AuthorityGameplayEvent,AuthorityMessage,AuthoritySummary} from './protocol.js';

const STEP_MS=1000/120;
const transportCommand=(kind:string)=>kind==='pose-ack'||kind==='event-ack';
type CommandReceipt={fingerprint:string;ack:AuthorityAck};
const clone=<T>(value:T):T=>structuredClone(value);
export interface AuthorityRuntimeOptions {
 emit:(message:AuthorityMessage,transfer?:Transferable[])=>void;
 now:()=>number;
 /** Runs inside this worker; authentic bindings and closures never cross postMessage. */
 onCommitted?:(binding:StructuralCompactQueries,events:readonly AuthorityGameplayEvent[],summary:AuthoritySummary)=>void;
 maxStepsPerPump?:number;maxPumpMs?:number;maxQueuedCommands?:number;maxInFlightEventBatches?:number;maxCommandHistory?:number;
}
/** Isolated experiment, not imported by the normal game entry. Exactly one live shared Rapier world. */
export function createAuthorityRuntime(options:AuthorityRuntimeOptions){
 const maxSteps=Math.max(1,Math.floor(options.maxStepsPerPump??8)),maxPumpMs=options.maxPumpMs??4;
 const maxCommands=options.maxQueuedCommands??64,maxEvents=options.maxInFlightEventBatches??8,maxHistory=options.maxCommandHistory??2048;
 let world:StructuralGameWorld|null=null,physics:ProjectilePhysics|null=null,unregister:(()=>void)|undefined;
 let worldId='',epoch=0,sequence=0,highestSequence=0,recipe='uninitialized',authorityRevision=0,mode:'main'|'free'='main',mapId:MapId='courtyard';
 let disposed=false,transitioning=false,fault:string|null=null,chain=Promise.resolve(),lastWall=options.now(),lastPoseAt=-Infinity,poseSequence=0,poseInFlight=0;
 let eventSequence=0,eventCursor:StructuralEventCursor|undefined,pendingDamage:AuthorityGameplayEvent[]=[];
 const eventCredits=new Map<number,number>(),commandHistory=new Map<string,CommandReceipt>(),transportHistory=new Map<string,CommandReceipt>(),queued=new Map<AuthorityCommand,number>();
 const clock:AuthorityClock={foregroundEligibleMs:0,requestedSimulationMs:0,processedSimulationMs:0,simulationDebtMs:0,peakSimulationDebtMs:0,processedQuanta:0,solverSteps:0,discardedSimulationMs:0,discardedByResetMs:0,transitionWallMs:0,pausedWallMs:0,hiddenWallMs:0,backpressureWallMs:0,paused:false,hidden:false,timeScale:1,lastPumpSteps:0,lastPumpDurationMs:0};
 const envelope=():AuthorityEnvelope=>({worldId,epoch,sequence,mapRecipeHash:recipe});
 const readBinding=()=>disposed?null:world?.getRenderBinding()??null;
 const pressure=()=>eventCredits.size>=maxEvents;
 function admit(now:number){
  if(!Number.isFinite(now)||now<lastWall)return;
  const elapsed=now-lastWall;lastWall=now;
  if(!world||disposed||transitioning)return;
  if(clock.hidden)clock.hiddenWallMs+=elapsed;
  else if(clock.paused||world.getRound().settled)clock.pausedWallMs+=elapsed;
  else{clock.foregroundEligibleMs+=elapsed;clock.requestedSimulationMs+=elapsed*clock.timeScale;if(pressure()||fault)clock.backpressureWallMs+=elapsed;}
  clock.simulationDebtMs=Math.max(0,clock.requestedSimulationMs-clock.processedSimulationMs-clock.discardedByResetMs);clock.peakSimulationDebtMs=Math.max(clock.peakSimulationDebtMs,clock.simulationDebtMs);
 }
 function summary():AuthoritySummary|null{
  if(!world)return null;
  const ordnancePending=physics?.getPendingWorkCount?.()??0,pendingWork=world.pending();
  return {...envelope(),authorityRevision,bindingRevision:readBinding()?.revision??0,mode,mapId,research:world.getResearch(),round:world.getRound(),objective:world.getObjective(),pendingWork,ordnancePending,structuralPending:Math.max(0,pendingWork-ordnancePending),queuedCommands:queued.size,oldestQueuedCommandAgeMs:queued.size?Math.max(0,options.now()-Math.min(...queued.values())):0,unacknowledgedEventBatches:eventCredits.size,eventSequence,poseInFlight:!!poseInFlight,state:disposed?'disposed':fault?'fault':pressure()?'consumer-backpressure':clock.hidden?'hidden':clock.paused?'paused':'active',fault,clock:{...clock}};
 }
 function collectEvents():AuthorityGameplayEvent[]{
  if(!world)return [];
  const batch=world.eventsSince(eventCursor);
  if(eventCursor&&batch.reset){fault='structural-event-history-overflow';}
  eventCursor=batch.cursor;
  const events:AuthorityGameplayEvent[]=[...pendingDamage,...batch.events.map(event=>({kind:'structural' as const,event:clone({...event,epoch})}))];pendingDamage=[];
  return events;
 }
 function publish(forcePose=false){
  if(!world||disposed)return;
  const events=collectEvents();
  if(events.length){const next=++eventSequence;eventCredits.set(next,options.now());options.emit({...envelope(),kind:'events',eventSequence:next,authorityRevision,committedAtMs:options.now(),events});}
  const binding=readBinding(),state=summary()!;
  if(binding){try{options.onCommitted?.(binding,events,state);}catch(error){fault=`presentation-hook: ${error instanceof Error?error.message:String(error)}`;}}
  const at=options.now();
  if(binding&&!poseInFlight&&(forcePose||at-lastPoseAt>=1000/30)){
   const moving=binding.movingViews(),cellIds=new Int32Array(moving.length),colors=new Uint32Array(moving.length),positions=new Float32Array(moving.length*3),rotations=new Float32Array(moving.length*4);
   for(let i=0;i<moving.length;i++){const cell=moving[i];if(cell.id<-2147483648||cell.id>2147483647)throw new Error('Pose ID exceeds signed 32-bit transport');cellIds[i]=cell.id;colors[i]=cell.color;positions.set([cell.position.x,cell.position.y,cell.position.z],i*3);rotations.set([cell.rotation.x,cell.rotation.y,cell.rotation.z,cell.rotation.w],i*4);}
   poseInFlight=++poseSequence;lastPoseAt=at;
   options.emit({...envelope(),kind:'poses',poseSequence,authorityRevision,bindingRevision:binding.revision,sampledAtMs:at,cellIds,colors,positions,rotations,projectiles:clone([...(physics?.getProjectiles()??[])])},[cellIds.buffer,colors.buffer,positions.buffer,rotations.buffer]);
  }
 }
 function detonation(event:Detonation){
  if(!world||disposed||event.epoch!==world.epoch)return;
  const result=world.damage({id:event.id,epoch:world.epoch,target:event.position,weapon:event.weapon,power:event.power},{details:false});
  if(result.accepted){authorityRevision++;pendingDamage.push({kind:'damage',detonation:clone({...event,epoch}),result:clone(result)});}
 }
 async function bindPhysics(){
  unregister?.();physics?.dispose();physics=null;
  if(!world?.physicsHost)return;
  const owner=world;const next=await createProjectilePhysics({host:owner.physicsHost!,onDetonation:detonation});
  if(disposed||world!==owner){next.dispose();return;}
  physics=next;unregister=owner.physicsHost!.register({afterStep(){clock.solverSteps++;}});
 }
 function resetTransport(){
  eventCursor=world?.eventsSince().cursor;pendingDamage=[];eventCredits.clear();eventSequence=0;poseInFlight=0;poseSequence=0;lastPoseAt=-Infinity;fault=null;
  commandHistory.clear();transportHistory.clear();clock.discardedByResetMs+=clock.simulationDebtMs;clock.simulationDebtMs=0;
  recipe=world?.getRenderBinding()?.source.fixture.recipeId??'uninitialized';authorityRevision++;
 }
 function canSpend(weapon:WeaponId){
  if(!world||!WEAPON_IDS.includes(weapon))return false;const r=world.getRound();
  return !r.settled&&!world.migrationPending&&!requiresLoadoutReselection(r)&&toolAvailable(weapon,r.startResearch)&&!!r.remaining&&r.remaining[weapon]>0&&(mode==='free'||r.used+weaponCost(weapon)<=r.budget);
 }
 function ack(command:AuthorityCommand,status:'accepted'|'rejected',received:number,started:number,reason?:string,saveText?:string):AuthorityAck{
  return {...envelope(),kind:'ack',commandId:command?.commandId??'',commandSequence:command?.sequence??0,status,committed:status==='accepted',duplicate:false,...(reason?{reason}:{}),summary:summary(),receivedAtMs:received,startedAtMs:started,committedAtMs:options.now(),...(saveText?{saveText}:{})};
 }
 function dispose(){
  if(disposed)return;admit(options.now());disposed=true;epoch++;unregister?.();unregister=undefined;physics?.dispose();physics=null;world?.suspend();world=null;eventCredits.clear();commandHistory.clear();transportHistory.clear();pendingDamage=[];
 }
 async function execute(command:AuthorityCommand,received:number):Promise<AuthorityAck>{
  const started=options.now();admit(started);
  const reject=(reason:string)=>ack(command,'rejected',received,started,reason);
  if(disposed)return reject('disposed');
  if(!command||typeof command.commandId!=='string'||!command.commandId.length||command.commandId.length>160||!Number.isSafeInteger(command.sequence)||command.sequence<1||!Number.isSafeInteger(command.epoch)||!Number.isSafeInteger(command.observedRevision)||command.observedRevision<0)return reject('invalid-envelope');
  if(worldId&&command.worldId!==worldId)return reject('wrong-world');
  if(command.epoch!==epoch)return reject('stale-epoch');
  if(command.mapRecipeHash!==recipe)return reject('wrong-map-recipe');
  const fingerprint=JSON.stringify(command),prior=commandHistory.get(command.commandId)??transportHistory.get(command.commandId);
  if(prior)return prior.fingerprint===fingerprint?{...clone(prior.ack),duplicate:true}:reject('command-id-reused');
  if(command.sequence<=highestSequence)return reject('stale-sequence');
  highestSequence=command.sequence;
  if(command.observedRevision>authorityRevision)return reject('future-revision');
  if(commandHistory.size>=maxHistory&&!['reset','restore','dispose','event-ack','pose-ack'].includes(command.kind))return reject('command-history-capacity');
  let reason:string|undefined,saveText:string|undefined,surface:AimSurface|undefined;
  const controls=['initialize','event-ack','pose-ack','clock','reset','restore','dispose','save'];
  if((pressure()||fault)&&!controls.includes(command.kind))return reject(fault??'consumer-backpressure');
  if(command.kind!=='initialize'&&!world)return reject('not-initialized');
  switch(command.kind){
   case 'initialize':{
    if(world){reason='already-initialized';break;}
    if(!command.worldId||!['main','free'].includes(command.mode)||!MAP_IDS.includes(command.mapId)||command.fixture&&command.fixture!=='research-1400'||command.fixture&&command.mode!=='free'){reason='invalid-initialize';break;}
    const research=command.fixture==='research-1400'?1400:0;
    if(!mapAvailable(command.mapId,research,command.mode==='free')||(command.loadout&&!(command.mode==='free'?validateToolSelection(command.loadout,research):validateLoadout(command.loadout,research)))){reason='invalid-loadout';break;}
    transitioning=true;mode=command.mode;worldId=command.worldId;mapId=command.mapId;world=createStructuralGameWorld({free:mode==='free'});const owner=world;
    if(command.fixture==='research-1400'){const seed=createWorld().getSnapshot();seed.research=1400;if(!await owner.restore(seed))throw new Error('Synthetic research fixture failed validation');}
    if(disposed){owner.suspend();return reject('disposed');}
    if(command.loadout)await owner.startRound(mapId,command.loadout);else await owner.loadMap(mapId);
    if(disposed){owner.suspend();world=null;return reject('disposed');}
    await bindPhysics();if(disposed){owner.suspend();return reject('disposed');}epoch++;resetTransport();transitioning=false;lastWall=options.now();break;
   }
   case 'launch':{
    if(!command.shot||!canSpend(command.shot.weapon)){reason='inventory-unavailable';break;}
    if(command.shot.weapon==='shock'||command.shot.weapon==='echo'){reason='placed-only-tool';break;}
    if(!physics!.launch({...command.shot,epoch:world!.epoch})){reason='invalid-launch';break;}
    if(!world!.recordShot(command.shot.weapon))throw new Error('Synchronous inventory acceptance invariant failed');authorityRevision++;break;
   }
   case 'place':{
    const weapon=command.placement?.weapon??'shock';
    if(!command.placement||!canSpend(weapon)){reason='inventory-unavailable';break;}
    const candidate=command.placement.surface;
    if(!candidate?.position||!candidate.normal){reason='invalid-placement';break;}
    const p=candidate.position,n=candidate.normal;
    const voxelId=candidate.voxelId===undefined?readBinding()!.source.staticIdAt(Math.round(p.x-n.x*1e-4),Math.round(p.y-n.y*1e-4),Math.round(p.z-n.z*1e-4)):candidate.voxelId;
    surface={...candidate,voxelId};
    if(!physics!.attach({...command.placement,surface,epoch:world!.epoch})){reason='invalid-placement';surface=undefined;break;}
    if(!world!.recordShot(weapon))throw new Error('Synchronous inventory acceptance invariant failed');authorityRevision++;break;
   }
   case 'detonate':for(const event of physics!.detonateAttached())detonation(event);break;
   case 'clock':{
    if(command.timeScale!==undefined&&(!Number.isFinite(command.timeScale)||command.timeScale<=0||command.timeScale>1)||command.paused!==undefined&&typeof command.paused!=='boolean'||command.hidden!==undefined&&typeof command.hidden!=='boolean'){reason='invalid-clock';break;}
    if(command.paused!==undefined)clock.paused=command.paused;if(command.hidden!==undefined)clock.hidden=command.hidden;if(command.timeScale!==undefined)clock.timeScale=command.timeScale;break;
   }
   case 'end':if(typeof command.criticalEffectsPending!=='boolean')reason='invalid-end';else if(command.criticalEffectsPending)reason='critical-effects-pending';else if(world!.pending())reason='authority-pending';else{world!.finishRound();authorityRevision++;}break;
   case 'save':{
    if((physics!.getPendingWorkCount?.()??0)>0){reason='in-flight-ordnance-unsupported';break;}
    if(world!.pending()){reason='authority-not-settled';break;}
    saveText=JSON.stringify({schema:'authority-worker-save/v1',worldId,epoch,committedSequence:command.sequence,mapRecipeHash:recipe,mode,ordnance:'settled-only',snapshot:world!.getSnapshot()});break;
   }
   case 'restore':{
    let saved:{schema?:string;mode?:string;mapRecipeHash?:string;ordnance?:string;snapshot?:WorldSnapshot};
    try{saved=JSON.parse(command.saveText);}catch{reason='invalid-save';break;}
    if(!saved||saved.schema!=='authority-worker-save/v1'||saved.mode!==mode||saved.ordnance!=='settled-only'||!saved.snapshot||saved.snapshot.schemaVersion!==9||!MAP_IDS.includes(saved.snapshot.mapId!)||saved.mapRecipeHash!==getManagedCompactGameFixture(saved.snapshot.mapId!).recipeId){reason='invalid-save';break;}
    transitioning=true;const transitionStart=options.now(),owner=world!;
    if(!await owner.restore(saved.snapshot)){transitioning=false;reason='invalid-save';break;}
    if(disposed){owner.suspend();world=null;return reject('disposed');}
    mapId=saved.snapshot.mapId!;await bindPhysics();if(disposed){owner.suspend();return reject('disposed');}epoch++;resetTransport();clock.transitionWallMs+=options.now()-transitionStart;transitioning=false;lastWall=options.now();break;
   }
   case 'reset':{
    const target=command.mapId??mapId,loadout=command.loadout??world!.getRound().loadout;
    if(!MAP_IDS.includes(target)||!mapAvailable(target,world!.getResearch(),mode==='free')||!loadout||!(mode==='free'?validateToolSelection(loadout,world!.getResearch()):validateLoadout(loadout,world!.getResearch()))){reason='invalid-reset';break;}
    transitioning=true;const transitionStart=options.now(),owner=world!;await owner.startRound(target,loadout);
    if(disposed){owner.suspend();world=null;return reject('disposed');}
    mapId=target;await bindPhysics();if(disposed){owner.suspend();return reject('disposed');}epoch++;resetTransport();clock.transitionWallMs+=options.now()-transitionStart;transitioning=false;lastWall=options.now();break;
   }
   case 'event-ack':if(!Number.isSafeInteger(command.throughEventSequence)||command.throughEventSequence<0||command.throughEventSequence>eventSequence)reason='invalid-event-ack';else for(const id of eventCredits.keys())if(id<=command.throughEventSequence)eventCredits.delete(id);break;
   case 'pose-ack':if(command.poseSequence!==poseInFlight||!poseInFlight)reason='invalid-pose-ack';else poseInFlight=0;break;
   case 'dispose':sequence=command.sequence;dispose();return ack(command,'accepted',received,started);
   default:reason='unknown-command';
  }
  if(!reason){sequence=command.sequence;admit(options.now());publish(command.kind==='initialize'||command.kind==='reset'||command.kind==='restore');admit(options.now());}
  const result=ack(command,reason?'rejected':'accepted',received,started,reason,saveText);if(surface&&!reason)result.surface=clone(surface);
  if(transportCommand(command.kind)){
   transportHistory.set(command.commandId,{fingerprint,ack:clone(result)});
   // Old transport retries still fail the sequence high-water mark after this bounded receipt cache expires.
   if(transportHistory.size>128)transportHistory.delete(transportHistory.keys().next().value!);
  }else if(commandHistory.size<maxHistory)commandHistory.set(command.commandId,{fingerprint,ack:clone(result)});
  return result;
 }
 function handle(command:AuthorityCommand):Promise<AuthorityAck>{
  const received=options.now();
  if(queued.size>=maxCommands){const result=ack(command,'rejected',received,received,'command-queue-capacity');options.emit(result);return Promise.resolve(result);}
  // Own incoming data even for direct test callers, just as structured cloning does at a Worker boundary.
  const input=clone(command);queued.set(input,received);
  const result=chain.then(async()=>{queued.delete(input);try{return await execute(input,received);}catch(error){transitioning=false;fault=error instanceof Error?error.message:String(error);return ack(input,'rejected',received,options.now(),'authority-fault');}});
  chain=result.then(()=>undefined,()=>undefined);return result.then(value=>{options.emit(value);return clone(value);});
 }
 function pump(at=options.now()):AuthoritySummary|null{
  admit(at);if(!world||disposed||transitioning)return summary();
  const started=options.now();clock.lastPumpSteps=0;
  if(!clock.paused&&!clock.hidden&&!pressure()&&!fault&&!world.getRound().settled){
   while(clock.simulationDebtMs+1e-8>=STEP_MS&&clock.lastPumpSteps<maxSteps){
    if(clock.lastPumpSteps&&options.now()-started>=maxPumpMs)break;
    world.step(1/120);clock.processedQuanta++;clock.processedSimulationMs+=STEP_MS;clock.lastPumpSteps++;
    clock.simulationDebtMs=Math.max(0,clock.requestedSimulationMs-clock.processedSimulationMs-clock.discardedByResetMs);clock.peakSimulationDebtMs=Math.max(clock.peakSimulationDebtMs,clock.simulationDebtMs);
    // Capture each fixed step before the existing finite history can wrap across a long pump.
    const events=collectEvents();if(events.length){pendingDamage.push(...events);break;}
   }
  }
  if(clock.lastPumpSteps)authorityRevision++;
  admit(options.now());clock.lastPumpDurationMs=options.now()-started;const priorPoseSequence=poseSequence;publish();admit(options.now());clock.lastPumpDurationMs=options.now()-started;const state=summary();
  // Periodic summaries share the single outstanding pose credit; slow consumers cannot grow a second unbounded queue.
  if(state&&poseSequence!==priorPoseSequence)options.emit({...envelope(),kind:'summary',summary:state});return state;
 }
 function inspect(){const state=summary();return state?{...state,projectiles:clone(physics?.getProjectiles()??[])}:null;}
 return {handle,pump,dispose,readBinding,inspect};
}
