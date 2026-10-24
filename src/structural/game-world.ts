import type {DamageCommand,DamageResult,Loadout,MapId,ObjectiveState,RoundResult,RoundState,Voxel,WeaponId,WorldSnapshot} from '../contracts.js';
import {MAP_IDS,TOOLS,WEAPON_IDS,mapAvailable,mapTitle,capacityForResearch,toolAvailable,weaponCost} from '../content-catalog.js';
import {validateLoadout,validateToolSelection,validateHistoricalLoadout,requiresLoadoutReselection} from '../gameplay.js';
import {createWorld} from '../domain.js';
import {createGameFixture,gameCellVoxel,previewGameVoxels,type GameFixture,type GameCell} from './game-fixtures.js';
import {createStructuralSimulation,validateStructuralSnapshot} from './simulation.js';
import type {StructuralPhysicsHost} from './physics-host.js';
import type {CellView,Point,Rotation,StructuralEvent,StructuralEventCursor,StructuralEventChanges} from './types.js';
export {previewGameVoxels} from './game-fixtures.js';

type Simulation=Awaited<ReturnType<typeof createStructuralSimulation>>;
type InventoryRound=RoundState&{loadout:Loadout;remaining:Loadout};
type CellSave={id:number;hp:number;loss:number;state:CellView['state'];position:Point;rotation:Rotation;chunkId?:string};
type SimulationSave={schema:string;fixtureId:string;fixtureSignature:string;maxActiveBodies:number;epoch:number;tick:number;accumulator:number;serial:number;cells:CellSave[];bodies:any[];queue:string[];shots:string[];processed:string[];episodes:any[];episodeCounts:any[];research:number;events:StructuralEvent[]};
type CompactSimulation=Omit<SimulationSave,'fixtureId'|'fixtureSignature'|'cells'>&{changes:unknown[][]};
interface SavedGame {schema:'structural-game/v1';fixtureId:string;free:boolean;migrationPending:boolean;legacyObjective?:{total:number;destroyed:number};rewardedLoss:number;creditedResearch:number;suppressedRoots:string[];simulation:CompactSimulation|null;}
export interface StructuralGameWorld {
 readonly epoch:number;readonly physicsHost:StructuralPhysicsHost|null;readonly migrationPending:boolean;readonly revision:number;
 activate():Promise<void>;suspend():void;getResearch():number;getVoxel(id:number):Voxel|null;getVoxels():readonly Voxel[];getObjective():ObjectiveState;getRound():RoundState;
 startRound(map:MapId,loadout:Loadout):Promise<boolean>;loadMap(map:MapId,free?:boolean):Promise<boolean>;reset():Promise<void>;
 recordShot(weapon?:WeaponId):boolean;damage(command:DamageCommand):DamageResult;finishRound():RoundResult;
 getSnapshot():WorldSnapshot;restore(snapshot:WorldSnapshot):Promise<boolean>;step(dt:number):void;pending():number;events():StructuralEvent[];eventsSince(cursor?:StructuralEventCursor):StructuralEventChanges;
}
const clone=<T>(value:T):T=>structuredClone(value);
const weights=(loadout:Loadout)=>WEAPON_IDS.reduce((n,id)=>n+loadout[id]*weaponCost(id),0);
const freshRound=(research:number):InventoryRound=>{const budget=capacityForResearch(research),loadout=Object.fromEntries(WEAPON_IDS.map(id=>[id,id==='charge'?budget:0])) as Loadout;return{budget,used:0,startResearch:research,startDestroyed:0,settled:false,loadout,remaining:{...loadout}};};
const freezeVoxel=(v:Voxel):Voxel=>Object.freeze({...v,position:Object.freeze(v.position),rotation:v.rotation?Object.freeze(v.rotation):undefined,size:v.size?Object.freeze(v.size):undefined});
const states=['static','dynamic','rubble','gone'] as const;
let active:StructuralGameWorld|null=null;
let serialTransition:Promise<unknown>=Promise.resolve();
let epochSerial=1;
function serial<T>(fn:()=>Promise<T>):Promise<T>{const next=serialTransition.then(fn,fn);serialTransition=next.then(()=>undefined,()=>undefined);return next;}

/** Sparse deterministic-fixture saves omit pristine geology and duplicated source
 * descriptions. Only changed health/poses plus genuine body/contact state remain. */
function compact(save:SimulationSave,bases:Map<number,GameCell>):CompactSimulation {
 const {fixtureId:_,fixtureSignature:__,cells,...metadata}=save;
 const changes:unknown[][]=[];
 for(const c of cells){const base=bases.get(c.id)!;
  if(c.state==='static'&&c.hp===base.hp&&c.loss===0)continue;
  const row:unknown[]=[c.id,c.hp,c.loss,states.indexOf(c.state)];
  if(c.chunkId!==undefined||c.position.x!==base.position.x||c.position.y!==base.position.y||c.position.z!==base.position.z||c.rotation.x||c.rotation.y||c.rotation.z||c.rotation.w!==1)row.push(c.position.x,c.position.y,c.position.z,c.rotation.x,c.rotation.y,c.rotation.z,c.rotation.w,c.chunkId??null);
  changes.push(row);
 }
 return {...metadata,changes};
}
function expand(input:CompactSimulation,baseline:SimulationSave):SimulationSave|null {
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
function pristineSnapshot(fixture:GameFixture,maxActiveBodies:number,epoch:number):SimulationSave {
 return {schema:'structural-simulation/v1',fixtureId:fixture.id,fixtureSignature:JSON.stringify(fixture.cells),maxActiveBodies,epoch,tick:0,accumulator:0,serial:0,cells:fixture.cells.map(c=>({id:c.id,hp:c.hp,loss:0,state:'static',position:{...c.position},rotation:{x:0,y:0,z:0,w:1}})),bodies:[],queue:[],shots:[],processed:[],episodes:[],episodeCounts:[],research:0,events:[]};
}
function validRound(value:RoundState|undefined,research:number,maxDestroyed:number,unlimited=false):value is InventoryRound {
 if(!value||!Number.isSafeInteger(value.budget)||![6,8,10].includes(value.budget)||!Number.isSafeInteger(value.used)||value.used<0||value.used>value.budget||typeof value.settled!=='boolean'||!Number.isSafeInteger(value.startResearch)||value.startResearch<0||value.startResearch>research||value.budget>capacityForResearch(value.startResearch)||!Number.isSafeInteger(value.startDestroyed)||value.startDestroyed<0||value.startDestroyed>maxDestroyed)return false;
 const l=value.loadout,r=value.remaining;
 return !!l&&!!r&&(unlimited?validateToolSelection(l,value.startResearch):validateHistoricalLoadout(l,value.startResearch)&&weights(l)<=value.budget)&&Object.keys(r).length===WEAPON_IDS.length&&WEAPON_IDS.every(id=>Object.hasOwn(r,id)&&Number.isSafeInteger(r[id])&&r[id]>=0&&r[id]<=l[id])&&value.used===weights(l)-weights(r);
}

export function createStructuralGameWorld(options:{free?:boolean;maxActiveBodies?:number}={}):StructuralGameWorld {
 const free=options.free===true,maxActiveBodies=options.maxActiveBodies??32;
 let mapId:MapId='courtyard',fixture:GameFixture|undefined,bases=new Map<number,GameCell>(),totalTargets=0;
 let sim:Simulation|null=null,host:StructuralPhysicsHost|null=null,cachedSimulation:CompactSimulation|null=null,unregisterSync:(()=>void)|undefined;
 let epoch=epochSerial++,research=0,round=freshRound(0),migrationPending=false,legacyObjective:SavedGame['legacyObjective'];
 let completedMaps:MapId[]=[],rewardedLoss=0,creditedResearch=0,suppressedRoots=new Set<string>();
 let voxelById=new Map<number,Voxel>(),voxelArray:readonly Voxel[]=Object.freeze([]),lossById=new Map<number,number>();
 let voxelArrayDirty=false;
 let destroyed=0,objectiveDestroyed=0,revision=0,viewCursor:number|undefined,eventCursor:{epoch:number;index:number}|undefined,eventHistory:StructuralEvent[]=[];
 let eventIds=new Set<string>(),lastRoot:string|undefined;
 function ensureFixture(){
  if(fixture)return;
  fixture=createGameFixture(mapId);bases=new Map(fixture.cells.map(c=>[c.id,c]));totalTargets=fixture.cells.reduce((n,c)=>n+(c.objective?1:0),0);
  voxelById=new Map(fixture.cells.map(c=>[c.id,freezeVoxel(gameCellVoxel(c))]));voxelArray=Object.freeze([...voxelById.values()]);lossById=new Map();destroyed=objectiveDestroyed=0;revision++;
 }
 function allowed(root:string|undefined){return !free&&!round.settled&&!!root&&root!=='initial'&&!suppressedRoots.has(root);}
 function sync(directRoot?:string,account=true){
  if(!sim)return;ensureFixture();
  const engine=sim as Simulation&{viewChanges?:(cursor?:number)=>{revision:number;reset:boolean;cells:readonly CellView[]};eventsSince?:(cursor?:{epoch:number;index:number})=>{cursor:{epoch:number;index:number};events:readonly StructuralEvent[];reset:boolean}};
  const batch=engine.viewChanges?.(viewCursor),views=batch?.cells??sim.views();
  if(batch)viewCursor=batch.revision;
  const eventBatch=engine.eventsSince?.(eventCursor);let recent:readonly StructuralEvent[];
  if(eventBatch){eventCursor=eventBatch.cursor;recent=eventBatch.events;if(eventBatch.reset){eventHistory=[];eventIds.clear();}}
  else recent=sim.events().filter(e=>!eventIds.has(e.id));
  const targetRoots=new Map<number,string>();
  for(const event of recent){if(!eventIds.has(event.id)){eventIds.add(event.id);eventHistory.push(clone(event));}if(event.targetId!==undefined)targetRoots.set(event.targetId,event.rootShotId);if(event.kind==='detach'||event.kind==='impact')lastRoot=event.rootShotId;}
  if(eventHistory.length>8192){eventHistory=eventHistory.slice(-8192);eventIds=new Set(eventHistory.map(e=>e.id));}
  let changed=false;
  for(const view of views){const base=bases.get(view.id)!;if(!base)continue;
   const prior=voxelById.get(view.id),wasDestroyed=prior===undefined||prior.structuralState!=='static',isDestroyed=view.state!=='static';
   if(wasDestroyed!==isDestroyed){destroyed+=isDestroyed?1:-1;if(base.objective)objectiveDestroyed+=isDestroyed?1:-1;}
   if(base.objective){const before=lossById.get(view.id)??0,next=isDestroyed?1:Math.max(0,1-view.hp/base.maxHp),delta=Math.max(0,next-before);lossById.set(view.id,next);if(account&&delta&&allowed(directRoot??targetRoots.get(view.id)??lastRoot))rewardedLoss+=delta;}
   if(view.state==='gone'){if(prior){voxelById.delete(view.id);changed=true;}continue;}
   // Simulation delta views preserve immutable source identities. Rebuild only
   // changed cells, not all static terrain, and retain unchanged render records.
   if(prior&&prior.hp===view.hp&&prior.structuralState===view.state&&prior.position.x===view.position.x&&prior.position.y===view.position.y&&prior.position.z===view.position.z&&prior.rotation!.x===view.rotation.x&&prior.rotation!.y===view.rotation.y&&prior.rotation!.z===view.rotation.z&&prior.rotation!.w===view.rotation.w)continue;
   voxelById.set(view.id,freezeVoxel(gameCellVoxel(view,base)));changed=true;
  }
  if(account&&!free&&!round.settled){const next=Math.min(200,Math.ceil(Math.max(0,rewardedLoss)*200/totalTargets));research+=Math.max(0,next-creditedResearch);creditedResearch=Math.max(creditedResearch,next);}
  if(changed){voxelArrayDirty=true;revision++;}
 }
 function snapshot():WorldSnapshot {
  ensureFixture();sync();
  const simulation=sim?compact(sim.snapshot() as SimulationSave,bases):clone(cachedSimulation);
  const structural:SavedGame={schema:'structural-game/v1',fixtureId:fixture!.id,free,migrationPending,...(legacyObjective?{legacyObjective:clone(legacyObjective)}:{}),rewardedLoss,creditedResearch,suppressedRoots:[...suppressedRoots],simulation};
  return {schemaVersion:9,structural,mapId,round:clone(round),completedMaps:[...completedMaps],epoch,voxels:[],totalCount:fixture!.cells.length,destroyedCount:destroyed,research,firstRewardClaimed:completedMaps.includes(mapId)};
 }
 function suspend(){if(!sim)return;sync();cachedSimulation=compact(sim.snapshot() as SimulationSave,bases);epoch=sim.epoch;unregisterSync?.();unregisterSync=undefined;sim.dispose();sim=null;host=null;if(active===api)active=null;}
 function install(engine:Simulation){
  sim=engine;epoch=sim.epoch;epochSerial=Math.max(epochSerial,epoch+1);viewCursor=undefined;eventCursor=undefined;
  sync(undefined,false);
  unregisterSync=sim.physicsHost.register({afterStep(){sync();}});
  const source=sim.physicsHost;
  host={get world(){return source.world;},get epoch(){return source.epoch;},register:p=>source.register(p),cell:id=>source.cell(id),colliderCell:(id,point)=>source.colliderCell(id,point),advance:dt=>{if(!round.settled&&!migrationPending)source.advance(dt);}};
  active=api;
 }
 async function activateNow(){
  if(sim)return;ensureFixture();if(active&&active!==api)active.suspend();
  const nextEpoch=Math.max(epoch,epochSerial++);
  const engine=await createStructuralSimulation(fixture!,{maxActiveBodies,initialEpoch:nextEpoch});
  try{
   if(cachedSimulation){
    const saved=expand(cachedSimulation,pristineSnapshot(fixture!,maxActiveBodies,nextEpoch));
    if(!saved||!engine.restore(saved))throw new Error('Invalid cached structural state');
   }
   install(engine);
  }catch(error){engine.dispose();throw error;}
 }

 function clearScene(){suspend();fixture=undefined;bases.clear();voxelById.clear();voxelArray=Object.freeze([]);lossById.clear();cachedSimulation=null;destroyed=objectiveDestroyed=0;rewardedLoss=creditedResearch=0;suppressedRoots.clear();eventHistory=[];eventIds.clear();lastRoot=undefined;viewCursor=eventCursor=undefined;migrationPending=false;legacyObjective=undefined;epoch=epochSerial++;revision++;}
 async function fresh(map:MapId,loadout?:Loadout){clearScene();mapId=map;round=freshRound(research);if(loadout){round.loadout={...loadout};round.remaining={...loadout};}await activateNow();}
 const objective=():ObjectiveState=>{ensureFixture();sync();const total=legacyObjective?.total??totalTargets,removed=legacyObjective?.destroyed??objectiveDestroyed;return{mapId,title:mapTitle(mapId),total,destroyed:removed,fraction:total?removed/total:0,goal:1,complete:removed===total,completedMaps:[...completedMaps]};};
 function result(accepted=false):DamageResult{return{accepted,removed:[],detached:[],newlyDestroyed:0,researchEarned:0,destruction:fixture?.cells.length?destroyed/fixture.cells.length:0};}
 function damage(command:DamageCommand):DamageResult {
  if(!sim||round.settled||migrationPending||requiresLoadoutReselection(round)||!command||typeof command.id!=='string'||!command.id||command.id.length>160||command.epoch!==epoch||!Object.hasOwn(TOOLS,command.weapon)||!Number.isFinite(command.power)||command.power<=0||command.power>3||!command.target||![command.target.x,command.target.y,command.target.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=10000))return result();
  sync();const before=new Map(voxelById),oldResearch=research,oldDestroyed=destroyed,tool=TOOLS[command.weapon];
  const accepted=sim.blast({id:command.id,epoch:sim.epoch,position:command.target,radius:tool.radius*Math.sqrt(command.power),damage:tool.strength*command.power,impulse:Math.min(16,tool.strength*.6*Math.sqrt(command.power))});
  if(!accepted)return result();if(command.reward===false)suppressedRoots.add(command.id);sync(command.id);
  const removed:Voxel[]=[],detached:Voxel[]=[];
  for(const [id,prior] of before){const next=voxelById.get(id);if(!next)removed.push(clone(prior));else if(prior.structuralState==='static'&&next.structuralState!=='static')detached.push(clone(next));}
  return{accepted:true,removed,detached,newlyDestroyed:destroyed-oldDestroyed,researchEarned:research-oldResearch,destruction:destroyed/fixture!.cells.length};
 }
 async function restoreNow(input:WorldSnapshot):Promise<boolean>{
  if(!input||typeof input!=='object')return false;
  if(input.schemaVersion!==9){
   const legacy=createWorld();if(!legacy.restore(input))return false;const saved=legacy.getSnapshot(),o=legacy.getObjective();
   clearScene();mapId=saved.mapId!;research=saved.research;round=clone(saved.round as InventoryRound);completedMaps=[...saved.completedMaps!];migrationPending=true;legacyObjective={total:o.total,destroyed:o.destroyed};epoch=Math.max(epoch,saved.epoch,epochSerial++);ensureFixture();return true;
  }
  const s=input.structural as SavedGame;
  if(!MAP_IDS.includes(input.mapId!)||!Number.isSafeInteger(input.epoch)||input.epoch<1||input.epoch>=Number.MAX_SAFE_INTEGER-2||!Number.isSafeInteger(input.research)||input.research<0||!Array.isArray(input.voxels)||input.voxels.length||!Array.isArray(input.completedMaps)||new Set(input.completedMaps).size!==input.completedMaps.length||input.completedMaps.some(id=>!MAP_IDS.includes(id))||input.firstRewardClaimed!==input.completedMaps.includes(input.mapId!)||input.research<input.completedMaps.length*80||!s||s.schema!=='structural-game/v1'||typeof s.free!=='boolean'||s.free&&!free||typeof s.migrationPending!=='boolean'||!Number.isFinite(s.rewardedLoss)||s.rewardedLoss<0||!Number.isSafeInteger(s.creditedResearch)||s.creditedResearch<0||s.creditedResearch>200||s.creditedResearch>input.research||!Array.isArray(s.suppressedRoots)||new Set(s.suppressedRoots).size!==s.suppressedRoots.length||s.suppressedRoots.some(id=>typeof id!=='string'||!id)||!Number.isSafeInteger(input.destroyedCount)||input.destroyedCount<0)return false;
  const targetFixture=createGameFixture(input.mapId!),targetBases=new Map(targetFixture.cells.map(c=>[c.id,c])),targetCount=targetFixture.cells.filter(c=>c.objective).length;
  if(s.fixtureId!==targetFixture.id||input.totalCount!==targetFixture.cells.length||input.destroyedCount>input.totalCount||s.rewardedLoss>targetCount||s.creditedResearch!==Math.min(200,Math.ceil(s.rewardedLoss*200/targetCount)))return false;
  if(s.migrationPending){if(!s.legacyObjective||!Number.isSafeInteger(s.legacyObjective.total)||s.legacyObjective.total<=0||!Number.isSafeInteger(s.legacyObjective.destroyed)||s.legacyObjective.destroyed<0||s.legacyObjective.destroyed>s.legacyObjective.total)return false;}
  else if(s.legacyObjective!==undefined)return false;
  if(!validRound(input.round,input.research,s.legacyObjective?.destroyed??targetCount,s.free))return false;
  // Check the compact surface before touching an existing world. The complete
  // expanded physical state is then checked by the authoritative validator.
  if(s.simulation!==null&&(!s.simulation||s.simulation.maxActiveBodies!==maxActiveBodies||s.simulation.epoch!==input.epoch||!Array.isArray(s.simulation.changes)))return false;
  if(s.simulation===null&&(input.destroyedCount||s.rewardedLoss||s.creditedResearch))return false;
  const baseline=pristineSnapshot(targetFixture,maxActiveBodies,input.epoch);
  const expanded=s.simulation?expand(s.simulation,baseline):baseline;
  if(!expanded)return false;
  const actualDestroyed=expanded.cells.filter(c=>c.state!=='static').length;
  const actualObjectiveDestroyed=expanded.cells.filter(c=>c.state!=='static'&&targetBases.get(c.id)?.objective).length;
  const loss=expanded.cells.reduce((n,c)=>n+(targetBases.get(c.id)!.objective?(c.state==='static'?1-c.hp/targetBases.get(c.id)!.maxHp:1):0),0);
  if(actualDestroyed!==input.destroyedCount||s.rewardedLoss>loss+1e-7||input.round!.startDestroyed>(s.legacyObjective?.destroyed??actualObjectiveDestroyed)||!validateStructuralSnapshot(targetFixture,expanded,{maxActiveBodies}))return false;
  // Pure validation above preserves the active native world and all in-flight
  // projectiles on any malformed restore, including a different map.
  ensureFixture();
  const sameFixture=fixture!.id===targetFixture.id;
  let candidate:Simulation;
  if(sim&&sameFixture){candidate=sim;if(!candidate.restore(expanded))return false;unregisterSync?.();unregisterSync=undefined;sim=null;host=null;}
  else{
   if(active)active.suspend();
   candidate=await createStructuralSimulation(targetFixture,{maxActiveBodies,initialEpoch:Math.max(epoch,epochSerial++,input.epoch)});
   if(!candidate.restore(expanded)){candidate.dispose();throw new Error('Validated structural state could not restore');}
  }
  fixture=targetFixture;bases=targetBases;totalTargets=targetCount;mapId=input.mapId!;research=input.research;round=clone(input.round as InventoryRound);completedMaps=[...input.completedMaps!];migrationPending=s.migrationPending;legacyObjective=clone(s.legacyObjective);rewardedLoss=s.rewardedLoss;creditedResearch=s.creditedResearch;suppressedRoots=new Set(s.suppressedRoots);cachedSimulation=null;
  voxelById=new Map(targetFixture.cells.map(c=>[c.id,freezeVoxel(gameCellVoxel(c))]));voxelArray=Object.freeze([...voxelById.values()]);lossById.clear();destroyed=objectiveDestroyed=0;eventHistory=[];eventIds.clear();lastRoot=undefined;
  install(candidate);revision++;return true;
 }
 const api:StructuralGameWorld={
  get epoch(){return sim?.epoch??epoch;},get physicsHost(){return host;},get migrationPending(){return migrationPending;},get revision(){sync();return revision;},
  activate:()=>serial(activateNow),suspend,getResearch(){sync();return research;},getVoxel(id){ensureFixture();sync();return voxelById.get(id)??null;},getVoxels(){ensureFixture();sync();if(voxelArrayDirty){voxelArray=Object.freeze([...voxelById.values()]);voxelArrayDirty=false;}return voxelArray;},getObjective:objective,getRound:()=>clone(round),
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
