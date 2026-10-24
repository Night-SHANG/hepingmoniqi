import {Color} from 'three';
import type {CompactSurfaceSource,SurfaceBounds} from '../compact/surface-source';

export interface ChunkMesh {
 readonly key:string;
 readonly position:Float32Array<ArrayBuffer>;
 readonly normal:Int8Array<ArrayBuffer>;
 readonly color:Float32Array<ArrayBuffer>;
 readonly faces:number;
 /** Bounds of emitted vertices, not a solid occupancy/collision proxy. */
 readonly bounds:SurfaceBounds|null;
 readonly stats:{readonly queriedCells:number;readonly temporaryBytes:number;readonly outputBytes:number};
}

// Kept byte-for-byte equivalent to compact/surface-renderer's face order,
// winding and linear-color shading. This slice deliberately leaves it frozen.
const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const;
const corners=[[[1,0,0],[1,1,0],[1,0,1],[1,1,1]],[[0,0,1],[0,1,1],[0,0,0],[0,1,0]],[[0,1,1],[1,1,1],[0,1,0],[1,1,0]],[[0,0,0],[1,0,0],[0,0,1],[1,0,1]],[[1,0,1],[1,1,1],[0,0,1],[0,1,1]],[[0,0,0],[0,1,0],[1,0,0],[1,1,0]]] as const;
const order=[0,1,2,2,1,3];

/** CPU-only replacement built against the authority's worker-local scalar facade.
 * Every returned array owns its entire, separate buffer; no source buffer or
 * private source identity token leaves the worker. No Three mesh or GPU world is
 * constructed. The transient halo is never retained in the result.
 */
export function buildChunk(source:CompactSurfaceSource,key:string,size=32):ChunkMesh {
 if(!Number.isSafeInteger(size)||size<1||size>64)throw new RangeError('Mesh chunk size must be an integer in [1,64]');
 const coords=key.split(',').map(Number);
 if(coords.length!==3||!coords.every(Number.isSafeInteger)||coords.join(',')!==key||coords.some(n=>!Number.isSafeInteger(n*size)||!Number.isSafeInteger(n*size+size)))throw new RangeError('Invalid mesh chunk key');
 const b=source.bounds;
 if(![b.minX,b.maxX,b.minY,b.maxY,b.minZ,b.maxZ].every(Number.isSafeInteger))throw new RangeError('Mesh source bounds must be safe lattice coordinates');
 const [cx,cy,cz]=coords;
 const minX=Math.max(cx*size,b.minX),maxX=Math.min(cx*size+size-1,b.maxX),minY=Math.max(cy*size,b.minY),maxY=Math.min(cy*size+size-1,b.maxY),minZ=Math.max(cz*size,b.minZ),maxZ=Math.min(cz*size+size-1,b.maxZ);
 if(minX>maxX||minY>maxY||minZ>maxZ)return {key,position:new Float32Array(),normal:new Int8Array(),color:new Float32Array(),faces:0,bounds:null,stats:{queriedCells:0,temporaryBytes:0,outputBytes:0}};
 const nx=maxX-minX+3,ny=maxY-minY+3,nz=maxZ-minZ+3;
 // Float64 preserves signed safe-integer IDs, including negative terrain IDs.
 const occupied=new Uint8Array(nx*ny*nz),ids=new Float64Array(nx*ny*nz),steps=[ny*nz,-ny*nz,nz,-nz,1,-1];
 const at=(x:number,y:number,z:number)=>(x*ny+y)*nz+z;
 for(let x=0;x<nx;x++)for(let y=0;y<ny;y++)for(let z=0;z<nz;z++){
  const id=source.staticIdAt(minX+x-1,minY+y-1,minZ+z-1);
  if(id!==null){const i=at(x,y,z);occupied[i]=1;ids[i]=id;}
 }
 let faces=0;
 for(let x=1;x<nx-1;x++)for(let y=1;y<ny-1;y++)for(let z=1;z<nz-1;z++){
  const i=at(x,y,z);if(occupied[i])for(let f=0;f<6;f++)if(!occupied[i+steps[f]])faces++;
 }
 const position=new Float32Array(faces*18),normal=new Int8Array(faces*18),color=new Float32Array(faces*18),shadedColor=new Color();
 const bounds={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity};let face=0;
 for(let x=1;x<nx-1;x++)for(let y=1;y<ny-1;y++)for(let z=1;z<nz-1;z++){
  const i=at(x,y,z);if(!occupied[i])continue;let shaded=false;
  for(let f=0;f<6;f++)if(!occupied[i+steps[f]]){
   if(!shaded){const id=ids[i],hp=source.hpOf(id),maxHp=source.maxHpOf(id);shadedColor.setHex(source.colorOf(id));if(hp<maxHp)shadedColor.multiplyScalar(.6+.4*hp/maxHp);shaded=true;}
   for(let v=0;v<6;v++){
    const c=corners[f][order[v]],o=face*18+v*3;
    position[o]=minX+x-1+c[0]-.5;position[o+1]=minY+y-1+c[1]-.5;position[o+2]=minZ+z-1+c[2]-.5;
    normal[o]=directions[f][0];normal[o+1]=directions[f][1];normal[o+2]=directions[f][2];
    color[o]=shadedColor.r;color[o+1]=shadedColor.g;color[o+2]=shadedColor.b;
    bounds.minX=Math.min(bounds.minX,position[o]);bounds.maxX=Math.max(bounds.maxX,position[o]);
    bounds.minY=Math.min(bounds.minY,position[o+1]);bounds.maxY=Math.max(bounds.maxY,position[o+1]);
    bounds.minZ=Math.min(bounds.minZ,position[o+2]);bounds.maxZ=Math.max(bounds.maxZ,position[o+2]);
   }
   face++;
  }
 }
 return {key,position,normal,color,faces,bounds:faces?bounds:null,stats:{queriedCells:occupied.length,temporaryBytes:occupied.byteLength+ids.byteLength,outputBytes:position.byteLength+normal.byteLength+color.byteLength}};
}
