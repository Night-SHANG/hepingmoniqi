import type { DamageCommand, DamageResult, MaterialId, Vec3, Voxel, WorldModel, WorldSnapshot, MapId, ObjectiveState, RoundState, RoundResult, Loadout, WeaponId } from './contracts.js';
import {TOOLS,WEAPON_IDS,MAP_IDS,mapAvailable,mapTitle} from './content-catalog.js';
import {bridgeVoxels,towerVoxels,cantileverVoxels} from './map-generators.js';
import {neighborhoodVoxels,cityVoxels} from './scaled-map-generators.js';
import {capacityForResearch,toolAvailable,validateLoadout,validateHistoricalLoadout,requiresLoadoutReselection,weaponCost} from './gameplay.js';

// Intentionally fictional game units, not a physical blast simulation.
const MATERIALS: Record<MaterialId, { hp: number; colors: number[] }> = {
 wood: { hp: 2, colors: [0x996238, 0xae7545, 0xc18a53, 0xb47a47] },
 stone: { hp: 5, colors: [0x626c70, 0x778080, 0x59666b] },
 roof: { hp: 2.4, colors: [0xa94633, 0xbc553d, 0x923b30] },
 glass: { hp: 0.6, colors: [0x8bc7cf, 0xa9dfe0] },
 foliage: { hp: 0.7, colors: [0x547436, 0x688b37, 0x7e9b42, 0x94ad4c] },
 metal: { hp: 6, colors: [0x3d4954, 0x515e65] },
};

const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
const clone = (v: Voxel): Voxel => ({ ...v, position: { ...v.position }, ...(v.size?{size:{...v.size}}:{}) });
const immutable = (v: Voxel): Voxel => Object.freeze({ ...v, position: Object.freeze({ ...v.position }), ...(v.size?{size:Object.freeze({...v.size})}:{}) });
const neighbors = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

function supportedIds(voxels: readonly Voxel[]): Set<number> {
 const positions=new Map(voxels.map(v=>[key(v.position),v]));
 const supported=new Set<number>(); const queue=voxels.filter(v=>v.anchored);
 for(const v of queue) supported.add(v.id);
 for(let i=0;i<queue.length;i++) for(const [x,y,z] of neighbors){
  const p=queue[i].position;const v=positions.get(key({x:p.x+x,y:p.y+y,z:p.z+z}));
  if(v&&v.objectId===queue[i].objectId&&!supported.has(v.id)){supported.add(v.id);queue.push(v);}
 }
 return supported;
}

// Canonical scaled geometry has a reusable broadphase and face-adjacency graph.
// Damage/support never compares every cell with every other city cell. Legacy
// maps retain their exact lattice and center-distance semantics above.
const BUCKET_SIZE=4, FACE_EPSILON=1e-7;
type Bounds={min:Vec3;max:Vec3};
const axes=['x','y','z'] as const;
function bounds(v:Voxel):Bounds{
 const size=v.size??{x:1,y:1,z:1};
 return {min:{x:v.position.x-size.x/2,y:v.position.y-size.y/2,z:v.position.z-size.z/2},max:{x:v.position.x+size.x/2,y:v.position.y+size.y/2,z:v.position.z+size.z/2}};
}
function faceTouching(a:Bounds,b:Bounds):boolean{
 return axes.some(axis=>{
  if(Math.abs(a.max[axis]-b.min[axis])>FACE_EPSILON&&Math.abs(b.max[axis]-a.min[axis])>FACE_EPSILON)return false;
  return axes.every(other=>other===axis||Math.min(a.max[other],b.max[other])-Math.max(a.min[other],b.min[other])>FACE_EPSILON);
 });
}
class ScaledSpatialIndex{
 private readonly buckets=new Map<string,number[]>();
 private readonly geometry=new Map<number,Bounds>();
 private readonly adjacent=new Map<number,number[]>();
 private readonly originals:Map<number,Voxel>;
 constructor(voxels:readonly Voxel[]){
  this.originals=new Map(voxels.map(v=>[v.id,v]));
  for(const voxel of voxels){
   const box=bounds(voxel);this.geometry.set(voxel.id,box);this.adjacent.set(voxel.id,[]);
   this.visit(box,key=>{let entries=this.buckets.get(key);if(!entries)this.buckets.set(key,entries=[]);entries.push(voxel.id);});
  }
  for(const voxel of voxels){
   const box=this.geometry.get(voxel.id)!;
   for(const id of this.query(box)){
    if(id<=voxel.id||this.originals.get(id)!.objectId!==voxel.objectId||!faceTouching(box,this.geometry.get(id)!))continue;
    this.adjacent.get(voxel.id)!.push(id);this.adjacent.get(id)!.push(voxel.id);
   }
  }
 }
 private visit(box:Bounds,callback:(key:string)=>void){
  for(let x=Math.floor((box.min.x-FACE_EPSILON)/BUCKET_SIZE);x<=Math.floor((box.max.x+FACE_EPSILON)/BUCKET_SIZE);x++)
  for(let y=Math.floor((box.min.y-FACE_EPSILON)/BUCKET_SIZE);y<=Math.floor((box.max.y+FACE_EPSILON)/BUCKET_SIZE);y++)
  for(let z=Math.floor((box.min.z-FACE_EPSILON)/BUCKET_SIZE);z<=Math.floor((box.max.z+FACE_EPSILON)/BUCKET_SIZE);z++)callback(`${x},${y},${z}`);
 }
 private query(box:Bounds):Set<number>{
  const ids=new Set<number>();this.visit(box,key=>{for(const id of this.buckets.get(key)??[])ids.add(id);});return ids;
 }
 queryRadius(center:Vec3,radius:number):Set<number>{
  return this.query({min:{x:center.x-radius,y:center.y-radius,z:center.z-radius},max:{x:center.x+radius,y:center.y+radius,z:center.z+radius}});
 }
 distanceTo(id:number,p:Vec3):number{
  const box=this.geometry.get(id)!;
  return Math.hypot(Math.max(0,box.min.x-p.x,p.x-box.max.x),Math.max(0,box.min.y-p.y,p.y-box.max.y),Math.max(0,box.min.z-p.z,p.z-box.max.z));
 }
 supported(voxels:readonly Voxel[]):Set<number>{
  const alive=new Set(voxels.map(v=>v.id));const queue=voxels.filter(v=>v.anchored).map(v=>v.id);const supported=new Set(queue);
  for(let i=0;i<queue.length;i++)for(const id of this.adjacent.get(queue[i])!){if(alive.has(id)&&!supported.has(id)){supported.add(id);queue.push(id);}}
  return supported;
 }
}
const spatialCache=new WeakMap<readonly Voxel[],ScaledSpatialIndex>();
function spatialFor(voxels:readonly Voxel[]):ScaledSpatialIndex|undefined{
 if(!voxels.some(v=>v.size))return undefined;
 let spatial=spatialCache.get(voxels);if(!spatial){spatial=new ScaledSpatialIndex(voxels);spatialCache.set(voxels,spatial);}return spatial;
}
const buildingWeight=(voxels:readonly Voxel[])=>voxels.reduce((sum,v)=>sum+(v.group==='house'?(v.weight??1):0),0);

function cottage(): Voxel[] {
 const cells = new Map<string, Voxel>();
 const put = (x: number, y: number, z: number, material: MaterialId) => {
  const spec=MATERIALS[material]; const shade=Math.abs(x*73+y*31+z*17)%spec.colors.length;
  cells.set(key({x,y,z}),{ id:0,position:{x,y,z},material,color:spec.colors[shade],hp:spec.hp,maxHp:spec.hp,anchored:y===0 });
 };
 // Continuous stone footing and timber floor make support connectivity explicit.
 for(let x=-7;x<=7;x++) for(let z=-5;z<=5;z++){put(x,0,z,'stone');put(x,1,z,'wood');}
 for(let y=2;y<=7;y++) for(let x=-7;x<=7;x++) for(let z=-5;z<=5;z++) {
  if(Math.abs(x)!==7&&Math.abs(z)!==5) continue;
  const frontWindow=Math.abs(z)===5&&Math.abs(x)>=3&&Math.abs(x)<=5&&y>=3&&y<=5;
  const sideWindow=Math.abs(x)===7&&Math.abs(z)<=2&&y>=3&&y<=5;
  put(x,y,z,frontWindow||sideWindow?'glass':'wood');
 }
 // Door with dark iron hardware, framed windows, and contrasting structural posts.
 for(let x=-1;x<=1;x++) for(let y=2;y<=5;y++) put(x,y,5,'wood');
 put(1,3,5,'metal');
 for(const x of [-7,7]) for(const z of [-5,5]) for(let y=2;y<=7;y++) put(x,y,z,'wood');
 const roofHeight=(x:number)=>8+Math.floor((8-Math.abs(x))/2);
 for(let x=-8;x<=8;x++) {
  const top=roofHeight(x);
  for(let z=-6;z<=6;z++) {
   put(x,top,z,'roof');
   // Fill vertical steps so roof tiles remain face-connected on the lattice.
   if(Math.abs(x)<8&&roofHeight(Math.abs(x)+1)<top) put(x,top-1,z,'roof');
  }
  if(Math.abs(x)<=7) for(const z of [-5,5]) for(let y=8;y<top;y++) put(x,y,z,'wood');
 }
 // Covered porch and entry steps.
 for(let x=-3;x<=3;x++) for(let z=6;z<=8;z++){put(x,0,z,'stone');put(x,1,z,'wood');}
 for(const x of [-3,3]) for(let y=2;y<=7;y++) put(x,y,8,'wood');
 for(let x=-3;x<=3;x++) for(let z=6;z<=8;z++) put(x,8,z,'roof');
 for(let x=-1;x<=1;x++) put(x,0,9,'stone');
 // A grounded hearth and stack connects all the way to the chimney cap.
 for(let y=2;y<=14;y++) for(let x=3;x<=4;x++) for(let z=-3;z<=-2;z++) put(x,y,z,y===14?'metal':'stone');
 return [...cells.values()].map((v,id)=>immutable({...v,id,group:'house',objectId:'house'}));
}

/** Interactive yard props share the same authoritative damage and support lattice as the house. */
function yard(): Voxel[] {
 const cells=new Map<string,Voxel>();
 const put=(x:number,y:number,z:number,material:MaterialId,group:Voxel['group'],objectId:string)=>{
  const spec=MATERIALS[material];
  const color=spec.colors[Math.abs(x*73+y*31+z*17)%spec.colors.length];
  cells.set(key({x,y,z}),{id:0,position:{x,y,z},material,color,hp:spec.hp,maxHp:spec.hp,anchored:y===0,group,objectId});
 };
 for(const [x,z,height] of [[-16,6,7],[-17,-10,8],[16,-12,7],[21,3,5],[-23,-18,5]]){
  const objectId=`tree:${x}:${z}`;
  for(let y=0;y<=height;y++)put(x,y,z,'wood','tree',objectId);
  for(let layer=0;layer<4;layer++){
   const radius=layer===3?1:layer===1?3:2;
   for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++){
    if(dx*dx+dz*dz>radius*radius||dx===0&&dz===0&&layer<2)continue;
    put(x+dx,height-1+layer,z+dz,'foliage','tree',objectId);
   }
  }
 }
 const fence=(x:number,z:number,alongX:boolean,length:number)=>{
  // Shared object identity lets adjacent rails transfer support across fence corners.
  for(let i=0;i<=length;i++)for(let y=0;y<=2;y++){
   if(y===0&&i%3!==0&&i!==length)continue;
   put(x+(alongX?i:0),y,z+(alongX?0:i),'wood','fence','fence');
  }
 };
 fence(-22,17,true,18);fence(5,17,true,18);fence(-22,-16,false,33);fence(23,-16,false,33);fence(-22,-16,true,45);
 for(const x of [-11,11])for(let dx=-2;dx<=2;dx++)for(let dz=-1;dz<=1;dz++){
  const id=`planter:${x}`;put(x+dx,0,9+dz,'stone','planter',id);
  put(x+dx,1,9+dz,Math.abs(dx)===2||Math.abs(dz)===1?'wood':'foliage','planter',id);
 }
 for(let x=11;x<=15;x++)for(let z=3;z<=5;z++){
  put(x,2,z,'wood','table','table');
  if((x===11||x===15)&&(z===3||z===5))for(let y=0;y<2;y++)put(x,y,z,'wood','table','table');
 }
 for(const [x,z] of [[-12,2],[11,-3],[12,-3]])for(let y=0;y<=1;y++)put(x,y,z,'wood','crate',`crate:${x}:${z}`);
 for(let x=-13;x<=-9;x++)for(let z=-6;z<=-4;z++)for(let y=0;y<3;y++){
  if(y===2&&(x===-13||x===-9))continue;
  put(x,y,z,'wood','logs','logs');
 }
 return [...cells.values()].map((v,index)=>immutable({...v,id:10000+index}));
}

/** Two separately supported warehouse bays, within the existing courtyard footprint. */
function warehouse(): Voxel[] {
 const cells=new Map<string,Voxel>();
 for(const [center,side] of [[-4,'left'],[4,'right']] as const){
  const put=(x:number,y:number,z:number,material:MaterialId)=>{
   const spec=MATERIALS[material];
   cells.set(key({x,y,z}),{id:0,position:{x,y,z},material,color:material==='roof'?0x536b7b:spec.colors[Math.abs(x*73+y*31+z*17)%spec.colors.length],hp:spec.hp,maxHp:spec.hp,anchored:y===0,group:'house',objectId:`warehouse:${side}`});
  };
  for(let x=center-3;x<=center+3;x++)for(let z=-5;z<=5;z++){
   put(x,0,z,'stone');put(x,1,z,'wood');
   for(let y=2;y<=7;y++){
    if(Math.abs(x-center)!==3&&Math.abs(z)!==5)continue;
    if(z===5&&Math.abs(x-center)<=1&&y<=5)continue;
    put(x,y,z,y>=5&&y<=6&&Math.abs(z)===5?'glass':side==='left'?'wood':'stone');
   }
  }
  for(let x=center-3;x<=center+3;x++)for(let z=-5;z<=5;z++){
   const top=8+Math.floor((3-Math.abs(x-center))/2);
   put(x,top,z,'roof');if(top===9)put(x,8,z,'roof');
  }
 }
 return [...cells.values()].map((v,index)=>immutable({...v,id:20000+index}));
}

function canonicalGeometry(voxel:Voxel,base:Voxel):boolean{
 if(Object.hasOwn(voxel,'size')!==Object.hasOwn(base,'size')||Object.hasOwn(voxel,'weight')!==Object.hasOwn(base,'weight')||voxel.weight!==base.weight)return false;
 if(!base.size)return voxel.size===undefined;
 const size=voxel.size;return !!size&&typeof size==='object'&&!Array.isArray(size)&&Object.keys(size).length===3&&(['x','y','z'] as const).every(axis=>Object.hasOwn(size,axis)&&size[axis]===base.size![axis]);
}

type InventoryRound = RoundState & {loadout:Loadout;remaining:Loadout};
const weaponIds=WEAPON_IDS;
const inventoryCapacity=(loadout:Loadout)=>weaponIds.reduce((total,id)=>total+loadout[id]*weaponCost(id),0);
const cloneRound=(round:InventoryRound):InventoryRound=>({...round,loadout:{...round.loadout},remaining:{...round.remaining}});
function freshRound(research:number,startDestroyed=0):InventoryRound{
 const budget=capacityForResearch(research),loadout={charge:budget,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0};
 return {budget,used:0,startResearch:research,startDestroyed,settled:false,loadout,remaining:{...loadout}};
}

/** Pure geometry access for migration and authoritative structural adapters. */
export function createMapVoxels(mapId:MapId):readonly Voxel[] {
 switch(mapId){
  case 'courtyard':return Object.freeze([...cottage(),...yard()]);
  case 'warehouse':return Object.freeze([...warehouse(),...yard()]);
  case 'bridge':return Object.freeze([...bridgeVoxels(),...yard()]);
  case 'tower':return Object.freeze([...towerVoxels(),...yard()]);
  case 'cantilever':return Object.freeze([...cantileverVoxels(),...yard()]);
  case 'neighborhood':return neighborhoodVoxels();
  case 'city':return cityVoxels();
 }
}

export function createWorld(): WorldModel {
 const maps:Record<MapId,readonly Voxel[]>={courtyard:Object.freeze([...cottage(),...yard()]),warehouse:Object.freeze([...warehouse(),...yard()]),bridge:Object.freeze([...bridgeVoxels(),...yard()]),tower:Object.freeze([...towerVoxels(),...yard()]),cantilever:Object.freeze([...cantileverVoxels(),...yard()]),neighborhood:neighborhoodVoxels(),city:cityVoxels()};
 let mapId:MapId='courtyard', original=maps.courtyard;
 let voxels: readonly Voxel[]=Object.freeze([...original]); let epoch=1, destroyedCount=0, research=0;
 const completedMaps=new Set<MapId>();const processed=new Set<string>();
 let round=freshRound(0);
 const buildingTotal=()=>buildingWeight(original);
 const buildingDestroyed=()=>buildingTotal()-buildingWeight(voxels);
 // Credit the cumulative fraction of each building cell's health lost, including
 // cells removed by support loss. Rounding the cumulative total, not each hit,
 // makes tiny damage count without allowing repeated fractional-hit farming.
 const buildingResearch=()=>Math.min(200,Math.ceil((buildingDestroyed()+voxels.reduce((sum,v)=>sum+(v.group==='house'?(v.weight??1)*(1-v.hp/v.maxHp):0),0))*200/buildingTotal()));
 const getObjective=():ObjectiveState=>{const total=buildingTotal(),destroyed=buildingDestroyed();return {mapId,title:mapTitle(mapId),total,destroyed,fraction:destroyed/total,goal:1,complete:destroyed===total,completedMaps:[...completedMaps]};};
 function recordShot(weapon:WeaponId='charge'):boolean {
  if(round.settled||requiresLoadoutReselection(round)||!weaponIds.includes(weapon)||!toolAvailable(weapon,round.startResearch,false)||round.remaining[weapon]<=0||round.used+weaponCost(weapon)>round.budget)return false;
  round.remaining[weapon]--;round.used+=weaponCost(weapon);return true;
 }
 function finishRound():RoundResult {
  round.settled=true;
  return {used:round.used,budget:round.budget,destruction:getObjective().fraction,researchEarned:research-round.startResearch};
 }
 const result=(accepted=false):DamageResult=>({accepted,removed:[],detached:[],newlyDestroyed:0,researchEarned:0,destruction:destroyedCount/original.length});
 function damage(command:DamageCommand):DamageResult {
  if(round.settled||requiresLoadoutReselection(round)||!command||typeof command.id!=='string'||command.id.length===0||command.id.length>160||command.epoch!==epoch||processed.has(command.id)||!Object.hasOwn(TOOLS,command.weapon)||!Number.isFinite(command.power)||command.power<=0||command.power>3||!command.target||![command.target.x,command.target.y,command.target.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=10000)) return result();
  processed.add(command.id);
  const priorBase=buildingResearch();
  const tool=TOOLS[command.weapon], radius=tool.radius*Math.sqrt(command.power), removed:Voxel[]=[], survivors:Voxel[]=[];
  const spatial=spatialFor(original),candidates=spatial?.queryRadius(command.target,radius);
  for(const v of voxels){
   if(candidates&&!candidates.has(v.id)){survivors.push(v);continue;}
   const distance=spatial?spatial.distanceTo(v.id,command.target):Math.hypot(v.position.x-command.target.x,v.position.y-command.target.y,v.position.z-command.target.z);
   if(distance>radius){survivors.push(v);continue;}
   const hp=v.hp-tool.strength*command.power*(0.35+0.65*(1-distance/radius));
   if(hp<=0) removed.push(v); else survivors.push(immutable({...v,hp}));
  }
  const detached:Voxel[]=[];
  if(removed.length){
   const supported=spatial?spatial.supported(survivors):supportedIds(survivors);
   voxels=Object.freeze(survivors.filter(v=>{if(supported.has(v.id))return true;detached.push(v);return false;}));
  } else voxels=Object.freeze(survivors);
  const newlyDestroyed=removed.length+detached.length;destroyedCount+=newlyDestroyed;
  const researchEarned=command.reward===false?0:buildingResearch()-priorBase;
  research+=researchEarned;
  return {accepted:true,removed:removed.map(clone),detached:detached.map(clone),newlyDestroyed,researchEarned,destruction:destroyedCount/original.length};
 }
 function getSnapshot():WorldSnapshot{return {schemaVersion:8,round:cloneRound(round),mapId,completedMaps:[...completedMaps],epoch,voxels:voxels.map(clone),totalCount:original.length,destroyedCount,research,firstRewardClaimed:completedMaps.has(mapId)};}
 function restore(snapshot:WorldSnapshot):boolean {
  if(!snapshot||typeof snapshot!=='object')return false;
  const legacy=snapshot.schemaVersion===undefined, old=legacy||snapshot.schemaVersion===2;
  if(!old&&snapshot.schemaVersion!==3&&snapshot.schemaVersion!==4&&snapshot.schemaVersion!==5&&snapshot.schemaVersion!==6&&snapshot.schemaVersion!==7&&snapshot.schemaVersion!==8)return false;
  const nextMap:MapId=old?'courtyard':snapshot.mapId!;
  const compatibleMap=(id:MapId)=>MAP_IDS.includes(id)&&(snapshot.schemaVersion===8||(snapshot.schemaVersion===7?['courtyard','warehouse','bridge','tower','cantilever'].includes(id):snapshot.schemaVersion===6?['courtyard','warehouse','bridge','tower'].includes(id):id==='courtyard'||id==='warehouse'));
  if(!compatibleMap(nextMap))return false;
  const bases=maps[nextMap], originals=new Map(bases.map(v=>[v.id,v]));
  const expectedTotal=legacy?1096:bases.length;
  if(!Number.isSafeInteger(snapshot.epoch)||snapshot.epoch<1||snapshot.epoch>=Number.MAX_SAFE_INTEGER||snapshot.totalCount!==expectedTotal||!Number.isSafeInteger(snapshot.destroyedCount)||snapshot.destroyedCount<0||snapshot.destroyedCount>expectedTotal||!Number.isSafeInteger(snapshot.research)||snapshot.research<0||typeof snapshot.firstRewardClaimed!=='boolean'||!Array.isArray(snapshot.voxels)||snapshot.voxels.length!==expectedTotal-snapshot.destroyedCount)return false;
  let completed:MapId[]=[];
  if(old){
   if(snapshot.destroyedCount/expectedTotal>=.8&&!snapshot.firstRewardClaimed)return false;
   if(snapshot.research<Math.floor(snapshot.destroyedCount*200/expectedTotal)+(snapshot.firstRewardClaimed?80:0))return false;
   if(snapshot.firstRewardClaimed)completed=['courtyard'];
  }else{
   if(!Array.isArray(snapshot.completedMaps)||snapshot.completedMaps.length>(snapshot.schemaVersion===8?7:snapshot.schemaVersion===7?5:snapshot.schemaVersion===6?4:2))return false;
   if(snapshot.completedMaps.some(id=>!compatibleMap(id))||new Set(snapshot.completedMaps).size!==snapshot.completedMaps.length)return false;
   completed=[...snapshot.completedMaps];
   if(snapshot.firstRewardClaimed!==completed.includes(nextMap)||snapshot.research<completed.length*80)return false;
  }
  const seen=new Set<number>();const next:Voxel[]=[];
  for(const v of snapshot.voxels){
   if(!v||!Number.isSafeInteger(v.id)||seen.has(v.id)||legacy&&v.id>=10000)return false;
   const base=originals.get(v.id);
   if(!base||!v.position||v.position.x!==base.position.x||v.position.y!==base.position.y||v.position.z!==base.position.z||v.material!==base.material||v.color!==base.color||v.maxHp!==base.maxHp||v.anchored!==base.anchored||!Number.isFinite(v.hp)||v.hp<=0||v.hp>base.maxHp)return false;
   if(!canonicalGeometry(v,base))return false;
   if(legacy ? (v.group!==undefined&&v.group!==base.group)||(v.objectId!==undefined&&v.objectId!==base.objectId) : v.group!==base.group||v.objectId!==base.objectId)return false;
   seen.add(v.id);next.push(immutable({...base,hp:v.hp}));
  }
  const spatial=spatialFor(bases);
  if((spatial?spatial.supported(next):supportedIds(next)).size!==next.length)return false;
  if(legacy)next.push(...bases.filter(v=>v.group!=='house'));
  const total=buildingWeight(bases);
  const nextBuildingDestroyed=total-buildingWeight(next);
  let nextRound=freshRound(snapshot.research,nextBuildingDestroyed);
  if(snapshot.schemaVersion===4||snapshot.schemaVersion===5||snapshot.schemaVersion===6||snapshot.schemaVersion===7||snapshot.schemaVersion===8){
   const saved=snapshot.round;
   if(!saved||!Number.isSafeInteger(saved.used)||saved.used<0||saved.used>saved.budget||typeof saved.settled!=='boolean'||!Number.isSafeInteger(saved.startResearch)||saved.startResearch<0||saved.startResearch>snapshot.research||!Number.isSafeInteger(saved.startDestroyed)||saved.startDestroyed<0||saved.startDestroyed>nextBuildingDestroyed)return false;
   if(snapshot.schemaVersion===4){
    if(saved.budget!==6)return false;
    // Old saves tracked successful executions, not weapon types. Preserve the
    // exact legacy capacity as grenades, including spent slots after a reload.
    nextRound={budget:6,used:saved.used,startResearch:saved.startResearch,startDestroyed:saved.startDestroyed,settled:saved.settled,loadout:{charge:6,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0},remaining:{charge:6-saved.used,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0}};
   }else{
    let {loadout,remaining}=saved;
    const ids:readonly WeaponId[]=snapshot.schemaVersion===5?['charge','pulse','shock']:snapshot.schemaVersion===6?['charge','pulse','shock','echo','split']:snapshot.schemaVersion===7?['charge','pulse','shock','echo','split','phase']:weaponIds;
    const exact=(value:unknown):value is Loadout=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===ids.length&&ids.every(id=>Object.hasOwn(value,id));
    // Validate the historical shape BEFORE adding new zero slots. Never refill.
    if(!exact(loadout)||!exact(remaining))return false;
    if(snapshot.schemaVersion===5){loadout={...loadout,echo:0,split:0,phase:0,heavy:0,nova:0};remaining={...remaining,echo:0,split:0,phase:0,heavy:0,nova:0};}
    if(snapshot.schemaVersion===6){loadout={...loadout,phase:0,heavy:0,nova:0};remaining={...remaining,phase:0,heavy:0,nova:0};}
    if(snapshot.schemaVersion===7){loadout={...loadout,heavy:0,nova:0};remaining={...remaining,heavy:0,nova:0};}
    const budgets=snapshot.schemaVersion===5?[6,8]:[6,8,10];
    if(!budgets.includes(saved.budget)||saved.budget>capacityForResearch(saved.startResearch)||!validateHistoricalLoadout(loadout,saved.startResearch)||inventoryCapacity(loadout)>saved.budget||!weaponIds.every(id=>Number.isSafeInteger(remaining![id])&&remaining![id]>=0&&remaining![id]<=loadout![id]))return false;
    if(saved.used!==inventoryCapacity(loadout)-inventoryCapacity(remaining))return false;
    nextRound={budget:saved.budget,used:saved.used,startResearch:saved.startResearch,startDestroyed:saved.startDestroyed,settled:saved.settled,loadout:{...loadout},remaining:{...remaining}};
   }
  }
  // Historical rewards and completion metadata are preserved, never re-awarded
  // or inferred from a threshold. Only intentional new rounds refill ammunition.
  mapId=nextMap;original=bases;voxels=Object.freeze(next);epoch=Math.max(epoch,snapshot.epoch)+1;destroyedCount=original.length-next.length;research=snapshot.research;round=nextRound;completedMaps.clear();for(const id of completed)completedMaps.add(id);processed.clear();return true;
 }
 // Build scaled-map support once during the transition, never on its first visible hit.
 function reset(){spatialFor(original);epoch++;voxels=Object.freeze([...original]);destroyedCount=0;round=freshRound(research);processed.clear();}
 function startRound(next:MapId,loadout:Loadout):boolean{
  if(!mapAvailable(next,research)||!validateLoadout(loadout,research))return false;
  const inventory={...loadout};
  mapId=next;original=maps[next];reset();
  round.loadout=inventory;round.remaining={...inventory};return true;
 }
 function loadMap(next:MapId,free=false){
  if(!mapAvailable(next,research,free))return false;
  mapId=next;original=maps[next];reset();return true;
 }
 return {get epoch(){return epoch;},getVoxels:()=>voxels,getRound:()=>cloneRound(round),startRound,recordShot,finishRound,damage,getSnapshot,getObjective,loadMap,restore,reset};
}
