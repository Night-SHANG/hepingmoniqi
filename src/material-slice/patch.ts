import {buildMaterialGreedyChunk,type MaterialSurfaceSource} from './geometry';
import {buildCellColorData} from './cell-colors';
import type {ChunkMesh} from '../worker-slice/chunk-mesh';
/** Experimental complete replacement. Texture payload participates in the same
 * epoch, revision, ownership and byte-credit protocol as its geometry. */
export function buildMaterialPatch(source:MaterialSurfaceSource,key:string,size=32):ChunkMesh {
 const geometry=buildMaterialGreedyChunk(source,key,size);
 if(!geometry.faces)return geometry;
 const cellColors=buildCellColorData(source,key,size);
 return {...geometry,cellColors,stats:{...geometry.stats,queriedCells:geometry.stats.queriedCells+cellColors.stats.queriedCells,outputBytes:geometry.stats.outputBytes+cellColors.stats.totalTextureBytes}};
}
