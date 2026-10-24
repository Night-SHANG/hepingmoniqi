import test from 'node:test';
import assert from 'node:assert/strict';
import {FloatType,MeshStandardMaterial,NearestFilter,NoColorSpace,RedFormat,RedIntegerFormat,RGBAFormat,ShaderLib,UnsignedByteType,UnsignedShortType,type WebGLRenderer} from 'three';
import {buildCellColorData,CELL_COLOR_GLSL} from './cell-colors';
import type {CompactSurfaceSource} from '../compact/surface-source';

const load=async()=>{const api=await import('./material').catch(()=>null);assert.ok(api?.createCellColorMaterial,'standard-lighting cell material implementation must exist');return api;};
function source(damaged=false,count=1):CompactSurfaceSource{return {bounds:{minX:0,maxX:Math.min(count-1,15),minY:0,maxY:Math.floor((count-1)/16),minZ:0,maxZ:0},staticIdAt:(x,y,z)=>z===0&&x>=0&&x<16&&y>=0&&y*16+x<count?y*16+x:null,colorOf:id=>count===1?0x8b9650:id,hpOf:id=>damaged&&id===0?2.5:10,maxHpOf:()=>10,forEachChunk:()=>{}};}
function shaderFor(material:MeshStandardMaterial){const shader={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader,uniforms:{}} as Parameters<MeshStandardMaterial['onBeforeCompile']>[0];material.onBeforeCompile(shader,{} as WebGLRenderer);return shader;}

test('factory creates owned nearest integer-index and linear float-palette textures, without pristine shade',async()=>{
 const {createCellColorMaterial}=await load(),data=buildCellColorData(source(),'0,0,0'),handle=createCellColorMaterial(data),{index,palette,shade}=handle.textures;
 assert.ok(handle.material instanceof MeshStandardMaterial);assert.equal(handle.material.vertexColors,false);assert.equal(handle.material.roughness,1);assert.equal(handle.material.metalness,0);assert.equal(handle.material.color.getHex(),0xffffff);assert.equal(shade,null);
 assert.equal(index.format,RedIntegerFormat);assert.equal(index.type,UnsignedByteType);assert.equal(index.internalFormat,'R8UI');assert.strictEqual(index.image.data,data.paletteIndex);
 assert.equal(palette.format,RGBAFormat);assert.equal(palette.type,FloatType);assert.equal(palette.internalFormat,'RGBA32F');assert.strictEqual(palette.image.data,data.palette);
 for(const texture of [index,palette]){assert.equal(texture.minFilter,NearestFilter);assert.equal(texture.magFilter,NearestFilter);assert.equal(texture.generateMipmaps,false);assert.equal(texture.colorSpace,NoColorSpace);assert.equal(texture.unpackAlignment,1);assert.equal(texture.flipY,false);assert.ok(texture.version>0);}
 assert.equal(handle.textureBytes,data.stats.totalTextureBytes);assert.equal(index.image.width,1);assert.equal(index.image.height,1);assert.equal(index.image.depth,1);handle.dispose();
});

test('damaged and wide-palette textures have exact R32F/R16UI payloads without expanded index colors',async()=>{
 const {createCellColorMaterial}=await load(),data=buildCellColorData(source(true,256),'0,0,0'),handle=createCellColorMaterial(data),{index,shade}=handle.textures;
 assert.equal(index.type,UnsignedShortType);assert.equal(index.internalFormat,'R16UI');assert.ok(shade);assert.equal(shade.format,RedFormat);assert.equal(shade.type,FloatType);assert.equal(shade.internalFormat,'R32F');assert.strictEqual(shade.image.data,data.shade);assert.equal(shade.generateMipmaps,false);assert.equal(shade.minFilter,NearestFilter);
 assert.equal(handle.textureBytes,data.paletteIndex.byteLength+data.palette.byteLength+data.shade!.byteLength);handle.dispose();
});

test('actual standard shader hook captures original local position/normal and retains lighting, shadows and output pipeline',async()=>{
 const {createCellColorMaterial}=await load(),data=buildCellColorData(source(true),'0,0,0'),handle=createCellColorMaterial(data),shader=shaderFor(handle.material);
 assert.ok(shader.fragmentShader.includes(CELL_COLOR_GLSL));assert.match(shader.vertexShader,/vCellOriginalPosition\s*=\s*position/);assert.match(shader.vertexShader,/vCellOriginalNormal\s*=\s*normal/);assert.ok(shader.vertexShader.indexOf('vCellOriginalPosition = position')<shader.vertexShader.indexOf('#include <project_vertex>'));
 assert.ok(shader.fragmentShader.includes('#define CELL_COLOR_HAS_SHADE'));assert.match(shader.fragmentShader,/diffuseColor\.rgb\s*\*=\s*cellColor\.rgb/);assert.match(shader.fragmentShader,/cellColor\.a\s*==\s*0\.0\)\s*discard/);
 for(const marker of ['lights_physical_fragment','lights_fragment_begin','lights_fragment_maps','lights_fragment_end','tonemapping_fragment','colorspace_fragment','shadowmap_pars_fragment'])assert.ok(shader.fragmentShader.includes(`#include <${marker}>`),`preserve ${marker}`);
 assert.strictEqual(shader.uniforms.uCellPaletteIndex.value,handle.textures.index);assert.strictEqual(shader.uniforms.uCellPalette.value,handle.textures.palette);assert.strictEqual(shader.uniforms.uCellShade.value,handle.textures.shade);assert.deepEqual([...shader.uniforms.uCellOrigin.value],data.origin);assert.deepEqual([...shader.uniforms.uCellDimensions.value],data.dimensions);assert.equal(shader.uniforms.uCellPaletteWidth.value,data.paletteWidth);handle.dispose();
});

test('shader cache variants distinguish optional shade but reuse identical layout independent of data',async()=>{
 const {createCellColorMaterial}=await load(),a=createCellColorMaterial(buildCellColorData(source(),'0,0,0')),b=createCellColorMaterial(buildCellColorData(source(true),'0,0,0')),c=createCellColorMaterial(buildCellColorData(source(false,256),'0,0,0'));
 assert.notEqual(a.material.customProgramCacheKey(),b.material.customProgramCacheKey());assert.equal(a.material.customProgramCacheKey(),c.material.customProgramCacheKey());const shader=shaderFor(a.material);assert.ok(!shader.fragmentShader.includes('#define CELL_COLOR_HAS_SHADE'));assert.equal(shader.uniforms.uCellShade,undefined);a.dispose();b.dispose();c.dispose();
});

test('dispose releases each texture and material exactly once without detaching caller buffers',async()=>{
 const {createCellColorMaterial}=await load(),data=buildCellColorData(source(true),'0,0,0'),handle=createCellColorMaterial(data),resources=[handle.material,handle.textures.index,handle.textures.palette,handle.textures.shade!],counts=new Map(resources.map(r=>[r,0]));
 for(const r of resources)r.addEventListener('dispose',()=>counts.set(r,counts.get(r)!+1));handle.dispose();handle.dispose();assert.deepEqual([...counts.values()],[1,1,1,1]);assert.ok(data.palette.byteLength>0);assert.ok(data.paletteIndex.byteLength>0);assert.ok(data.shade!.byteLength>0);
});

test('empty data rejects material creation instead of allocating invalid or unaccounted placeholder textures',async()=>{
 const {createCellColorMaterial}=await load();assert.throws(()=>createCellColorMaterial(buildCellColorData(source(),'1,0,0')),RangeError);
});
