import type {Point, ImmutableCellView} from '../structural/types';

export interface SurfaceBounds {readonly minX:number;readonly maxX:number;readonly minY:number;readonly maxY:number;readonly minZ:number;readonly maxZ:number}
/** Immutable scalar facade over authoritative state. No CellView or dense inventory is needed. */
export interface CompactSurfaceSource {
 readonly bounds:SurfaceBounds;
 staticIdAt(x:number,y:number,z:number):number|null;
 colorOf(id:number):number;
 hpOf(id:number):number;
 maxHpOf(id:number):number;
 forEachChunk(chunkSize:number,visit:(cx:number,cy:number,cz:number)=>void):void;
}
/** Original lattice position, captured before departure. Appearance and topology are independent. */
export interface SurfaceEdit {readonly id:number;readonly revision:number;readonly position:Readonly<Point>;readonly topologyChanged:boolean;readonly appearanceChanged:boolean}
export type MovingSurfaceCell=ImmutableCellView & {readonly size?:Readonly<Point>};
export interface SurfaceStorePort extends Omit<CompactSurfaceSource,'bounds'|'forEachChunk'> {
 readonly fixture:{readonly bounds:SurfaceBounds;forEachChunk(chunkSize:number,visit:(cx:number,cy:number,cz:number)=>void):void};
}
export function createCompactSurfaceSource(store:SurfaceStorePort):CompactSurfaceSource {
 return Object.freeze({bounds:Object.freeze({...store.fixture.bounds}),staticIdAt:(x:number,y:number,z:number)=>store.staticIdAt(x,y,z),colorOf:(id:number)=>store.colorOf(id),hpOf:(id:number)=>store.hpOf(id),maxHpOf:(id:number)=>store.maxHpOf(id),forEachChunk:(size:number,visit:(cx:number,cy:number,cz:number)=>void)=>store.fixture.forEachChunk(size,visit)});
}
