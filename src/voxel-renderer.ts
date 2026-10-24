import * as THREE from 'three';
import type {Voxel} from './contracts';
import {createGrowingInstancePool} from './scene-runtime';

type Entry={voxel:Voxel;immutable:boolean;slot:number;stamp:number;x:number;y:number;z:number;sx:number;sy:number;sz:number;qx:number;qy:number;qz:number;qw:number;state:Voxel['structuralState'];color:number;hp:number;maxHp:number;key:string|null;matrixDirty:boolean;colorDirty:boolean};
const key=(x:number,y:number,z:number)=>`${x},${y},${z}`;
const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const;

/**
 * Render authority, never simulate it. A compact surface pool leaves all interior
 * cells in the authority index and exposes their real faces immediately on edits.
 * Stable IDs, not source-array indices, map rendered hits back to live cells.
 */
export function createVoxelInstanceRenderer(scene:THREE.Scene,geometry:THREE.BufferGeometry,material:THREE.Material){
 const pool=createGrowingInstancePool(scene,geometry,material),transform=new THREE.Object3D(),color=new THREE.Color();
 const entries=new Map<number,Entry>(),occupied=new Map<string,Entry>(),visible:Entry[]=[],dirty=new Set<Entry>();
 let ordered:Entry[]=[],revision=0,matrixWrites=0,colorWrites=0,scanned=0;
 let lastSnapshot:readonly Voxel[]|null=null,immutableSnapshot=false;
 const bounds=new THREE.Box3(),cellBounds=new THREE.Box3();
 if(!geometry.boundingBox)geometry.computeBoundingBox();
 pool.mesh.receiveShadow=true;pool.mesh.name='authoritative-voxel-surfaces';
 const adjacent=(entry:Entry)=>{dirty.add(entry);for(const [dx,dy,dz] of directions){const neighbor=occupied.get(key(entry.x+dx,entry.y+dy,entry.z+dz));if(neighbor)dirty.add(neighbor);}};
 const removeSlot=(entry:Entry)=>{if(entry.slot<0)return;const slot=entry.slot,last=visible.pop()!;entry.slot=-1;if(last!==entry){visible[slot]=last;last.slot=slot;last.matrixDirty=last.colorDirty=true;dirty.add(last);}};
 const isInterior=(entry:Entry)=>entry.key!==null&&directions.every(([dx,dy,dz])=>occupied.has(key(entry.x+dx,entry.y+dy,entry.z+dz)));
 return {
  get mesh(){return pool.mesh;},
  getVoxel(instanceId:number){return visible[instanceId]?.voxel;},
  getDiagnostics(){return {total:entries.size,visible:visible.length,hidden:entries.size-visible.length,capacity:pool.mesh.instanceMatrix.count,matrixWrites,colorWrites,scanned};},
  set(voxels:readonly Voxel[]){
   matrixWrites=colorWrites=scanned=0;if(immutableSnapshot&&voxels===lastSnapshot)return;
   revision++;let allImmutable=true;let reordered=ordered.length!==voxels.length;
   // Most frames have identical membership/order. This path avoids a second full
   // map scan and performs no coordinate hashing or GPU writes for static cells.
   const nextOrdered:Entry[]=ordered.length===voxels.length?ordered:new Array(voxels.length);
   for(let i=0;i<voxels.length;i++){
    const v=voxels[i],p=v.position,r=v.rotation,s=v.size;scanned++;
    let e=ordered[i]?.voxel.id===v.id?ordered[i]:entries.get(v.id);
    if(!e){e={voxel:v,immutable:false,slot:-1,stamp:0,x:NaN,y:NaN,z:NaN,sx:NaN,sy:NaN,sz:NaN,qx:NaN,qy:NaN,qz:NaN,qw:NaN,state:undefined,color:NaN,hp:NaN,maxHp:NaN,key:null,matrixDirty:true,colorDirty:true};entries.set(v.id,e);reordered=true;}
    else if(ordered[i]!==e)reordered=true;
    e.stamp=revision;nextOrdered[i]=e;
    if(e.voxel===v&&e.immutable)continue;
    e.voxel=v;e.immutable=Object.isFrozen(v)&&Object.isFrozen(p)&&(!r||Object.isFrozen(r))&&(!s||Object.isFrozen(s));allImmutable=allImmutable&&e.immutable;
    const sx=s?.x??.965,sy=s?.y??.965,sz=s?.z??.965,qx=r?.x??0,qy=r?.y??0,qz=r?.z??0,qw=r?.w??1;
    if(e.x!==p.x||e.y!==p.y||e.z!==p.z||e.sx!==sx||e.sy!==sy||e.sz!==sz||e.qx!==qx||e.qy!==qy||e.qz!==qz||e.qw!==qw||e.state!==v.structuralState){
     if(e.key!==null){occupied.delete(e.key);adjacent(e);}
     e.x=p.x;e.y=p.y;e.z=p.z;e.sx=sx;e.sy=sy;e.sz=sz;e.qx=qx;e.qy=qy;e.qz=qz;e.qw=qw;e.state=v.structuralState;
     const lattice=(v.structuralState===undefined||v.structuralState==='static')&&sx===1&&sy===1&&sz===1&&qx===0&&qy===0&&qz===0&&Math.abs(qw)===1&&Number.isSafeInteger(p.x)&&Number.isSafeInteger(p.y)&&Number.isSafeInteger(p.z);
     e.key=lattice?key(p.x,p.y,p.z):null;
     if(e.key!==null){occupied.set(e.key,e);adjacent(e);}
     e.matrixDirty=true;dirty.add(e);
    }
    if(e.color!==v.color||e.hp!==v.hp||e.maxHp!==v.maxHp){e.color=v.color;e.hp=v.hp;e.maxHp=v.maxHp;e.colorDirty=true;dirty.add(e);}
   }
   if(reordered)for(const [id,e] of entries)if(e.stamp!==revision){if(e.key!==null){occupied.delete(e.key);adjacent(e);}removeSlot(e);entries.delete(id);dirty.delete(e);}
   ordered=nextOrdered;lastSnapshot=voxels;immutableSnapshot=allImmutable&&Object.isFrozen(voxels);
   for(const e of dirty){
    if(e.stamp!==revision)continue;
    if(isInterior(e))removeSlot(e);
    else if(e.slot<0){e.slot=visible.length;visible.push(e);e.matrixDirty=e.colorDirty=true;}
   }
   pool.reserve(visible.length);const mesh=pool.mesh;mesh.name='authoritative-voxel-surfaces';mesh.count=visible.length;
   let minMatrix=Infinity,maxMatrix=-1,minColor=Infinity,maxColor=-1;
   for(const e of dirty){
    if(e.slot<0||e.stamp!==revision)continue;
    if(e.matrixDirty){
     transform.position.set(e.x,e.y,e.z);transform.quaternion.set(e.qx,e.qy,e.qz,e.qw);transform.scale.set(e.sx,e.sy,e.sz);transform.updateMatrix();mesh.setMatrixAt(e.slot,transform.matrix);
     cellBounds.copy(geometry.boundingBox!).applyMatrix4(transform.matrix);bounds.union(cellBounds);
     minMatrix=Math.min(minMatrix,e.slot);maxMatrix=Math.max(maxMatrix,e.slot);matrixWrites++;e.matrixDirty=false;
    }
    if(e.colorDirty){color.setHex(e.color);if(e.hp<e.maxHp)color.multiplyScalar(.6+.4*e.hp/e.maxHp);mesh.setColorAt(e.slot,color);minColor=Math.min(minColor,e.slot);maxColor=Math.max(maxColor,e.slot);colorWrites++;e.colorDirty=false;}
   }
   dirty.clear();
   if(matrixWrites){mesh.instanceMatrix.addUpdateRange(minMatrix*16,(maxMatrix-minMatrix+1)*16);mesh.instanceMatrix.needsUpdate=true;}
   if(colorWrites&&mesh.instanceColor){mesh.instanceColor.addUpdateRange(minColor*3,(maxColor-minColor+1)*3);mesh.instanceColor.needsUpdate=true;}
   // Conservatively expanding bounds avoid rescanning 100k static transforms on
   // every falling-body frame. Removed geometry cannot cause a missed ray hit.
   mesh.boundingBox=bounds;mesh.boundingSphere=bounds.getBoundingSphere(mesh.boundingSphere??new THREE.Sphere());
   if(!entries.size){bounds.makeEmpty();ordered=[];occupied.clear();}
  },
  dispose(){entries.clear();occupied.clear();visible.length=0;ordered=[];dirty.clear();pool.dispose();},
 };
}
