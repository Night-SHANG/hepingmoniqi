import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import * as THREE from 'three';
import type {CompactSurfaceSource, SurfaceBounds} from '../compact/surface-source';
import {buildChunk} from '../worker-slice/chunk-mesh';
import {MeshCreditQueue} from '../worker-slice/mesh-credit-queue';

// This independent fixture suite checks presentation data and geometry only.
// Float32 shader tolerance is deliberately NOT bit-exact HP/physics authority.
type Cell = {x:number;y:number;z:number;color?:number;hp?:number;maxHp?:number;material?:string};
type Source = CompactSurfaceSource & {materialOf(id:number):string|undefined};
const direction = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const;
const positionKey = (p:Pick<Cell,'x'|'y'|'z'>) => `${p.x},${p.y},${p.z}`;
const faceKey = (p:readonly number[], n:readonly number[]) => [...p,...n].join(',');
const loadColors = async () => {
 const module = await import('./cell-colors').catch(() => null);
 assert.ok(module, 'the real compact cell-color implementation must exist');
 return module;
};
const loadGeometry = async () => {
 const module = await import('./geometry').catch(() => null);
 assert.ok(module?.buildMaterialGreedyChunk, 'the real material/normal mesher must exist');
 return module;
};
const loadMaterial = async () => {
 const module = await import('./material').catch(() => null);
 assert.ok(module?.createCellColorMaterial, 'the actual Three material adapter must exist');
 return module;
};
function source(cells:Cell[], bounds?:SurfaceBounds):Source {
 const ids = cells.map((_,i) => i%2 ? -(2**40)-i : 2**40+i);
 const byPosition = new Map(cells.map((p,i) => [positionKey(p),ids[i]]));
 const byId = new Map(ids.map((id,i) => [id,cells[i]]));
 return {
  bounds:bounds ?? {minX:Math.min(...cells.map(p=>p.x)),maxX:Math.max(...cells.map(p=>p.x)),minY:Math.min(...cells.map(p=>p.y)),maxY:Math.max(...cells.map(p=>p.y)),minZ:Math.min(...cells.map(p=>p.z)),maxZ:Math.max(...cells.map(p=>p.z))},
  staticIdAt:(x,y,z)=>byPosition.get(`${x},${y},${z}`)??null,
  colorOf:id=>byId.get(id)!.color??0x81957a,
  hpOf:id=>byId.get(id)!.hp??10,
  maxHpOf:id=>byId.get(id)!.maxHp??10,
  materialOf:id=>byId.get(id)!.material,
  forEachChunk(size,visit){
   const keys = new Set(cells.map(p=>`${Math.floor(p.x/size)},${Math.floor(p.y/size)},${Math.floor(p.z/size)}`));
   for(const key of keys)visit(...key.split(',').map(Number) as [number,number,number]);
  }
 };
}
function oracleFaces(cells:Cell[]) {
 const occupied = new Set(cells.map(positionKey)), result = new Map<string,Cell>();
 for(const p of cells)for(const n of direction)if(!occupied.has(`${p.x+n[0]},${p.y+n[1]},${p.z+n[2]}`))result.set(faceKey([p.x+n[0]/2,p.y+n[1]/2,p.z+n[2]/2],n),p);
 return result;
}

// Mutations caught: truncation instead of floor; epsilon with the wrong sign;
// world-position lookup after translation; transformed normal used as local.
test('surface cell selection uses negative local coordinates and the inward side of each normal',async()=>{
 const {cellFromSurface} = await loadColors();
 const centers = [[-33,-8,-2],[-1,-1,-1],[0,0,0],[31,2,7]];
 for(const center of centers)for(const n of direction){
  const p={x:center[0]+n[0]/2,y:center[1]+n[1]/2,z:center[2]+n[2]/2};
  assert.deepEqual(cellFromSurface(p,{x:n[0],y:n[1],z:n[2]}),center);
 }
 assert.deepEqual(cellFromSurface({x:-1.5,y:-2,z:-3},{x:1,y:0,z:0}),[-2,-2,-3]);
 assert.deepEqual(cellFromSurface({x:-1.5,y:-2,z:-3},{x:-1,y:0,z:0}),[-1,-2,-3]);
});

test('intact palette reproduces frozen baseline Float32 linear colors rather than normalized sRGB bytes',async()=>{
 const {buildCellColorData,sampleCellColor} = await loadColors();
 const cells:Cell[]=Array.from({length:256},(_,i)=>({x:i%8,y:Math.floor(i/64),z:Math.floor(i/8)%8,color:(i<<16)|((255-i)<<8)|((i*73)&255)}));
 const actualSource=source(cells), data=buildCellColorData(actualSource,'0,0,0',8);
 assert.equal(data.stats.occupiedCells,256);
 for(const c of cells){
  // The frozen one-cell worker oracle is independent of the new palette/shader code.
  const baseline=buildChunk(source([c]),'0,0,0',8);
  const got=sampleCellColor(data,{x:c.x+.5,y:c.y,z:c.z},{x:1,y:0,z:0});
  assert.deepEqual(got,Array.from(baseline.color.slice(0,3)),`unshaded cell ${positionKey(c)} must exactly preserve baseline Float32 linear RGB`);
 }
});

test('damaged fractional HP has an explicit Float32 visual tolerance without modifying authoritative scalar inputs',async()=>{
 const {buildCellColorData,sampleCellColor,CELL_COLOR_FLOAT32_TOLERANCE} = await loadColors();
 assert.ok(CELL_COLOR_FLOAT32_TOLERANCE<=1e-7 && CELL_COLOR_FLOAT32_TOLERANCE>0);
 const cells:Cell[]=[
  {x:-4,y:-2,z:-3,color:0xffffff,hp:1/3,maxHp:17},
  {x:-3,y:-2,z:-3,color:0x808080,hp:9.999999999999998,maxHp:10},
  {x:-2,y:-2,z:-3,color:0x010bfe,hp:0.00000000001,maxHp:99.9},
  {x:-1,y:-2,z:-3,color:0xfedcba,hp:123456.7890123,maxHp:987654.32109}
 ];
 const before=structuredClone(cells),data=buildCellColorData(source(cells),'-1,-1,-1',8);
 assert.ok(data.shade instanceof Float32Array,'damaged shade must not be silently omitted');
 for(const c of cells){
  const baseline=buildChunk(source([c]),'-1,-1,-1',8),want=Array.from(baseline.color.slice(0,3));
  const got=sampleCellColor(data,{x:c.x+.5,y:c.y,z:c.z},{x:1,y:0,z:0});assert.ok(got);
  got.forEach((channel:number,i:number)=>assert.ok(Math.abs(channel-want[i])<=CELL_COLOR_FLOAT32_TOLERANCE,`${positionKey(c)} channel ${i}: ${channel} vs ${want[i]}`));
 }
 assert.deepEqual(cells,before,'presentation construction must not round or overwrite source HP');
});

test('transformed objects retain lattice color lookup in original local coordinates',async()=>{
 const {buildCellColorData,sampleCellColor,cellFromSurface} = await loadColors();
 const cells:Cell[]=[{x:-3,y:0,z:-2,color:0xff0000},{x:-2,y:0,z:-2,color:0x00ff00}];
 const data=buildCellColorData(source(cells),'-1,0,-1',8),object=new THREE.Object3D();
 object.position.set(72.125,-14.5,121.75);object.rotation.set(.7,-1.2,.4);object.scale.set(1.8,.65,1.2);object.updateMatrixWorld(true);
 const original=new THREE.Vector3(-2.5,0,-2),normal=new THREE.Vector3(1,0,0),world=original.clone().applyMatrix4(object.matrixWorld);
 const recovered=object.worldToLocal(world.clone());
 const worldNormal=normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(object.matrixWorld));
 const recoveredNormal=worldNormal.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(object.matrixWorld).transpose()).normalize();
 assert.deepEqual(cellFromSurface(recovered,recoveredNormal),[-3,0,-2]);
 assert.deepEqual(sampleCellColor(data,recovered,recoveredNormal),[1,0,0]);
 assert.equal(sampleCellColor(data,world,worldNormal),null,'a translated world position must never be clamped into a local cell');
 // Rubble already uses the existing instance color path. This fixture only
 // establishes the lookup contract, not that moving rubble adopts this material.
});

test('air holes and coordinates beyond the retained envelope are rejected rather than clamped to colored voxels',async()=>{
 const {buildCellColorData,sampleCellColor}=await loadColors();
 const cells:Cell[]=[{x:-3,y:-2,z:-3,color:0xff0000},{x:-1,y:-2,z:-3,color:0x0000ff}];
 const data=buildCellColorData(source(cells),'-1,-1,-1',8);
 assert.deepEqual(data.dimensions,[3,1,1]);assert.equal(data.stats.airTexels,1);
 assert.equal(sampleCellColor(data,{x:-2,y:-1.5,z:-3},{x:0,y:1,z:0}),null,'an internal air texel must remain transparent');
 assert.equal(sampleCellColor(data,{x:-4,y:-1.5,z:-3},{x:0,y:1,z:0}),null,'out of range must not clamp to the nearest palette index');
 assert.deepEqual(sampleCellColor(data,{x:-2.5,y:-2,z:-3},{x:1,y:0,z:0}),[1,0,0],'left newly exposed wall reads its surviving cell');
 assert.deepEqual(sampleCellColor(data,{x:-1.5,y:-2,z:-3},{x:-1,y:0,z:0}),[0,0,1],'right newly exposed wall uses the opposite inward normal');
});

test('palette indices, padded texture allocation, no-mip configuration and disposal count real resources',async()=>{
 const {buildCellColorData} = await loadColors(),{createCellColorMaterial}=await loadMaterial();
 const cells:Cell[]=Array.from({length:257},(_,i)=>({x:i%8,y:Math.floor(i/64),z:Math.floor(i/8)%8,color:i+1,hp:i===0?3.25:10}));
 const data=buildCellColorData(source(cells),'0,0,0',8),bundle=createCellColorMaterial(data);
 try{
  assert.ok(data.paletteIndex instanceof Uint16Array,'more than 255 non-air colors must not wrap into Uint8 or air');
  assert.equal(data.palette.length,data.paletteWidth*data.paletteHeight*4,'palette texture storage includes padded row texels');
  assert.equal(data.paletteIndex.length,data.dimensions[0]*data.dimensions[1]*data.dimensions[2]);
  assert.equal(data.stats.indexBytes,data.paletteIndex.byteLength);
  assert.equal(data.stats.paletteBytes,data.palette.byteLength);
  assert.equal(data.stats.shadeBytes,data.shade?.byteLength??0);
  const allocated=data.paletteIndex.byteLength+data.palette.byteLength+(data.shade?.byteLength??0);
  assert.equal(data.stats.totalTextureBytes,allocated);
  assert.equal(bundle.textureBytes,allocated,'CPU upload accounting must not omit padding, index width, or shade');
  const textures=Object.values(bundle.textures).filter((t):t is THREE.DataTexture|THREE.Data3DTexture=>t!==null);
  for(const texture of textures){
   assert.equal(texture.generateMipmaps,false,'reported level-zero bytes are complete only when mipmaps are disabled');
   assert.equal(texture.mipmaps.length,0);assert.equal(texture.minFilter,THREE.NearestFilter);assert.equal(texture.magFilter,THREE.NearestFilter);
   assert.equal(texture.colorSpace,THREE.NoColorSpace,'linear palette must not receive a second sRGB decode');
  }
  assert.equal(bundle.textures.palette.image.data,data.palette);
  assert.equal(bundle.textures.index.image.data,data.paletteIndex);
  assert.equal(bundle.textures.shade?.image.data,data.shade);
  assert.equal(new Set([data.paletteIndex.buffer,data.palette.buffer,data.shade!.buffer]).size,3);
  for(const array of [data.paletteIndex,data.palette,data.shade!]){assert.equal(array.byteOffset,0);assert.equal(array.buffer.byteLength,array.byteLength);}
  let materialDisposals=0,textureDisposals=0;bundle.material.addEventListener('dispose',()=>materialDisposals++);
  textures.forEach(t=>t.addEventListener('dispose',()=>textureDisposals++));bundle.dispose();
  assert.equal(materialDisposals,1);assert.equal(textureDisposals,textures.length);
 }finally{bundle.dispose();}
});

async function verifyBoundary(cells:Cell[],size:number){
 const {buildMaterialGreedyChunk}=await loadGeometry(),{buildCellColorData,sampleCellColor}=await loadColors();
 const s=source(cells),want=oracleFaces(cells),seen=new Set<string>();let area=0,unitFaces=0;
 s.forEachChunk(size,(cx,cy,cz)=>{
  const key=`${cx},${cy},${cz}`,mesh=buildMaterialGreedyChunk(s,key,size),colors=buildCellColorData(s,key,size);
  const arrays=[mesh.position,mesh.normal,mesh.color,mesh.index];
  assert.equal(mesh.stats.outputBytes,arrays.reduce((sum,a)=>sum+a.byteLength,0),'output credit includes index buffer');
  assert.equal(new Set(arrays.map(a=>a.buffer)).size,arrays.length);
  for(const array of arrays){assert.equal(array.byteOffset,0);assert.equal(array.buffer.byteLength,array.byteLength);}
  unitFaces+=mesh.unitFaces;
  for(let q=0;q<mesh.faces;q++){
   const p=Array.from({length:4},(_,v)=>Array.from(mesh.position.slice((q*4+v)*3,(q*4+v+1)*3)));
   const n=Array.from(mesh.normal.slice(q*12,q*12+3)),axis=n.findIndex(v=>v!==0),[u,v]=[0,1,2].filter(a=>a!==axis);
   assert.equal(n.filter(v=>v!==0).length,1);assert.equal(Math.abs(n[axis]),1);
   assert.ok(p.every(point=>point[axis]===p[0][axis]));
   const loU=Math.min(...p.map(a=>a[u])),hiU=Math.max(...p.map(a=>a[u])),loV=Math.min(...p.map(a=>a[v])),hiV=Math.max(...p.map(a=>a[v]));
   assert.ok(Number.isInteger(hiU-loU)&&hiU>loU&&Number.isInteger(hiV-loV)&&hiV>loV);
   for(let t=0;t<2;t++){
    const indices=Array.from(mesh.index.slice(q*6+t*3,q*6+t*3+3));assert.ok(indices.every(i=>i>=q*4&&i<q*4+4));
    const points=indices.map(i=>new THREE.Vector3().fromArray(mesh.position,i*3));
    const cross=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));assert.ok(cross.dot(new THREE.Vector3(...n))>0);area+=cross.length()/2;
   }
   const materials=new Set<string|undefined>();
   for(let a=loU+.5;a<hiU;a++)for(let b=loV+.5;b<hiV;b++){
    const center=[0,0,0];center[axis]=p[0][axis];center[u]=a;center[v]=b;const k=faceKey(center,n),cell=want.get(k);
    assert.ok(cell,`filled hole, invented interior face, or wrong outward normal ${k}`);assert.ok(!seen.has(k),`duplicate face ${k}`);seen.add(k);materials.add(cell.material);
    const got=sampleCellColor(colors,{x:center[0],y:center[1],z:center[2]},{x:n[0],y:n[1],z:n[2]});assert.ok(got,`newly exposed crater face lacks voxel data: ${k}`);
    const baseline=buildChunk(source([cell]),key,size);const expected=Array.from(baseline.color.slice(0,3));
    got.forEach((channel:number,i:number)=>assert.ok(Math.abs(channel-expected[i])<=1e-7));
   }
   assert.equal(materials.size,1,'one merged quad cannot cross a material boundary even if colors match');
  }
 });
 assert.equal(unitFaces,want.size);assert.equal(seen.size,want.size);assert.equal(area,want.size);
}

test('material merging preserves holes, inward crater walls, chunk seams and per-voxel color/HP across negative coordinates',async()=>{
 const cells:Cell[]=[];
 for(let x=-3;x<=4;x++)for(let y=-1;y<=1;y++)for(let z=-3;z<=4;z++){
  if((x===0||x===1)&&(z===0||z===1)&&y>=0)continue;
  cells.push({x,y,z,material:x<0?'soil':'stone',color:(x+y+z)%2?0x849c51:0x78624f,hp:(x-z)%3?10:3.333333333});
 }
 for(const size of [2,4,8])await verifyBoundary(cells,size);
});

test('geometry-only neutral colors are not equivalence evidence, while the companion data restores checkerboard colors',async()=>{
 const {buildMaterialGreedyChunk}=await loadGeometry(),{buildCellColorData,sampleCellColor}=await loadColors();
 const cells:Cell[]=[];for(let x=0;x<8;x++)for(let z=0;z<8;z++)cells.push({x,y:0,z,material:'soil',color:(x+z)%2?0xff0000:0x0000ff});
 const s=source(cells),geometry=buildMaterialGreedyChunk(s,'0,0,0',8),data=buildCellColorData(s,'0,0,0',8);
 assert.equal(geometry.faces,6);assert.equal(geometry.unitFaces,160);assert.ok(geometry.color.every(v=>v===1));
 assert.deepEqual(sampleCellColor(data,{x:0,y:.5,z:0},{x:0,y:1,z:0}),[0,0,1]);
 assert.deepEqual(sampleCellColor(data,{x:1,y:.5,z:0},{x:0,y:1,z:0}),[1,0,0]);
});

test('independent transfer detaches only presentation arrays, including indices and every texture allocation',async()=>{
 const {buildMaterialPatch}=await import('./patch');
 const cells=[{x:0,y:0,z:0,color:0x123456,hp:1.234567890123,maxHp:10,material:'stone'}],before=structuredClone(cells),s=source(cells);
 const queue=new MeshCreditQueue({envelope:{worldId:'independent-color-transfer',epoch:1,sequence:1,mapRecipeHash:'independent-fixture'},chunkKeys:['0,0,0']});
 queue.markDirty('0,0,0',1,0);
 const result=queue.takeNext(key=>buildMaterialPatch(s,key,4),1);assert.equal(result.status,'patch');
 const geometry=result.patch.mesh,colors=geometry.cellColors!;assert.ok(geometry.index);assert.ok(colors);
 const arrays=[geometry.position,geometry.normal,geometry.color,geometry.index,colors.paletteIndex,colors.palette,...(colors.shade?[colors.shade]:[])];
 const transfer=result.transfer;assert.equal(new Set(transfer).size,transfer.length);
 assert.deepEqual(new Set(transfer),new Set(arrays.map(a=>a.buffer)),'real queue transfer must include geometry, index and all texture buffers exactly once');
 const byteCount=transfer.reduce((sum,b)=>sum+b.byteLength,0);assert.equal(queue.diagnostics(1).inFlightBytes,byteCount);
 const receiver=structuredClone(result.patch,{transfer});
 assert.ok(arrays.every(a=>a.byteLength===0));
 assert.equal(receiver.mesh.stats.outputBytes,byteCount,'complete patch byte credit includes textures, not merely geometry');
 assert.deepEqual(cells,before);assert.equal(s.hpOf(s.staticIdAt(0,0,0)!),1.234567890123);
 assert.deepEqual(Array.from(buildMaterialPatch(s,'0,0,0',4).index!),Array.from(receiver.mesh.index!));
 assert.equal(queue.acknowledge(receiver.header),byteCount);assert.equal(queue.diagnostics(2).inFlightBytes,0);queue.dispose();
});

test('browser harness self-tests metrics without importing or launching a browser',()=>{
 const result=spawnSync(process.execPath,['scripts/material-browser-check.mjs','--self-test'],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'',QA_BROWSER_CHANNEL:''}});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/no browser was executed/i);
});
