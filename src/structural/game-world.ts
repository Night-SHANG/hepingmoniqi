import type {DamageCommand,DamageResult,Loadout,MapId,ObjectiveState,RoundResult,RoundState,Voxel,WeaponId,WorldSnapshot} from '../contracts.js';
import {MAP_IDS,TOOLS,WEAPON_IDS,mapAvailable,mapTitle,capacityForResearch,toolAvailable,weaponCost} from '../content-catalog.js';
import {validateLoadout,validateToolSelection,validateHistoricalLoadout,requiresLoadoutReselection} from '../gameplay.js';
import {createWorld} from '../domain.js';
import {createLegacyGameFixture,gameCellVoxel,type GameFixture,type GameCell} from './game-fixtures.js';
import {createCompactGameFixture,type CompactFixture} from '../compact/fixture.js';
import {decodeGameSimulation,encodeGameSimulation,validateCompactStructuralSnapshot} from '../compact/snapshot.js';
import {createStructuralSimulation,validateStructuralSnapshot} from './simulation.js';
import type {StructuralPhysicsHost} from './physics-host.js';
import type {CellView,Point,Rotation,StructuralEvent,StructuralEventCursor,StructuralEventChanges,StructuralCompactQueries,StructuralSimulationOptions,ImmutableCellView} from './types.js';
export {previewGameVoxels} from './game-fixtures.js';

type Simulation=Awaited<ReturnType<typeof createStructuralSimulation>>;
type InventoryRound=RoundState&{loadout:Loadout;remaining:Loadout};
type CellSave={id:number;hp:number;loss:number;state:CellView['state'];position:Point;rotation:Rotation;chunkId?:string};
type SimulationSave={schema:string;fixtureId:string;fixtureSignature:string;maxActiveBodies:number;epoch:number;tick:number;accumulator:number;serial:number;cells:CellSave[];bodies:any[];queue:string[];shots:string[];processed:string[];episodes:any[];episodeCounts:any[];research:number;events:StructuralEvent[]};
type CompactSimulation=Omit<SimulationSave,'fixtureId'|'fixtureSignature'|'cells'>&{changes:unknown[][]};
interface SavedGame {schema:'structural-game/v1';fixtureId:string;free:boolean;migrationPending:boolean;legacyObjective?:{total:number;destroyed:number};rewardedLoss:number;creditedResearch:number;suppressedRoots:string[];simulation:CompactSimulation|null;}
export interface StructuralGameWorld {
 readonly epoch:number;readonly physicsHost:StructuralPhysicsHost|null;readonly migrationPending:boolean;readonly revision:number;
 activate():Promise<void>;suspend():void;getRenderBinding():StructuralCompactQueries|null;getResearch():number;getVoxel(id:number):Voxel|null;getVoxels():readonly Voxel[];getObjective():ObjectiveState;getRound():RoundState;
 startRound(map:MapId,loadout:Loadout):Promise<boolean>;loadMap(map:MapId,free?:boolean):Promise<boolean>;reset():Promise<void>;
 recordShot(weapon?:WeaponId):boolean;damage(command:DamageCommand):DamageResult;finishRound():RoundResult;
 getSnapshot():WorldSnapshot;restore(snapshot:WorldSnapshot):Promise<boolean>;step(dt:number):void;pending():number;events():StructuralEvent[];eventsSince(cursor?:StructuralEventCursor):StructuralEventChanges;
}
const clone=<T>(value:T):T=>structuredClone(value);
const weights=(loadout:Loadout)=>WEAPON_IDS.reduce((n,id)=>n+loadout[id]*weaponCost(id),0);
const freshRound=(research:number):InventoryRound=>{const budget=capacityForResearch(research),loadout=Object.fromEntries(WEAPON_IDS.map(id=>[id,id==='charge'?budget:0])) as Loadout;return{budget,used:0,startResearch:research,startDestroyed:0,settled:false,loadout,remaining:{...loadout}};};
const SHARED_UNIT_SIZE=Object.freeze({x:1,y:1,z:1});
const SHARED_IDENTITY=Object.freeze({x:0,y:0,z:0,w:1});
const freezeVoxel=(v:Voxel):Voxel=>Object.freeze({...v,position:Object.freeze(v.position),rotation:v.rotation?(v.rotation.x===0&&v.rotation.y===0&&v.rotation.z===0&&v.rotation.w===1?SHARED_IDENTITY:Object.freeze(v.rotation)):undefined,size:v.size?(v.size.x===1&&v.size.y===1&&v.size.z===1?SHARED_UNIT_SIZE:Object.freeze(v.size)):undefined});
const states=['static','dynamic','rubble','gone'] as const;
let active:StructuralGameWorld|null=null;
let serialTransition:Promise<unknown>=Promise.resolve();
let epochSerial=1;
function serial<T>(fn:()=>Promise<T>):Promise<T>{const next=serialTransition.then(fn,fn);serialTransition=next.then(()=>undefined,()=>undefined);return next;}

/** Historical geometry upgrades alone expand their old immutable inventory. */
function expandLegacy(input:CompactSimulation,baseline:SimulationSave):SimulationSave|null {
 if(!input||typeof input!=='object'||!Array.isArray(input.changes))return null;
 const cells=new Map(baseline.cells.map(c=>[c.id,c])),seen=new Set<number>();
 for(const row of input.changes){if(!Array.isArray(row)||(row.length!==4&&row.length!==12))return null;
  const [id,hp,loss,stateIndex]=row as number[],base=cells.get(id);if(!base||seen.has(id)||!Number.isInteger(stateIndex)||stateIndex<0||stateIndex>3)return null;seen.add(id);
  const next:CellSave={...base,hp,loss,state:states[stateIndex]};
  if(row.length===12){next.position={x:row[4] as number,y:row[5] as number,z:row[6] as number};next.rotation={x:row[7] as number,y:row[8] as number,z:row[9] as number,w:row[10] as number};if(row[11]!==null)next.chunkId=row[11] as string;}
  cells.set(id,next);
 }
 const {changes:_,...metadata}=input;
 return {...metadata,fixtureId:baseline.fixtureId,fixtureSignature:baseline.fixtureSignature,cells:[...cells.values()]};
}
function pristineLegacySnapshot(fixture:GameFixture,maxActiveBodies:number,epoch:number):SimulationSave {
 return {schema:'structural-simulation/v1',fixtureId:fixture.id,fixtureSignature:JSON.stringify(fixture.cells),maxActiveBodies,epoch,tick:0,accumulator:0,serial:0,cells:fixture.cells.map(c=>({id:c.id,hp:c.hp,loss:0,state:'static',position:{...c.position},rotation:{x:0,y:0,z:0,w:1}})),bodies:[],queue:[],shots:[],processed:[],episodes:[],episodeCounts:[],research:0,events:[]};
}
function pristineCompactSnapshot(fixture:CompactFixture,maxActiveBodies:number,epoch:number):SimulationSave {
 return {schema:'structural-simulation-compact/v1',fixtureId:fixture.id,fixtureSignature:'compact:'+fixture.recipeId,maxActiveBodies,epoch,tick:0,accumulator:0,serial:0,cells:[],bodies:[],queue:[],shots:[],processed:[],episodes:[],episodeCounts:[],research:0,events:[]};
}
function validRound(value:RoundState|undefined,research:number,maxDestroyed:number,unlimited=false):value is InventoryRound {
 if(!value||!Number.isSafeInteger(value.budget)||![6,8,10].includes(value.budget)||!Number.isSafeInteger(value.used)||value.used<0||value.used>value.budget||typeof value.settled!=='boolean'||!Number.isSafeInteger(value.startResearch)||value.startResearch<0||value.startResearch>research||value.budget>capacityForResearch(value.startResearch)||!Number.isSafeInteger(value.startDestroyed)||value.startDestroyed<0||value.startDestroyed>maxDestroyed)return false;
 const l=value.loadout,r=value.remaining;
 return !!l&&!!r&&(unlimited?validateToolSelection(l,value.startResearch):validateHistoricalLoadout(l,value.startResearch)&&weights(l)<=value.budget)&&Object.keys(r).length===WEAPON_IDS.length&&WEAPON_IDS.every(id=>Object.hasOwn(r,id)&&Number.isSafeInteger(r[id])&&r[id]>=0&&r[id]<=l[id])&&value.used===weights(l)-weights(r);
}

export function createStructuralGameWorld(options:{free?:boolean;maxActiveBodies?:number;compactSupportFactory?:StructuralSimulationOptions['compactSupportFactory']}={}):StructuralGameWorld {
 const free=options.free===true,maxActiveBodies=options.maxActiveBodies??32;
 let mapId:MapId='courtyard',fixture:CompactFixture|undefined,totalTargets=0;
 let sim:Simulation|null=null,host:StructuralPhysicsHost|null=null,cachedSimulation:CompactSimulation|null=null,unregisterSync:(()=>void)|undefined;
 let epoch=epochSerial++,research=0,round=freshRound(0),migrationPending=false,legacyObjective:SavedGame['legacyObjective'];
 let completedMaps:MapId[]=[],rewardedLoss=0,creditedResearch=0,suppressedRoots=new Set<string>();
 // Only edited IDs have retained game records. Pristine voxels are composed on demand.
 let changedVoxels=new Map<number,Voxel|null>(),diagnosticVoxels:readonly Voxel[]|undefined,diagnosticRevision:number|undefined,lossById=new Map<number,number>();
 let destroyed=0,objectiveDestroyed=0,revision=0,viewCursor:number|undefined,eventCursor:{epoch:number;index:number}|undefined,eventHistory:StructuralEvent[]=[];
 let eventIds=new Set<string>(),lastRoot:string|undefined;
 function ensureFixture(){
  if(fixture)return;
  fixture=createCompactGameFixture(mapId);totalTargets=fixture.objectiveCount;
  changedVoxels.clear();diagnosticVoxels=undefined;lossById.clear();destroyed=objectiveDestroyed=0;revision++;
 }
 function pristineVoxel(id:number):Voxel|null {const base=fixture!.original(id);return base?freezeVoxel(gameCellVoxel(base as GameCell)):null;}
 function cachedVoxel(id:number):Voxel|null {return changedVoxels.has(id)?changedVoxels.get(id)!:pristineVoxel(id);}
 function viewVoxel(view:ImmutableCellView):Voxel|null {return view.state==='gone'?null:freezeVoxel(gameCellVoxel(view,{group:fixture!.groupOf(view.id)} as GameCell));}
 function currentVoxel(id:number):Voxel|null {const binding=sim?.compact;if(!binding)return cachedVoxel(id);const view=binding.cell(id);return view?viewVoxel(view):null;}
 function allowed(root:string|undefined){return !free&&!round.settled&&!!root&&root!=='initial'&&!suppressedRoots.has(root);}
 function sync(directRoot?:string,account=true,collect?:(prior:Voxel|null,next:Voxel|null)=>void){
  if(!sim)return;ensureFixture();
  const binding=sim.compact;if(!binding)throw new Error('Game simulation requires compact authority');
  const batch=binding.changesSince(viewCursor);
  // Body poses belong to the renderer/query port, not the 120 Hz gameplay
  // ledger. HP/state changes alone affect objective counts and research.
  const views=batch.reset?binding.changedCells():batch.edits.filter(edit=>edit.appearanceChanged).map(edit=>binding.cell(edit.id)!);
  viewCursor=batch.revision;
  const eventBatch=sim.eventsSince(eventCursor);eventCursor=eventBatch.cursor;
  if(eventBatch.reset){eventHistory=[];eventIds.clear();}
  const targetRoots=new Map<number,string>();
  for(const event of eventBatch.events){if(!eventIds.has(event.id)){eventIds.add(event.id);eventHistory.push(clone(event));}if(event.targetId!==undefined)targetRoots.set(event.targetId,event.rootShotId);if(event.kind==='detach'||event.kind==='impact')lastRoot=event.rootShotId;}
  if(eventHistory.length>8192){eventHistory=eventHistory.slice(-8192);eventIds=new Set(eventHistory.map(e=>e.id));}
  const nextVoxels=batch.reset?new Map<number,Voxel|null>():changedVoxels,nextLoss=batch.reset?new Map<number,number>():lossById;
  let changed=batch.reset&&changedVoxels.size>0;
  for(const view of views){const base=fixture!.original(view.id);if(!base)continue;
   const prior=cachedVoxel(view.id),isDestroyed=view.state!=='static';
   if(base.objective){const before=lossById.get(view.id)??0,next=isDestroyed?1:Math.max(0,1-view.hp/base.maxHp),delta=Math.max(0,next-before);nextLoss.set(view.id,next);if(account&&delta&&allowed(directRoot??targetRoots.get(view.id)??lastRoot))rewardedLoss+=delta;}
   if(view.state==='gone'){nextVoxels.set(view.id,null);if(prior){changed=true;collect?.(prior,null);}continue;}
   if(prior&&prior.hp===view.hp&&prior.structuralState===view.state){nextVoxels.set(view.id,prior);continue;}
   const next=viewVoxel(view)!;nextVoxels.set(view.id,next);changed=true;collect?.(prior,next);
  }
  changedVoxels=nextVoxels;lossById=nextLoss;
  const totals=binding.aggregate();destroyed=totals.departed;objectiveDestroyed=totals.objectiveDeparted;
  if(account&&!free&&!round.settled){const next=totalTargets?Math.min(200,Math.ceil(Math.max(0,rewardedLoss)*200/totalTargets)):0;research+=Math.max(0,next-creditedResearch);creditedResearch=Math.max(creditedResearch,next);}
  if(changed){diagnosticVoxels=undefined;revision++;}
 }
 function snapshot():WorldSnapshot {
  ensureFixture();sync();
  const simulation=sim?encodeGameSimulation(fixture!,sim.snapshotSparse() as SimulationSave):clone(cachedSimulation);
  const structural:SavedGame={schema:'structural-game/v1',fixtureId:fixture!.id,free,migrationPending,...(legacyObjective?{legacyObjective:clone(legacyObjective)}:{}),rewardedLoss,creditedResearch,suppressedRoots:[...suppressedRoots],simulation};
  return {schemaVersion:9,structural,mapId,round:clone(round),completedMaps:[...completedMaps],epoch,voxels:[],totalCount:fixture!.count,destroyedCount:destroyed,research,firstRewardClaimed:completedMaps.includes(mapId)};
 }
 function releaseSimulation(preserve:boolean){if(!sim)return;if(preserve){sync();cachedSimulation=encodeGameSimulation(fixture!,sim.snapshotSparse() as SimulationSave);
   // Preserve only sparse latest poses when the authoritative world is released.
   // Active gameplay never refreshes these redundant presentation records per step.
   for(const view of sim.compact!.movingViews())changedVoxels.set(view.id,viewVoxel(view));
   diagnosticVoxels=undefined;diagnosticRevision=undefined;
  }epoch=sim.epoch;unregisterSync?.();unregisterSync=undefined;sim.dispose();sim=null;host=null;if(active===api)active=null;}
 function suspend(){releaseSimulation(true);}
 function install(engine:Simulation){
  sim=engine;epoch=sim.epoch;epochSerial=Math.max(epochSerial,epoch+1);viewCursor=undefined;eventCursor=undefined;
  sync(undefined,false);
  unregisterSync=sim.physicsHost.register({afterStep(){sync();}});
  const source=sim.physicsHost;
  host={get world(){return source.world;},get epoch(){return source.epoch;},register:p=>source.register(p),cell:id=>source.cell(id),colliderCell:(id,point)=>source.colliderCell(id,point),advance:dt=>{if(!round.settled&&!migrationPending)source.advance(dt);}};
  active=api;
 }
 async function activateNow(){
  if(sim)return;ensureFixture();
  const saved=cachedSimulation?decodeGameSimulation(fixture!,cachedSimulation,{maxActiveBodies}):null;
  if(cachedSimulation&&!saved)throw new Error('Invalid cached structural state');
  const nextEpoch=Math.max(epoch,epochSerial++);
  const engine=await createStructuralSimulation(fixture!,{maxActiveBodies,initialEpoch:nextEpoch,compactSupportFactory:options.compactSupportFactory,beforeWorldCreate(){if(active&&active!==api)active.suspend();}});
  try{
   if(saved&&!engine.restore(saved))throw new Error('Invalid cached structural state');
   install(engine);
  }catch(error){engine.dispose();throw error;}
 }

 function clearScene(){releaseSimulation(false);fixture=undefined;changedVoxels.clear();diagnosticVoxels=undefined;lossById.clear();cachedSimulation=null;destroyed=objectiveDestroyed=0;rewardedLoss=creditedResearch=0;suppressedRoots.clear();eventHistory=[];eventIds.clear();lastRoot=undefined;viewCursor=eventCursor=undefined;migrationPending=false;legacyObjective=undefined;epoch=epochSerial++;revision++;}
 async function fresh(map:MapId,loadout?:Loadout){clearScene();mapId=map;round=freshRound(research);if(loadout){round.loadout={...loadout};round.remaining={...loadout};}await activateNow();}
 const objective=():ObjectiveState=>{ensureFixture();sync();const total=legacyObjective?.total??totalTargets,removed=legacyObjective?.destroyed??objectiveDestroyed;return{mapId,title:mapTitle(mapId),total,destroyed:removed,fraction:total?removed/total:0,goal:1,complete:removed===total,completedMaps:[...completedMaps]};};
 function result(accepted=false):DamageResult{return{accepted,removed:[],detached:[],newlyDestroyed:0,researchEarned:0,destruction:fixture?.count?destroyed/fixture.count:0};}
 function damage(command:DamageCommand):DamageResult {
  if(!sim||round.settled||migrationPending||requiresLoadoutReselection(round)||!command||typeof command.id!=='string'||!command.id||command.id.length>160||command.epoch!==epoch||!Object.hasOwn(TOOLS,command.weapon)||!Number.isFinite(command.power)||command.power<=0||command.power>3||!command.target||![command.target.x,command.target.y,command.target.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=10000))return result();
  sync();const oldResearch=research,oldDestroyed=destroyed,tool=TOOLS[command.weapon],radius=tool.radius*Math.sqrt(command.power);
  // Removed moving cells must report their true pre-hit pose. Retain immutable
  // views only for the sparse moving subset inside this blast, never the city.
  const movingBefore=new Map<number,ImmutableCellView>();
  for(const view of sim.compact!.movingViews())if(Math.hypot(view.position.x-command.target.x,view.position.y-command.target.y,view.position.z-command.target.z)<=radius)movingBefore.set(view.id,view);
  const accepted=sim.blast({id:command.id,epoch:sim.epoch,position:command.target,radius,damage:tool.strength*command.power,impulse:Math.min(16,tool.strength*.6*Math.sqrt(command.power))});
  if(!accepted)return result();if(command.reward===false)suppressedRoots.add(command.id);
  const removed:Voxel[]=[],detached:Voxel[]=[];
  sync(command.id,true,(prior,next)=>{if(prior&&!next)removed.push(clone(movingBefore.has(prior.id)?viewVoxel(movingBefore.get(prior.id)!)!:prior));else if(prior?.structuralState==='static'&&next&&next.structuralState!=='static')detached.push(clone(next));});
  return{accepted:true,removed,detached,newlyDestroyed:destroyed-oldDestroyed,researchEarned:research-oldResearch,destruction:destroyed/fixture!.count};
 }
 async function restoreNow(input:WorldSnapshot):Promise<boolean>{
  if(!input||typeof input!=='object')return false;
  if(input.schemaVersion!==9){
   const legacy=createWorld();if(!legacy.restore(input))return false;const saved=legacy.getSnapshot(),o=legacy.getObjective();
   clearScene();mapId=saved.mapId!;research=saved.research;round=clone(saved.round as InventoryRound);completedMaps=[...saved.completedMaps!];migrationPending=true;legacyObjective={total:o.total,destroyed:o.destroyed};epoch=Math.max(epoch,saved.epoch,epochSerial++);ensureFixture();return true;
  }
  const s=input.structural as SavedGame;
  if(!MAP_IDS.includes(input.mapId!)||!Number.isSafeInteger(input.epoch)||input.epoch<1||input.epoch>=Number.MAX_SAFE_INTEGER-2||!Number.isSafeInteger(input.research)||input.research<0||!Array.isArray(input.voxels)||input.voxels.length||!Array.isArray(input.completedMaps)||new Set(input.completedMaps).size!==input.completedMaps.length||input.completedMaps.some(id=>!MAP_IDS.includes(id))||input.firstRewardClaimed!==input.completedMaps.includes(input.mapId!)||input.research<input.completedMaps.length*80||!s||s.schema!=='structural-game/v1'||typeof s.free!=='boolean'||s.free&&!free||typeof s.migrationPending!=='boolean'||!Number.isFinite(s.rewardedLoss)||s.rewardedLoss<0||!Number.isSafeInteger(s.creditedResearch)||s.creditedResearch<0||s.creditedResearch>200||s.creditedResearch>input.research||!Array.isArray(s.suppressedRoots)||new Set(s.suppressedRoots).size!==s.suppressedRoots.length||s.suppressedRoots.some(id=>typeof id!=='string'||!id)||!Number.isSafeInteger(input.destroyedCount)||input.destroyedCount<0)return false;
  // Only the exact previous experiment geometry counts enter this
  // migration. Validate its original cells before preserving progress and asking
  // for a new round; never fill new soil through saved moving rubble.
  const geometryUpgrade=(input.mapId==='city'&&input.totalCount===184681)||(input.mapId==='neighborhood'&&input.totalCount===50016);
  const legacyFixture=geometryUpgrade?createLegacyGameFixture(input.mapId!):undefined;
  const targetFixture=geometryUpgrade?undefined:createCompactGameFixture(input.mapId!);
  const targetCount=legacyFixture?legacyFixture.cells.reduce((n,c)=>n+(c.objective?1:0),0):targetFixture!.objectiveCount;
  const totalCount=legacyFixture?.cells.length??targetFixture!.count,targetId=legacyFixture?.id??targetFixture!.id;
  if(s.fixtureId!==targetId||input.totalCount!==totalCount||input.destroyedCount>totalCount||s.rewardedLoss>targetCount||s.creditedResearch!==Math.min(200,Math.ceil(s.rewardedLoss*200/targetCount)))return false;
  if(s.migrationPending){if(!s.legacyObjective||!Number.isSafeInteger(s.legacyObjective.total)||s.legacyObjective.total<=0||!Number.isSafeInteger(s.legacyObjective.destroyed)||s.legacyObjective.destroyed<0||s.legacyObjective.destroyed>s.legacyObjective.total)return false;}
  else if(s.legacyObjective!==undefined)return false;
  if(!validRound(input.round,input.research,s.legacyObjective?.destroyed??targetCount,s.free))return false;
  // Validate every saved row and body/contact relationship before replacing
  // an existing world. Current fixtures never expand pristine cell state.
  if(s.simulation!==null&&(!s.simulation||s.simulation.maxActiveBodies!==maxActiveBodies||s.simulation.epoch!==input.epoch||!Array.isArray(s.simulation.changes)))return false;
  if(s.simulation===null&&(input.destroyedCount||s.rewardedLoss||s.creditedResearch))return false;
  let restored:SimulationSave|null;
  let actualDestroyed=0,actualObjectiveDestroyed=0,loss=0;
  if(legacyFixture){
   const baseline=pristineLegacySnapshot(legacyFixture,maxActiveBodies,input.epoch);
   restored=s.simulation?expandLegacy(s.simulation,baseline):baseline;
   if(!restored||!validateStructuralSnapshot(legacyFixture,restored,{maxActiveBodies}))return false;
   const legacyBases=new Map(legacyFixture.cells.map(c=>[c.id,c]));
   for(const c of restored.cells){const base=legacyBases.get(c.id)!;if(c.state!=='static'){actualDestroyed++;if(base.objective)actualObjectiveDestroyed++;}if(base.objective)loss+=c.state==='static'?1-c.hp/base.maxHp:1;}
  }else{
   restored=s.simulation?decodeGameSimulation(targetFixture!,s.simulation,{maxActiveBodies}):pristineCompactSnapshot(targetFixture!,maxActiveBodies,input.epoch);
   if(!restored||!validateCompactStructuralSnapshot(targetFixture!,restored,{maxActiveBodies}))return false;
   for(const c of restored.cells){const objective=targetFixture!.objectiveOf(c.id);if(c.state!=='static'){actualDestroyed++;if(objective)actualObjectiveDestroyed++;}if(objective)loss+=c.state==='static'?1-c.hp/targetFixture!.maxHpOf(c.id):1;}
  }
  if(actualDestroyed!==input.destroyedCount||s.rewardedLoss>loss+1e-7||input.round!.startDestroyed>(s.legacyObjective?.destroyed??actualObjectiveDestroyed))return false;
  if(geometryUpgrade){
   clearScene();mapId=input.mapId!;research=input.research;round=clone(input.round as InventoryRound);completedMaps=[...input.completedMaps!];
   migrationPending=true;legacyObjective={total:targetCount,destroyed:actualObjectiveDestroyed};epoch=Math.max(epoch,input.epoch,epochSerial++);ensureFixture();return true;
  }
  // Pure validation above preserves the active native world and all in-flight
  // projectiles on any malformed restore, including a different map.
  ensureFixture();
  const sameFixture=fixture!.id===targetFixture!.id;
  let candidate:Simulation;
  if(sim&&sameFixture){candidate=sim;if(!candidate.restore(restored))return false;unregisterSync?.();unregisterSync=undefined;sim=null;host=null;}
  else{
   candidate=await createStructuralSimulation(targetFixture!,{maxActiveBodies,initialEpoch:Math.max(epoch,epochSerial++,input.epoch),compactSupportFactory:options.compactSupportFactory,beforeWorldCreate(){if(active)active.suspend();}});
   if(!candidate.restore(restored)){candidate.dispose();throw new Error('Validated structural state could not restore');}
  }
  fixture=targetFixture!;totalTargets=targetCount;mapId=input.mapId!;research=input.research;round=clone(input.round as InventoryRound);completedMaps=[...input.completedMaps!];migrationPending=s.migrationPending;legacyObjective=clone(s.legacyObjective);rewardedLoss=s.rewardedLoss;creditedResearch=s.creditedResearch;suppressedRoots=new Set(s.suppressedRoots);cachedSimulation=null;
  changedVoxels.clear();diagnosticVoxels=undefined;lossById.clear();destroyed=objectiveDestroyed=0;eventHistory=[];eventIds.clear();lastRoot=undefined;
  install(candidate);revision++;return true;
 }
 const api:StructuralGameWorld={
  get epoch(){return sim?.epoch??epoch;},get physicsHost(){return host;},get migrationPending(){return migrationPending;},get revision(){sync();return revision;},
  activate:()=>serial(activateNow),suspend,getRenderBinding:()=>sim?.compact??null,getResearch(){sync();return research;},getVoxel(id){ensureFixture();sync();return currentVoxel(id);},
  // Explicit diagnostic/test materialization. The game renderer uses the binding.
  getVoxels(){ensureFixture();sync();const poseRevision=sim?.compact?.revision;if(!diagnosticVoxels||diagnosticRevision!==poseRevision){const voxels:Voxel[]=[];for(let ordinal=0;ordinal<fixture!.count;ordinal++){const voxel=currentVoxel(fixture!.idAtOrdinal(ordinal)!);if(voxel)voxels.push(voxel);}diagnosticVoxels=Object.freeze(voxels);diagnosticRevision=poseRevision;}return diagnosticVoxels;},getObjective:objective,getRound:()=>clone(round),
  startRound:(map,loadout)=>serial(async()=>{if(!mapAvailable(map,research,free)||!(free?validateToolSelection(loadout,research):validateLoadout(loadout,research)))return false;await fresh(map,loadout);return true;}),
  loadMap:(map,allowFree=false)=>serial(async()=>{if(!mapAvailable(map,research,free||allowFree))return false;await fresh(map);return true;}),
  reset:()=>serial(async()=>{await fresh(mapId);}),
  recordShot(weapon='charge'){if(round.settled||migrationPending||requiresLoadoutReselection(round)||!WEAPON_IDS.includes(weapon)||!toolAvailable(weapon,round.startResearch)||round.remaining[weapon]<=0||!free&&round.used+weaponCost(weapon)>round.budget)return false;if(!free){round.remaining[weapon]--;round.used+=weaponCost(weapon);}return true;},
  damage,finishRound(){sync();if(api.pending()>0)throw new Error('Cannot settle while structural or projectile work is pending');round.settled=true;return{used:round.used,budget:round.budget,destruction:objective().fraction,researchEarned:research-round.startResearch};},
  eventsSince(cursor){
   sync();if(sim)return sim.eventsSince(cursor);
   const index=eventCursor?.index??eventHistory.length,first=index-eventHistory.length;
   const reset=!cursor||cursor.epoch!==epoch||!Number.isSafeInteger(cursor.index)||cursor.index<first||cursor.index>index;
   const events=Object.freeze(eventHistory.slice(reset?0:cursor!.index-first).map(e=>Object.freeze({...e,position:Object.freeze({...e.position})})));
   return Object.freeze({cursor:Object.freeze({epoch,index}),reset,events});
  },
  getSnapshot:snapshot,restore:input=>serial(()=>restoreNow(input)),step:dt=>host?.advance(dt),pending:()=>sim?.pending()??cachedSimulation?.bodies.filter(b=>b.status!=='rubble').length??0,events(){sync();return clone(eventHistory);},
 };
 return api;
}
