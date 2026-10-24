// Shared fixture orchestration for native profiles and browser diagnostics.
// This is not a game integration. Terrain Cell enumeration is forbidden.
import {CompactStructures} from '../structure-store/compact-structures.ts';
import {CompactTerrain} from '../terrain/compact-terrain.ts';
import {legacyLayoutColumns} from '../terrain/legacy-layout-columns.ts';
import {sparseStructureFixture} from '../support-ab/sparse-structure-fixture.ts';
function forbidden():never {throw new Error('No ground Cell or structure CellView materialization permitted');}
export function citySource(){
 const layout=legacyLayoutColumns('city'),terrain=new CompactTerrain(layout.config),input={terrain,bounds:{minX:layout.config.minX,maxX:layout.config.maxX,minZ:layout.config.minZ,maxZ:layout.config.maxZ},objectId:'game:city:geology'};
 const fixture=sparseStructureFixture('city'),buildings=new Map<string,{minX:number;maxX:number;minZ:number;maxZ:number}>();
 for(const c of fixture.cells)if(c.role==='foundation'||c.role==='building'){
  const p=c.position,b=buildings.get(c.objectId);if(b){b.minX=Math.min(b.minX,p.x);b.maxX=Math.max(b.maxX,p.x);b.minZ=Math.min(b.minZ,p.z);b.maxZ=Math.max(b.maxZ,p.z);}else buildings.set(c.objectId,{minX:p.x,maxX:p.x,minZ:p.z,maxZ:p.z});
 }
 const at=performance.now(),store=new CompactStructures(fixture.cells),packingMs=performance.now()-at;
 terrain.cell=forbidden;store.cell=forbidden;
 return {store,input,locations:[...buildings.values()],packingMs,sourceAllocations:fixture.allocations};
}
