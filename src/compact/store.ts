import type {CellView,Point,Rotation} from '../structural/types.js';
import type {CompactCell,CompactFixture,CompactBounds} from './fixture.js';

/** The one mutable authority for edited cells, including body-derived pose.
 * Pristine cells have no retained State. The simulation still owns all bodies. */
export interface CompactCellState {spec:CompactCell;hp:number;loss:number;state:CellView['state'];position:Point;rotation:Rotation;chunkId?:string}
export interface CompactStoreEdit {id:number;revision:number;position:Point;topologyChanged:boolean;appearanceChanged:boolean}
export interface CompactStoreChanges {revision:number;reset:boolean;ids:number[];edits:CompactStoreEdit[]}
export interface CompactAggregate {count:number;static:number;dynamic:number;rubble:number;gone:number;departed:number;loss:number;totalHp:number;objectiveCount:number;objectiveDeparted:number}
interface Record {value:CompactCellState;hp:number;loss:number;state:CellView['state'];revision:number;topologyRevision:number;appearanceRevision:number}
interface Revision {id:number;revision:number;topologyChanged:boolean;appearanceChanged:boolean}
const JOURNAL_LIMIT=16384;
const IDENTITY:Rotation={x:0,y:0,z:0,w:1};
const DIRECTIONS=[[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]] as const;
const frozen=<T>(value:T):T=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const item of Object.values(value))frozen(item);Object.freeze(value);}return value;};
const ownsPose=(c:CompactCellState)=>c.state==='dynamic'||c.state==='rubble';

/** Sparse latest revisions serve independent consumers. markChanged records
 * deltas against each row's last accounting state, so aggregates never scan the
 * edited inventory. Consumers must call it after writing mutable state fields. */
export class CompactAuthorityStore {
 private readonly records=new Map<number,Record>();
 private readonly movingIds=new Set<number>();
 private readonly journal:(Revision|undefined)[]=[];
 private version=0;private resetVersion=0;private totals:CompactAggregate;
 constructor(readonly fixture:CompactFixture){this.totals=this.initialTotals();}
 get revision(){return this.version;}
 get count(){return this.fixture.count;}
 private initialTotals():CompactAggregate{return {count:this.fixture.count,static:this.fixture.count-this.fixture.initialGoneCount,dynamic:0,rubble:0,gone:this.fixture.initialGoneCount,departed:this.fixture.initialGoneCount,loss:0,totalHp:this.fixture.totalHp,objectiveCount:this.fixture.objectiveCount,objectiveDeparted:this.fixture.initialObjectiveDeparted};}
 private pristine(id:number):CompactCellState|undefined{const spec=this.fixture.original(id);if(!spec)return;return {spec,hp:spec.hp,loss:0,state:spec.hp>0?'static':'gone',position:{...spec.position},rotation:{...IDENTITY}};}
 /** Owned snapshot: caller mutations never touch fixture columns or authority. */
 read(id:number):CompactCellState|undefined {const record=this.records.get(id);return record?structuredClone(record.value):this.pristine(id);}
 /** Internal borrowed read. Never mutate this value: call writable first.
  * Unlike read(), a previously edited cell's metadata/pose need not be cloned. */
 peek(id:number):CompactCellState|undefined{return this.records.get(id)?.value??this.pristine(id);}
 /** Stable writable row. Merely requesting it does not count damage or publish a change. */
 writable(id:number):CompactCellState|undefined{let record=this.records.get(id);if(record)return record.value;const value=this.pristine(id);if(!value)return;frozen(value.spec);record={value,hp:value.hp,loss:0,state:value.state,revision:0,topologyRevision:0,appearanceRevision:0};this.records.set(id,record);return value;}
 edit(id:number){return this.writable(id);}
 markChanged(id:number):void{
  const row=this.records.get(id);if(!row)throw new Error('Cannot mark an unowned compact state');
  const c=row.value,revision=++this.version,topology=(row.state==='static')!==(c.state==='static'),appearance=row.hp!==c.hp||row.state!==c.state;
  if(row.state!==c.state){this.totals[row.state]--;this.totals[c.state]++;const departure=Number(c.state!=='static')-Number(row.state!=='static');this.totals.departed+=departure;if(this.fixture.objectiveOf(id))this.totals.objectiveDeparted+=departure;}
  if(this.fixture.roleOf(id)!=='terrain')this.totals.loss+=c.loss-row.loss;
  row.hp=c.hp;row.loss=c.loss;row.state=c.state;row.revision=revision;if(topology)row.topologyRevision=revision;if(appearance)row.appearanceRevision=revision;
  if(ownsPose(c))this.movingIds.add(id);else this.movingIds.delete(id);
  this.journal[(revision-1)%JOURNAL_LIMIT]={id,revision,topologyChanged:topology,appearanceChanged:appearance};
 }
 stateOf(id:number):CellView['state']|undefined{const c=this.records.get(id);if(c)return c.value.state;const hp=this.fixture.hpOf(id);return Number.isFinite(hp)?hp>0?'static':'gone':undefined;}
 hpOf(id:number){return this.records.get(id)?.value.hp??this.fixture.hpOf(id);}
 maxHpOf(id:number){return this.fixture.maxHpOf(id);}colorOf(id:number){return this.fixture.colorOf(id);}materialOf(id:number){return this.fixture.materialOf(id);}
 original(id:number){return this.fixture.original(id);}ordinal(id:number){return this.fixture.ordinal(id);}
 staticIdAt(x:number,y:number,z:number):number|null{const id=this.fixture.idAt(x,y,z);return id!==null&&this.stateOf(id)==='static'?id:null;}
 staticAt(x:number,y:number,z:number){return this.staticIdAt(x,y,z);}
 staticNeighbors(p:Point):number[]{const result:number[]=[];for(const [dx,dy,dz] of DIRECTIONS){const id=this.staticIdAt(p.x+dx,p.y+dy,p.z+dz);if(id!==null)result.push(id);}return result;}
 queryStaticSphere(center:Point,radius:number):number[]{return this.fixture.idsInSphere(center,radius).filter(id=>this.stateOf(id)==='static');}
 idsInBounds(bounds:CompactBounds){return this.fixture.idsInBounds(bounds);}
 idsInChunk(key:string){return this.fixture.idsInChunk(key);}
 private orderedRecords(){return [...this.records.values()].sort((a,b)=>this.fixture.ordinal(a.value.spec.id)-this.fixture.ordinal(b.value.spec.id));}
 changedIds():number[]{return this.orderedRecords().filter(r=>r.revision>0).map(r=>r.value.spec.id);}
 changedStates():CompactCellState[]{return this.orderedRecords().filter(r=>r.revision>0).map(r=>structuredClone(r.value));}
 departedStates():CompactCellState[]{return this.orderedRecords().filter(r=>r.value.state!=='static').map(r=>structuredClone(r.value));}
 /** Internal borrowed sparse rows. Mutations still require markChanged afterward. */
 *sparseStates():IterableIterator<CompactCellState>{for(const row of this.records.values())yield row.value;}
 /** Frame path: never traverses historical gone/static damage records. */
 *movingStates():IterableIterator<CompactCellState>{for(const id of this.movingIds)yield this.records.get(id)!.value;}
 changesSince(cursor?:number):CompactStoreChanges{
  const reset=!Number.isSafeInteger(cursor)||cursor!<this.resetVersion||cursor!>this.version;
  if(reset)return {revision:this.version,reset:true,ids:[],edits:[]};
  if(cursor===this.version)return {revision:this.version,reset:false,ids:[],edits:[]};
  let entries:Revision[];
  if(cursor!<this.version-JOURNAL_LIMIT){
   // The bounded journal may wrap within one command. Sparse rows retain the
   // latest revision of each kind, so older same-epoch cursors remain exact.
   entries=[];
   for(const row of this.records.values())if(row.revision>cursor!)entries.push({id:row.value.spec.id,revision:row.revision,topologyChanged:row.topologyRevision>cursor!,appearanceChanged:row.appearanceRevision>cursor!});
  }else{
   const updates=new Map<number,Revision>();
   for(let revision=cursor!+1;revision<=this.version;revision++){
    const entry=this.journal[(revision-1)%JOURNAL_LIMIT]!;
    const previous=updates.get(entry.id);
    updates.set(entry.id,{...entry,topologyChanged:entry.topologyChanged||previous?.topologyChanged===true,appearanceChanged:entry.appearanceChanged||previous?.appearanceChanged===true});
   }
   entries=[...updates.values()];
  }
  entries.sort((a,b)=>this.fixture.ordinal(a.id)-this.fixture.ordinal(b.id));
  return {revision:this.version,reset:false,ids:entries.map(entry=>entry.id),edits:entries.map(entry=>({...entry,position:this.fixture.originalPosition(entry.id)!}))};
 }
 aggregate():Readonly<CompactAggregate>{return {...this.totals};}
 reset():void{this.records.clear();this.movingIds.clear();this.journal.length=0;this.totals=this.initialTotals();this.resetVersion=++this.version;}
 diagnostics(){let poses=0,changed=0;for(const row of this.records.values()){if(ownsPose(row.value))poses++;if(row.revision>0)changed++;}return {mutableStates:this.records.size,changedStates:changed,poseRecords:poses,retainedPristineStates:0,duplicatedPoseRecords:0};}
}
