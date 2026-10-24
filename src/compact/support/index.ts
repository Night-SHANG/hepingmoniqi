import type {CompactAuthorityStore} from '../store.js';
import type {CompactFixture} from '../fixture.js';
import {isManagedCompactFixture} from '../managed-fixture.js';
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
interface ValidatedTemplate {source:CompactSupportLattice;nextToken:()=>ValidatedPristine}
interface TemplateNamespace {
 entries:WeakMap<CompactFixture,Promise<ValidatedTemplate>>;
 lru:Map<CompactFixture,Promise<ValidatedTemplate>>;
}
const newNamespace=():TemplateNamespace=>({entries:new WeakMap(),lru:new Map()});
let templates=newNamespace();
function resetTemplateNamespace():void {
 templates.entries=new WeakMap();templates.lru.clear();templates=newNamespace();
}
/** Environment injection only: loaders supply the same untrusted bytes/manifest
 * that browser fetching supplies. Native tests still execute full validation. */
export function configureCompactSupportAssetLoader(loader:CompactSupportAssetLoader):()=>void {
 if(hostAssetLoader)throw new Error('A compact support asset loader is already configured');
 hostAssetLoader=loader;resetTemplateNamespace();let active=true;
 return ()=>{if(active&&hostAssetLoader===loader){hostAssetLoader=undefined;resetTemplateNamespace();}active=false;};
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
async function validate(fixture:CompactFixture,options:CompactSupportOptions) {
 const source=new CompactSupportLattice(fixture);
 if(options.expectation.mapId!==(fixture.map??fixture.id))throw new Error('Wrong fixture map recipe');
 const decoded=await decodePristineBrowser(options.artifactBytes,options.expectation);
 const token=await validatePristineBrowser(source,decoded);
 return {source,token};
}
async function loadAsset(fixture:CompactFixture):Promise<CompactSupportOptions> {
 if(!fixture.map)throw new Error('Pass compiled support artifact bytes and manifest for a custom fixture');
 if(hostAssetLoader)return hostAssetLoader(fixture.map);
 if(typeof window==='undefined')throw new Error('Pass compiled support artifact bytes and manifest outside the browser');
 return (await import('./assets.js')).loadCompactSupportAsset(fixture.map);
}
/** Cache only an owned validated pristine template, never a live store, graph,
 * or a store-bound graph factory. Pending entries count toward the same limit.
 * Completion never inserts, so eviction and namespace resets cannot resurrect
 * an old promise. Existing callers may still finish their independent graph. */
function managedTemplate(fixture:CompactFixture):Promise<ValidatedTemplate> {
 const cache=templates,found=cache.entries.get(fixture);
 if(found){cache.lru.delete(fixture);cache.lru.set(fixture,found);return found;}
 const pending=(async()=>{
  const {source,token}=await validate(fixture,await loadAsset(fixture));
  return {source,nextToken:createPristineTokenFactory(source,token)};
 })();
 cache.entries.set(fixture,pending);cache.lru.set(fixture,pending);
 if(cache.lru.size>2){const oldest=cache.lru.keys().next().value!;cache.lru.delete(oldest);cache.entries.delete(oldest);}
 void pending.catch(()=>{if(cache.entries.get(fixture)===pending){cache.entries.delete(fixture);cache.lru.delete(fixture);}});
 return pending;
}
/** No live authority writes occur before, during, or after validation. The caller
 * awaits this graph before replacing an existing simulation/world. Only exact
 * managed immutable fixtures without explicit artifacts qualify for reuse. */
export async function createCompactSupport(store:CompactAuthorityStore,options?:CompactSupportOptions):Promise<CompactSupportGraph> {
 if(options===undefined&&isManagedCompactFixture(store.fixture)){
  const {source,nextToken}=await managedTemplate(store.fixture);
  return hydrateGraph(store,source,nextToken());
 }
 const {source,token}=await validate(store.fixture,options??await loadAsset(store.fixture));
 return hydrateGraph(store,source,token);
}
/** Optional setup factory for repeated independent graphs over the same immutable
 * fixture and store. Each graph owns its own reset template and live presence. */
export async function prepareCompactSupport(store:CompactAuthorityStore,options:CompactSupportOptions):Promise<()=>CompactSupportGraph> {
 const {source,token}=await validate(store.fixture,options),next=createPristineTokenFactory(source,token);
 return ()=>hydrateGraph(store,source,next());
}
