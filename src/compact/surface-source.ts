import type {Point, ImmutableCellView, StructuralCompactQueries} from '../structural/types';
import type {CompactFixture} from './fixture';
import {CompactAuthorityStore} from './store';
import {isManagedCompactFixture} from './managed-fixture';

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
// Proof is attached to exact frozen facades, never public fields which a spread,
// borrowed fixture, recipe string or structural TypeScript cast could forge.
const queryStores=new WeakMap<object,CompactAuthorityStore>();
const surfaceStores=new WeakMap<CompactSurfaceSource,{store:CompactAuthorityStore;fixture:CompactFixture}>();
export function createCompactQuerySource(store:CompactAuthorityStore,generation:()=>number):StructuralCompactQueries['source'] {
 if(!(store instanceof CompactAuthorityStore))throw new TypeError('A compact query source requires an authority store');
 const source=Object.freeze({fixture:store.fixture,get generation(){return generation();},staticIdAt:(x:number,y:number,z:number)=>store.staticIdAt(x,y,z),colorOf:(id:number)=>store.colorOf(id),hpOf:(id:number)=>store.hpOf(id),maxHpOf:(id:number)=>store.maxHpOf(id),materialOf:(id:number)=>store.materialOf(id)});
 queryStores.set(source,store);return source;
}
/** Internal identity proof for a bind, deliberately rechecked against all writable
 * rows. Revision and aggregates miss unpublished edits and terrain damage. */
export function pristineSurfaceFixture(source:CompactSurfaceSource):CompactFixture|null {
 const proof=surfaceStores.get(source);
 return proof&&proof.store.fixture===proof.fixture&&isManagedCompactFixture(proof.fixture)&&proof.store.diagnostics().mutableStates===0?proof.fixture:null;
}
export function createCompactSurfaceSource(store:SurfaceStorePort):CompactSurfaceSource {
 const source=Object.freeze({bounds:Object.freeze({...store.fixture.bounds}),staticIdAt:(x:number,y:number,z:number)=>store.staticIdAt(x,y,z),colorOf:(id:number)=>store.colorOf(id),hpOf:(id:number)=>store.hpOf(id),maxHpOf:(id:number)=>store.maxHpOf(id),forEachChunk:(size:number,visit:(cx:number,cy:number,cz:number)=>void)=>store.fixture.forEachChunk(size,visit)});
 const authority=queryStores.get(store);if(authority&&authority.fixture===store.fixture)surfaceStores.set(source,{store:authority,fixture:authority.fixture});
 return source;
}
