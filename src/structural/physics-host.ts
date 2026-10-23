import type RAPIER from '@dimforge/rapier3d-compat';
import type {CellView,Point} from './types.js';
export type CollisionRecord={first:number;second:number;started:boolean};
export type ForceRecord={first:number;second:number;impulse:number;normal:Point};
export interface PhysicsParticipant {
 beforeStep?(world:RAPIER.World):void;
 afterStep?(world:RAPIER.World,collisions:readonly CollisionRecord[],forces:readonly ForceRecord[]):void;
 pending?():number;
 beforeWorldReplace?():void;
 afterWorldReplace?(world:RAPIER.World,epoch:number):void;
}
/** One live authority; consumers never step or drain this world themselves. */
export interface StructuralPhysicsHost {
 readonly world:RAPIER.World;
 readonly epoch:number;
 register(participant:PhysicsParticipant):()=>void;
 advance(dt:number):void;
 cell(id:number):CellView|null;
 colliderCell(handle:number,point?:Point):number|null;
}
