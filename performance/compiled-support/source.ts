import {readFileSync} from 'node:fs';
import {CompactStructures} from '../structure-store/compact-structures.ts';
import {CompactTerrain} from '../terrain/compact-terrain.ts';
import {legacyLayoutColumns} from '../terrain/legacy-layout-columns.ts';
import {sparseStructureFixture} from '../support-ab/sparse-structure-fixture.ts';
import {sha256,type Recipe} from './pristine-validation.ts';
export const timed=<T>(fn:()=>T)=>{const at=performance.now(),value=fn();return {value,ms:performance.now()-at};};
function forbidCellMaterialization():never {throw new Error('No ground Cell or structure CellView materialization permitted');}
export function citySource(){
 const layout=legacyLayoutColumns('city'),terrain=new CompactTerrain(layout.config),input={terrain,bounds:{minX:layout.config.minX,maxX:layout.config.maxX,minZ:layout.config.minZ,maxZ:layout.config.maxZ},objectId:'game:city:geology'};
 const fixture=sparseStructureFixture('city'),buildings=new Map<string,{minX:number;maxX:number;minZ:number;maxZ:number}>();
 for(const c of fixture.cells)if(c.role==='foundation'||c.role==='building'){
  const p=c.position,b=buildings.get(c.objectId);if(b){b.minX=Math.min(b.minX,p.x);b.maxX=Math.max(b.maxX,p.x);b.minZ=Math.min(b.minZ,p.z);b.maxZ=Math.max(b.maxZ,p.z);}else buildings.set(c.objectId,{minX:p.x,maxX:p.x,minZ:p.z,maxZ:p.z});
 }
 const packed=timed(()=>new CompactStructures(fixture.cells));
 terrain.cell=forbidCellMaterialization;packed.value.cell=forbidCellMaterialization;
 return {store:packed.value,input,locations:[...buildings.values()],packingMs:packed.ms,sourceAllocations:fixture.allocations};
}
// Stable relative names and actual bytes, no timestamps or invented version tag.
export function currentRecipe():Recipe {
 const files=['src/structural/fixtures.ts','src/structural/game-fixtures.ts','src/structural/types.ts','src/world-layout.ts','vendor/three-voxel-destruction/structure.ts',
 'performance/terrain/compact-terrain.ts','performance/terrain/legacy-layout-columns.ts','performance/structure-store/compact-structures.ts','performance/support-ab/sparse-structure-fixture.ts',
 'performance/incremental-support/indexed-structure.ts','performance/incremental-support/incremental-support.ts','performance/compiled-support/codec.ts','performance/compiled-support/pristine-validation.ts','performance/compiled-support/source.ts'];
 return {mapId:'city',seed:11,sourceChecksums:Object.fromEntries(files.sort().map(path=>[path,sha256(readFileSync(new URL(`../../${path}`,import.meta.url)))]))};
}
