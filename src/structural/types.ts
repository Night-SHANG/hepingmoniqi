export interface Point { x:number; y:number; z:number }
export interface Rotation extends Point { w:number }
export type Matter = 'soil'|'road'|'wood'|'stone'|'roof'|'glass'|'foliage'|'metal';
export interface Cell { id:number; objectId:string; role:'terrain'|'road'|'foundation'|'building'|'tree'|'bridge'; position:Point; material:Matter; color:number; hp:number; maxHp:number; anchor?:boolean; }
export interface Piece { id:string; cells:number[] }
export interface SupportGraph { remove(ids:readonly number[]):void; unsupported():Piece[]; }
export interface StructuralEvent { id:string; epoch:number; tick:number; kind:'detonation'|'detach'|'impact'|'sleep'; position:Point; sourceId?:string; targetId?:number; damage?:number; rootShotId:string; }
export interface CellView extends Cell { state:'static'|'dynamic'|'rubble'|'gone'; rotation:Rotation }
export interface SceneFixture { id:string; cells:Cell[] }
export interface BlastCommand { id:string; epoch:number; position:Point; radius:number; damage:number; impulse:number }
export interface StructuralSimulation {
 readonly epoch:number;
 blast(command:BlastCommand):boolean;
 step(dt:number):void;
 views():CellView[];
 events():StructuralEvent[];
 pending():number;
 research():number;
 snapshot():unknown;
 restore(snapshot:unknown):boolean;
 reset():void;
 dispose():void;
}
