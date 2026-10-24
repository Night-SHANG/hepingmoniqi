import type {MapId,Voxel} from '../contracts.js';
import {createMapVoxels} from '../domain.js';
import {WORLD_BOUNDS} from '../world-layout.js';
import {createStructuralFixture} from './fixtures.js';
import type {Cell,CellView,SceneFixture} from './types.js';

export interface GameCell extends Cell { group?:Voxel['group']; objective:boolean; }
export interface GameFixture extends SceneFixture { cells:GameCell[]; }
/** Finite game geology. Every layer, including boundary roots, can be excavated.
 * One ordinary blast leaves real lower soil, while repeated blasts can open a
 * full-depth hole. These are fictional gameplay HP, not physical rock values. */
export const GAME_SOIL_HP=Object.freeze([3.2,5.5,9,14,21,30,42,58]);
const location=(x:number,y:number,z:number)=>`${x},${y},${z}`;
const column=(x:number,z:number)=>`${x},${z}`;

export function createGameFixture(map:MapId):GameFixture {return buildGameFixture(map,true);}
/** Historical geometry only for strict old-save validation, never live play. */
export function createLegacyGameFixture(map:MapId):GameFixture {return buildGameFixture(map,false);}

function buildGameFixture(map:MapId,continuous:boolean):GameFixture {
 const large=map==='neighborhood'||map==='city';
 const source=large?createStructuralFixture(map).cells:[];
 const cells:GameCell[]=large?source.filter(c=>c.role!=='terrain').map(c=>({...c,position:{...c.position},anchor:undefined,objective:c.role==='building'||c.role==='foundation',group:c.role==='tree'?'tree':c.role==='building'||c.role==='foundation'?'house':undefined})):createMapVoxels(map).map(v=>({id:v.id,position:{...v.position},objectId:v.objectId??`legacy:${v.id}`,role:v.group==='tree'?'tree':v.group==='house'&&v.position.y===0?'foundation':map==='bridge'&&v.group==='house'?'bridge':'building',material:v.material,color:v.color,hp:v.hp,maxHp:v.maxHp,group:v.group,objective:v.group==='house'}));
 const soilColumns=new Map<string,{x:number;z:number}>();
 if(large){for(const c of source)if(c.role==='terrain')soilColumns.set(column(c.position.x,c.position.z),{x:c.position.x,z:c.position.z});}
 else{
  const {halfX,halfZ}=WORLD_BOUNDS[map];
  for(let x=-halfX;x<=halfX;x++)for(let z=-halfZ;z<=halfZ;z++)soilColumns.set(column(x,z),{x,z});
  const occupied=new Set(cells.map(c=>location(c.position.x,c.position.y,c.position.z)));
  let roadId=-1_000_000;
  const road=(x:number,z:number)=>{if(occupied.has(location(x,0,z)))return;occupied.add(location(x,0,z));cells.push({id:roadId--,objectId:`game:${map}:road`,role:'road',material:'road',color:[0x6f675c,0x807366,0x71695f][Math.abs(x*7+z*11)%3],position:{x,y:0,z},hp:4,maxHp:4,objective:false});};
  for(let x=-25;x<=25;x++)for(let z=-11;z<=-9;z++)road(x,z);
  for(let x=-1;x<=1;x++)for(let z=10;z<=19;z++)road(x,z);
 }
 // Retain every existing soil ID, including deep layers, by appending the
 // added-column block after all eight layers of the original plots. Formal
 // maps fill the WHOLE published playable rectangle, not isolated lab pads.
 const originalPoints=[...soilColumns.values()],addedPoints:{x:number;z:number}[]=[];
 const {halfX,halfZ}=WORLD_BOUNDS[map];
 if(large&&continuous)for(let x=-halfX;x<=halfX;x++)for(let z=-halfZ;z<=halfZ;z++){
  const key=column(x,z);if(soilColumns.has(key))continue;
  const point={x,z};soilColumns.set(key,point);addedPoints.push(point);
 }
 const extent=continuous||!large?{minX:-halfX,maxX:halfX,minZ:-halfZ,maxZ:halfZ}:originalPoints.reduce((b,p)=>({minX:Math.min(b.minX,p.x),maxX:Math.max(b.maxX,p.x),minZ:Math.min(b.minZ,p.z),maxZ:Math.max(b.maxZ,p.z)}),{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity});
 let soilId=-1;
 for(const points of [originalPoints,addedPoints])for(let depth=1;depth<=GAME_SOIL_HP.length;depth++)for(const {x,z} of points){
  const hp=GAME_SOIL_HP[depth-1],y=-depth;
  const color=depth===1?[0x8b9650,0x9aa45a,0x778448][Math.abs(x*7+z*11)%3]:[0x775238,0x8b6240,0x9a7048][Math.abs(x*73+y*31+z*17)%3];
  cells.push({id:soilId--,objectId:`game:${map}:geology`,role:'terrain',position:{x,y,z},material:'soil',color,hp,maxHp:hp,objective:false,...(depth===GAME_SOIL_HP.length&&(x===extent.minX||x===extent.maxX||z===extent.minZ||z===extent.maxZ)?{anchor:true}:{})});
 }
 return {id:`structural-game:v09:${map}:soil-${GAME_SOIL_HP.length}`,cells};
}

export function gameCellVoxel(cell:GameCell|CellView,metadata?:GameCell):Voxel {
 const meta=metadata??cell as GameCell;
 return {id:cell.id,objectId:cell.objectId,position:{...cell.position},rotation:'rotation'in cell?{...cell.rotation}:{x:0,y:0,z:0,w:1},structuralState:'state'in cell&&cell.state!=='gone'?cell.state:'static',role:cell.role,material:cell.material==='soil'||cell.material==='road'?'stone':cell.material,color:cell.color,hp:cell.hp,maxHp:cell.maxHp,anchored:cell.anchor===true,size:{x:1,y:1,z:1},group:meta.group};
}

/** Setup previews do not initialize Rapier or create a physics world. */
export function previewGameVoxels(map:MapId):readonly Voxel[]{return createGameFixture(map).cells.map(c=>gameCellVoxel(c));}
