import type {CompactAuthorityStore} from '../store.js';
import type {MapId} from '../../contracts.js';
import type {Piece,SupportGraph} from '../../structural/types.js';
import {IndexedStructure} from './indexed-structure.js';
import {CompactSupportLattice} from './lattice.js';
import {createPristineTokenFactory,type CompiledManifest,type ValidatedPristine} from './pristine-core.js';
import {decodePristineBrowser,validatePristineBrowser} from './runtime.js';

export {CompactSupportLattice} from './lattice.js';
export type {CompiledManifest} from './pristine-core.js';
export interface CompactSupportOptions {artifactBytes:Uint8Array|ArrayBuffer;expectation:CompiledManifest}
export type CompactSupportAssetLoader=(map:MapId)=>Promise<CompactSupportOptions>;
let hostAssetLoader:CompactSupportAssetLoader|undefined;
/** Environment injection only: loaders supply the same untrusted bytes/manifest
 * that browser fetching supplies. Native tests still execute full validation. */
export function configureCompactSupportAssetLoader(loader:CompactSupportAssetLoader):()=>void {
 if(hostAssetLoader)throw new Error('A compact support asset loader is already configured');
 hostAssetLoader=loader;let active=true;
 return ()=>{if(active&&hostAssetLoader===loader)hostAssetLoader=undefined;active=false;};
}
export interface CompactSupportGraph extends SupportGraph {
 reset():void;
 dispose():void;
 diagnostics():{disposed:boolean;cells:number;chunks:number;liveMembers:number;directedEdges:number;typedBufferBytes:number;storedNeighborSlots:number;retainedVoxelRecords:number};
}

/** Graph only hydrates trusted pristine tables. Seed partitioning is build-time. */
function hydrateGraph(store:CompactAuthorityStore,source:CompactSupportLattice,token:ValidatedPristine):CompactSupportGraph {
 let nextToken:(()=>ValidatedPristine)|undefined=createPristineTokenFactory(source,token);
 let graph:IndexedStructure|undefined;
 const active=()=>{if(!graph)throw new Error('Compact support is disposed');return graph;};
 const reset=()=>{
  if(!nextToken)throw new Error('Compact support is disposed');
  const replacement=IndexedStructure.fromPristine(source,nextToken());
  // Sparse departures include dynamic, sleeping rubble, and removed cells.
  // Hydrate pristine FIRST; live occupancy is never the original lattice.
  const departed:number[]=[];
  for(const state of store.sparseStates())if(state.state!=='static'){const index=source.index(state.spec.id);if(index>=0)departed.push(index);}
  replacement.leave(departed);graph=replacement;
 };
 reset();
 return {
  remove(ids:readonly number[]):void {const target=active(),indices:number[]=[];for(const id of ids){const index=source.index(id);if(index>=0)indices.push(index);}target.leave(indices);},
  unsupported():Piece[]{return active().unsupported().map(piece=>{const cells=piece.voxels.map(i=>source.id(i)).sort((a,b)=>a-b);return {id:`unsupported-${cells[0]}`,cells};}).sort((a,b)=>a.cells[0]-b.cells[0]);},
  reset,
  dispose(){graph=undefined;nextToken=undefined;},
  diagnostics(){return graph?{disposed:false,...graph.diagnostics()}:{disposed:true,cells:0,chunks:0,liveMembers:0,directedEdges:0,typedBufferBytes:0,storedNeighborSlots:0,retainedVoxelRecords:0};},
 };
}
async function validate(store:CompactAuthorityStore,options:CompactSupportOptions) {
 const source=new CompactSupportLattice(store.fixture);
 if(options.expectation.mapId!==(store.fixture.map??store.fixture.id))throw new Error('Wrong fixture map recipe');
 const decoded=await decodePristineBrowser(options.artifactBytes,options.expectation);
 const token=await validatePristineBrowser(source,decoded);
 return {source,token};
}
/** No live authority writes occur before, during, or after validation. The caller
 * awaits this graph before replacing an existing simulation/world. */
export async function createCompactSupport(store:CompactAuthorityStore,options?:CompactSupportOptions):Promise<CompactSupportGraph> {
 if(!options){
  if(!store.fixture.map)throw new Error('Pass compiled support artifact bytes and manifest for a custom fixture');
  if(hostAssetLoader)options=await hostAssetLoader(store.fixture.map);
  else {
   if(typeof window==='undefined')throw new Error('Pass compiled support artifact bytes and manifest outside the browser');
   options=await (await import('./assets.js')).loadCompactSupportAsset(store.fixture.map);
  }
 }
 const {source,token}=await validate(store,options);
 return hydrateGraph(store,source,token);
}
/** Optional setup factory for repeated independent graphs over the same immutable
 * fixture and store. Each graph owns its own reset template and live presence. */
export async function prepareCompactSupport(store:CompactAuthorityStore,options:CompactSupportOptions):Promise<()=>CompactSupportGraph> {
 const {source,token}=await validate(store,options),next=createPristineTokenFactory(source,token);
 return ()=>hydrateGraph(store,source,next());
}
