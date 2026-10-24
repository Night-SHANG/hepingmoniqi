/** Compact authority inventory. The established structure-only recipe below is
 * ported from the local support-ab proof; terrain ranking and typed columns are
 * ported from the terrain/structure-store proofs. No physics/world ownership. */
import type {MapId,Voxel} from '../contracts.js';
import {createMapVoxels} from '../domain.js';
import {WORLD_BOUNDS} from '../world-layout.js';
import {GAME_SOIL_HP} from '../structural/game-fixtures.js';
import type {GameCell} from '../structural/game-fixtures.js';
import type {Cell,Matter,Point,SceneFixture} from '../structural/types.js';

export type CompactCell = Cell & Partial<Pick<GameCell,'objective'|'group'>>;
export interface CompactBounds {minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number}
export interface CompactFixture {
 readonly kind:'compact-fixture'|'dense-fixture';readonly id:string;readonly map?:MapId;readonly version:string;readonly recipeId:string;
 readonly count:number;readonly structureCount:number;readonly terrainCount:number;readonly totalHp:number;readonly objectiveCount:number;readonly minY:number;readonly bounds:Readonly<CompactBounds>;
 readonly initialGoneCount:number;readonly initialObjectiveDeparted:number;
 original(id:number):CompactCell|undefined;originalPosition(id:number):Point|undefined;
 ordinal(id:number):number;idAtOrdinal(ordinal:number):number|undefined;idAt(x:number,y:number,z:number):number|null;
 xOf(id:number):number;yOf(id:number):number;zOf(id:number):number;
 hpOf(id:number):number;maxHpOf(id:number):number;colorOf(id:number):number;
 materialOf(id:number):Matter|undefined;roleOf(id:number):Cell['role']|undefined;objectIdOf(id:number):string|undefined;
 anchorOf(id:number):boolean|undefined;objectiveOf(id:number):boolean;groupOf(id:number):Voxel['group'];
 neighbor(id:number,dx:number,dy:number,dz:number):number|null;
 idsInBounds(bounds:CompactBounds):number[];idsInSphere(center:Point,radius:number):number[];idsInChunk(key:string):number[];
 forEachChunk(size:number,visit:(x:number,y:number,z:number)=>void):void;chunkKeys():Iterable<string>;
 /** Explicit diagnostic/test-only full inventory traversal. Runtime uses bounded IDs/scalars. */
 diagnosticCells():IterableIterator<CompactCell>;
 diagnostics():{retainedCellObjects:number;terrainCellObjects:number;typedBytes:number;internedObjectIds:number};
}
const MATTER: Matter[]=['soil','road','wood','stone','roof','glass','foliage','metal'];
const ROLES:Cell['role'][]=['terrain','road','foundation','building','tree','bridge'];
const GROUPS:Voxel['group'][]=[undefined,'house','tree','fence','crate','table','planter','logs'];
const finiteBounds=(b:CompactBounds)=>Object.values(b).every(Number.isFinite)&&b.minX<=b.maxX&&b.minY<=b.maxY&&b.minZ<=b.maxZ;
const validPoint=(p:Point)=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z);
const chunk=(p:Point,size=8)=>`${Math.floor(p.x/size)},${Math.floor(p.y/size)},${Math.floor(p.z/size)}`;

/** Immutable source-order columns. Query indices are numeric permutations, not
 * cell/position maps. HP deliberately stays Float64, including fractional HP. */
class StructureColumns {
 readonly ids:Float64Array;readonly x:Float64Array;readonly y:Float64Array;readonly z:Float64Array;
 readonly hp:Float64Array;readonly maxHp:Float64Array;readonly color:Uint32Array;
 readonly object:Uint32Array;readonly material:Uint8Array;readonly role:Uint8Array;
 readonly anchor:Uint8Array;readonly group:Uint8Array;readonly flags:Uint8Array;
 readonly idOrder:Uint32Array;readonly positionOrder:Uint32Array;readonly objects:string[]=[];
 constructor(source:readonly GameCell[]){
  const n=source.length;this.ids=new Float64Array(n);this.x=new Float64Array(n);this.y=new Float64Array(n);this.z=new Float64Array(n);this.hp=new Float64Array(n);this.maxHp=new Float64Array(n);this.color=new Uint32Array(n);this.object=new Uint32Array(n);this.material=new Uint8Array(n);this.role=new Uint8Array(n);this.anchor=new Uint8Array(n);this.group=new Uint8Array(n);this.flags=new Uint8Array(n);this.idOrder=new Uint32Array(n);this.positionOrder=new Uint32Array(n);
  const objectIds=new Map<string,number>();
  for(let i=0;i<n;i++){
   const c=source[i];if(!Number.isSafeInteger(c.id)||!validPoint(c.position)||!Number.isFinite(c.hp)||!Number.isFinite(c.maxHp)||c.hp<0||c.maxHp<=0||c.hp>c.maxHp||!MATTER.includes(c.material)||!ROLES.includes(c.role))throw new Error('Invalid immutable compact cell');
   this.ids[i]=c.id;this.x[i]=c.position.x;this.y[i]=c.position.y;this.z[i]=c.position.z;this.hp[i]=c.hp;this.maxHp[i]=c.maxHp;this.color[i]=c.color;this.material[i]=MATTER.indexOf(c.material);this.role[i]=ROLES.indexOf(c.role);this.group[i]=GROUPS.indexOf(c.group);this.anchor[i]=c.anchor===undefined?0:c.anchor?2:1;this.flags[i]=(c.objective?1:0)|('anchor'in c?2:0)|('group'in c?4:0);let index=objectIds.get(c.objectId);if(index===undefined){index=this.objects.length;objectIds.set(c.objectId,index);this.objects.push(c.objectId);}this.object[i]=index;this.idOrder[i]=i;this.positionOrder[i]=i;
  }
  this.idOrder.sort((a,b)=>this.ids[a]-this.ids[b]);this.positionOrder.sort((a,b)=>this.x[a]-this.x[b]||this.y[a]-this.y[b]||this.z[a]-this.z[b]);
  for(let i=1;i<n;i++)if(this.ids[this.idOrder[i]]===this.ids[this.idOrder[i-1]])throw new Error('Duplicate compact cell ID');
 }
 index(id:number){let lo=0,hi=this.ids.length;while(lo<hi){const mid=(lo+hi)>>>1;if(this.ids[this.idOrder[mid]]<id)lo=mid+1;else hi=mid;}return lo<this.ids.length&&this.ids[this.idOrder[lo]]===id?this.idOrder[lo]:-1;}
 at(x:number,y:number,z:number){let lo=0,hi=this.ids.length;while(lo<hi){const mid=(lo+hi)>>>1,i=this.positionOrder[mid],diff=this.x[i]-x||this.y[i]-y||this.z[i]-z;if(diff<0)lo=mid+1;else hi=mid;}if(lo===this.ids.length)return -1;const i=this.positionOrder[lo];return this.x[i]===x&&this.y[i]===y&&this.z[i]===z?i:-1;}
 cell(i:number):GameCell{return {id:this.ids[i],objectId:this.objects[this.object[i]],role:ROLES[this.role[i]],position:{x:this.x[i],y:this.y[i],z:this.z[i]},material:MATTER[this.material[i]],color:this.color[i],hp:this.hp[i],maxHp:this.maxHp[i],...(this.flags[i]&2?{anchor:this.anchor[i]?this.anchor[i]===2:undefined}:{}),objective:!!(this.flags[i]&1),...(this.flags[i]&4?{group:GROUPS[this.group[i]]}:{})};}
 indicesInBounds(b:CompactBounds){let lo=0,hi=this.ids.length;while(lo<hi){const mid=(lo+hi)>>>1;if(this.x[this.positionOrder[mid]]<b.minX)lo=mid+1;else hi=mid;}const result:number[]=[];for(let rank=lo;rank<this.ids.length;rank++){const i=this.positionOrder[rank];if(this.x[i]>b.maxX)break;if(this.y[i]>=b.minY&&this.y[i]<=b.maxY&&this.z[i]>=b.minZ&&this.z[i]<=b.maxZ)result.push(i);}return result.sort((a,b)=>a-b);}
 bytes(){return [this.ids,this.x,this.y,this.z,this.hp,this.maxHp,this.color,this.object,this.material,this.role,this.anchor,this.group,this.flags,this.idOrder,this.positionOrder].reduce((n,a)=>n+a.byteLength,0);}
}

/** Historical two-block negative soil IDs, implicit at all eight finite layers. */
class SoilInventory {
 readonly count:number;readonly columns:number;readonly oldColumns:number;private readonly rank?:Int32Array;private readonly column?:Int32Array;readonly depth:number;
 constructor(readonly map:MapId,readonly bounds:CompactBounds,originalColumns?:readonly {x:number;z:number}[]){
  this.depth=bounds.maxZ-bounds.minZ+1;this.columns=(bounds.maxX-bounds.minX+1)*this.depth;this.count=this.columns*GAME_SOIL_HP.length;
  this.oldColumns=originalColumns?.length??this.columns;
  if(originalColumns){this.rank=new Int32Array(this.columns).fill(-1);this.column=new Int32Array(this.columns);let rank=0;for(const p of originalColumns){const col=(p.x-bounds.minX)*this.depth+p.z-bounds.minZ;this.rank[col]=rank;this.column[rank++]=col;}for(let col=0;col<this.columns;col++)if(this.rank[col]===-1){this.rank[col]=rank;this.column[rank++]=col;}}
 }
 contains(id:number){return Number.isSafeInteger(id)&&id<0&&-id<=this.count;}
 private columnFor(id:number){const n=-id-1,old=this.oldColumns,prior=n<old*8,offset=prior?n:n-old*8,size=prior?old:this.columns-old,rank=offset%size+(prior?0:old);return this.column?.[rank]??rank;}
 x(id:number){return this.bounds.minX+Math.floor(this.columnFor(id)/this.depth);}y(id:number){const n=-id-1,old=this.oldColumns;return -(n<old*8?Math.floor(n/old)+1:Math.floor((n-old*8)/(this.columns-old))+1);}z(id:number){return this.bounds.minZ+this.columnFor(id)%this.depth;}
 position(id:number):Point{return {x:this.x(id),y:this.y(id),z:this.z(id)};}
 idAt(x:number,y:number,z:number):number|null{const b=this.bounds;if(![x,y,z].every(Number.isSafeInteger)||x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ||y> -1||y< -8)return null;const col=(x-b.minX)*this.depth+z-b.minZ,rank=this.rank?.[col]??col,d=-y-1,old=this.oldColumns;return rank<old?-(1+d*old+rank):-(1+8*old+d*(this.columns-old)+rank-old);}
 color(id:number){const p=this.position(id);return p.y===-1?[0x8b9650,0x9aa45a,0x778448][Math.abs(p.x*7+p.z*11)%3]:[0x775238,0x8b6240,0x9a7048][Math.abs(p.x*73+p.y*31+p.z*17)%3];}
 anchor(id:number){const p=this.position(id),b=this.bounds;return p.y===-8&&(p.x===b.minX||p.x===b.maxX||p.z===b.minZ||p.z===b.maxZ)?true:undefined;}
 cell(id:number):GameCell{const p=this.position(id),hp=GAME_SOIL_HP[-p.y-1],anchor=this.anchor(id);return {id,objectId:`game:${this.map}:geology`,role:'terrain',position:p,material:'soil',color:this.color(id),hp,maxHp:hp,objective:false,...(anchor?{anchor}:{} )};}
 bytes(){return (this.rank?.byteLength??0)+(this.column?.byteLength??0);}
 forEachColumn(visit:(x:number,z:number)=>void){for(let rank=0;rank<this.columns;rank++){const col=this.column?.[rank]??rank;visit(this.bounds.minX+Math.floor(col/this.depth),this.bounds.minZ+col%this.depth);}}
}

abstract class FixtureQueries implements CompactFixture {
 abstract readonly kind:CompactFixture['kind'];abstract readonly id:string;readonly map?:MapId;abstract readonly version:string;abstract readonly recipeId:string;abstract readonly count:number;abstract readonly structureCount:number;abstract readonly terrainCount:number;abstract readonly totalHp:number;abstract readonly objectiveCount:number;abstract readonly minY:number;abstract readonly bounds:Readonly<CompactBounds>;abstract readonly initialGoneCount:number;abstract readonly initialObjectiveDeparted:number;
 abstract original(id:number):CompactCell|undefined;abstract ordinal(id:number):number;abstract idAtOrdinal(n:number):number|undefined;abstract idAt(x:number,y:number,z:number):number|null;abstract xOf(id:number):number;abstract yOf(id:number):number;abstract zOf(id:number):number;abstract hpOf(id:number):number;abstract maxHpOf(id:number):number;abstract colorOf(id:number):number;abstract materialOf(id:number):Matter|undefined;abstract roleOf(id:number):Cell['role']|undefined;abstract objectIdOf(id:number):string|undefined;abstract anchorOf(id:number):boolean|undefined;abstract objectiveOf(id:number):boolean;abstract groupOf(id:number):Voxel['group'];abstract idsInBounds(b:CompactBounds):number[];abstract forEachChunk(size:number,visit:(x:number,y:number,z:number)=>void):void;abstract diagnostics():ReturnType<CompactFixture['diagnostics']>;
 originalPosition(id:number):Point|undefined{return this.ordinal(id)<0?undefined:{x:this.xOf(id),y:this.yOf(id),z:this.zOf(id)};}
 neighbor(id:number,dx:number,dy:number,dz:number):number|null{const p=this.originalPosition(id);return p?this.idAt(p.x+dx,p.y+dy,p.z+dz):null;}
 idsInSphere(p:Point,r:number):number[]{if(!validPoint(p)||!Number.isFinite(r)||r<0)return [];return this.idsInBounds({minX:p.x-r,maxX:p.x+r,minY:p.y-r,maxY:p.y+r,minZ:p.z-r,maxZ:p.z+r}).filter(id=>Math.hypot(this.xOf(id)-p.x,this.yOf(id)-p.y,this.zOf(id)-p.z)<=r);}
 idsInChunk(key:string){const v=key.split(',').map(Number);if(v.length!==3||!v.every(Number.isSafeInteger))return [];const [x,y,z]=v;return this.idsInBounds({minX:x*8,maxX:(x+1)*8,minY:y*8,maxY:(y+1)*8,minZ:z*8,maxZ:(z+1)*8}).filter(id=>Math.floor(this.xOf(id)/8)===x&&Math.floor(this.yOf(id)/8)===y&&Math.floor(this.zOf(id)/8)===z);}
 chunkKeys(){const keys:string[]=[];this.forEachChunk(8,(x,y,z)=>keys.push(`${x},${y},${z}`));return keys;}
 *diagnosticCells(){for(let i=0;i<this.count;i++)yield this.original(this.idAtOrdinal(i)!)!;}
}

class GameInventory extends FixtureQueries {
 readonly kind='compact-fixture' as const;readonly version='compact-game/v1';readonly id:string;readonly recipeId:string;readonly count:number;readonly structureCount:number;readonly terrainCount:number;readonly totalHp:number;readonly objectiveCount:number;readonly minY=-8;readonly bounds:Readonly<CompactBounds>;readonly initialGoneCount=0;readonly initialObjectiveDeparted=0;
 private readonly structures:StructureColumns;private readonly soil:SoilInventory;
 constructor(readonly map:MapId,source:GameCell[],columns?:readonly {x:number;z:number}[]){
  super();this.id=`structural-game:v09:${map}:soil-8`;this.recipeId=`heping-v09:compact-game:1:${map}:warm-recipe-1:soil-8`;
  const {halfX,halfZ}=WORLD_BOUNDS[map];let maxY= -1;for(const c of source)maxY=Math.max(maxY,c.position.y);this.bounds=Object.freeze({minX:-halfX,maxX:halfX,minY:-8,maxY,minZ:-halfZ,maxZ:halfZ});
  this.structures=new StructureColumns(source);this.soil=new SoilInventory(map,this.bounds,columns);this.structureCount=source.length;this.terrainCount=this.soil.count;this.count=this.structureCount+this.terrainCount;this.totalHp=source.reduce((n,c)=>n+c.hp,0);this.objectiveCount=source.reduce((n,c)=>n+(c.objective?1:0),0);
 }
 ordinal(id:number){if(this.soil.contains(id))return this.structureCount-id-1;return this.structures.index(id);}
 idAtOrdinal(n:number){return Number.isSafeInteger(n)&&n>=0&&n<this.count?n<this.structureCount?this.structures.ids[n]:-(n-this.structureCount+1):undefined;}
 original(id:number){if(this.soil.contains(id))return this.soil.cell(id);const i=this.structures.index(id);return i<0?undefined:this.structures.cell(i);}
 idAt(x:number,y:number,z:number){const ground=this.soil.idAt(x,y,z);if(ground!==null)return ground;const i=this.structures.at(x,y,z);return i<0?null:this.structures.ids[i];}
 xOf(id:number){return this.soil.contains(id)?this.soil.x(id):this.structures.x[this.structures.index(id)];}yOf(id:number){return this.soil.contains(id)?this.soil.y(id):this.structures.y[this.structures.index(id)];}zOf(id:number){return this.soil.contains(id)?this.soil.z(id):this.structures.z[this.structures.index(id)];}
 hpOf(id:number){return this.soil.contains(id)?GAME_SOIL_HP[-this.soil.y(id)-1]:this.structures.hp[this.structures.index(id)];}maxHpOf(id:number){return this.soil.contains(id)?this.hpOf(id):this.structures.maxHp[this.structures.index(id)];}colorOf(id:number){return this.soil.contains(id)?this.soil.color(id):this.structures.color[this.structures.index(id)];}
 materialOf(id:number){return this.soil.contains(id)?'soil' as const:MATTER[this.structures.material[this.structures.index(id)]];}roleOf(id:number){return this.soil.contains(id)?'terrain' as const:ROLES[this.structures.role[this.structures.index(id)]];}objectIdOf(id:number){return this.soil.contains(id)?`game:${this.map}:geology`:this.structures.objects[this.structures.object[this.structures.index(id)]];}
 anchorOf(id:number){if(this.soil.contains(id))return this.soil.anchor(id);const a=this.structures.anchor[this.structures.index(id)];return a?a===2:undefined;}objectiveOf(id:number){return !this.soil.contains(id)&&!!(this.structures.flags[this.structures.index(id)]&1);}groupOf(id:number){return this.soil.contains(id)?undefined:GROUPS[this.structures.group[this.structures.index(id)]];}
 idsInBounds(b:CompactBounds){if(!finiteBounds(b))return [];const ids=this.structures.indicesInBounds(b).map(i=>this.structures.ids[i]),ground:number[]=[];const bounds=this.bounds;for(let x=Math.max(bounds.minX,Math.ceil(b.minX));x<=Math.min(bounds.maxX,Math.floor(b.maxX));x++)for(let y=Math.max(-8,Math.ceil(b.minY));y<=Math.min(-1,Math.floor(b.maxY));y++)for(let z=Math.max(bounds.minZ,Math.ceil(b.minZ));z<=Math.min(bounds.maxZ,Math.floor(b.maxZ));z++)ground.push(this.soil.idAt(x,y,z)!);ground.sort((a,b)=>b-a);return ids.concat(ground);}
 forEachChunk(size:number,visit:(x:number,y:number,z:number)=>void){if(!Number.isSafeInteger(size)||size<=0)throw new Error('Invalid chunk size');const seen=new Set<string>();const put=(x:number,y:number,z:number)=>{const cx=Math.floor(x/size),cy=Math.floor(y/size),cz=Math.floor(z/size),key=`${cx},${cy},${cz}`;if(!seen.has(key)){seen.add(key);visit(cx,cy,cz);}};const s=this.structures;for(let i=0;i<s.ids.length;i++)put(s.x[i],s.y[i],s.z[i]);const b=this.bounds;for(let cx=Math.floor(b.minX/size);cx<=Math.floor(b.maxX/size);cx++)for(let cy=Math.floor(-8/size);cy<=Math.floor(-1/size);cy++)for(let cz=Math.floor(b.minZ/size);cz<=Math.floor(b.maxZ/size);cz++)put(cx*size,cy*size,cz*size);}
 diagnostics(){return {retainedCellObjects:0,terrainCellObjects:0,typedBytes:this.structures.bytes()+this.soil.bytes(),internedObjectIds:this.structures.objects.length+1};}
}

/** Dense compatibility adapter only: preserves generic fixtures and arbitrary
 * extra metadata. The game path never invokes this adapter. */
class DenseInventory extends FixtureQueries {
 readonly kind='dense-fixture' as const;readonly version='dense-fixture/v1';readonly recipeId:string;readonly id:string;readonly count:number;readonly structureCount:number;readonly terrainCount:number;readonly totalHp:number;readonly objectiveCount:number;readonly minY:number;readonly bounds:Readonly<CompactBounds>;readonly initialGoneCount:number;readonly initialObjectiveDeparted:number;
 private readonly cells:CompactCell[];private readonly ordinals:Map<number,number>;private readonly positions:Map<string,number>;
 constructor(source:SceneFixture){super();if(!source||typeof source.id!=='string'||!source.id||!Array.isArray(source.cells))throw new Error('Invalid dense fixture');this.id=source.id;this.cells=structuredClone(source.cells);this.ordinals=new Map();this.positions=new Map();let total=0,objectives=0,terrain=0,gone=0,objectiveDeparted=0;const b={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity};for(let i=0;i<this.cells.length;i++){const c=this.cells[i];if(!Number.isSafeInteger(c.id)||this.ordinals.has(c.id)||!validPoint(c.position)||!Number.isFinite(c.hp)||c.hp<0||!Number.isFinite(c.maxHp)||c.maxHp<=0||c.hp>c.maxHp||!MATTER.includes(c.material))throw new Error('Invalid dense fixture cell');this.ordinals.set(c.id,i);this.positions.set(`${c.position.x},${c.position.y},${c.position.z}`,c.id);if(c.role==='terrain')terrain++;else total+=c.hp;if(c.objective)objectives++;if(c.hp<=0){gone++;if(c.objective)objectiveDeparted++;}for(const axis of ['X','Y','Z'] as const){const v=c.position[axis.toLowerCase() as 'x'|'y'|'z'];b[`min${axis}`]=Math.min(b[`min${axis}`],v);b[`max${axis}`]=Math.max(b[`max${axis}`],v);}}this.count=this.cells.length;this.structureCount=this.count-terrain;this.terrainCount=terrain;this.totalHp=total;this.objectiveCount=objectives;this.initialGoneCount=gone;this.initialObjectiveDeparted=objectiveDeparted;this.minY=this.count?b.minY:0;this.bounds=Object.freeze(this.count?b:{minX:0,maxX:-1,minY:0,maxY:-1,minZ:0,maxZ:-1});this.recipeId=JSON.stringify(this.cells);}
 private cell(id:number){const i=this.ordinals.get(id);return i===undefined?undefined:this.cells[i];}
 original(id:number){const c=this.cell(id);return c?structuredClone(c):undefined;}ordinal(id:number){return this.ordinals.get(id)??-1;}idAtOrdinal(n:number){return this.cells[n]?.id;}idAt(x:number,y:number,z:number){return this.positions.get(`${x},${y},${z}`)??null;}
 xOf(id:number){return this.cell(id)?.position.x??NaN;}yOf(id:number){return this.cell(id)?.position.y??NaN;}zOf(id:number){return this.cell(id)?.position.z??NaN;}hpOf(id:number){return this.cell(id)?.hp??NaN;}maxHpOf(id:number){return this.cell(id)?.maxHp??NaN;}colorOf(id:number){return this.cell(id)?.color??NaN;}materialOf(id:number){return this.cell(id)?.material;}roleOf(id:number){return this.cell(id)?.role;}objectIdOf(id:number){return this.cell(id)?.objectId;}anchorOf(id:number){return this.cell(id)?.anchor;}objectiveOf(id:number){return this.cell(id)?.objective===true;}groupOf(id:number){return this.cell(id)?.group;}
 idsInBounds(b:CompactBounds){return finiteBounds(b)?this.cells.filter(c=>c.position.x>=b.minX&&c.position.x<=b.maxX&&c.position.y>=b.minY&&c.position.y<=b.maxY&&c.position.z>=b.minZ&&c.position.z<=b.maxZ).map(c=>c.id):[];}
 forEachChunk(size:number,visit:(x:number,y:number,z:number)=>void){if(!Number.isSafeInteger(size)||size<=0)throw new Error('Invalid chunk size');const seen=new Set<string>();for(const c of this.cells){const key=chunk(c.position,size);if(seen.has(key))continue;seen.add(key);visit(Math.floor(c.position.x/size),Math.floor(c.position.y/size),Math.floor(c.position.z/size));}}
 diagnostics(){return {retainedCellObjects:this.count,terrainCellObjects:this.terrainCount,typedBytes:0,internedObjectIds:0};}
}
export function createDenseFixture(fixture:SceneFixture):CompactFixture{return new DenseInventory(fixture);}

export function createCompactGameFixture(map:MapId):CompactFixture {
 if(!(map in WORLD_BOUNDS))throw new Error('Unknown game map');
 if(map==='neighborhood'||map==='city'){
  const source=sparseStructureFixture(map);
  const cells:GameCell[]=source.cells.map(c=>({...c,anchor:undefined,objective:c.role==='building'||c.role==='foundation',group:c.role==='tree'?'tree':c.role==='building'||c.role==='foundation'?'house':undefined}));
  return new GameInventory(map,cells,source.originalColumns);
 }
 const cells:GameCell[]=createMapVoxels(map).map(v=>({id:v.id,position:{...v.position},objectId:v.objectId??`legacy:${v.id}`,role:v.group==='tree'?'tree':v.group==='house'&&v.position.y===0?'foundation':map==='bridge'&&v.group==='house'?'bridge':'building',material:v.material,color:v.color,hp:v.hp,maxHp:v.maxHp,group:v.group,objective:v.group==='house'}));
 const occupied=new Set(cells.map(c=>`${c.position.x},${c.position.y},${c.position.z}`));let roadId=-1_000_000;
 const road=(x:number,z:number)=>{const k=`${x},0,${z}`;if(occupied.has(k))return;occupied.add(k);cells.push({id:roadId--,objectId:`game:${map}:road`,role:'road',material:'road',color:[0x6f675c,0x807366,0x71695f][Math.abs(x*7+z*11)%3],position:{x,y:0,z},hp:4,maxHp:4,objective:false});};
 for(let x=-25;x<=25;x++)for(let z=-11;z<=-9;z++)road(x,z);for(let x=-1;x<=1;x++)for(let z=10;z<=19;z++)road(x,z);
 return new GameInventory(map,cells);
}

type StructureMap = 'lab' | 'neighborhood' | 'city';
type Role = Cell['role'];
interface Building { objectId: string; variant: number; width: number; depth: number; floors: number; x: number; z: number; turns: number }
interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

// Original warm cottage palette and layouts, adapted from warm-voxel-scale-spike.
// All previous 2 × 1 × 2 merged floors are individual authoritative unit cells here.
const materials: Record<Matter, { hp: number; colors: number[] }> = {
  soil: { hp: 3.2, colors: [0x775238, 0x8b6240, 0x9a7048] },
  road: { hp: 4, colors: [0x6f675c, 0x807366, 0x71695f] },
  wood: { hp: 2, colors: [0x996238, 0xae7545, 0xc18a53, 0xb47a47] },
  stone: { hp: 5, colors: [0x626c70, 0x778080, 0x59666b] },
  roof: { hp: 2.4, colors: [0xa94633, 0xbc553d, 0x923b30] },
  glass: { hp: .6, colors: [0x8bc7cf, 0xa9dfe0] },
  foliage: { hp: .7, colors: [0x547436, 0x688b37, 0x7e9b42, 0x94ad4c] },
  metal: { hp: 6, colors: [0x3d4954, 0x515e65] },
};
const variants = [[8, 10, 1], [10, 12, 2], [12, 8, 1], [14, 12, 3], [10, 16, 2], [16, 14, 4], [12, 16, 3], [14, 10, 5], [16, 16, 5]] as const;
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const horizontalKey = (x: number, z: number) => `${x},${z}`;
const rotate = (x: number, z: number, turns: number): [number, number] =>
  turns === 1 ? [-z, x] : turns === 2 ? [-x, -z] : turns === 3 ? [z, -x] : [x, z];

function placements(map: StructureMap): Building[] {
  const result: Building[] = [];
  const put = (variant: number, x: number, z: number, turns: number) => {
    const [width, depth, floors] = variants[variant];
    result.push({ objectId: `warm:${map}:building-${String(result.length + 1).padStart(2, '0')}`, variant, width, depth, floors, x, z, turns });
  };
  if (map === 'lab') { put(0, -8, -3, 0); put(0, 3, -3, 0); }
  else if (map === 'neighborhood') {
    const lots = [[-28, -24], [0, -24], [28, -24], [-28, 0], [28, 0], [-28, 24], [0, 24], [28, 24], [0, 0]];
    lots.forEach(([x, z], i) => put(i, x, z, i % 4));
  } else {
    for (let row = 0; row < 2; row++) for (let column = 0; column < 3; column++) {
      const block = row * 3 + column;
      for (let lotRow = 0; lotRow < 2; lotRow++) for (let lotColumn = 0; lotColumn < 3; lotColumn++) {
        put(result.length % 9, (column - 1) * 78 + (lotColumn - 1) * 24,
          (row === 0 ? -34 : 34) + (lotRow === 0 ? -12 : 12), (block + lotRow * 3 + lotColumn) % 4);
      }
    }
  }
  return result;
}

function footprint(building: Building): Rect {
  const corners = [0, building.width - 1].flatMap(x => [0, building.depth - 1].map(z =>
    rotate(x - building.width / 2, z - building.depth / 2, building.turns)));
  return {
    minX: building.x + Math.min(...corners.map(([x]) => x)), maxX: building.x + Math.max(...corners.map(([x]) => x)),
    minZ: building.z + Math.min(...corners.map(([, z]) => z)), maxZ: building.z + Math.max(...corners.map(([, z]) => z)),
  };
}

class FixtureBuilder {
  private cells = new Map<string, Cell>();
  readonly soil = new Map<string, { x: number; z: number }>();
  private roads = new Map<string, { x: number; z: number }>();
  constructor(readonly map: StructureMap) {}

  put(objectId: string, role: Role, x: number, y: number, z: number, material: Matter, shade = 0): void {
    const k = key(x, y, z);
    if (this.cells.has(k)) throw new Error(`Overlapping fixture cells: ${objectId} and ${this.cells.get(k)!.objectId} at ${k}`);
    const spec = materials[material];
    const color = spec.colors[Math.abs(x * 73 + y * 31 + z * 17 + shade * 13) % spec.colors.length];
    this.cells.set(k, { id: 0, objectId, role, position: { x, y, z }, material, color, hp: spec.hp, maxHp: spec.hp });
  }

  terrain(minX: number, maxX: number, minZ: number, maxZ: number): void {
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) this.soil.set(horizontalKey(x, z), { x, z });
  }

  road(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.terrain(minX - 2, maxX + 2, minZ - 2, maxZ + 2);
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) this.roads.set(horizontalKey(x, z), { x, z });
  }

  finish() {
    // In the source all 3 legacy soil layers sort before y >= 0 structures.
    // Count those historical IDs without ever constructing those soil Cells.
    for (const { x, z } of this.roads.values()) this.put(`warm:${this.map}:road`, 'road', x, 0, z, 'road');
    const cells = [...this.cells.values()].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.position.z - b.position.z);
    const start = (this.map === 'lab' ? 1 : this.map === 'neighborhood' ? 1_000_001 : 2_000_001) + this.soil.size * 3;
    cells.forEach((cell, i) => { cell.id = start + i; });
    return { cells, originalColumns: [...this.soil.values()].sort((a,b)=>a.x-b.x||a.z-b.z) };
  }
}

function addBuilding(builder: FixtureBuilder, building: Building): void {
  const { width: w, depth: d, floors } = building;
  const local = new Map<string, { position: Point; material: Matter }>();
  const put = (x: number, y: number, z: number, material: Matter) => local.set(key(x, y, z), { position: { x, y, z }, material });
  for (let x = 1; x < w - 1; x++) for (let z = 1; z < d - 1; z++) {
    if (x === 1 || x === w - 2 || z === 1 || z === d - 2) put(x, 0, z, 'stone');
  }
  for (let level = 0; level <= floors; level++) for (let x = 1; x < w - 1; x++) for (let z = 1; z < d - 1; z++) put(x, 1 + level * 6, z, 'wood');
  for (let floor = 0; floor < floors; floor++) for (let dy = 1; dy <= 5; dy++) {
    for (let x = 1; x < w - 1; x++) for (let z = 1; z < d - 1; z++) {
      const onX = x === 1 || x === w - 2, onZ = z === 1 || z === d - 2;
      if (!onX && !onZ) continue;
      if (floor === 0 && z === d - 2 && x >= Math.floor(w / 2) - 1 && x <= Math.floor(w / 2) && dy <= 4) continue;
      const along = onZ ? x : z, span = onZ ? w : d;
      const window = dy >= 2 && dy <= 3 && along >= 3 && along <= span - 4 && (along - 3) % 4 < 2;
      put(x, 1 + floor * 6 + dy, z, window ? 'glass' : 'wood');
    }
  }
  const ceiling = 1 + floors * 6, roofBase = ceiling + 1;
  const roofY = (x: number) => roofBase + Math.floor(Math.min(x, w - 1 - x) / 2);
  for (let x = 0; x < w; x++) {
    const top = roofY(x), adjacentLow = Math.min(roofY(Math.max(0, x - 1)), roofY(Math.min(w - 1, x + 1)));
    for (let z = 0; z < d; z++) {
      put(x, top, z, 'roof');
      if (adjacentLow < top) put(x, top - 1, z, 'roof');
    }
    if (x >= 1 && x <= w - 2) for (const z of [1, d - 2]) for (let y = ceiling + 1; y < top; y++) {
      if (!local.has(key(x, y, z))) put(x, y, z, 'wood');
    }
  }
  if (building.variant % 2 === 0) {
    const x = w - 4, z = 3;
    for (let y = 0; y <= roofY(x) + 2; y++) put(x, y, z, y === roofY(x) + 2 ? 'metal' : 'stone');
  }
  for (const { position: p, material } of local.values()) {
    const [x, z] = rotate(p.x - w / 2, p.z - d / 2, building.turns);
    builder.put(building.objectId, p.y === 0 ? 'foundation' : 'building', building.x + x, p.y, building.z + z, material, building.variant);
  }
}

function addTree(builder: FixtureBuilder, x: number, z: number, index: number): void {
  builder.terrain(x - 2, x + 2, z - 2, z + 2);
  const objectId = `warm:${builder.map}:tree-${String(index).padStart(2, '0')}`;
  for (let y = 0; y <= 5; y++) builder.put(objectId, 'tree', x, y, z, 'wood');
  for (let y = 4; y <= 7; y++) {
    const radius = y === 5 ? 3 : y === 7 ? 1 : 2;
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (Math.abs(dx) + Math.abs(dz) > radius || (dx === 0 && dz === 0 && y <= 5)) continue;
      builder.put(objectId, 'tree', x + dx, y, z + dz, 'foliage', index);
    }
  }
}

function addBridge(builder: FixtureBuilder, x: number, z: number, turns = 0): void {
  const objectId = `warm:${builder.map}:bridge-01`;
  builder.terrain(x - (turns ? 3 : 7), x + (turns ? 3 : 7), z - (turns ? 7 : 3), z + (turns ? 7 : 3));
  const put = (dx: number, y: number, dz: number, material: Matter) => {
    const [rx, rz] = rotate(dx, dz, turns);
    builder.put(objectId, 'bridge', x + rx, y, z + rz, material);
  };
  for (const dx of [-5, 5]) for (let y = 0; y < 4; y++) for (let dz = -1; dz <= 1; dz++) put(dx, y, dz, 'stone');
  for (let dx = -5; dx <= 5; dx++) for (let dz = -1; dz <= 1; dz++) put(dx, 4, dz, 'wood');
  for (let dx = -5; dx <= 5; dx++) for (const dz of [-1, 1]) put(dx, 5, dz, 'metal');
}

/** Structure-only projection of the current source fixture. The historical
 * terrain footprint is counted solely to preserve original positive IDs.
 * Returns no terrain Cells and does not create native physics objects. */
function sparseStructureFixture(map: StructureMap) {
  const builder = new FixtureBuilder(map), buildings = placements(map);
  if (map === 'lab') {
    builder.terrain(-20, 21, -15, 13);
    builder.road(-18, 0, 5, 7);
    builder.road(9, 11, 2, 11);
    addTree(builder, -14, 10, 1);
    addBridge(builder, 10, 7);
  } else if (map === 'neighborhood') {
    for (const x of [-14, 14]) builder.road(x - 1, x + 1, -35, 35);
    for (const z of [-12, 12]) builder.road(-38, 38, z - 1, z + 1);
    for (const building of buildings) {
      const rect = footprint(building), street = building.x < 0 ? -14 : 14;
      builder.terrain(rect.minX - 2, rect.maxX + 2, rect.minZ - 2, rect.maxZ + 2);
      builder.terrain(Math.min(building.x, street), Math.max(building.x, street), building.z - 1, building.z + 1);
      if (street > building.x) builder.road(rect.maxX + 1, street, building.z - 1, building.z + 1);
      else builder.road(street, rect.minX - 1, building.z - 1, building.z + 1);
    }
    for (const [i, [x, z]] of [[-19, -6], [19, -6], [-19, 6], [19, 6]].entries()) {
      builder.terrain(Math.min(x, x < 0 ? -14 : 14), Math.max(x, x < 0 ? -14 : 14), z - 1, z + 1);
      addTree(builder, x, z, i + 1);
    }
    addBridge(builder, 14, 20);
  } else {
    for (const z of [-34, 0, 34]) builder.road(-116, 116, z - 1, z + 1);
    for (const x of [-39, 39]) builder.road(x - 1, x + 1, -58, 58);
    for (const building of buildings) {
      const rect = footprint(building), street = building.z < 0 ? -34 : 34;
      builder.terrain(rect.minX - 2, rect.maxX + 2, rect.minZ - 2, rect.maxZ + 2);
      builder.terrain(building.x - 1, building.x + 1, Math.min(building.z, street), Math.max(building.z, street));
      if (street > building.z) builder.road(building.x - 1, building.x + 1, rect.maxZ + 1, street);
      else builder.road(building.x - 1, building.x + 1, street, rect.minZ - 1);
    }
    for (const [i, x] of [-110, -86, -62, -16, 8, 32, 62, 86, 110].entries()) {
      builder.terrain(x - 1, x + 1, 0, 6);
      addTree(builder, x, 6, i + 1);
    }
    addBridge(builder, 0, 0, 1);
  }
  buildings.forEach(building => addBuilding(builder, building));
  return builder.finish();
}
