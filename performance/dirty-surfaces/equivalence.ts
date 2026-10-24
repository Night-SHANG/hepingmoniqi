import assert from 'node:assert/strict';
import {buildSurface} from '../preview/surface.ts';
import {sparseStructureFixture} from '../support-ab/sparse-structure-fixture.ts';
import {WORLD_BOUNDS} from '../../src/world-layout.ts';
import {CompactTerrain} from '../terrain/compact-terrain.ts';
import {CompactStructures} from '../structure-store/compact-structures.ts';
import {CompactSurfaceSource,DirtySurfaceChunks} from './dirty-surfaces.ts';
import {hashGeometry} from './verify-geometry.ts';
const t=performance.now(),b=WORLD_BOUNDS.city,bounds={minX:-b.halfX,maxX:b.halfX,minZ:-b.halfZ,maxZ:b.halfZ};
const sourceCells=sparseStructureFixture('city').cells;
const oracle=buildSurface({...b,depth:8},sourceCells,(x,y,z)=>y===-1?[0x8b9650,0x9aa45a,0x778448][Math.abs(x*7+z*11)%3]:[0x775238,0x8b6240,0x9a7048][Math.abs(x*73+y*31+z*17)%3],false);
const expected=hashGeometry([oracle]);assert.equal(expected.faces,203018);
const source=new CompactSurfaceSource(new CompactTerrain({map:'city',...bounds}),new CompactStructures(sourceCells),bounds);
// Assert adapter really uses scalar occupancy and colors, not CellViews.
source.terrain.cell=()=>{throw new Error('Terrain CellView queried by renderer');};source.structures.cell=()=>{throw new Error('Structure CellView queried by renderer');};
const outputs=[];
for(const size of [16,32]){const mesh=new DirtySurfaceChunks(source,size),initial=mesh.initialize(),hash=hashGeometry(mesh.geometries());assert.deepEqual(hash,expected);outputs.push({chunkSize:size,hash,initial,diagnostics:mesh.diagnostics()});}
console.log(JSON.stringify({scope:'Exact CPU positions (all 6 vertices per face), normals, and uint32 color hash against existing preview oracle previously dense-certified; no whole-city terrain Cell array, no Rapier, no browser/GPU claim',structureSourceCells:sourceCells.length,terrainCellObjects:0,expected,outputs,ms:performance.now()-t},null,2));
