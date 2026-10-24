import {Data3DTexture,DataTexture,FloatType,MeshStandardMaterial,NearestFilter,NoColorSpace,RedFormat,RedIntegerFormat,RGBAFormat,UnsignedByteType,UnsignedShortType,type Texture} from 'three';
import {CELL_COLOR_GLSL,type CellColorData} from './cell-colors';

export interface CellColorMaterial {
 readonly material:MeshStandardMaterial;
 readonly textures:Readonly<{index:Data3DTexture;palette:DataTexture;shade:Data3DTexture|null}>;
 /** Exact texture payload allocation, excluding driver metadata/VRAM padding. */
 readonly textureBytes:number;
 /** Idempotent. Disposes owned Three resources, not caller buffers or geometry. */
 dispose():void;
}

/** WebGL2-only experimental material adapter. Three 0.180 WebGLTextures maps
 * RED_INTEGER/UNSIGNED_BYTE to R8UI, UNSIGNED_SHORT to R16UI, RED/FLOAT to R32F,
 * and RGBA/FLOAT to RGBA32F. texelFetch needs no float filtering extension.
 * This constructs resources and patches the existing lit standard shader;
 * successful CPU construction is NOT evidence of GPU compile/upload/render. */
export function createCellColorMaterial(data:CellColorData):CellColorMaterial {
 if(data.dimensions.some(n=>n<1)||!data.paletteIndex.length||!data.palette.length)throw new RangeError('Cannot create a cell material for an empty chunk');
 const [width,height,depth]=data.dimensions;
 const index=new Data3DTexture(data.paletteIndex,width,height,depth);
 index.format=RedIntegerFormat;index.type=data.paletteIndex instanceof Uint16Array?UnsignedShortType:UnsignedByteType;index.internalFormat=data.paletteIndex instanceof Uint16Array?'R16UI':'R8UI';
 const palette=new DataTexture(data.palette,data.paletteWidth,data.paletteHeight,RGBAFormat,FloatType);palette.internalFormat='RGBA32F';
 const shade=data.shade?new Data3DTexture(data.shade,width,height,depth):null;
 if(shade){shade.format=RedFormat;shade.type=FloatType;shade.internalFormat='R32F';}
 const configure=(texture:Texture)=>{texture.minFilter=NearestFilter;texture.magFilter=NearestFilter;texture.generateMipmaps=false;texture.flipY=false;texture.unpackAlignment=1;texture.colorSpace=NoColorSpace;texture.needsUpdate=true;};
 configure(index);configure(palette);if(shade)configure(shade);
 const material=new MeshStandardMaterial({color:0xffffff,roughness:1,metalness:0,vertexColors:false});
 material.name='isolated-cell-palette-standard';
 material.customProgramCacheKey=()=>`isolated-cell-palette-v1-${shade?'hp':'pristine'}`;
 material.onBeforeCompile=shader=>{
  shader.uniforms.uCellPaletteIndex={value:index};shader.uniforms.uCellPalette={value:palette};
  shader.uniforms.uCellOrigin={value:[...data.origin]};shader.uniforms.uCellDimensions={value:[...data.dimensions]};shader.uniforms.uCellPaletteWidth={value:data.paletteWidth};
  if(shade)shader.uniforms.uCellShade={value:shade};
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vCellOriginalPosition;\nvarying vec3 vCellOriginalNormal;').replace('#include <begin_vertex>','#include <begin_vertex>\nvCellOriginalPosition = position;\nvCellOriginalNormal = normal;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\n${shade?'#define CELL_COLOR_HAS_SHADE\n':''}${CELL_COLOR_GLSL}`).replace('#include <color_fragment>',`#include <color_fragment>\nvec4 cellColor = readCellColor(vCellOriginalPosition,vCellOriginalNormal);\nif(cellColor.a == 0.0) discard;\ndiffuseColor.rgb *= cellColor.rgb;`);
 };
 let disposed=false;
 return {material,textures:{index,palette,shade},textureBytes:data.paletteIndex.byteLength+data.palette.byteLength+(data.shade?.byteLength??0),dispose(){if(disposed)return;disposed=true;material.dispose();index.dispose();palette.dispose();shade?.dispose();}};
}
