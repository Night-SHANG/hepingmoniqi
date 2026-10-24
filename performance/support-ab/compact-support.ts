// THROWAWAY exact cell-connectivity proof, not a simulation replacement.
// Implicit finite terrain coordinates + sparse structure numeric occupancy.
// No neighbor records, native physics worlds, or pristine ground Cell values.
import type { Cell, Piece, Point } from '../../src/structural/types.ts';
import type { CompactTerrain, Bounds } from '../terrain/compact-terrain.ts';
interface TerrainInput { terrain: CompactTerrain; bounds: Bounds }
export class CompactSupport {
  private readonly terrain?: CompactTerrain;
  private readonly b?: Readonly<Bounds>;
  private readonly depth:number;
  private readonly groundCount:number;
  private readonly count:number;
  private readonly present:Uint8Array;
  private readonly seen:Uint32Array;
  private readonly queue:Int32Array;
  private readonly ids:Float64Array;
  private readonly xyz:Float64Array;
  private readonly anchors:Uint8Array;
  private readonly idIndex=new Map<number,number>();
  private readonly structureOccupancy=new Map<number,number>();
  private readonly minX:number; private readonly minY:number; private readonly minZ:number;
  private readonly keyHeight:number; private readonly keyDepth:number;
  private readonly maxX:number; private readonly maxY:number; private readonly maxZ:number;
  private generation=0; private tail=0; private live:number;
  private groundLookups=0; private outputCells=0; private queries=0;
  constructor(cells:readonly Cell[], input?:TerrainInput){
    this.terrain=input?.terrain;this.b=input?Object.freeze({minX:input.bounds.minX,maxX:input.bounds.maxX,minZ:input.bounds.minZ,maxZ:input.bounds.maxZ}):undefined;
    if(this.b&&!Object.values(this.b).every(n=>Number.isSafeInteger(n)&&n>=-2147483648&&n<=2147483647))throw new Error('Terrain requires bounded Int32 coordinates in this proof');
    if(input&&input.terrain.diagnostics().mutableChunks!==0)throw new Error('This isolated graph takes a pristine descriptor; removals are owned here');
    this.depth=this.b?this.b.maxZ-this.b.minZ+1:0;
    this.groundCount=this.b?(this.b.maxX-this.b.minX+1)*this.depth*8:0;
    if(input&&(this.groundCount!==input.terrain.cellCount||input.terrain.idAt(this.b!.minX,-1,this.b!.minZ)===null||input.terrain.idAt(this.b!.maxX,-8,this.b!.maxZ)===null))throw new Error('Descriptor bounds mismatch');
    this.count=this.groundCount+cells.length;this.live=this.count;
    if(!Number.isSafeInteger(this.count)||this.count>=2**31)throw new Error('Compact traversal capacity exceeded');
    let minX=this.b?.minX??Infinity,maxX=this.b?.maxX??-Infinity,minY=this.b?-8:Infinity,maxY=this.b?-1:-Infinity,minZ=this.b?.minZ??Infinity,maxZ=this.b?.maxZ??-Infinity;
    for(const c of cells){
      if(!Number.isSafeInteger(c.id))throw new Error('Cell id must be a safe integer');
      const {x,y,z}=c.position;
      if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||!Number.isSafeInteger(z))throw new Error('Cell positions must use a safe integer unit lattice');
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
    }
    if(!this.count){minX=minY=minZ=maxX=maxY=maxZ=0;}
    // Include one-cell padding so neighbor queries outside the box cannot alias.
    this.minX=minX-1;this.minY=minY-1;this.minZ=minZ-1;
    this.maxX=maxX;this.maxY=maxY;this.maxZ=maxZ;
    this.keyHeight=maxY-minY+3;this.keyDepth=maxZ-minZ+3;
    if(!Number.isSafeInteger((maxX-minX+3)*this.keyHeight*this.keyDepth))throw new Error('Finite compact coordinate key exceeds safe integer range');
    this.present=new Uint8Array(this.count).fill(1);this.seen=new Uint32Array(this.count);this.queue=new Int32Array(this.count);
    this.ids=new Float64Array(cells.length);this.xyz=new Float64Array(cells.length*3);this.anchors=new Uint8Array(cells.length);
    for(let s=0;s<cells.length;s++){
      const c=cells[s],{x,y,z}=c.position,index=this.groundCount+s;
      if(this.idIndex.has(c.id)||(c.id<0&&c.id>=-this.groundCount))throw new Error(`Duplicate cell id: ${c.id}`);
      const key=this.key(x,y,z);
      if(this.structureOccupancy.has(key)||this.groundAt(x,y,z)>=0)throw new Error(`Overlapping occupied cell at ${x},${y},${z}`);
      this.ids[s]=c.id;this.xyz[s*3]=x;this.xyz[s*3+1]=y;this.xyz[s*3+2]=z;this.anchors[s]=c.anchor===true?1:0;
      this.idIndex.set(c.id,index);this.structureOccupancy.set(key,index);
    }
  }
  private key(x:number,y:number,z:number){return ((x-this.minX)*this.keyHeight+(y-this.minY))*this.keyDepth+(z-this.minZ);}
  private groundAt(x:number,y:number,z:number):number{
    const b=this.b;if(!b||x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ||y> -1||y< -8)return -1;
    return ((x-b.minX)*this.depth+(z-b.minZ))*8-y-1;
  }
  private indexAt(x:number,y:number,z:number):number{
    if(x<=this.minX||x>this.maxX||y<=this.minY||y>this.maxY||z<=this.minZ||z>this.maxZ)return -1;
    const g=this.groundAt(x,y,z);return g>=0?g:(this.structureOccupancy.get(this.key(x,y,z))??-1);
  }
  removeAt(x:number,y:number,z:number):boolean{
    if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||!Number.isSafeInteger(z))return false;
    const index=this.indexAt(x,y,z);if(index<0||!this.present[index])return false;
    this.present[index]=0;this.live--;return true;
  }
  remove(ids:readonly number[]):void{
    if(this.terrain&&this.terrain.diagnostics().mutableChunks!==0)throw new Error('Descriptor mutated after construction; this proof requires a pristine descriptor');
    for(const id of ids){
      let index=this.idIndex.get(id);
      if(index===undefined&&this.terrain&&Number.isSafeInteger(id)&&id<0&&id>=-this.groundCount){
        // Bounded changed-ID adapter only; never used for flood or construction.
        const p=this.terrain.cell(id)!.position;this.groundLookups++;index=this.groundAt(p.x,p.y,p.z);
      }
      if(index!==undefined&&index>=0&&this.present[index]){this.present[index]=0;this.live--;}
    }
  }
  /** Exact bounded sphere occupancy removal. No damage/impulse/dynamics claim. */
  removeSphere(at:Point,radius:number):number{
    if(!Number.isFinite(radius)||radius<0||![at.x,at.y,at.z].every(Number.isFinite))throw new Error('Invalid bounded sphere');
    let removed=0;
    // Clamp before iteration, including centers where x++ would not advance.
    const minX=Math.max(this.minX+1,Math.ceil(at.x-radius)),maxX=Math.min(this.maxX,Math.floor(at.x+radius));
    const minY=Math.max(this.minY+1,Math.ceil(at.y-radius)),maxY=Math.min(this.maxY,Math.floor(at.y+radius));
    const minZ=Math.max(this.minZ+1,Math.ceil(at.z-radius)),maxZ=Math.min(this.maxZ,Math.floor(at.z+radius));
    for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++)for(let z=minZ;z<=maxZ;z++)
      if(Math.hypot(x-at.x,y-at.y,z-at.z)<=radius&&this.removeAt(x,y,z))removed++;
    return removed;
  }
  private enqueue(index:number):void{
    if(index>=0&&this.present[index]&&this.seen[index]!==this.generation){this.seen[index]=this.generation;this.queue[this.tail++]=index;}
  }
  private flood():void{
    const b=this.b,depth=this.depth,ground=this.groundCount,stride=depth*8;
    for(let head=0;head<this.tail;head++){
      const n=this.queue[head];
      if(n<ground){
        const layer=n%8,column=Math.floor(n/8),z=column%depth,x=Math.floor(column/depth);
        if(x>0)this.enqueue(n-stride);if(x<b!.maxX-b!.minX)this.enqueue(n+stride);
        if(z>0)this.enqueue(n-8);if(z<depth-1)this.enqueue(n+8);
        if(layer>0)this.enqueue(n-1);else this.enqueue(this.structureOccupancy.get(this.key(x+b!.minX,0,z+b!.minZ))??-1);
        if(layer<7)this.enqueue(n+1);
        // Structure cells adjacent to the side/bottom of a finite terrain slab
        // are allowed by the generic fixture API, though absent in current city.
        if(x===0)this.enqueue(this.structureOccupancy.get(this.key(b!.minX-1,-layer-1,z+b!.minZ))??-1);
        if(x===b!.maxX-b!.minX)this.enqueue(this.structureOccupancy.get(this.key(b!.maxX+1,-layer-1,z+b!.minZ))??-1);
        if(z===0)this.enqueue(this.structureOccupancy.get(this.key(x+b!.minX,-layer-1,b!.minZ-1))??-1);
        if(z===depth-1)this.enqueue(this.structureOccupancy.get(this.key(x+b!.minX,-layer-1,b!.maxZ+1))??-1);
        if(layer===7)this.enqueue(this.structureOccupancy.get(this.key(x+b!.minX,-9,z+b!.minZ))??-1);
      }else{
        const s=(n-ground)*3,x=this.xyz[s],y=this.xyz[s+1],z=this.xyz[s+2];
        this.enqueue(this.indexAt(x-1,y,z));this.enqueue(this.indexAt(x+1,y,z));
        this.enqueue(this.indexAt(x,y-1,z));this.enqueue(this.indexAt(x,y+1,z));
        this.enqueue(this.indexAt(x,y,z-1));this.enqueue(this.indexAt(x,y,z+1));
      }
    }
  }
  private idAtIndex(index:number):number{
    if(index>=this.groundCount)return this.ids[index-this.groundCount];
    const column=Math.floor(index/8);return this.terrain!.idAt(this.b!.minX+Math.floor(column/this.depth),-1-index%8,this.b!.minZ+column%this.depth)!;
  }
  unsupported():Piece[]{
    this.queries++;this.generation=(this.generation+1)>>>0;if(this.generation===0){this.seen.fill(0);this.generation=1;}
    this.tail=0;const b=this.b;
    if(b)for(let x=b.minX;x<=b.maxX;x++)for(let z=b.minZ;z<=b.maxZ;z++)if(x===b.minX||x===b.maxX||z===b.minZ||z===b.maxZ)this.enqueue(this.groundAt(x,-8,z));
    for(let s=0;s<this.anchors.length;s++)if(this.anchors[s])this.enqueue(this.groundCount+s);
    this.flood();const pieces:Piece[]=[];
    for(let n=0;n<this.count;n++)if(this.present[n]&&this.seen[n]!==this.generation){
      this.tail=0;this.enqueue(n);this.flood();const cells:number[]=[];
      for(let i=0;i<this.tail;i++)cells.push(this.idAtIndex(this.queue[i]));
      this.outputCells+=cells.length;cells.sort((a,b)=>a-b);pieces.push({id:`unsupported-${cells[0]}`,cells});
    }
    return pieces.sort((a,b)=>a.cells[0]-b.cells[0]);
  }
  diagnostics(){
    const buffers={present:this.present.byteLength,seen:this.seen.byteLength,queue:this.queue.byteLength,structureIds:this.ids.byteLength,structureCoordinates:this.xyz.byteLength,structureAnchors:this.anchors.byteLength};
    return {groundCells:this.groundCount,structureCells:this.ids.length,totalCells:this.count,liveCells:this.live,buffers,typedBufferBytes:Object.values(buffers).reduce((a,b)=>a+b,0),terrainDescriptorBytes:this.terrain?.diagnostics().columnIndexBytes??0,
      allocations:{groundCellObjects:this.groundLookups,neighborObjects:0,traversalQueueArrays:1,typedArrays:6,structurePositionMapEntries:this.structureOccupancy.size,structureIdMapEntries:this.idIndex.size,cumulativeReturnedDisconnectedIds:this.outputCells},supportQueries:this.queries};
  }
}
