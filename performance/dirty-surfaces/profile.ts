import assert from 'node:assert/strict';
import {sparseStructureFixture} from '../support-ab/sparse-structure-fixture.ts';
import {WORLD_BOUNDS} from '../../src/world-layout.ts';
import {CompactTerrain} from '../terrain/compact-terrain.ts';
import {CompactStructures} from '../structure-store/compact-structures.ts';
import {CompactSurfaceSource,DirtySurfaceChunks,type SurfaceEdit} from './dirty-surfaces.ts';
const size=Number(process.argv[2]??16),started=performance.now(),b=WORLD_BOUNDS.city,bounds={minX:-b.halfX,maxX:b.halfX,minZ:-b.halfZ,maxZ:b.halfZ};
const structures=new CompactStructures(sparseStructureFixture('city').cells),terrain=new CompactTerrain({map:'city',...bounds});
const source=new CompactSurfaceSource(terrain,structures,bounds),mesh=new DirtySurfaceChunks(source,size),sourceMs=performance.now()-started;
const initial=mesh.initialize();assert.equal(mesh.diagnostics().faces,203018);global.gc?.();const memoryBeforeCuts=process.memoryUsage();
function cut(x:number,z:number){
 const at=performance.now(),edits:SurfaceEdit[]=[];let candidateOccupancyQueries=0;
 for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=0;dy++)for(let dz=-2;dz<=2;dz++)if(dx*dx+dy*dy+dz*dz<=4){
  candidateOccupancyQueries++;const id=terrain.staticAt(x+dx,-1+dy,z+dz);if(id!==null)edits.push(source.captureEdit(id,()=>terrain.damage(id,1e9)));
 }
 mesh.applyEdits(edits);const mutationAndInvalidationMs=performance.now()-at;const rebuild=mesh.rebuildDirty();
 return{center:{x,y:-1,z},removed:edits.length,candidateOccupancyQueries,mutationAdapterColorQueries:edits.length*2,mutationAndInvalidationMs,rebuild};
}
const one=cut(-25,-9),many=[];
for(const z of [-75,-25,25,75])for(const x of [-88,-44,0,44,88])many.push(cut(x,z));
const sum=(pick:(row:typeof one)=>number)=>many.reduce((n,c)=>n+pick(c),0);
const allKeys=new Set(many.flatMap(c=>c.rebuild.keys));
const twenty={cuts:many.length,removed:sum(c=>c.removed),candidateOccupancyQueries:sum(c=>c.candidateOccupancyQueries),mutationAdapterColorQueries:sum(c=>c.mutationAdapterColorQueries),mutationAndInvalidationMs:sum(c=>c.mutationAndInvalidationMs),rebuildMs:sum(c=>c.rebuild.ms),occupancyMs:sum(c=>c.rebuild.occupancyMs),countMs:sum(c=>c.rebuild.countMs),emitMs:sum(c=>c.rebuild.emitMs),rebuiltChunkOperations:sum(c=>c.rebuild.chunks),distinctRebuiltChunks:allKeys.size,queriedCells:sum(c=>c.rebuild.queriedCells),coreCells:sum(c=>c.rebuild.coreCells),outputBytes:sum(c=>c.rebuild.outputBytes),peakTemporaryBytes:Math.max(...many.map(c=>c.rebuild.peakTemporaryBytes)),perCut:many};
console.log(JSON.stringify({scope:'Occupancy-only CPU surface regeneration for radius-2 topsoil cuts. Not blast damage/support search, full solver, physics, render submission, GPU, browser, or FPS. Twenty cuts are sequential additional nonoverlapping cuts, each flushed separately after the first cut.',chunkSize:size,sourceMs,initial,one,twenty,final:mesh.diagnostics(),memoryBeforeCuts,memoryAfterCuts:process.memoryUsage()},null,2));
