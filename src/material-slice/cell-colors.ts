import {Color} from 'three';
import type {CompactSurfaceSource} from '../compact/surface-source';

export const CELL_FACE_EPSILON=1e-4;
/** Absolute linear-channel tolerance against the baseline's final Float32 RGB.
 * Base palette and HP shade are rounded separately before GPU multiplication.
 * This bound applies to the authority's normal HP interval [0,maxHp]. */
export const CELL_COLOR_FLOAT32_TOLERANCE=1e-7;
type Triple=readonly [number,number,number];
type Point=Readonly<{x:number;y:number;z:number}>;
export interface CellColorData {
 readonly key:string;
 /** Original object/lattice coordinates, not translated mesh world coordinates. */
 readonly origin:Triple;
 readonly dimensions:Triple;
 /** WebGL x-fastest order: ((z * height) + y) * width + x. Zero means air. */
 readonly paletteIndex:Uint8Array<ArrayBuffer>|Uint16Array<ArrayBuffer>;
 /** Linear RGBA32F texels. Token zero and row padding remain transparent black. */
 readonly palette:Float32Array<ArrayBuffer>;
 readonly paletteWidth:number;
 readonly paletteHeight:number;
 /** R32F, including retained air padding; absent when every occupied cell is pristine. */
 readonly shade:Float32Array<ArrayBuffer>|null;
 readonly stats:Readonly<{queriedCells:number;occupiedCells:number;airTexels:number;indexBytes:number;paletteBytes:number;shadeBytes:number;totalTextureBytes:number}>;
}

/** Isolated presentation snapshot. Authority IDs/HP stay JS Float64 and never
 * leave the source as an ID texture. Counts are allocated texture payload bytes,
 * not driver VRAM, heap, transient scratch, upload speed, or GPU performance. */
export function buildCellColorData(source:CompactSurfaceSource,key:string,size=32):CellColorData {
 if(!Number.isSafeInteger(size)||size<1||size>64)throw new RangeError('Cell-color chunk size must be an integer in [1,64]');
 const coords=key.split(',').map(Number);
 if(coords.length!==3||!coords.every(Number.isSafeInteger)||coords.join(',')!==key||coords.some(n=>!Number.isSafeInteger(n*size)||!Number.isSafeInteger(n*size+size)))throw new RangeError('Invalid cell-color chunk key');
 const b=source.bounds;
 if(![b.minX,b.maxX,b.minY,b.maxY,b.minZ,b.maxZ].every(Number.isSafeInteger))throw new RangeError('Cell-color bounds must be safe lattice coordinates');
 const min=[Math.max(coords[0]*size,b.minX),Math.max(coords[1]*size,b.minY),Math.max(coords[2]*size,b.minZ)];
 const max=[Math.min(coords[0]*size+size-1,b.maxX),Math.min(coords[1]*size+size-1,b.maxY),Math.min(coords[2]*size+size-1,b.maxZ)];
 const empty=(queriedCells:number):CellColorData=>({key,origin:min as [number,number,number],dimensions:[0,0,0],paletteIndex:new Uint8Array(),palette:new Float32Array(),paletteWidth:0,paletteHeight:0,shade:null,stats:{queriedCells,occupiedCells:0,airTexels:0,indexBytes:0,paletteBytes:0,shadeBytes:0,totalTextureBytes:0}});
 if(min.some((n,a)=>n>max[a]))return empty(0);
 const dims=max.map((n,a)=>n-min[a]+1),volume=dims[0]*dims[1]*dims[2],tokens=new Uint32Array(volume);
 const paletteHex:number[]=[],paletteIds=new Map<number,number>(),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 let occupiedCells=0,shades:Float32Array<ArrayBuffer>|null=null;
 for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++){
  const id=source.staticIdAt(min[0]+x,min[1]+y,min[2]+z);if(id===null)continue;
  const color=source.colorOf(id);let token=paletteIds.get(color);
  if(token===undefined){token=paletteHex.length+1;if(token>65535)throw new RangeError('Cell-color palette exceeds Uint16 capacity');paletteIds.set(color,token);paletteHex.push(color);}
  const i=(z*dims[1]+y)*dims[0]+x;tokens[i]=token;occupiedCells++;
  const hp=source.hpOf(id),maxHp=source.maxHpOf(id);
  if(hp<maxHp){if(!shades){shades=new Float32Array(volume);shades.fill(1);}shades[i]=.6+.4*hp/maxHp;}
  lo[0]=Math.min(lo[0],x);lo[1]=Math.min(lo[1],y);lo[2]=Math.min(lo[2],z);hi[0]=Math.max(hi[0],x);hi[1]=Math.max(hi[1],y);hi[2]=Math.max(hi[2],z);
 }
 if(!occupiedCells)return empty(volume);
 const origin=min.map((n,a)=>n+lo[a]) as [number,number,number],dimensions=hi.map((n,a)=>n-lo[a]+1) as [number,number,number];
 const texelCount=dimensions[0]*dimensions[1]*dimensions[2];
 const paletteIndex=paletteHex.length<256?new Uint8Array(texelCount):new Uint16Array(texelCount),shade=shades?new Float32Array(texelCount):null;
 for(let z=0;z<dimensions[2];z++)for(let y=0;y<dimensions[1];y++)for(let x=0;x<dimensions[0];x++){
  const from=((z+lo[2])*dims[1]+y+lo[1])*dims[0]+x+lo[0],to=(z*dimensions[1]+y)*dimensions[0]+x;
  paletteIndex[to]=tokens[from];if(shade)shade[to]=shades![from];
 }
 const paletteWidth=Math.min(256,paletteHex.length+1),paletteHeight=Math.ceil((paletteHex.length+1)/paletteWidth),palette=new Float32Array(paletteWidth*paletteHeight*4),linear=new Color();
 paletteHex.forEach((hex,i)=>{linear.setHex(hex);palette.set([linear.r,linear.g,linear.b,1],(i+1)*4);});
 const indexBytes=paletteIndex.byteLength,paletteBytes=palette.byteLength,shadeBytes=shade?.byteLength??0;
 return {key,origin,dimensions,paletteIndex,palette,paletteWidth,paletteHeight,shade,stats:{queriedCells:volume,occupiedCells,airTexels:texelCount-occupiedCells,indexBytes,paletteBytes,shadeBytes,totalTextureBytes:indexBytes+paletteBytes+shadeBytes}};
}

/** Face normals must be original object-space axis normals, not view/world normals. */
export function cellFromSurface(position:Point,normal:Point):Triple {
 return [Math.floor(position.x-normal.x*CELL_FACE_EPSILON+.5),Math.floor(position.y-normal.y*CELL_FACE_EPSILON+.5),Math.floor(position.z-normal.z*CELL_FACE_EPSILON+.5)];
}

/** CPU counterpart to the exact nearest-texel shader lookup, including GPU f32 multiply. */
export function sampleCellColor(data:CellColorData,position:Point,normal:Point):Triple|null {
 // Subtract the integer origin before the inward bias, matching the GLSL order.
 const local=cellFromSurface({x:position.x-data.origin[0],y:position.y-data.origin[1],z:position.z-data.origin[2]},normal);
 if(local.some((n,a)=>n<0||n>=data.dimensions[a]||!Number.isFinite(n)))return null;
 const i=(local[2]*data.dimensions[1]+local[1])*data.dimensions[0]+local[0],token=data.paletteIndex[i];if(token===0)return null;
 const offset=token*4,shade=data.shade?.[i]??1;
 return [Math.fround(data.palette[offset]*shade),Math.fround(data.palette[offset+1]*shade),Math.fround(data.palette[offset+2]*shade)];
}

/** Shared shader contract. WebGL2 integer index reads never interpolate colors.
 * Capture raw position/normal before model/normalMatrix transforms in the vertex shader.
 * Define CELL_COLOR_HAS_SHADE only when the optional R32F texture exists. */
export const CELL_COLOR_GLSL=/* glsl */`
uniform highp usampler3D uCellPaletteIndex;
uniform highp sampler2D uCellPalette;
uniform ivec3 uCellOrigin;
uniform ivec3 uCellDimensions;
uniform int uCellPaletteWidth;
#ifdef CELL_COLOR_HAS_SHADE
uniform highp sampler3D uCellShade;
#endif
varying vec3 vCellOriginalPosition;
varying vec3 vCellOriginalNormal;
vec4 readCellColor(vec3 originalPosition,vec3 originalNormal) {
 // Algebraically equivalent to floor(position - normal*epsilon + .5) - origin.
 // Keeping the biased operand chunk-local prevents large-coordinate f32 cancellation.
 vec3 localPosition=originalPosition-vec3(uCellOrigin);
 ivec3 cell=ivec3(floor(localPosition-originalNormal*${CELL_FACE_EPSILON.toFixed(4)}+0.5));
 if(any(lessThan(cell,ivec3(0)))||any(greaterThanEqual(cell,uCellDimensions)))return vec4(0.0);
 uint token=texelFetch(uCellPaletteIndex,cell,0).r;
 if(token==0u)return vec4(0.0);
 int paletteIndex=int(token);
 vec4 color=texelFetch(uCellPalette,ivec2(paletteIndex%uCellPaletteWidth,paletteIndex/uCellPaletteWidth),0);
 #ifdef CELL_COLOR_HAS_SHADE
 color.rgb*=texelFetch(uCellShade,cell,0).r;
 #endif
 return color;
}
`;
