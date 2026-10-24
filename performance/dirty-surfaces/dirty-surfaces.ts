// ISOLATED CPU/OCCUPANCY PROOF. No production renderer, GPU, Rapier, or solver.
import type {Point} from '../../src/structural/types.ts';
import {CompactTerrain, type Bounds} from '../terrain/compact-terrain.ts';
import {CompactStructures} from '../structure-store/compact-structures.ts';

export interface SurfaceEdit {readonly id:number;readonly revision:number;readonly position:Point;readonly beforeColor:number|null;readonly afterColor:number|null}
export interface SurfaceGeometry {readonly key:string;readonly revision:number;readonly positions:Float32Array;readonly normals:Int8Array;readonly colors:Uint32Array;readonly faceCount:number;readonly bufferBytes:number}
export interface RebuildReport {keys:string[];chunks:number;queriedCells:number;coreCells:number;occupiedCells:number;faces:number;outputBytes:number;peakTemporaryBytes:number;occupancyMs:number;countMs:number;emitMs:number;ms:number}
interface Extents extends Bounds {minY:number;maxY:number}
const dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const;
const corners=[[[1,0,0],[1,1,0],[1,0,1],[1,1,1]],[[0,0,1],[0,1,1],[0,0,0],[0,1,0]],[[0,1,1],[1,1,1],[0,1,0],[1,1,0]],[[0,0,0],[1,0,0],[0,0,1],[1,0,1]],[[1,0,1],[1,1,1],[0,0,1],[0,1,1]],[[0,0,0],[0,1,0],[1,0,0],[1,1,0]]] as const;
const order=[0,1,2,2,1,3];
const chunkKey=(x:number,y:number,z:number)=>`${x},${y},${z}`;
const topColors=[0x8b9650,0x9aa45a,0x778448],soilColors=[0x775238,0x8b6240,0x9a7048];

/** Read-only rendering adapter. No CellView queries, retained source objects,
 * duplicate city colors, private-field access, or cell inventory. Metadata is
 * enumerated only when registering chunks. Mutations remain owned by stores.
 */
export class CompactSurfaceSource {
 private revision=0;
 readonly bounds:Extents;
 readonly terrainBounds:Readonly<Bounds>;
 constructor(readonly terrain:CompactTerrain,readonly structures:CompactStructures,terrainBounds:Bounds){
  this.terrainBounds=Object.freeze({...terrainBounds});
  const b:Extents={...terrainBounds,minY:-8,maxY:-1};
  for(let i=0;i<structures.cellCount;i++){
   const x=structures.xAt(i)!,y=structures.yAt(i)!,z=structures.zAt(i)!;
   b.minX=Math.min(b.minX,x);b.maxX=Math.max(b.maxX,x);b.minY=Math.min(b.minY,y);b.maxY=Math.max(b.maxY,y);b.minZ=Math.min(b.minZ,z);b.maxZ=Math.max(b.maxZ,z);
  }
  this.bounds=Object.freeze(b);
 }
 /** Exact live static occupancy. The existing fixture has disjoint terrain
  * and structure lattices. Colors are immutable, HP is not a render input.
  */
 colorAt(x:number,y:number,z:number):number|null {
  const b=this.bounds;if(x<b.minX||x>b.maxX||y<b.minY||y>b.maxY||z<b.minZ||z>b.maxZ)return null;
  if(y<=-1&&y>=-8&&this.terrain.staticAt(x,y,z)!==null)return y===-1?topColors[Math.abs(x*7+z*11)%3]:soilColors[Math.abs(x*73+y*31+z*17)%3];
  const id=this.structures.staticAt(x,y,z);return id===null?null:this.structures.colorAt(this.structures.indexOf(id));
 }
 private originalPosition(id:number):Point {
  const soil=this.terrain.originalPosition(id);if(soil)return soil;
  const i=this.structures.indexOf(id);if(i<0)throw new Error('Unknown static inventory ID');
  return{x:this.structures.xAt(i)!,y:this.structures.yAt(i)!,z:this.structures.zAt(i)!};
 }
 /** Call at the existing authority mutation boundary. This captures original
  * coordinates BEFORE promotion, and detects HP-only/no-op edits. No polling of
  * all changed IDs, structures, terrain, or city chunks is needed afterwards.
  */
 captureEdit(id:number,mutate:()=>unknown):SurfaceEdit {
  const position=this.originalPosition(id),{x,y,z}=position,beforeColor=this.colorAt(x,y,z);
  mutate();return{id,position,revision:++this.revision,beforeColor,afterColor:this.colorAt(x,y,z)};
 }
 registerChunks(size:number):Set<string> {
  const keys=new Set<string>(),b=this.terrainBounds;
  for(let cx=Math.floor(b.minX/size);cx<=Math.floor(b.maxX/size);cx++)for(let cy=Math.floor(-8/size);cy<=Math.floor(-1/size);cy++)for(let cz=Math.floor(b.minZ/size);cz<=Math.floor(b.maxZ/size);cz++)keys.add(chunkKey(cx,cy,cz));
  for(let i=0;i<this.structures.cellCount;i++)keys.add(chunkKey(Math.floor(this.structures.xAt(i)!/size),Math.floor(this.structures.yAt(i)!/size),Math.floor(this.structures.zAt(i)!/size)));
  return keys;
 }
}

/** Per-render-chunk typed geometry. One bounded transient halo is released
 * after each chunk rebuild. Dirty IDs/revisions are sparse, not a dense cache.
 * Initial build visits registered original-occupancy chunks once. Later work
 * consumes only explicit edits and rebuilds those chunks, never scans the city.
 */
export class DirtySurfaceChunks {
 private readonly geometry=new Map<string,SurfaceGeometry>();
 private readonly registered:Set<string>;
 private readonly dirty=new Set<string>();
 private readonly latestRevision=new Map<number,number>();
 private initialized=false;
 constructor(readonly source:CompactSurfaceSource,readonly chunkSize=16){
  if(!Number.isSafeInteger(chunkSize)||chunkSize<1||chunkSize>64)throw new Error('Render chunk size must be an integer in [1,64]');
  this.registered=source.registerChunks(chunkSize);
 }
 initialize():RebuildReport {
  if(this.initialized)throw new Error('Surface chunks already initialized');
  for(const key of this.registered)this.dirty.add(key);this.initialized=true;return this.rebuildDirty();
 }
 getGeometry(key:string):SurfaceGeometry|undefined{return this.geometry.get(key);}
 geometries():IterableIterator<SurfaceGeometry>{return this.geometry.values();}
 entries():IterableIterator<[string,SurfaceGeometry]>{return this.geometry.entries();}
 /** Trusted internal authority events only, not a validating public input API. */
 applyEdits(edits:Iterable<SurfaceEdit>):void {
  if(!this.initialized)throw new Error('Initialize surface chunks before applying edits');
  const s=this.chunkSize;
  for(const edit of edits){
   // No-op notifications do not supersede an earlier real occupancy edit.
   if(edit.beforeColor===edit.afterColor)continue;
   if(edit.revision<=(this.latestRevision.get(edit.id)??0))continue;
   this.latestRevision.set(edit.id,edit.revision);
   const{x,y,z}=edit.position,cx=Math.floor(x/s),cy=Math.floor(y/s),cz=Math.floor(z/s);
   const mark=(a:number,b:number,c:number)=>{const key=chunkKey(a,b,c);if(this.registered.has(key))this.dirty.add(key);};
   mark(cx,cy,cz);
   // Only face-sharing neighbors on the ACTUAL cell boundary, never all 26.
   if(x-cx*s===0)mark(cx-1,cy,cz);if(x-cx*s===s-1)mark(cx+1,cy,cz);
   if(y-cy*s===0)mark(cx,cy-1,cz);if(y-cy*s===s-1)mark(cx,cy+1,cz);
   if(z-cz*s===0)mark(cx,cy,cz-1);if(z-cz*s===s-1)mark(cx,cy,cz+1);
  }
 }
 rebuildDirty():RebuildReport {
  const at=performance.now();const report:RebuildReport={keys:[...this.dirty],chunks:this.dirty.size,queriedCells:0,coreCells:0,occupiedCells:0,faces:0,outputBytes:0,peakTemporaryBytes:0,occupancyMs:0,countMs:0,emitMs:0,ms:0};
  for(const key of this.dirty){const result=this.buildChunk(key,(this.geometry.get(key)?.revision??0)+1);this.geometry.set(key,result.geometry);report.queriedCells+=result.queriedCells;report.coreCells+=result.coreCells;report.occupiedCells+=result.occupiedCells;report.faces+=result.geometry.faceCount;report.outputBytes+=result.geometry.bufferBytes;report.peakTemporaryBytes=Math.max(report.peakTemporaryBytes,result.temporaryBytes);report.occupancyMs+=result.occupancyMs;report.countMs+=result.countMs;report.emitMs+=result.emitMs;}
  this.dirty.clear();report.ms=performance.now()-at;return report;
 }
 private buildChunk(key:string,revision:number){
  const[cx,cy,cz]=key.split(',').map(Number),s=this.chunkSize,b=this.source.bounds;
  const minX=Math.max(cx*s,b.minX),maxX=Math.min(cx*s+s-1,b.maxX),minY=Math.max(cy*s,b.minY),maxY=Math.min(cy*s+s-1,b.maxY),minZ=Math.max(cz*s,b.minZ),maxZ=Math.min(cz*s+s-1,b.maxZ);
  const nx=maxX-minX+3,ny=maxY-minY+3,nz=maxZ-minZ+3;
  const occupied=new Uint8Array(nx*ny*nz),color=new Uint32Array(nx*ny*nz);
  const at=(x:number,y:number,z:number)=>(x*ny+y)*nz+z;
  let queriedCells=0,occupiedCells=0,coreCells=0;const occupancyAt=performance.now();
  // One-cell halo includes exact cross-chunk neighbors. Air beyond finite
  // world bounds is sampled too and counted honestly, but never materialized.
  for(let x=0;x<nx;x++)for(let y=0;y<ny;y++)for(let z=0;z<nz;z++){
   const value=this.source.colorAt(minX+x-1,minY+y-1,minZ+z-1);queriedCells++;
   if(value!==null){const i=at(x,y,z);occupied[i]=1;color[i]=value;}
  }
  const occupancyMs=performance.now()-occupancyAt,countAt=performance.now();
  const steps=[ny*nz,-ny*nz,nz,-nz,1,-1];let faceCount=0;
  for(let x=1;x<nx-1;x++)for(let y=1;y<ny-1;y++)for(let z=1;z<nz-1;z++){
   coreCells++;const i=at(x,y,z);if(!occupied[i])continue;occupiedCells++;
   for(let f=0;f<6;f++)if(!occupied[i+steps[f]])faceCount++;
  }
  const countMs=performance.now()-countAt,emitAt=performance.now();
  const positions=new Float32Array(faceCount*18),normals=new Int8Array(faceCount*18),colors=new Uint32Array(faceCount);
  let face=0;
  for(let x=1;x<nx-1;x++)for(let y=1;y<ny-1;y++)for(let z=1;z<nz-1;z++){
   const i=at(x,y,z);if(!occupied[i])continue;
   for(let f=0;f<6;f++)if(!occupied[i+steps[f]]){
    colors[face]=color[i];
    for(let v=0;v<6;v++){const c=corners[f][order[v]],o=face*18+v*3;
     positions[o]=minX+x-1+c[0]-.5;positions[o+1]=minY+y-1+c[1]-.5;positions[o+2]=minZ+z-1+c[2]-.5;
     normals[o]=dirs[f][0];normals[o+1]=dirs[f][1];normals[o+2]=dirs[f][2];
    }face++;
   }
  }
  const geometry:SurfaceGeometry={key,revision,positions,normals,colors,faceCount,bufferBytes:positions.byteLength+normals.byteLength+colors.byteLength};
  return{geometry,queriedCells,coreCells,occupiedCells,temporaryBytes:occupied.byteLength+color.byteLength,occupancyMs,countMs,emitMs:performance.now()-emitAt};
 }
 diagnostics(){let faces=0,typedOutputBytes=0;for(const g of this.geometry.values()){faces+=g.faceCount;typedOutputBytes+=g.bufferBytes;}return{chunkSize:this.chunkSize,registeredChunks:this.registered.size,geometryChunks:this.geometry.size,dirtyChunks:this.dirty.size,changedRevisionEntries:this.latestRevision.size,faces,typedOutputBytes,retainedCellViews:0,retainedHaloBytes:0};}
}
