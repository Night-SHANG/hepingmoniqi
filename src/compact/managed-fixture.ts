import type {MapId} from '../contracts.js';
import {createCompactGameFixture,type CompactFixture} from './fixture.js';

// Only immutable facades created here qualify for pristine-data reuse. Copying
// labels or wrapping a facade in a Proxy does not transfer this identity proof.
const managed=new WeakSet<CompactFixture>();
const fixtures=new Map<string,CompactFixture>();
const CAPACITY=2;
export function isManagedCompactFixture(fixture:CompactFixture):boolean{return managed.has(fixture);}

/** The typed inventory stays exclusively inside method closures. Freezing the
 * inventory instance itself would still expose writable typed-array columns. */
function facade(source:CompactFixture):CompactFixture {
 return Object.freeze({
  kind:source.kind,id:source.id,map:source.map,version:source.version,recipeId:source.recipeId,
  count:source.count,structureCount:source.structureCount,terrainCount:source.terrainCount,
  totalHp:source.totalHp,objectiveCount:source.objectiveCount,minY:source.minY,
  bounds:Object.freeze({...source.bounds}),initialGoneCount:source.initialGoneCount,initialObjectiveDeparted:source.initialObjectiveDeparted,
  original:source.original.bind(source),originalPosition:source.originalPosition.bind(source),
  ordinal:source.ordinal.bind(source),idAtOrdinal:source.idAtOrdinal.bind(source),idAt:source.idAt.bind(source),
  xOf:source.xOf.bind(source),yOf:source.yOf.bind(source),zOf:source.zOf.bind(source),
  hpOf:source.hpOf.bind(source),maxHpOf:source.maxHpOf.bind(source),colorOf:source.colorOf.bind(source),
  materialOf:source.materialOf.bind(source),roleOf:source.roleOf.bind(source),objectIdOf:source.objectIdOf.bind(source),
  anchorOf:source.anchorOf.bind(source),objectiveOf:source.objectiveOf.bind(source),groupOf:source.groupOf.bind(source),
  neighbor:source.neighbor.bind(source),idsInBounds:source.idsInBounds.bind(source),idsInSphere:source.idsInSphere.bind(source),idsInChunk:source.idsInChunk.bind(source),
  forEachChunk:source.forEachChunk.bind(source),chunkKeys:source.chunkKeys.bind(source),diagnosticCells:source.diagnosticCells.bind(source),diagnostics:source.diagnostics.bind(source),
 });
}
/** Bounded process-local reuse for game entry paths only. The public fresh
 * factory remains unchanged for compatibility and arbitrary fixture testing. */
export function getManagedCompactGameFixture(map:MapId):CompactFixture {
 for(const [key,fixture] of fixtures)if(fixture.map===map){fixtures.delete(key);fixtures.set(key,fixture);return fixture;}
 const fixture=facade(createCompactGameFixture(map));
 const key=JSON.stringify([fixture.map,fixture.version,fixture.recipeId]);
 managed.add(fixture);fixtures.set(key,fixture);
 if(fixtures.size>CAPACITY)fixtures.delete(fixtures.keys().next().value!);
 return fixture;
}
