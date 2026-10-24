import test from 'node:test';
import assert from 'node:assert/strict';
import {Color,Matrix3,Matrix4,Quaternion,Vector3} from 'three';
import type {CompactSurfaceSource,SurfaceBounds} from '../compact/surface-source';

const load=async()=>{const api=await import('./cell-colors').catch(()=>null);assert.ok(api?.buildCellColorData,'cell-color data implementation must exist');return api;};
type Cell={x:number;y:number;z:number;color:number;hp?:number;maxHp?:number};
function fixture(cells:Cell[],bounds?:SurfaceBounds):CompactSurfaceSource {
 const byPos=new Map(cells.map((c,i)=>[`${c.x},${c.y},${c.z}`,2**40+i]));
 return {bounds:bounds??{minX:Math.min(...cells.map(c=>c.x)),maxX:Math.max(...cells.map(c=>c.x)),minY:Math.min(...cells.map(c=>c.y)),maxY:Math.max(...cells.map(c=>c.y)),minZ:Math.min(...cells.map(c=>c.z)),maxZ:Math.max(...cells.map(c=>c.z))},staticIdAt:(x,y,z)=>byPos.get(`${x},${y},${z}`)??null,colorOf:id=>cells[id-2**40].color,hpOf:id=>cells[id-2**40].hp??10,maxHpOf:id=>cells[id-2**40].maxHp??10,forEachChunk:()=>{}};
}
const normal={x:0,y:1,z:0};

test('linear palette preserves known original colors with exact pristine Float32 channels',async()=>{
 const {buildCellColorData,sampleCellColor}=await load();
 const cells=[0x000000,0xffffff,0xff0000,0x808080,0x8b9650].map((color,x)=>({x,y:0,z:0,color}));
 const data=buildCellColorData(fixture(cells),'0,0,0');
 for(const c of cells){const expected=new Color().setHex(c.color);assert.deepEqual(sampleCellColor(data,{x:c.x,y:.5,z:0},normal),[Math.fround(expected.r),Math.fround(expected.g),Math.fround(expected.b)]);}
 assert.equal(data.shade,null);assert.equal(data.stats.shadeBytes,0);assert.ok(data.paletteIndex instanceof Uint8Array);assert.equal(data.palette[3],0,'air token is distinct from occupied black');
});

test('tight clipped occupied bounds retain and count all interior air padding',async()=>{
 const {buildCellColorData,sampleCellColor}=await load();
 const data=buildCellColorData(fixture([{x:2,y:1,z:4,color:0xff0000},{x:4,y:1,z:4,color:0x00ff00}],{minX:0,maxX:99,minY:0,maxY:20,minZ:0,maxZ:99}),'0,0,0');
 assert.deepEqual(data.origin,[2,1,4]);assert.deepEqual(data.dimensions,[3,1,1]);assert.deepEqual([...data.paletteIndex],[1,0,2]);assert.equal(data.stats.occupiedCells,2);assert.equal(data.stats.airTexels,1);assert.equal(data.stats.queriedCells,32*21*32);
 assert.equal(data.stats.indexBytes,3);assert.equal(data.stats.paletteBytes,3*4*4);assert.equal(data.stats.totalTextureBytes,51);
 assert.equal(sampleCellColor(data,{x:3,y:1.5,z:4},normal),null);assert.equal(sampleCellColor(data,{x:33,y:1.5,z:4},normal),null);
});

test('x-fastest texel address covers all dimensions and negative owning cells on six face signs',async()=>{
 const {buildCellColorData,cellFromSurface,sampleCellColor}=await load();
 const cells:Cell[]=[];for(let z=-3;z<=-2;z++)for(let y=-3;y<=-2;y++)for(let x=-3;x<=-2;x++)cells.push({x,y,z,color:0x10101*(cells.length+1)});
 const data=buildCellColorData(fixture(cells),'-1,-1,-1');
 assert.deepEqual([...data.paletteIndex],[1,2,3,4,5,6,7,8]);
 for(const c of cells)for(const n of [{x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:-1,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1}]){
  const p={x:c.x+n.x*.5,y:c.y+n.y*.5,z:c.z+n.z*.5};assert.deepEqual(cellFromSurface(p,n),[c.x,c.y,c.z]);assert.notEqual(sampleCellColor(data,p,n),null);
 }
});

test('only damaged chunks allocate HP shade and Float32 render error is bounded without touching Float64 HP',async()=>{
 const {buildCellColorData,sampleCellColor,CELL_COLOR_FLOAT32_TOLERANCE}=await load();
 const hp=1.2345678901234567,maxHp=9.876543210987654,cells=[{x:0,y:0,z:0,color:0x8b9650,hp,maxHp},{x:1,y:0,z:0,color:0xffffff}];
 const source=fixture(cells),data=buildCellColorData(source,'0,0,0');
 assert.ok(data.shade instanceof Float32Array);assert.deepEqual([...data.shade],[Math.fround(.6+.4*hp/maxHp),1]);assert.equal(data.stats.shadeBytes,8);assert.equal(source.hpOf(2**40),hp);assert.equal(source.maxHpOf(2**40),maxHp);
 const expected=new Color().setHex(cells[0].color).multiplyScalar(.6+.4*hp/maxHp),actual=sampleCellColor(data,{x:0,y:.5,z:0},normal)!;
 [expected.r,expected.g,expected.b].forEach((v,i)=>assert.ok(Math.abs(actual[i]-Math.fround(v))<=CELL_COLOR_FLOAT32_TOLERANCE));
});

test('256 unique base colors promote palette indices to Uint16 and count allocated palette row padding',async()=>{
 const {buildCellColorData}=await load();const cells=Array.from({length:256},(_,i)=>({x:i%16,y:Math.floor(i/16),z:0,color:i}));
 const small=buildCellColorData(fixture(cells.slice(0,255)),'0,0,0'),data=buildCellColorData(fixture(cells),'0,0,0');
 assert.ok(small.paletteIndex instanceof Uint8Array);assert.ok(data.paletteIndex instanceof Uint16Array);assert.equal(data.paletteIndex[255],256);
 assert.equal(data.paletteWidth,256);assert.equal(data.paletteHeight,2);assert.equal(data.palette.byteLength,256*2*4*4);
 assert.equal(data.stats.totalTextureBytes,data.palette.byteLength+data.paletteIndex.byteLength);
 for(const array of [data.paletteIndex,data.palette]){assert.equal(array.byteOffset,0);assert.equal(array.byteLength,array.buffer.byteLength);}
});

test('data snapshots own buffers and do not track later authority edits',async()=>{
 const {buildCellColorData,sampleCellColor}=await load();const cells=[{x:0,y:0,z:0,color:0x123456,hp:2.5}],source=fixture(cells),data=buildCellColorData(source,'0,0,0'),before=sampleCellColor(data,{x:0,y:.5,z:0},normal);
 cells[0].color=0xffffff;cells[0].hp=9;assert.deepEqual(sampleCellColor(data,{x:0,y:.5,z:0},normal),before);assert.notDeepEqual(sampleCellColor(buildCellColorData(source,'0,0,0'),{x:0,y:.5,z:0},normal),before);
 assert.equal(new Set([data.palette.buffer,data.paletteIndex.buffer,data.shade!.buffer]).size,3);
});

test('translated rotated nonuniform rubble transform preserves original local-space cell choice',async()=>{
 const {buildCellColorData,sampleCellColor}=await load();const data=buildCellColorData(fixture([{x:-2,y:-1,z:-3,color:0xabcdef}]),'-1,-1,-1');
 const localP=new Vector3(-1.5,-1,-3),localN=new Vector3(1,0,0),matrix=new Matrix4().compose(new Vector3(140,22,-88),new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),.9),new Vector3(2,.5,3));
 const worldP=localP.clone().applyMatrix4(matrix),worldN=localN.clone().applyMatrix3(new Matrix3().getNormalMatrix(matrix)).normalize();
 const recoveredP=worldP.clone().applyMatrix4(matrix.clone().invert()),recoveredN=worldN.clone().applyMatrix3(new Matrix3().setFromMatrix4(matrix).transpose()).normalize();
 assert.deepEqual(sampleCellColor(data,recoveredP,recoveredN),sampleCellColor(data,localP,localN));assert.equal(sampleCellColor(data,worldP,worldN),null);
});

test('empty/outside chunks allocate no textures and malformed lattice requests fail explicitly',async()=>{
 const {buildCellColorData}=await load(),source=fixture([{x:0,y:0,z:0,color:0xabcdef}]);
 const outside=buildCellColorData(source,'1,0,0');assert.deepEqual(outside.dimensions,[0,0,0]);assert.equal(outside.stats.totalTextureBytes,0);assert.equal(outside.stats.queriedCells,0);
 for(const key of ['00,0,0','0,0','0,0,1.5','NaN,0,0'])assert.throws(()=>buildCellColorData(source,key),RangeError);
 for(const size of [0,1.5,65])assert.throws(()=>buildCellColorData(source,'0,0,0',size),RangeError);
 assert.throws(()=>buildCellColorData({...source,bounds:{...source.bounds,minX:NaN}},'0,0,0'),RangeError);
});

test('shader subtracts integer origin before inward bias so Float32 cannot erase epsilon on distant lattice faces',async()=>{
 const {buildCellColorData,sampleCellColor,CELL_COLOR_GLSL,CELL_FACE_EPSILON}=await load();
 // Algebraically equivalent, but the old operation order loses 1e-4 in Float32.
 const f=Math.fround,p=2048.5;
 assert.equal(Math.floor(f(f(p-CELL_FACE_EPSILON)+.5))-2048,1,'reproduces the old GPU-precision wrong neighbor');
 assert.equal(Math.floor(f(f(f(p-2048)-CELL_FACE_EPSILON)+.5)),0,'origin first preserves inward face ownership');
 assert.match(CELL_COLOR_GLSL,/vec3 localPosition\s*=\s*originalPosition\s*-\s*vec3\(uCellOrigin\)/);
 assert.match(CELL_COLOR_GLSL,/floor\(localPosition-originalNormal\*/);
 const data=buildCellColorData(fixture([{x:2048,y:0,z:0,color:0xff0000},{x:2049,y:0,z:0,color:0x00ff00}]),'64,0,0');
 assert.deepEqual(sampleCellColor(data,{x:p,y:0,z:0},{x:1,y:0,z:0}),[1,0,0]);
});
