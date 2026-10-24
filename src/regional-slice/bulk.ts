/** Isolated regional static-edit experiment. Not connected to physics or the
 * production authority. Tile bounds refer to cell centers, never collider faces. */
import type {CompactBounds} from '../compact/fixture.js';
import type {Point} from '../structural/types.js';
export interface BulkBlast {id:string;epoch:number;center:Point;radius:number;damage:number;reward?:boolean}
export interface BulkTileSummary {bounds:CompactBounds;count:number;materialCount:number;allStatic:boolean;pristine:boolean;maxHp:number}
export type BulkClassification='outside'|'boundary'|'mixed'|'partial'|'not-killable'|'full-gone';
export interface BulkTileDecision {kind:BulkClassification;minimumDamage:number;maximumDistance:number}
export function classifyBulkTile(tile:BulkTileSummary,blast:BulkBlast):BulkTileDecision {
 const {bounds:b}=tile,p=blast.center;
 const maximumDistance=Math.hypot(Math.max(Math.abs(b.minX-p.x),Math.abs(b.maxX-p.x)),Math.max(Math.abs(b.minY-p.y),Math.abs(b.maxY-p.y)),Math.max(Math.abs(b.minZ-p.z),Math.abs(b.maxZ-p.z)));
 const minimumDistance=Math.hypot(Math.max(b.minX-p.x,0,p.x-b.maxX),Math.max(b.minY-p.y,0,p.y-b.maxY),Math.max(b.minZ-p.z,0,p.z-b.maxZ));
 const minimumDamage=blast.damage*(1-.65*maximumDistance/blast.radius);
 const kind:BulkClassification=minimumDistance>blast.radius?'outside':maximumDistance>blast.radius?'boundary':tile.materialCount!==1?'mixed':!tile.allStatic||!tile.pristine?'partial':minimumDamage<tile.maxHp?'not-killable':'full-gone';
 return {kind,minimumDamage,maximumDistance};
}

import type {CompactFixture} from '../compact/fixture.js';
import type {CompactAggregate} from '../compact/store.js';
import type {CellView} from '../structural/types.js';
export interface BulkRow {id:number;hp:number;loss:number;state:CellView['state']}
export interface BulkAggregate extends CompactAggregate {rewardedLoss:number;creditedResearch:number;research:number;structuralResearch:number}
export interface BulkSnapshot {schema:'regional-bulk-experiment/v1';fixtureId:string;recipeId:string;epoch:number;shots:string[];rows:BulkRow[];goneTiles:string[];objectiveLoss:[number,number][];rewardedLoss:number;creditedResearch:number;research:number}
interface Tile {key:string;summary:BulkTileSummary;ids:Float64Array;structureHp:number;objectives:number;gone:boolean;dirty:boolean}
export interface BulkReport {accepted:boolean;candidateTiles:number;boundingTileLookups:number;classifications:Record<BulkClassification,number>;classificationMs:number;editMs:number;totalMs:number;scalarCellsVisited:number;scalarDistanceEvaluations:number;scalarDamageCalls:number;scalarChanged:number;scalarDeleted:number;bulkTiles:number;fullOccupancyBulkTiles:number;bulkCells:number;overrideWrites:number;perCellBulkWrites:number;changed:number;deleted:number}
const classifications=():Record<BulkClassification,number>=>({'outside':0,'boundary':0,'mixed':0,'partial':0,'not-killable':0,'full-gone':0});
const tileKey=(x:number,y:number,z:number)=>`${Math.floor(x/8)},${Math.floor(y/8)},${Math.floor(z/8)}`;
const report=():BulkReport=>({accepted:false,candidateTiles:0,boundingTileLookups:0,classifications:classifications(),classificationMs:0,editMs:0,totalMs:0,scalarCellsVisited:0,scalarDistanceEvaluations:0,scalarDamageCalls:0,scalarChanged:0,scalarDeleted:0,bulkTiles:0,fullOccupancyBulkTiles:0,bulkCells:0,overrideWrites:0,perCellBulkWrites:0,changed:0,deleted:0});
/** Experiment only. Immutable membership is built once; a uniform gone tile is
 * one boolean write plus aggregate arithmetic. It is never expanded on edit.
 * Sparse rows hold exact fallback HP, preserving original IDs. This static
 * slice deliberately does NOT apply blast damage to dynamic/rubble bodies. */
export class RegionalBulkStore {
 private tiles=new Map<string,Tile>();private rows=new Map<number,BulkRow>();private shots=new Set<string>();private objectiveLoss=new Map<number,number>();
 private totals:CompactAggregate;private rewardedLoss=0;private creditedResearch=0;private research=0;
 epoch=1;
 constructor(readonly fixture:CompactFixture,initialRows:readonly BulkRow[]=[]){
  const build=new Map<string,{summary:BulkTileSummary;ids:number[];materials:Set<string>;structureHp:number;objectives:number}>();
  for(let ordinal=0;ordinal<fixture.count;ordinal++){
   const id=fixture.idAtOrdinal(ordinal)!,x=fixture.xOf(id),y=fixture.yOf(id),z=fixture.zOf(id),key=tileKey(x,y,z),tx=Math.floor(x/8),ty=Math.floor(y/8),tz=Math.floor(z/8);
   let tile=build.get(key);if(!tile){tile={summary:{bounds:{minX:tx*8,maxX:tx*8+7,minY:ty*8,maxY:ty*8+7,minZ:tz*8,maxZ:tz*8+7},count:0,materialCount:0,allStatic:true,pristine:true,maxHp:0},ids:[],materials:new Set(),structureHp:0,objectives:0};build.set(key,tile);}
   const hp=fixture.hpOf(id);tile.ids.push(id);tile.summary.count++;tile.summary.maxHp=Math.max(tile.summary.maxHp,hp);tile.summary.allStatic&&=hp>0;tile.summary.pristine&&=hp===fixture.maxHpOf(id);tile.materials.add(fixture.materialOf(id)!);tile.summary.materialCount=tile.materials.size;if(fixture.roleOf(id)!=='terrain')tile.structureHp+=hp;if(fixture.objectiveOf(id))tile.objectives++;
  }
  for(const [key,tile] of build)this.tiles.set(key,{key,summary:tile.summary,ids:new Float64Array(tile.ids),structureHp:tile.structureHp,objectives:tile.objectives,gone:false,dirty:false});
  this.totals=this.initialTotals();
  for(const row of initialRows){if(!this.validRow(row)||this.rows.has(row.id))throw new Error('Invalid initial static-slice row');this.applyRow({...row},false);if(fixture.objectiveOf(row.id))this.objectiveLoss.set(row.id,row.state==='static'?Math.max(0,1-row.hp/fixture.maxHpOf(row.id)):1);}
 }
 private initialTotals():CompactAggregate{const f=this.fixture;return {count:f.count,static:f.count-f.initialGoneCount,dynamic:0,rubble:0,gone:f.initialGoneCount,departed:f.initialGoneCount,loss:0,totalHp:f.totalHp,objectiveCount:f.objectiveCount,objectiveDeparted:f.initialObjectiveDeparted};}
 private tileOf(id:number){const f=this.fixture;return this.tiles.get(tileKey(f.xOf(id),f.yOf(id),f.zOf(id)));}
 private validRow(row:BulkRow){const hp=this.fixture.hpOf(row.id);return Number.isFinite(hp)&&Number.isFinite(row.hp)&&row.hp>=0&&row.hp<=hp&&Number.isFinite(row.loss)&&row.loss>=0&&row.loss<=hp&&['static','gone','dynamic','rubble'].includes(row.state)&&(row.state==='gone'?row.hp===0:row.hp>0)&&(row.state==='static'?Math.abs(row.loss-(hp-row.hp))<1e-7:row.loss===hp);}
 read(id:number):BulkRow|undefined{const hp=this.fixture.hpOf(id);if(!Number.isFinite(hp))return;const row=this.rows.get(id);if(row)return {...row};return this.tileOf(id)?.gone?{id,hp:0,loss:hp,state:'gone'}:{id,hp,loss:0,state:hp>0?'static':'gone'};}
 private applyRow(next:BulkRow,reward:boolean){
  const old=this.read(next.id)!,f=this.fixture,objective=f.objectiveOf(next.id);
  if(old.state!==next.state){this.totals[old.state]--;this.totals[next.state]++;const d=Number(next.state!=='static')-Number(old.state!=='static');this.totals.departed+=d;if(objective)this.totals.objectiveDeparted+=d;}
  if(f.roleOf(next.id)!=='terrain')this.totals.loss+=next.loss-old.loss;
  if(objective){const before=this.objectiveLoss.get(next.id)??0,value=next.state==='static'?Math.max(0,1-next.hp/f.maxHpOf(next.id)):1;if(reward)this.rewardedLoss+=Math.max(0,value-before);this.objectiveLoss.set(next.id,value);}
  this.rows.set(next.id,next);this.tileOf(next.id)!.dirty=true;
 }
 private credit(){const next=this.totals.objectiveCount?Math.min(200,Math.ceil(Math.max(0,this.rewardedLoss)*200/this.totals.objectiveCount)):0;this.research+=Math.max(0,next-this.creditedResearch);this.creditedResearch=Math.max(this.creditedResearch,next);}
 aggregate():BulkAggregate{return {...this.totals,rewardedLoss:this.rewardedLoss,creditedResearch:this.creditedResearch,research:this.research,structuralResearch:this.totals.totalHp?Math.min(200,Math.ceil(200*this.totals.loss/this.totals.totalHp)):0};}
 blast(command:BulkBlast,options:{forceScalar?:boolean}={}):BulkReport {
  const out=report(),start=performance.now();
  if(!command||command.epoch!==this.epoch||typeof command.id!=='string'||!command.id||this.shots.has(command.id)||!command.center||!Object.values(command.center).every(Number.isFinite)||!Number.isFinite(command.radius)||command.radius<=0||command.radius>1e6||!Number.isFinite(command.damage)||command.damage<0||command.damage>1e9)return out;
  this.shots.add(command.id);out.accepted=true;
  const {center:p,radius:r}=command,candidates:{tile:Tile;decision:BulkTileDecision}[]=[],at=performance.now();
  const f=this.fixture,b=f.bounds;
  for(let x=Math.floor(Math.max(p.x-r,b.minX)/8);x<=Math.floor(Math.min(p.x+r,b.maxX)/8);x++)for(let y=Math.floor(Math.max(p.y-r,b.minY)/8);y<=Math.floor(Math.min(p.y+r,b.maxY)/8);y++)for(let z=Math.floor(Math.max(p.z-r,b.minZ)/8);z<=Math.floor(Math.min(p.z+r,b.maxZ)/8);z++){
   out.boundingTileLookups++;const tile=this.tiles.get(`${x},${y},${z}`);if(!tile||tile.gone)continue;out.candidateTiles++;
   const decision=classifyBulkTile({...tile.summary,pristine:tile.summary.pristine&&!tile.dirty},command);out.classifications[decision.kind]++;if(decision.kind!=='outside')candidates.push({tile,decision});
  }
  out.classificationMs=performance.now()-at;const editStart=performance.now();
  for(const {tile,decision} of candidates){
   if(decision.kind==='full-gone'&&!options.forceScalar){
    tile.gone=true;out.overrideWrites++;out.bulkTiles++;out.fullOccupancyBulkTiles+=Number(tile.ids.length===512);out.bulkCells+=tile.ids.length;
    this.totals.static-=tile.ids.length;this.totals.gone+=tile.ids.length;this.totals.departed+=tile.ids.length;this.totals.objectiveDeparted+=tile.objectives;this.totals.loss+=tile.structureHp;if(command.reward!==false)this.rewardedLoss+=tile.objectives;
    continue;
   }
   for(const id of tile.ids){out.scalarCellsVisited++;const row=this.read(id)!;if(row.state!=='static'||row.hp<=0)continue;
    out.scalarDistanceEvaluations++;const distance=Math.hypot(f.xOf(id)-p.x,f.yOf(id)-p.y,f.zOf(id)-p.z);if(distance>r)continue;
    const value=command.damage*(1-.65*distance/r);if(value<=0)continue;out.scalarDamageCalls++;
    const used=Math.min(row.hp,value),hp=row.hp-used;const next:BulkRow={id,hp:hp<=1e-8?0:hp,loss:hp<=1e-8?f.hpOf(id):Math.min(f.hpOf(id),row.loss+used),state:hp<=1e-8?'gone':'static'};
    this.applyRow(next,command.reward!==false);out.scalarChanged++;out.scalarDeleted+=Number(next.state==='gone');
   }
  }
  this.credit();out.editMs=performance.now()-editStart;out.changed=out.scalarChanged+out.bulkCells;out.deleted=out.scalarDeleted+out.bulkCells;out.totalMs=performance.now()-start;return out;
 }
 snapshot():BulkSnapshot{return {schema:'regional-bulk-experiment/v1',fixtureId:this.fixture.id,recipeId:this.fixture.recipeId,epoch:this.epoch,shots:[...this.shots],rows:[...this.rows.values()].map(r=>({...r})),goneTiles:[...this.tiles.values()].filter(t=>t.gone).map(t=>t.key),objectiveLoss:[...this.objectiveLoss],rewardedLoss:this.rewardedLoss,creditedResearch:this.creditedResearch,research:this.research};}
 restore(input:unknown):boolean{
  const s=input as BulkSnapshot;
  try{
   if(!s||s.schema!=='regional-bulk-experiment/v1'||s.fixtureId!==this.fixture.id||s.recipeId!==this.fixture.recipeId||!Number.isSafeInteger(s.epoch)||s.epoch<1||!Array.isArray(s.rows)||s.rows.some(r=>!this.validRow(r))||new Set(s.rows.map(r=>r.id)).size!==s.rows.length||!Array.isArray(s.goneTiles)||new Set(s.goneTiles).size!==s.goneTiles.length||s.goneTiles.some(k=>{const t=this.tiles.get(k);return !t||!t.summary.allStatic||!t.summary.pristine||t.summary.materialCount!==1;})||s.rows.some(r=>s.goneTiles.includes(this.tileOf(r.id)!.key))||!Array.isArray(s.shots)||s.shots.some(id=>typeof id!=='string'||!id)||new Set(s.shots).size!==s.shots.length||!Array.isArray(s.objectiveLoss)||s.objectiveLoss.some(([id,value])=>!this.fixture.objectiveOf(id)||!Number.isFinite(value)||value<0||value>1)||!Number.isFinite(s.rewardedLoss)||s.rewardedLoss<0||s.rewardedLoss>this.fixture.objectiveCount||!Number.isInteger(s.creditedResearch)||s.creditedResearch<0||s.creditedResearch>200||s.research!==s.creditedResearch)return false;
   this.clear();this.epoch=s.epoch;
   for(const row of s.rows)this.applyRow({...row},false);
   for(const key of s.goneTiles){const tile=this.tiles.get(key)!;tile.gone=true;this.totals.static-=tile.ids.length;this.totals.gone+=tile.ids.length;this.totals.departed+=tile.ids.length;this.totals.objectiveDeparted+=tile.objectives;this.totals.loss+=tile.structureHp;}
   this.shots=new Set(s.shots);this.objectiveLoss=new Map(s.objectiveLoss);this.rewardedLoss=s.rewardedLoss;this.creditedResearch=s.creditedResearch;this.research=s.research;return true;
  }catch{return false;}
 }
 private clear(){this.rows.clear();this.shots.clear();this.objectiveLoss.clear();for(const tile of this.tiles.values()){tile.gone=false;tile.dirty=false;}this.totals=this.initialTotals();this.rewardedLoss=this.creditedResearch=this.research=0;}
 reset(){this.clear();this.epoch++;}
}
