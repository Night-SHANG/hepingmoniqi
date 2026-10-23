import { SparseStructure, random, type LatticeVoxel } from '../../vendor/three-voxel-destruction/structure.js';
import { fragments } from '../../vendor/three-voxel-destruction/fragments.js';
import type { Cell, Piece, Point, SupportGraph } from './types.js';

interface Snapshot { ids:number[]; voxels:LatticeVoxel[] }
const key=(x:number,y:number,z:number):string=>`${x},${y},${z}`;
const offsets=[[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]] as const;

/** Copy the public data so support bookkeeping never writes to or depends on caller mutation. */
function snapshot(cells:readonly Cell[]):Snapshot {
  const ids:number[]=[],voxels:LatticeVoxel[]=[];
  const seenIds=new Set<number>(),occupied=new Set<string>();
  for(const cell of [...cells].sort((a,b)=>a.id-b.id)) {
    if(!Number.isSafeInteger(cell.id))throw new Error('Cell id must be a safe integer');
    if(seenIds.has(cell.id))throw new Error(`Duplicate cell id: ${cell.id}`);
    const {x,y,z}=cell.position;
    if(![x,y,z].every(Number.isSafeInteger))throw new Error('Cell positions must use a safe integer unit lattice');
    const location=key(x,y,z);
    if(occupied.has(location))throw new Error(`Overlapping occupied cell at ${location}`);
    seenIds.add(cell.id);occupied.add(location);ids.push(cell.id);
    voxels.push({x,y,z,objectId:cell.objectId,material:cell.material,anchor:cell.anchor===true});
  }
  return {ids,voxels};
}

/** Global occupancy support. Only caller-supplied explicit map-boundary roots anchor cells. */
export function createSupportGraph(cells:readonly Cell[]):SupportGraph {
  const {ids,voxels}=snapshot(cells);
  const indexOf=new Map(ids.map((id,index)=>[id,index]));
  const structure=new SparseStructure(voxels);
  return {
    remove(removed:readonly number[]):void {
      const indices:number[]=[];
      for(const id of removed){const index=indexOf.get(id);if(index!==undefined)indices.push(index);}
      structure.leave(indices);
    },
    unsupported():Piece[] {
      return structure.unsupported().map(piece=>{
        const cells=piece.voxels.map(v=>ids[v]).sort((a,b)=>a-b);
        // Every component has a unique minimum cell ID, stable across repeat reads.
        return {id:`unsupported-${cells[0]}`,cells};
      }).sort((a,b)=>a.cells[0]-b.cells[0]);
    },
  };
}

/**
 * Optional deterministic fracture partition. Real upstream weighted-seed code supplies
 * the Voronoi labels; a final six-face/material flood prevents disconnected rigid groups.
 * Does not remove cells, create bodies, or mutate the support graph.
 */
export function fractureCellIds(cells:readonly Cell[],at:Point,mean:number,seed=11):number[][] {
  if(!Number.isFinite(mean)||mean<=0)throw new Error('Fracture mean must be positive and finite');
  if(![at.x,at.y,at.z].every(Number.isFinite))throw new Error('Fracture origin must be finite');
  const {ids,voxels}=snapshot(cells);
  const labels=fragments(voxels,[at.x,at.y,at.z],mean,random(seed));
  const occupied=new Map(voxels.map((v,i)=>[key(v.x,v.y,v.z),i]));
  const seen=new Uint8Array(voxels.length),groups:number[][]=[];
  for(let start=0;start<voxels.length;start++) {
    if(seen[start])continue;
    const group=[start];seen[start]=1;
    for(let n=0;n<group.length;n++) {
      const p=voxels[group[n]];
      for(const [dx,dy,dz]of offsets) {
        const u=occupied.get(key(p.x+dx,p.y+dy,p.z+dz));
        if(u!==undefined&&!seen[u]&&labels.get(u)===labels.get(start)&&voxels[u].material===voxels[start].material) {
          seen[u]=1;group.push(u);
        }
      }
    }
    groups.push(group.map(v=>ids[v]).sort((a,b)=>a-b));
  }
  return groups.sort((a,b)=>a[0]-b[0]);
}
