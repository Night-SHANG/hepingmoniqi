export interface Point { x:number; y:number; z:number }
export interface Rotation extends Point { w:number }
export type Matter = 'soil'|'road'|'wood'|'stone'|'roof'|'glass'|'foliage'|'metal';
export interface Cell { id:number; objectId:string; role:'terrain'|'road'|'foundation'|'building'|'tree'|'bridge'; position:Point; material:Matter; color:number; hp:number; maxHp:number; anchor?:boolean; }
export interface Piece { id:string; cells:number[] }
export interface SupportGraph { remove(ids:readonly number[]):void; unsupported():Piece[]; }
export interface StructuralEvent { id:string; epoch:number; tick:number; kind:'detonation'|'detach'|'impact'|'sleep'; position:Point; sourceId?:string; targetId?:number; damage?:number; rootShotId:string; }
export interface CellView extends Cell { state:'static'|'dynamic'|'rubble'|'gone'; rotation:Rotation }
/** Immutable query values, not writable simulation state. */
export type ImmutableCellView = Readonly<Omit<CellView,'position'|'rotation'>> & {readonly position:Readonly<Point>;readonly rotation:Readonly<Rotation>};
export type ImmutableStructuralEvent = Readonly<Omit<StructuralEvent,'position'>> & {readonly position:Readonly<Point>};
export interface StructuralViewChanges {readonly revision:number;readonly reset:boolean;readonly cells:readonly ImmutableCellView[]}
export interface StructuralEventCursor {readonly epoch:number;readonly index:number}
export interface StructuralEventChanges {readonly cursor:StructuralEventCursor;readonly reset:boolean;readonly events:readonly ImmutableStructuralEvent[]}
export interface SceneFixture { id:string; cells:Cell[] }
export interface BlastCommand { id:string; epoch:number; position:Point; radius:number; damage:number; impulse:number }
export interface CompactSupportGraph extends SupportGraph {reset():void;dispose?():void}
export interface StructuralSimulationOptions {
 maxActiveBodies?:number;initialEpoch?:number;
 /** Optional prevalidated support adapter. The same kernel owns all physics. */
 compactSupportFactory?:(store:import('../compact/store.js').CompactAuthorityStore)=>CompactSupportGraph|Promise<CompactSupportGraph>;
 /** Called once after awaited pristine-support validation, immediately before
  * allocating the first native world. Never called by reset or restore. */
 beforeWorldCreate?:()=>void;
}
export interface StructuralCellSave {id:number;hp:number;loss:number;state:CellView['state'];position:Point;rotation:Rotation;chunkId?:string}
export interface StructuralLocalCell {id:number;position:Point;rotation:Rotation}
export interface StructuralChunkSave {transforms:StructuralLocalCell[];id:string;cells:number[];rootShotId:string;status:'active'|'queued'|'rubble';position:Point;rotation:Rotation;linvel:Point;angvel:Point;quiet:number}
export interface StructuralContactEpisode {n:number;credited:boolean}
export interface StructuralSaveMetadata {fixtureId:string;fixtureSignature:string;maxActiveBodies:number;epoch:number;tick:number;accumulator:number;serial:number;cells:StructuralCellSave[];bodies:StructuralChunkSave[];queue:string[];shots:string[];processed:string[];episodes:[string,StructuralContactEpisode][];episodeCounts:[string,number][];research:number;events:StructuralEvent[]}
export interface StructuralSnapshot extends StructuralSaveMetadata {schema:'structural-simulation/v1'}
export interface SparseStructuralSnapshot extends StructuralSaveMetadata {schema:'structural-simulation-changes/v1'}
export interface CompactStructuralSnapshot extends StructuralSaveMetadata {schema:'structural-simulation-compact/v1'}
type CompactStore=import('../compact/store.js').CompactAuthorityStore;
/** Sparse runtime query port. Reset means rebuild from the immutable descriptor
 * and sparse changes, not request a full-world CellView array. */
export interface StructuralCompactQueries {
 readonly fixture:import('../compact/fixture.js').CompactFixture;
 readonly source:Pick<CompactStore,'fixture'|'staticIdAt'|'colorOf'|'hpOf'|'maxHpOf'|'materialOf'>&{readonly generation:number};
 readonly revision:number;
 changesSince(sinceRevision?:number):ReturnType<CompactStore['changesSince']>;
 cell(id:number):ImmutableCellView|null;
 /** All edited cells only, for sparse cursor reset/replacement. */
 changedCells():readonly ImmutableCellView[];
 movingViews():readonly ImmutableCellView[];
 aggregate():ReturnType<CompactStore['aggregate']>;
 diagnostics():ReturnType<CompactStore['diagnostics']>;
}
export interface StructuralSimulation {
 readonly epoch:number;
 readonly compact?:StructuralCompactQueries;
 blast(command:BlastCommand):boolean;
 step(dt:number):void;
 /** Independently owned, mutable deep snapshot. Compact mode: diagnostic-only
  * full materialization; production consumers must use the compact query port. */
 views():CellView[];
 /** Immutable values. Dense mode caches the full array; compact mode explicitly
  * materializes a diagnostic array. Retained values never change under callers. */
 liveViews():readonly ImmutableCellView[];
 readonly viewRevision:number;
 /** Dense-only: expired cursors replace the full view. Compact mode throws;
  * use compact.changesSince and changedCells for sparse cursor resets. */
 viewChanges(sinceRevision?:number):StructuralViewChanges;
 /** Index is epoch-local; reset also signals a gap in the bounded event log. */
 eventsSince(cursor?:StructuralEventCursor):StructuralEventChanges;
 events():StructuralEvent[];
 pending():number;
 research():number;
 snapshot():unknown;
 /** Owned sparse cells plus complete save metadata. Legacy dense schema needs
  * expansion; compact schema is validated/restored directly, without expansion. */
 snapshotSparse():unknown;
 restore(snapshot:unknown):boolean;
 reset():void;
 dispose():void;
}
