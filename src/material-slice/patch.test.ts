import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMaterialPatch} from './patch';
import type {MaterialSurfaceSource} from './geometry';
const source:MaterialSurfaceSource={bounds:{minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0},staticIdAt:(x,y,z)=>x===0&&y===0&&z===0?1:null,materialOf:()=> 'wood',colorOf:()=>0x995533,hpOf:()=>5,maxHpOf:()=>10,forEachChunk:(_s,v)=>v(0,0,0)};
test('complete material patch accounts all geometry and texture buffers',()=>{const p=buildMaterialPatch(source,'0,0,0');assert.ok(p.cellColors);assert.equal(p.stats.outputBytes,p.position.byteLength+p.normal.byteLength+p.color.byteLength+p.index!.byteLength+p.cellColors.stats.totalTextureBytes);});
test('empty replacement never allocates a cell texture',()=>{const p=buildMaterialPatch(source,'1,0,0');assert.equal(p.faces,0);assert.equal(p.cellColors,undefined);assert.equal(p.stats.outputBytes,0);});
