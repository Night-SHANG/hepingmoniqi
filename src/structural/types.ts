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
export interface StructuralSimulationOptions {maxActiveBodies?:number;initialEpoch?:number}
export interface StructuralSimulation {
 readonly epoch:number;
 blast(command:BlastCommand):boolean;
 step(dt:number):void;
 /** Independently owned, mutable deep snapshot. */
 views():CellView[];
 /** Cached immutable values. Retained arrays and cells never change under callers. */
 liveViews():readonly ImmutableCellView[];
 readonly viewRevision:number;
 /** First/expired/pre-replacement cursors require replacing the complete consumer view. */
 viewChanges(sinceRevision?:number):StructuralViewChanges;
 /** Index is epoch-local; reset also signals a gap in the bounded event log. */
 eventsSince(cursor?:StructuralEventCursor):StructuralEventChanges;
 events():StructuralEvent[];
 pending():number;
 research():number;
 snapshot():unknown;
 restore(snapshot:unknown):boolean;
 reset():void;
 dispose():void;
}
