import type {CompactFixture} from '../fixture.js';
import type {IdentifiedLattice} from './pristine-core.js';

/** Original fixture topology, independent of sparse live-state changes. The
 * contiguous geology ID range needs no full-city permutation or ID map. Only
 * structure IDs are sorted, matching the legacy seeded support iteration. */
export class CompactSupportLattice implements IdentifiedLattice {
 readonly count:number;
 readonly groundCount:number;
 private readonly structures:Float64Array;
 private readonly below:number;
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
 }
 private isGround(i:number):boolean{return i>=this.below&&i<this.below+this.groundCount;}
 id(i:number):number {
  if(!Number.isInteger(i)||i<0||i>=this.count)throw new Error('Invalid support index');
  return this.isGround(i)?i-this.below-this.groundCount:this.structures[i<this.below?i:i-this.groundCount];
 }
 index(id:number):number {
  if(!Number.isSafeInteger(id))return -1;
  if(this.groundCount&&id>=-this.groundCount&&id<0)return id+this.groundCount+this.below;
  let low=0,high=this.structures.length-1;
  while(low<=high){const mid=(low+high)>>>1,value=this.structures[mid];if(value===id)return mid<this.below?mid:mid+this.groundCount;if(value<id)low=mid+1;else high=mid-1;}
  return -1;
 }
 position(i:number){const id=this.id(i);return {x:this.fixture.xOf(id)!,y:this.fixture.yOf(id)!,z:this.fixture.zOf(id)!};}
 material(i:number):string{return this.fixture.materialOf(this.id(i))!;}
 objectId(i:number):string{return this.fixture.objectIdOf(this.id(i))!;}
 anchor(i:number):boolean{return this.fixture.anchorOf(this.id(i))===true;}
 neighbours(i:number,fn:(neighbor:number,axis:number)=>void):void {
  const id=this.id(i),x=this.fixture.xOf(id)!,y=this.fixture.yOf(id)!,z=this.fixture.zOf(id)!;
  // ORIGINAL occupied neighbor IDs. Never call store.staticIdAt here.
  const visit=(x:number,y:number,z:number,axis:number)=>{const id=this.fixture.idAt(x,y,z);if(id!==null){const index=this.index(id);if(index<0)throw new Error('Original neighbor ID missing');fn(index,axis);}};
  visit(x-1,y,z,0);visit(x+1,y,z,1);visit(x,y-1,z,2);visit(x,y+1,z,3);visit(x,y,z-1,4);visit(x,y,z+1,5);
 }
 diagnostics(){return {sortedStructureIds:this.structures.length,sortedIdBytes:this.structures.byteLength,groundIdMapEntries:0};}
}
