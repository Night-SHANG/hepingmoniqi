import type {CompactFixture} from '../fixture.js';
import type {IdentifiedLattice} from './pristine-core.js';

interface TerrainColumns {minX:number;maxX:number;minZ:number;maxZ:number;depth:number;top:Int32Array;stride:Int32Array}

/** Original fixture topology, independent of sparse live-state changes. The
 * contiguous geology ID range needs no full-city permutation or ID map. Only
 * structure IDs are sorted, matching the legacy seeded support iteration. */
export class CompactSupportLattice implements IdentifiedLattice {
 readonly count:number;
 readonly groundCount:number;
 private readonly structures:Float64Array;
 private readonly below:number;
 private readonly contiguousStructureStart:number|undefined;
 private readonly coordinates:{x:Int32Array;y:Int32Array;z:Int32Array}|undefined;
 private readonly terrain:TerrainColumns|undefined;
 constructor(readonly fixture:CompactFixture) {
  this.count=fixture.count;
  if(!Number.isInteger(this.count)||this.count<0||this.count>=2**31)throw new Error('Support graph capacity exceeds Int32');
  this.groundCount=fixture.kind==='compact-fixture'?fixture.terrainCount:0;
  const size=this.count-this.groundCount;
  if(!Number.isInteger(this.groundCount)||this.groundCount<0||size<0)throw new Error('Invalid terrain capacity');
  if(this.groundCount){
   const b=fixture.bounds;
   if(size!==fixture.structureCount||(b.maxX-b.minX+1)*(b.maxZ-b.minZ+1)*8!==this.groundCount)throw new Error('Terrain descriptor bounds mismatch');
  }
  this.structures=new Float64Array(size);
  for(let i=0;i<size;i++){
   const id=fixture.idAtOrdinal(i);
   if(id===undefined||!Number.isSafeInteger(id)||id< -2147483648||id>2147483647)throw new Error('Compiled support requires Int32 IDs');
   if(this.groundCount&&id>=-this.groundCount&&id<0)throw new Error('Duplicate terrain/structure ID');
   const x=fixture.xOf(id),y=fixture.yOf(id),z=fixture.zOf(id);
   if(![x,y,z].every(n=>Number.isInteger(n)&&n>=-2147483648&&n<=2147483647))throw new Error('Compiled support requires an Int32 unit lattice');
   if(fixture.idAt(x,y,z)!==id)throw new Error('Overlapping original occupancy');
   this.structures[i]=id;
  }
  this.structures.sort();
  let below=0;
  for(let i=0;i<size;i++){
   if(i&&this.structures[i]===this.structures[i-1])throw new Error('Duplicate support ID');
   if(this.structures[i]<-this.groundCount)below++;
  }
  this.below=below;
  // Sorted, unique integer IDs prove this optional arithmetic index. Arbitrary
  // and split negative/positive IDs retain the original binary-search fallback.
  this.contiguousStructureStart=size&&this.structures[size-1]-this.structures[0]===size-1?this.structures[0]:undefined;
  if(fixture.kind==='compact-fixture'){
   const x=new Int32Array(size),y=new Int32Array(size),z=new Int32Array(size);
   for(let i=0;i<size;i++){const id=this.structures[i];x[i]=fixture.xOf(id);y[i]=fixture.yOf(id);z[i]=fixture.zOf(id);}
   this.coordinates={x,y,z};
  }
  this.terrain=this.proveTerrainColumns();
 }
 /** A kind/map label is not proof. Check every inferred layer against both
  * original occupancy and its inverse coordinates, including ID uniqueness.
  * Keep only two scalars per x/z column; the temporary seen bits are released.
  * Noncanonical descriptors retain the old accessor route without weakening
  * any of the later topology, anchor, membership or geometric-edge checks. */
 private proveTerrainColumns():TerrainColumns|undefined {
  if(!this.groundCount)return;
  const b=this.fixture.bounds,width=b.maxX-b.minX+1,depth=b.maxZ-b.minZ+1,columns=width*depth;
  if(![b.minX,b.maxX,b.minZ,b.maxZ,width,depth,columns].every(Number.isSafeInteger)||width<=0||depth<=0||columns*8!==this.groundCount||columns>1048576)return;
  const top=new Int32Array(columns),stride=new Int32Array(columns),seen=new Uint8Array(this.groundCount);
  for(let x=b.minX;x<=b.maxX;x++)for(let z=b.minZ;z<=b.maxZ;z++){
   const column=(x-b.minX)*depth+z-b.minZ,first=this.fixture.idAt(x,-1,z),second=this.fixture.idAt(x,-2,z);
   if(first===null||second===null)return;
   const step=second-first;
   for(let y=-1;y>=-8;y--){
    const id=this.fixture.idAt(x,y,z);
    if(id===null||!Number.isSafeInteger(id)||id>=0||id< -this.groundCount||id!==first+(-1-y)*step||seen[id+this.groundCount]||this.fixture.xOf(id)!==x||this.fixture.yOf(id)!==y||this.fixture.zOf(id)!==z)return;
    seen[id+this.groundCount]=1;
   }
   top[column]=first+this.groundCount+this.below;stride[column]=step;
  }
  return {minX:b.minX,maxX:b.maxX,minZ:b.minZ,maxZ:b.maxZ,depth,top,stride};
 }
 private isGround(i:number):boolean{return i>=this.below&&i<this.below+this.groundCount;}
 id(i:number):number {
  if(!Number.isInteger(i)||i<0||i>=this.count)throw new Error('Invalid support index');
  return this.isGround(i)?i-this.below-this.groundCount:this.structures[i<this.below?i:i-this.groundCount];
 }
 index(id:number):number {
  if(!Number.isSafeInteger(id))return -1;
  if(this.groundCount&&id>=-this.groundCount&&id<0)return id+this.groundCount+this.below;
  if(this.contiguousStructureStart!==undefined){const i=id-this.contiguousStructureStart;return i>=0&&i<this.structures.length?(i<this.below?i:i+this.groundCount):-1;}
  let low=0,high=this.structures.length-1;
  while(low<=high){const mid=(low+high)>>>1,value=this.structures[mid];if(value===id)return mid<this.below?mid:mid+this.groundCount;if(value<id)low=mid+1;else high=mid-1;}
  return -1;
 }
 position(i:number){const id=this.id(i);if(this.coordinates&&!this.isGround(i)){const j=i<this.below?i:i-this.groundCount;return {x:this.coordinates.x[j],y:this.coordinates.y[j],z:this.coordinates.z[j]};}return {x:this.fixture.xOf(id)!,y:this.fixture.yOf(id)!,z:this.fixture.zOf(id)!};}
 material(i:number):string{return this.fixture.materialOf(this.id(i))!;}
 objectId(i:number):string{return this.fixture.objectIdOf(this.id(i))!;}
 anchor(i:number):boolean{return this.fixture.anchorOf(this.id(i))===true;}
 private visit(x:number,y:number,z:number,axis:number,fn:(neighbor:number,axis:number)=>void):void {
  const t=this.terrain;
  if(t&&y>=-8&&y<=-1&&x>=t.minX&&x<=t.maxX&&z>=t.minZ&&z<=t.maxZ){const column=(x-t.minX)*t.depth+z-t.minZ;fn(t.top[column]+(-1-y)*t.stride[column],axis);return;}
  // Outside the proven soil rectangle, preserve arbitrary original occupancy.
  const id=this.fixture.idAt(x,y,z);if(id!==null){const index=this.index(id);if(index<0)throw new Error('Original neighbor ID missing');fn(index,axis);}
 }
 neighbours(i:number,fn:(neighbor:number,axis:number)=>void):void {
  const id=this.id(i);let x:number,y:number,z:number;
  if(this.coordinates&&!this.isGround(i)){const j=i<this.below?i:i-this.groundCount;x=this.coordinates.x[j];y=this.coordinates.y[j];z=this.coordinates.z[j];}
  else{x=this.fixture.xOf(id);y=this.fixture.yOf(id);z=this.fixture.zOf(id);}
  // ORIGINAL occupied neighbor IDs. Never call store.staticIdAt here.
  this.visit(x-1,y,z,0,fn);this.visit(x+1,y,z,1,fn);this.visit(x,y-1,z,2,fn);this.visit(x,y+1,z,3,fn);this.visit(x,y,z-1,4,fn);this.visit(x,y,z+1,5,fn);
 }
 diagnostics(){return {sortedStructureIds:this.structures.length,sortedIdBytes:this.structures.byteLength,groundIdMapEntries:0,structureCoordinateBytes:this.coordinates?this.coordinates.x.byteLength+this.coordinates.y.byteLength+this.coordinates.z.byteLength:0,terrainColumnBytes:this.terrain?this.terrain.top.byteLength+this.terrain.stride.byteLength:0};}
}
