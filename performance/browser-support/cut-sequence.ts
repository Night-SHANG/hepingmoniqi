// The same bounded sphere-selection and ordered-result adapter used by the
// native profile and browser diagnostic. Graph algorithms are not duplicated.
import type {CompactLattice} from '../incremental-support/incremental-support.ts';
import type {IndexedStructure} from '../incremental-support/indexed-structure.ts';
export interface BuildingBounds {minX:number;maxX:number;minZ:number;maxZ:number}
export function applyCityCut(source:CompactLattice,graph:IndexedStructure,locations:BuildingBounds[],i:number):number {
 if(!Number.isInteger(i)||i<0||i>=20||locations.length<36)throw new Error('Invalid fixed city cut');
 const b=locations[(i*7)%36],at={x:(b.minX+b.maxX)/2,y:i%4===3?-5:-1,z:(b.minZ+b.maxZ)/2},radius=5.5+(i%3)*1.2,e=source.extent,indices:number[]=[];
 for(let x=Math.max(e.minX,Math.ceil(at.x-radius));x<=Math.min(e.maxX,Math.floor(at.x+radius));x++)for(let y=Math.max(e.minY,Math.ceil(at.y-radius));y<=Math.min(e.maxY,Math.floor(at.y+radius));y++)for(let z=Math.max(e.minZ,Math.ceil(at.z-radius));z<=Math.min(e.maxZ,Math.floor(at.z+radius));z++)if(Math.hypot(x-at.x,y-at.y,z-at.z)<=radius){const index=source.at(x,y,z);if(index>=0)indices.push(index);}
 const before=graph.diagnostics().liveMembers;graph.leave(indices);return before-graph.diagnostics().liveMembers;
}
export function orderedUnsupported(source:CompactLattice,graph:IndexedStructure){return graph.unsupported().map(piece=>{const cells=piece.voxels.map(v=>source.id(v)).sort((a,b)=>a-b);return {id:`unsupported-${cells[0]}`,cells};}).sort((a,b)=>a.cells[0]-b.cells[0]);}
