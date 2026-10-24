import * as THREE from 'three';
import type {AimSurface} from '../contracts';
import {createGrowingInstancePool} from '../scene-runtime';
import {pristineSurfaceFixture,type CompactSurfaceSource,type MovingSurfaceCell,type SurfaceEdit} from './surface-source';
import type {CompactFixture} from './fixture';

// Ported from the measured dirty-surfaces proof. Face order/winding is the same
// as the preview, not a second meshing algorithm. Only one bounded halo lives
// during a rebuild. Original cells remain in authority, never a renderer map.
const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const;
const corners=[[[1,0,0],[1,1,0],[1,0,1],[1,1,1]],[[0,0,1],[0,1,1],[0,0,0],[0,1,0]],[[0,1,1],[1,1,1],[0,1,0],[1,1,0]],[[0,0,0],[1,0,0],[0,0,1],[1,0,1]],[[1,0,1],[1,1,1],[0,0,1],[0,1,1]],[[0,0,0],[0,1,0],[1,0,0],[1,1,0]]] as const;
const order=[0,1,2,2,1,3];
const chunkKey=(x:number,y:number,z:number)=>`${x},${y},${z}`;
interface Chunk {mesh:THREE.Mesh;faces:number;bytes:number}
export interface SurfaceRebuildReport {keys:string[];chunks:number;colorChunks:number;queriedCells:number;faces:number;outputBytes:number;peakTemporaryBytes:number;ms:number}
const emptyReport=():SurfaceRebuildReport=>({keys:[],chunks:0,colorChunks:0,queriedCells:0,faces:0,outputBytes:0,peakTemporaryBytes:0,ms:0});
function shade(color:THREE.Color,hex:number,hp:number,maxHp:number){color.setHex(hex);if(hp<maxHp)color.multiplyScalar(.6+.4*hp/maxHp);return color;}

/** A real Three renderer, with bounded static-chunk work and a separate sparse
 * moving pool. bind is required after authority replacement/reset. Passing a
 * full-world CellView array to setMoving is neither necessary nor supported by
 * the compact integration contract: it receives departed/queued/rubble only.
 */
export function createCompactSurfaceRenderer(scene:THREE.Scene,box:THREE.BufferGeometry,material:THREE.Material,options:{chunkSize?:number}={}) {
 const size=options.chunkSize??16;
 if(!Number.isSafeInteger(size)||size<1||size>64)throw new Error('Render chunk size must be an integer in [1,64]');
 const group=new THREE.Group();group.name='compact-authoritative-static-surfaces';scene.add(group);
 const surfaceMaterial=material.clone();surfaceMaterial.vertexColors=true;
 const moving=createSparseMovingRenderer(scene,box,material),chunks=new Map<string,Chunk>(),registered=new Set<string>(),topologyDirty=new Set<string>(),appearanceDirty=new Set<string>();
 const topologyRevisions=new Map<number,number>(),appearanceRevisions=new Map<number,number>(),color=new THREE.Color(),staticBounds=new THREE.Box3(),worldNormal=new THREE.Vector3();
 let source:CompactSurfaceSource|null=null,revision=0,disposed=false,lastReport=emptyReport();
 let pristineFixture:CompactFixture|null=null,meshesPristine=false,lastBindReused=false;
 const disposeChunk=(chunk:Chunk)=>{group.remove(chunk.mesh);chunk.mesh.geometry.dispose();};
 const assertAlive=()=>{if(disposed)throw new Error('Compact surface renderer has been disposed');};
 function clearBinding(){meshesPristine=false;pristineFixture=null;for(const chunk of chunks.values())disposeChunk(chunk);chunks.clear();registered.clear();topologyDirty.clear();appearanceDirty.clear();topologyRevisions.clear();appearanceRevisions.clear();source=null;staticBounds.makeEmpty();moving.set([]);}
 function buildChunk(key:string){
  const s=source!,b=s.bounds,[cx,cy,cz]=key.split(',').map(Number);
  const minX=Math.max(cx*size,b.minX),maxX=Math.min(cx*size+size-1,b.maxX),minY=Math.max(cy*size,b.minY),maxY=Math.min(cy*size+size-1,b.maxY),minZ=Math.max(cz*size,b.minZ),maxZ=Math.min(cz*size+size-1,b.maxZ);
  const nx=maxX-minX+3,ny=maxY-minY+3,nz=maxZ-minZ+3;
  // Signed safe-integer IDs include negative terrain IDs; float64 avoids an
  // accidental unsigned/int32 truncation. This halo is transient, not retained.
  const occupied=new Uint8Array(nx*ny*nz),ids=new Float64Array(nx*ny*nz),steps=[ny*nz,-ny*nz,nz,-nz,1,-1];
  const at=(x:number,y:number,z:number)=>(x*ny+y)*nz+z;
  for(let x=0;x<nx;x++)for(let y=0;y<ny;y++)for(let z=0;z<nz;z++){
   const id=s.staticIdAt(minX+x-1,minY+y-1,minZ+z-1);if(id!==null){const i=at(x,y,z);occupied[i]=1;ids[i]=id;}
  }
  let faces=0;
  for(let x=1;x<nx-1;x++)for(let y=1;y<ny-1;y++)for(let z=1;z<nz-1;z++){const i=at(x,y,z);if(occupied[i])for(let f=0;f<6;f++)if(!occupied[i+steps[f]])faces++;}
  const positions=new Float32Array(faces*18),normals=new Int8Array(faces*18),colors=new Float32Array(faces*18);let face=0;
  for(let x=1;x<nx-1;x++)for(let y=1;y<ny-1;y++)for(let z=1;z<nz-1;z++){
   const i=at(x,y,z);if(!occupied[i])continue;let shaded=false;
   for(let f=0;f<6;f++)if(!occupied[i+steps[f]]){
    if(!shaded){shade(color,s.colorOf(ids[i]),s.hpOf(ids[i]),s.maxHpOf(ids[i]));shaded=true;}
    for(let v=0;v<6;v++){const c=corners[f][order[v]],o=face*18+v*3;
     positions[o]=minX+x-1+c[0]-.5;positions[o+1]=minY+y-1+c[1]-.5;positions[o+2]=minZ+z-1+c[2]-.5;
     normals[o]=directions[f][0];normals[o+1]=directions[f][1];normals[o+2]=directions[f][2];colors[o]=color.r;colors[o+1]=color.g;colors[o+2]=color.b;
    }face++;
   }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return {geometry,faces,bytes:positions.byteLength+normals.byteLength+colors.byteLength,queriedCells:occupied.length,temporaryBytes:occupied.byteLength+ids.byteLength};
 }
 function ownerOfFace(geometry:THREE.BufferGeometry,face:number){
  const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),v=face*6;
  // Opposite quad corners, not the hit point: exact edge/corner hits must not
  // pick an arbitrary adjacent cell. No retained face-ID/cell-view array.
  return {x:Math.round((p.getX(v)+p.getX(v+5))/2-n.getX(v)*.5),y:Math.round((p.getY(v)+p.getY(v+5))/2-n.getY(v)*.5),z:Math.round((p.getZ(v)+p.getZ(v+5))/2-n.getZ(v)*.5)};
 }
 function refreshColors(chunk:Chunk){
  const geometry=chunk.mesh.geometry,colors=geometry.getAttribute('color') as THREE.BufferAttribute;
  for(let face=0;face<chunk.faces;face++){
   const {x,y,z}=ownerOfFace(geometry,face),id=source!.staticIdAt(x,y,z);
   if(id===null)throw new Error('Static occupancy changed without a topology journal edit');
   shade(color,source!.colorOf(id),source!.hpOf(id),source!.maxHpOf(id));
   for(let v=0;v<6;v++)colors.setXYZ(face*6+v,color.r,color.g,color.b);
  }
  colors.needsUpdate=true;
 }
 function flush():SurfaceRebuildReport {
  assertAlive();const start=performance.now(),report=emptyReport();report.keys=[...topologyDirty];report.chunks=topologyDirty.size;
  for(const key of topologyDirty){
   const built=buildChunk(key),old=chunks.get(key);if(old)disposeChunk(old);
   if(built.faces){const mesh=new THREE.Mesh(built.geometry,surfaceMaterial);mesh.name=key;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);chunks.set(key,{mesh,faces:built.faces,bytes:built.bytes});}
   else {built.geometry.dispose();chunks.delete(key);}
   appearanceDirty.delete(key);report.queriedCells+=built.queriedCells;report.faces+=built.faces;report.outputBytes+=built.bytes;report.peakTemporaryBytes=Math.max(report.peakTemporaryBytes,built.temporaryBytes);
  }
  for(const key of appearanceDirty){const chunk=chunks.get(key);if(chunk){refreshColors(chunk);report.colorChunks++;}}
  topologyDirty.clear();appearanceDirty.clear();if(report.chunks||report.colorChunks)revision++;
  report.ms=performance.now()-start;lastReport=report;return report;
 }
 return {
  group,
  get raycastObjects():THREE.Object3D[]{return [group,moving.mesh];},
  /** Reuse only this renderer's untouched managed baseline, never old authority
   * state: its owner may have reset or changed it without delivering edits. */
  bind(next:CompactSurfaceSource){
   assertAlive();const fixture=pristineSurfaceFixture(next);
   lastBindReused=fixture!==null&&meshesPristine&&pristineFixture===fixture;
   if(lastBindReused){
    source=next;topologyDirty.clear();appearanceDirty.clear();topologyRevisions.clear();appearanceRevisions.clear();moving.set([]);revision++;lastReport=emptyReport();return lastReport;
   }
   clearBinding();source=next;const b=next.bounds;staticBounds.set(new THREE.Vector3(b.minX-.5,b.minY-.5,b.minZ-.5),new THREE.Vector3(b.maxX+.5,b.maxY+.5,b.maxZ+.5));next.forEachChunk(size,(cx,cy,cz)=>registered.add(chunkKey(cx,cy,cz)));for(const key of registered)topologyDirty.add(key);revision++;
   const report=flush();pristineFixture=fixture;meshesPristine=fixture!==null;return report;
  },
  applyEdits(edits:Iterable<SurfaceEdit>){
   assertAlive();if(!source)throw new Error('Bind a surface source before applying edits');
   for(const edit of edits){
    const topology=edit.topologyChanged&&edit.revision>(topologyRevisions.get(edit.id)??-Infinity),appearance=edit.appearanceChanged&&edit.revision>(appearanceRevisions.get(edit.id)??-Infinity);if(!topology&&!appearance)continue;
    meshesPristine=false;
    const{x,y,z}=edit.position,cx=Math.floor(x/size),cy=Math.floor(y/size),cz=Math.floor(z/size),own=chunkKey(cx,cy,cz);
    if(appearance){appearanceRevisions.set(edit.id,edit.revision);if(registered.has(own))appearanceDirty.add(own);}
    if(topology){topologyRevisions.set(edit.id,edit.revision);const mark=(a:number,b:number,c:number)=>{const key=chunkKey(a,b,c);if(registered.has(key))topologyDirty.add(key);};mark(cx,cy,cz);
     if(x-cx*size===0)mark(cx-1,cy,cz);if(x-cx*size===size-1)mark(cx+1,cy,cz);
     if(y-cy*size===0)mark(cx,cy-1,cz);if(y-cy*size===size-1)mark(cx,cy+1,cz);
     if(z-cz*size===0)mark(cx,cy,cz-1);if(z-cz*size===size-1)mark(cx,cy,cz+1);
    }
   }
  },
  flush,
  setMoving(cells:readonly MovingSurfaceCell[]){assertAlive();if(cells.some(cell=>cell.state!=='gone'))meshesPristine=false;if(moving.set(cells))revision++;},
  resolveIntersection(hit:THREE.Intersection):AimSurface|null {
   if(disposed||!source)return null;
   if(hit.object===moving.mesh)return moving.resolve(hit);
   const chunk=chunks.get(hit.object.name);if(!chunk||chunk.mesh!==hit.object||hit.faceIndex===undefined||hit.faceIndex===null||!hit.face)return null;
   const face=Math.floor(hit.faceIndex/2);if(face<0||face>=chunk.faces)return null;
   const {x,y,z}=ownerOfFace(chunk.mesh.geometry,face),id=source.staticIdAt(x,y,z);if(id===null)return null;
   worldNormal.copy(hit.face.normal).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld));
   return {voxelId:id,position:{x:hit.point.x,y:hit.point.y,z:hit.point.z},normal:{x:worldNormal.x,y:worldNormal.y,z:worldNormal.z}};
  },
  getBounds(target=new THREE.Box3()){return target.copy(staticBounds).union(moving.bounds);},
  getDiagnostics(){let faces=0,typedBufferBytes=0;for(const chunk of chunks.values()){faces+=chunk.faces;typedBufferBytes+=chunk.bytes;}return {chunkSize:size,registeredChunks:registered.size,staticMeshes:chunks.size,faces,typedBufferBytes,drawCallsUpperBound:chunks.size+(moving.count?1:0),movingCells:moving.count,movingCapacity:moving.mesh.instanceMatrix.count,movingMatrixWrites:moving.matrixWrites,movingColorWrites:moving.colorWrites,revision,dirtyChunks:topologyDirty.size,appearanceDirtyChunks:appearanceDirty.size,changedRevisionEntries:new Set([...topologyRevisions.keys(),...appearanceRevisions.keys()]).size,retainedCellViews:0,sparseTransformEntries:moving.count,retainedHaloBytes:0,lastBindReused,meshesPristine,lastRebuild:lastReport};},
  dispose(){if(disposed)return;clearBinding();moving.dispose();scene.remove(group);surfaceMaterial.dispose();disposed=true;},
 };
}

interface MovingEntry {id:number;stamp:number;slot:number;x:number;y:number;z:number;sx:number;sy:number;sz:number;qx:number;qy:number;qz:number;qw:number;color:number;hp:number;maxHp:number;matrixDirty:boolean;colorDirty:boolean}
/** Sparse transforms only. Stable IDs survive reorders, compaction and growth. */
function createSparseMovingRenderer(scene:THREE.Scene,geometry:THREE.BufferGeometry,material:THREE.Material){
 const pool=createGrowingInstancePool(scene,geometry,material),entries=new Map<number,MovingEntry>(),visible:MovingEntry[]=[],dirty=new Set<MovingEntry>(),transform=new THREE.Object3D(),color=new THREE.Color(),bounds=new THREE.Box3(),cellBounds=new THREE.Box3(),matrix=new THREE.Matrix4(),normalMatrix=new THREE.Matrix3(),normal=new THREE.Vector3();
 if(!geometry.boundingBox)geometry.computeBoundingBox();let stamp=0,matrixWrites=0,colorWrites=0;
 function set(cells:readonly MovingSurfaceCell[]){
  stamp++;matrixWrites=colorWrites=0;let changed=false;
  for(const cell of cells){
   if(cell.state==='gone')continue;
   let entry=entries.get(cell.id);
   if(!entry){entry={id:cell.id,stamp,slot:visible.length,x:NaN,y:NaN,z:NaN,sx:NaN,sy:NaN,sz:NaN,qx:NaN,qy:NaN,qz:NaN,qw:NaN,color:NaN,hp:NaN,maxHp:NaN,matrixDirty:true,colorDirty:true};entries.set(cell.id,entry);visible.push(entry);changed=true;}
   entry.stamp=stamp;const p=cell.position,q=cell.rotation,s=cell.size,sx=s?.x??1,sy=s?.y??1,sz=s?.z??1;
   if(entry.x!==p.x||entry.y!==p.y||entry.z!==p.z||entry.sx!==sx||entry.sy!==sy||entry.sz!==sz||entry.qx!==q.x||entry.qy!==q.y||entry.qz!==q.z||entry.qw!==q.w){Object.assign(entry,{x:p.x,y:p.y,z:p.z,sx,sy,sz,qx:q.x,qy:q.y,qz:q.z,qw:q.w,matrixDirty:true});dirty.add(entry);}
   if(entry.color!==cell.color||entry.hp!==cell.hp||entry.maxHp!==cell.maxHp){entry.color=cell.color;entry.hp=cell.hp;entry.maxHp=cell.maxHp;entry.colorDirty=true;dirty.add(entry);}
  }
  for(const [id,entry]of entries)if(entry.stamp!==stamp){const slot=entry.slot,last=visible.pop()!;if(last!==entry){visible[slot]=last;last.slot=slot;last.matrixDirty=last.colorDirty=true;dirty.add(last);}entries.delete(id);dirty.delete(entry);changed=true;}
  pool.reserve(visible.length);const mesh=pool.mesh;mesh.name='compact-authoritative-moving-cells';mesh.receiveShadow=true;mesh.count=visible.length;
  let minMatrix=Infinity,maxMatrix=-1,minColor=Infinity,maxColor=-1;
  for(const e of dirty){
   if(e.matrixDirty){transform.position.set(e.x,e.y,e.z);transform.quaternion.set(e.qx,e.qy,e.qz,e.qw);transform.scale.set(e.sx,e.sy,e.sz);transform.updateMatrix();mesh.setMatrixAt(e.slot,transform.matrix);cellBounds.copy(geometry.boundingBox!).applyMatrix4(transform.matrix);bounds.union(cellBounds);minMatrix=Math.min(minMatrix,e.slot);maxMatrix=Math.max(maxMatrix,e.slot);e.matrixDirty=false;matrixWrites++;}
   if(e.colorDirty){shade(color,e.color,e.hp,e.maxHp);mesh.setColorAt(e.slot,color);minColor=Math.min(minColor,e.slot);maxColor=Math.max(maxColor,e.slot);e.colorDirty=false;colorWrites++;}
  }
  dirty.clear();if(matrixWrites){mesh.instanceMatrix.clearUpdateRanges();mesh.instanceMatrix.addUpdateRange(minMatrix*16,(maxMatrix-minMatrix+1)*16);mesh.instanceMatrix.needsUpdate=true;}
  if(colorWrites&&mesh.instanceColor){mesh.instanceColor.clearUpdateRanges();mesh.instanceColor.addUpdateRange(minColor*3,(maxColor-minColor+1)*3);mesh.instanceColor.needsUpdate=true;}
  if(!visible.length)bounds.makeEmpty();mesh.boundingBox=bounds;mesh.boundingSphere=bounds.getBoundingSphere(mesh.boundingSphere??new THREE.Sphere());return changed||matrixWrites>0||colorWrites>0;
 }
 return {set,get mesh(){return pool.mesh;},get count(){return visible.length;},get matrixWrites(){return matrixWrites;},get colorWrites(){return colorWrites;},bounds,
  resolve(hit:THREE.Intersection):AimSurface|null {if(hit.instanceId===undefined||!hit.face)return null;const entry=visible[hit.instanceId];if(!entry)return null;pool.mesh.getMatrixAt(hit.instanceId,matrix);matrix.premultiply(pool.mesh.matrixWorld);normalMatrix.getNormalMatrix(matrix);normal.copy(hit.face.normal).applyNormalMatrix(normalMatrix);return {voxelId:entry.id,position:{x:hit.point.x,y:hit.point.y,z:hit.point.z},normal:{x:normal.x,y:normal.y,z:normal.z}};},
  dispose(){pool.dispose();entries.clear();visible.length=0;dirty.clear();},
 };
}
