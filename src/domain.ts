import type { DamageCommand, DamageResult, MaterialId, Vec3, Voxel, WorldModel, WorldSnapshot } from './contracts.js';

// Intentionally fictional game units, not a physical blast simulation.
const MATERIALS: Record<MaterialId, { hp: number; colors: number[] }> = {
 wood: { hp: 2, colors: [0x996238, 0xae7545, 0xc18a53, 0xb47a47] },
 stone: { hp: 5, colors: [0x626c70, 0x778080, 0x59666b] },
 roof: { hp: 2.4, colors: [0xa94633, 0xbc553d, 0x923b30] },
 glass: { hp: 0.6, colors: [0x8bc7cf, 0xa9dfe0] },
 foliage: { hp: 0.7, colors: [0x547436, 0x688b37, 0x7e9b42, 0x94ad4c] },
 metal: { hp: 6, colors: [0x3d4954, 0x515e65] },
};
const TOOLS = { pulse: { radius: 1.65, strength: 4.8 }, charge: { radius: 3.2, strength: 8 }, shock: { radius: 5.4, strength: 11 } };
const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
const clone = (v: Voxel): Voxel => ({ ...v, position: { ...v.position } });
const immutable = (v: Voxel): Voxel => Object.freeze({ ...v, position: Object.freeze({ ...v.position }) });
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

export function createWorld(): WorldModel {
 const house=cottage(); const props=yard(); const original=[...house,...props]; const originals=new Map(original.map(v=>[v.id,v])); const totalCount=original.length;
 let voxels: readonly Voxel[]=Object.freeze([...original]); let epoch=1, destroyedCount=0, research=0, firstRewardClaimed=false;
 const processed=new Set<string>();
 const result=(accepted=false):DamageResult=>({accepted,removed:[],detached:[],newlyDestroyed:0,researchEarned:0,destruction:destroyedCount/totalCount});
 function damage(command:DamageCommand):DamageResult {
  if(!command||typeof command.id!=='string'||command.id.length===0||command.id.length>160||command.epoch!==epoch||processed.has(command.id)||!Object.hasOwn(TOOLS,command.weapon)||!Number.isFinite(command.power)||command.power<=0||command.power>3||!command.target||![command.target.x,command.target.y,command.target.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=10000)) return result();
  processed.add(command.id);
  const tool=TOOLS[command.weapon], radius=tool.radius*Math.sqrt(command.power), removed:Voxel[]=[], survivors:Voxel[]=[];
  for(const v of voxels){
   const distance=Math.hypot(v.position.x-command.target.x,v.position.y-command.target.y,v.position.z-command.target.z);
   if(distance>radius){survivors.push(v);continue;}
   const hp=v.hp-tool.strength*command.power*(0.35+0.65*(1-distance/radius));
   if(hp<=0) removed.push(v); else survivors.push(immutable({...v,hp}));
  }
  const detached:Voxel[]=[];
  if(removed.length){
   const supported=supportedIds(survivors);
   voxels=Object.freeze(survivors.filter(v=>{if(supported.has(v.id))return true;detached.push(v);return false;}));
  } else voxels=Object.freeze(survivors);
  const newlyDestroyed=removed.length+detached.length;
  const priorBase=Math.floor(destroyedCount*200/totalCount); destroyedCount+=newlyDestroyed;
  let researchEarned=Math.floor(destroyedCount*200/totalCount)-priorBase;
  if(!firstRewardClaimed&&destroyedCount/totalCount>=0.8){firstRewardClaimed=true;researchEarned+=80;}
  research+=researchEarned;
  return {accepted:true,removed:removed.map(clone),detached:detached.map(clone),newlyDestroyed,researchEarned,destruction:destroyedCount/totalCount};
 }
 function getSnapshot():WorldSnapshot{return {schemaVersion:2,epoch,voxels:voxels.map(clone),totalCount,destroyedCount,research,firstRewardClaimed};}
 function restore(snapshot:WorldSnapshot):boolean {
  if(!snapshot||typeof snapshot!=='object')return false;
  // Unversioned saves belong only to the original 1096-voxel cottage, never the expanded scene.
  const legacy=snapshot.schemaVersion===undefined;
  if(!legacy&&snapshot.schemaVersion!==2)return false;
  const expectedTotal=legacy?house.length:totalCount;
  if(!Number.isSafeInteger(snapshot.epoch)||snapshot.epoch<1||snapshot.epoch>=Number.MAX_SAFE_INTEGER||snapshot.totalCount!==expectedTotal||!Number.isSafeInteger(snapshot.destroyedCount)||snapshot.destroyedCount<0||snapshot.destroyedCount>expectedTotal||!Number.isSafeInteger(snapshot.research)||snapshot.research<0||typeof snapshot.firstRewardClaimed!=='boolean'||!Array.isArray(snapshot.voxels)||snapshot.voxels.length!==expectedTotal-snapshot.destroyedCount||snapshot.destroyedCount/expectedTotal>=0.8&&!snapshot.firstRewardClaimed)return false;
  if(snapshot.research<Math.floor(snapshot.destroyedCount*200/expectedTotal)+(snapshot.firstRewardClaimed?80:0))return false;
  const seen=new Set<number>();const next:Voxel[]=[];
  for(const v of snapshot.voxels){
   if(!v||!Number.isSafeInteger(v.id)||seen.has(v.id)||legacy&&v.id>=10000)return false;
   const base=originals.get(v.id);
   if(!base||!v.position||v.position.x!==base.position.x||v.position.y!==base.position.y||v.position.z!==base.position.z||v.material!==base.material||v.color!==base.color||v.maxHp!==base.maxHp||v.anchored!==base.anchored||!Number.isFinite(v.hp)||v.hp<=0||v.hp>base.maxHp)return false;
   if(legacy ? (v.group!==undefined&&v.group!==base.group)||(v.objectId!==undefined&&v.objectId!==base.objectId) : v.group!==base.group||v.objectId!==base.objectId)return false;
   seen.add(v.id);next.push(immutable({...base,hp:v.hp}));
  }
  if(supportedIds(next).size!==next.length)return false;
  if(legacy)next.push(...props);
  voxels=Object.freeze(next);epoch=Math.max(epoch,snapshot.epoch)+1;destroyedCount=snapshot.destroyedCount;research=snapshot.research;firstRewardClaimed=snapshot.firstRewardClaimed;processed.clear();return true;
 }

 return {get epoch(){return epoch;},getVoxels:()=>voxels,damage,getSnapshot,restore,reset(){epoch++;voxels=Object.freeze([...original]);destroyedCount=0;processed.clear();}};
}
