import {Color} from 'three';
import type {CompactSurfaceSource} from '../compact/surface-source';
import type {ChunkMesh} from '../worker-slice/chunk-mesh';

export interface GreedyChunkMesh extends ChunkMesh {
 /** Four vertices and six indices per emitted quad; faces counts these quads. */
 readonly index:Uint32Array<ArrayBuffer>;
 /** Exact occupied boundary area before merging, in unit-cell faces. */
 readonly unitFaces:number;
}

const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const;
// Same vertex order and outward triangle winding as the frozen worker oracle.
const corners=[[[1,0,0],[1,1,0],[1,0,1],[1,1,1]],[[0,0,1],[0,1,1],[0,0,0],[0,1,0]],[[0,1,1],[1,1,1],[0,1,0],[1,1,0]],[[0,0,0],[1,0,0],[0,0,1],[1,0,1]],[[1,0,1],[1,1,1],[0,0,1],[0,1,1]],[[0,0,0],[0,1,0],[1,0,0],[1,1,0]]] as const;
const order=[0,1,2,2,1,3];
const tangents=[[1,2],[0,2],[0,1]] as const;

/** Isolated CPU-only greedy candidate. Occupancy is sampled from the authority,
 * never reconstructed from an AABB. Coplanar faces merge only when all three
 * final Float32 linear-color channels match exactly (including HP shade).
 * No collider, authority state, source buffer or source identity is returned.
 * temporaryBytes measures typed scratch storage, not JS palette/Map overhead.
 */
export function buildGreedyChunk(source:CompactSurfaceSource,key:string,size=32):GreedyChunkMesh {
 if(!Number.isSafeInteger(size)||size<1||size>64)throw new RangeError('Mesh chunk size must be an integer in [1,64]');
 const coords=key.split(',').map(Number);
 if(coords.length!==3||!coords.every(Number.isSafeInteger)||coords.join(',')!==key||coords.some(n=>!Number.isSafeInteger(n*size)||!Number.isSafeInteger(n*size+size)))throw new RangeError('Invalid mesh chunk key');
 const b=source.bounds;
 if(![b.minX,b.maxX,b.minY,b.maxY,b.minZ,b.maxZ].every(Number.isSafeInteger))throw new RangeError('Mesh source bounds must be safe lattice coordinates');
 const min=[Math.max(coords[0]*size,b.minX),Math.max(coords[1]*size,b.minY),Math.max(coords[2]*size,b.minZ)];
 const max=[Math.min(coords[0]*size+size-1,b.maxX),Math.min(coords[1]*size+size-1,b.maxY),Math.min(coords[2]*size+size-1,b.maxZ)];
 const empty=(queriedCells:number,temporaryBytes:number):GreedyChunkMesh=>({key,position:new Float32Array(),normal:new Int8Array(),color:new Float32Array(),index:new Uint32Array(),faces:0,unitFaces:0,bounds:null,stats:{queriedCells,temporaryBytes,outputBytes:0}});
 if(min.some((n,a)=>n>max[a]))return empty(0,0);
 const dims=max.map((n,a)=>n-min[a]+1),halo=dims.map(n=>n+2),volume=halo[0]*halo[1]*halo[2];
 const occupied=new Uint8Array(volume),ids=new Float64Array(volume),tokens=new Uint32Array(volume),steps=[halo[1]*halo[2],-halo[1]*halo[2],halo[2],-halo[2],1,-1];
 const at=(x:number,y:number,z:number)=>(x*halo[1]+y)*halo[2]+z;
 for(let x=0;x<halo[0];x++)for(let y=0;y<halo[1];y++)for(let z=0;z<halo[2];z++){
  const id=source.staticIdAt(min[0]+x-1,min[1]+y-1,min[2]+z-1);
  if(id!==null){const i=at(x,y,z);occupied[i]=1;ids[i]=id;}
 }
 const palette:number[][]=[],paletteIds=new Map<string,number>(),shaded=new Color();let unitFaces=0;
 for(let x=1;x<halo[0]-1;x++)for(let y=1;y<halo[1]-1;y++)for(let z=1;z<halo[2]-1;z++){
  const i=at(x,y,z);if(!occupied[i])continue;
  let exposed=0;for(const step of steps)if(!occupied[i+step])exposed++;
  if(!exposed)continue;unitFaces+=exposed;
  const id=ids[i],hp=source.hpOf(id),maxHp=source.maxHpOf(id);shaded.setHex(source.colorOf(id));if(hp<maxHp)shaded.multiplyScalar(.6+.4*hp/maxHp);
  const rgb=[Math.fround(shaded.r),Math.fround(shaded.g),Math.fround(shaded.b)],colorKey=rgb.join(',');let token=paletteIds.get(colorKey);
  if(token===undefined){palette.push(rgb);token=palette.length;paletteIds.set(colorKey,token);}tokens[i]=token;
 }
 const haloBytes=occupied.byteLength+ids.byteLength+tokens.byteLength;
 if(!unitFaces)return empty(volume,haloBytes);
 // At most one descriptor per source unit face. Entries are face, plane,
 // tangent origin u/v, tangent extent width/height, exact final-color token.
 const quads=new Uint32Array(unitFaces*7),mask=new Uint32Array(Math.max(dims[0]*dims[1],dims[0]*dims[2],dims[1]*dims[2]));let faces=0;
 for(let f=0;f<6;f++){
  const axis=Math.floor(f/2),[uAxis,vAxis]=tangents[axis],width=dims[uAxis],height=dims[vAxis],p=[0,0,0];
  for(let plane=0;plane<dims[axis];plane++){
   p[axis]=plane+1;
   for(let v=0;v<height;v++)for(let u=0;u<width;u++){
    p[uAxis]=u+1;p[vAxis]=v+1;const i=at(p[0],p[1],p[2]);mask[v*width+u]=occupied[i]&&!occupied[i+steps[f]]?tokens[i]:0;
   }
   for(let v=0;v<height;v++)for(let u=0;u<width;){
    const token=mask[v*width+u];if(!token){u++;continue;}
    let w=1,h=1;while(u+w<width&&mask[v*width+u+w]===token)w++;
    rows:while(v+h<height){for(let du=0;du<w;du++)if(mask[(v+h)*width+u+du]!==token)break rows;h++;}
    quads.set([f,plane,u,v,w,h,token],faces*7);faces++;
    for(let dv=0;dv<h;dv++)mask.fill(0,(v+dv)*width+u,(v+dv)*width+u+w);u+=w;
   }
  }
 }
 const position=new Float32Array(faces*12),normal=new Int8Array(faces*12),color=new Float32Array(faces*12),index=new Uint32Array(faces*6);
 const bounds={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity};
 for(let q=0;q<faces;q++){
  const at=q*7,f=quads[at],axis=Math.floor(f/2),[uAxis,vAxis]=tangents[axis],origin=[0,0,0],extent=[1,1,1],rgb=palette[quads[at+6]-1];
  origin[axis]=quads[at+1];origin[uAxis]=quads[at+2];origin[vAxis]=quads[at+3];extent[uAxis]=quads[at+4];extent[vAxis]=quads[at+5];
  for(let v=0;v<4;v++){
   const o=q*12+v*3,c=corners[f][v];
   for(let a=0;a<3;a++){position[o+a]=min[a]+origin[a]+c[a]*extent[a]-.5;normal[o+a]=directions[f][a];color[o+a]=rgb[a];}
   bounds.minX=Math.min(bounds.minX,position[o]);bounds.maxX=Math.max(bounds.maxX,position[o]);bounds.minY=Math.min(bounds.minY,position[o+1]);bounds.maxY=Math.max(bounds.maxY,position[o+1]);bounds.minZ=Math.min(bounds.minZ,position[o+2]);bounds.maxZ=Math.max(bounds.maxZ,position[o+2]);
  }
  for(let v=0;v<6;v++)index[q*6+v]=q*4+order[v];
 }
 return {key,position,normal,color,index,faces,unitFaces,bounds,stats:{queriedCells:volume,temporaryBytes:haloBytes+quads.byteLength+mask.byteLength,outputBytes:position.byteLength+normal.byteLength+color.byteLength+index.byteLength}};
}
