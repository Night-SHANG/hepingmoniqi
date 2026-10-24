// Isolated compact-access adaptation. Not imported by production, no physics/browser.
import type { CompactStructures } from '../structure-store/compact-structures.ts';
import type { CompactTerrain, Bounds } from '../terrain/compact-terrain.ts';
import type { Piece, Point } from '../../hepingmoniqi-v09/src/structural/types.ts';
import { IndexedStructure, type IndexedLattice } from './indexed-structure.ts';
export interface TerrainInput { terrain: CompactTerrain; bounds: Bounds; objectId: string }

/** Public IDs remain stable; dense indices only address graph bitmaps/chunk members.
 * Original terrain IDs form [-groundCount,-1]. Sparse structure IDs on either side
 * are merged without an all-terrain ID Map or permutation table.
 */
export class CompactLattice implements IndexedLattice {
  readonly count:number;
  readonly groundCount:number;
  private readonly below:number;
  readonly bounds?:Readonly<Bounds>;
  readonly extent:Readonly<{minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number}>;
  readonly terrain?:Readonly<TerrainInput>;
  constructor(readonly structures:CompactStructures,terrain?:TerrainInput){
    if(structures.diagnostics().changedCells>0||terrain&&terrain.terrain.diagnostics().changedCells>0)throw new Error('Support initialization requires pristine stores; replay removals explicitly');
    this.terrain=terrain?Object.freeze({terrain:terrain.terrain,bounds:Object.freeze({...terrain.bounds}),objectId:terrain.objectId}):undefined;
    this.bounds=terrain?Object.freeze({...terrain.bounds}):undefined;
    const b=this.bounds;
    this.groundCount=terrain?.terrain.cellCount??0;this.count=this.groundCount+structures.cellCount;
    if(this.count>=2**31)throw new Error('Graph capacity exceeds Int32');
    if(b&&(![b.minX,b.maxX,b.minZ,b.maxZ].every(n=>Number.isInteger(n)&&n>=-2147483648&&n<=2147483647)||b.maxX<b.minX||b.maxZ<b.minZ))throw new Error('Terrain requires finite Int32 bounds');
    if(terrain&&((b!.maxX-b!.minX+1)*(b!.maxZ-b!.minZ+1)*8!==this.groundCount||terrain.terrain.idAt(b!.minX,-1,b!.minZ)===null||terrain.terrain.idAt(b!.maxX,-8,b!.maxZ)===null))throw new Error('Terrain descriptor bounds mismatch');
    let below=0,minX=b?.minX??Infinity,maxX=b?.maxX??-Infinity,minY=b?-8:Infinity,maxY=b?-1:-Infinity,minZ=b?.minZ??Infinity,maxZ=b?.maxZ??-Infinity;
    for(let s=0;s<structures.cellCount;s++){
      const id=structures.idAtIndex(s)!,x=structures.xAt(s)!,y=structures.yAt(s)!,z=structures.zAt(s)!;
      if(this.groundCount&&id>=-this.groundCount&&id<0)throw new Error('Duplicate terrain/structure ID');
      if(id< -this.groundCount)below++;
      if(terrain&&terrain.terrain.idAt(x,y,z)!==null)throw new Error('Overlapping terrain/structure occupancy');
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
    }
    this.below=below;this.extent=Object.freeze({minX,maxX,minY,maxY,minZ,maxZ});
  }
  private isGround(i:number){return i>=this.below&&i<this.below+this.groundCount;}
  private structureIndex(i:number){return i<this.below?i:i-this.groundCount;}
  private fromStructureIndex(s:number){return s<this.below?s:s+this.groundCount;}
  id(i:number):number{return this.isGround(i)?i-this.below-this.groundCount:this.structures.idAtIndex(this.structureIndex(i))!;}
  index(id:number):number{
    if(!Number.isSafeInteger(id))return -1;
    if(id>=-this.groundCount&&id<0)return id+this.groundCount+this.below;
    const s=this.structures.indexOf(id);return s<0?-1:this.fromStructureIndex(s);
  }
  position(i:number):Point{
    if(this.isGround(i))return this.terrain!.terrain.originalPosition(this.id(i))!;
    const s=this.structureIndex(i);return {x:this.structures.xAt(s)!,y:this.structures.yAt(s)!,z:this.structures.zAt(s)!};
  }
  material(i:number):string{return this.isGround(i)?'soil':this.structures.materialAt(this.structureIndex(i))!;}
  objectId(i:number):string{return this.isGround(i)?this.terrain!.objectId:this.structures.objectIdAt(this.structureIndex(i))!;}
  anchor(i:number):boolean{
    if(!this.isGround(i))return this.structures.anchorAt(this.structureIndex(i))===true;
    const p=this.position(i),b=this.bounds!;return p.y===-8&&(p.x===b.minX||p.x===b.maxX||p.z===b.minZ||p.z===b.maxZ);
  }
  at(x:number,y:number,z:number):number{
    const ground=this.terrain?.terrain.idAt(x,y,z);if(ground!==null&&ground!==undefined)return ground+this.groundCount+this.below;
    const s=this.structures.indexAt(x,y,z);return s<0?-1:this.fromStructureIndex(s);
  }
  neighbours(i:number,fn:(neighbor:number,axis:number)=>void):void{
    const {x,y,z}=this.position(i);
    // ORIGINAL occupancy, not terrain.staticAt/structures.staticAt. The algorithm
    // alone applies present/done in leave and split, including within a batch.
    let u=this.at(x-1,y,z);if(u>=0)fn(u,0);u=this.at(x+1,y,z);if(u>=0)fn(u,1);
    u=this.at(x,y-1,z);if(u>=0)fn(u,2);u=this.at(x,y+1,z);if(u>=0)fn(u,3);
    u=this.at(x,y,z-1);if(u>=0)fn(u,4);u=this.at(x,y,z+1);if(u>=0)fn(u,5);
  }
}
export class CompactIncrementalSupport {
  private readonly source:CompactLattice;
  private readonly structure:IndexedStructure;
  constructor(structures:CompactStructures,terrain?:TerrainInput,seed=11,initialize?:(source:CompactLattice)=>IndexedStructure){this.source=new CompactLattice(structures,terrain);this.structure=initialize?initialize(this.source):new IndexedStructure(this.source,seed);}
  remove(ids:readonly number[]):void{
    const indices:number[]=[];for(const id of ids){const i=this.source.index(id);if(i>=0)indices.push(i);}this.structure.leave(indices);
  }
  /** Occupancy-only benchmark cuts. This is not HP, blast, or detachment logic. */
  removeSphere(at:Point,radius:number):number{
    if(![at.x,at.y,at.z,radius].every(Number.isFinite)||radius<0)throw new Error('Invalid sphere');
    const e=this.source.extent,indices:number[]=[];
    for(let x=Math.max(e.minX,Math.ceil(at.x-radius));x<=Math.min(e.maxX,Math.floor(at.x+radius));x++)
      for(let y=Math.max(e.minY,Math.ceil(at.y-radius));y<=Math.min(e.maxY,Math.floor(at.y+radius));y++)
        for(let z=Math.max(e.minZ,Math.ceil(at.z-radius));z<=Math.min(e.maxZ,Math.floor(at.z+radius));z++)if(Math.hypot(x-at.x,y-at.y,z-at.z)<=radius){const i=this.source.at(x,y,z);if(i>=0)indices.push(i);}
    const before=this.structure.diagnostics().liveMembers;this.structure.leave(indices);return before-this.structure.diagnostics().liveMembers;
  }
  unsupported():Piece[]{
    return this.structure.unsupported().map(piece=>{const cells=piece.voxels.map(v=>this.source.id(v)).sort((a,b)=>a-b);return {id:`unsupported-${cells[0]}`,cells};}).sort((a,b)=>a.cells[0]-b.cells[0]);
  }
  /** Explicit debug snapshot for bounded exact chunk/face parity tests only. */
  partition(){return this.structure.chunks.map(ch=>({objectId:ch.objectId,voxels:ch.voxels.map(v=>this.source.id(v)),ground:ch.ground,edges:[...ch.edges]}));}
  diagnostics(){return {...this.structure.diagnostics(),groundCells:this.source.groundCount,structureCells:this.source.structures.cellCount,structureStore:this.source.structures.diagnostics(),terrainDescriptor:this.source.terrain?.terrain.diagnostics(),setup:this.structure.setup};}
}
