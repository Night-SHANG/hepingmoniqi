import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import type {Voxel} from './contracts.js';

const root=new URL('../',import.meta.url);
const importer=new URL('../scripts/import-voxel-buildings.py',import.meta.url);
type NativeModel={id:number;sha256:string;nativeVoxelCount:number;bounds:{min:number[];max:number[]};palette:number[];boxes:number[][]};
type NativePack={schemaVersion:number;maxBoxAxis:number;models:NativeModel[]};
function readNative(path:URL):{cells:Map<string,number>;palette:number[];bytes:Buffer}{
 const bytes=readFileSync(path),cells=new Map<string,number>(),palette:number[]=[0];
 assert.equal(bytes.toString('ascii',0,4),'VOX ');
 for(let offset=8;offset<bytes.length;){
  const type=bytes.toString('ascii',offset,offset+4),content=bytes.readUInt32LE(offset+4),start=offset+12;
  if(type==='XYZI')for(let i=0;i<bytes.readUInt32LE(start);i++){
   const p=start+4+i*4;cells.set(`${bytes[p]},${bytes[p+1]},${bytes[p+2]}`,bytes[p+3]);
  }
  if(type==='RGBA')for(let i=0;i<255;i++)palette.push(bytes[start+i*4]*65536+bytes[start+i*4+1]*256+bytes[start+i*4+2]);
  offset=start+content;
 }
 return {cells,palette,bytes};
}
function chunk(name:string,content:Buffer,children=Buffer.alloc(0)){
 const head=Buffer.alloc(12);head.write(name);head.writeUInt32LE(content.length,4);head.writeUInt32LE(children.length,8);
 return Buffer.concat([head,content,children]);
}
function fixture(){
 // The missing (1,1,0) cell must stay empty, the blue cell cannot merge with red,
 // and the nine-cell vertical column must be split at the eight-cell cap.
 const cells=[[0,0,0,1],[1,0,0,1],[0,1,0,1],[2,0,0,2],...Array.from({length:9},(_,z)=>[4,0,z,1])];
 const size=Buffer.alloc(12);[8,8,12].forEach((v,i)=>size.writeUInt32LE(v,i*4));
 const count=Buffer.alloc(4);count.writeUInt32LE(cells.length);
 const rgba=Buffer.alloc(1024);rgba.set([255,0,0,255,0,0,255,255]);
 return Buffer.concat([Buffer.from('VOX '),Buffer.from([150,0,0,0]),chunk('MAIN',Buffer.alloc(0),Buffer.concat([
  chunk('SIZE',size),chunk('XYZI',Buffer.concat([count,Buffer.from(cells.flat())])),chunk('RGBA',rgba)
 ]))]);
}

test('VOX importer retains holes and palette boundaries while splitting damage chunks at eight cells',()=>{
 const temp=mkdtempSync(join(tmpdir(),'native-building-test-'));
 try{
  writeFileSync(join(temp,'1.vox'),fixture());const output=join(temp,'out.json');
  const run=spawnSync('python3',[importer.pathname,'--source-dir',temp,'--output',output,'--manifest',join(temp,'manifest.json')],{encoding:'utf8'});
  assert.equal(run.status,0,`converter must process valid native bytes: ${run.stderr}`);
  const pack=JSON.parse(readFileSync(output,'utf8')) as NativePack,model=pack.models[0];
  assert.equal(model.nativeVoxelCount,13);assert.equal(pack.maxBoxAxis,8);
  assert.deepEqual(model.boxes,[[0,0,0,2,1,1,1],[2,0,0,1,1,1,2],[4,0,0,1,1,8,1],[0,1,0,1,1,1,1],[4,0,8,1,1,1,1]]);
  assert.equal(model.palette[1],0xff0000);assert.equal(model.palette[2],0x0000ff);
 }finally{rmSync(temp,{recursive:true,force:true});}
});

test('VOX importer fails closed on truncated or duplicate occupied-cell records',()=>{
 const temp=mkdtempSync(join(tmpdir(),'native-building-invalid-'));
 try{
  for(const bytes of [fixture().subarray(0,25),(()=>{const b=fixture(),p=b.indexOf('XYZI')+16;b.copy(b,p+4,p,p+4);return b;})()]){
   writeFileSync(join(temp,'1.vox'),bytes);
   const run=spawnSync('python3',[importer.pathname,'--source-dir',temp,'--output',join(temp,'out.json'),'--manifest',join(temp,'manifest.json')],{encoding:'utf8'});
   assert.notEqual(run.status,0);assert.match(run.stderr,/invalid|duplicate|truncated/i);
  }
 }finally{rmSync(temp,{recursive:true,force:true});}
});

test('all thirteen licensed models reconstruct every native occupied cell and color without overlaps or proxy fills',()=>{
 const pack=JSON.parse(readFileSync(new URL('./generated/voxel-buildings.json',import.meta.url),'utf8')) as NativePack;
 assert.equal(pack.models.length,13);assert.equal(pack.schemaVersion,1);
 for(const model of pack.models){
  const original=readNative(new URL(`../assets/source-buildings/${model.id}.vox`,import.meta.url));
  assert.equal(model.sha256,createHash('sha256').update(original.bytes).digest('hex'));
  const reconstructed=new Map<string,number>();
  for(const [x,y,z,dx,dy,dz,color] of model.boxes){
   assert.ok([dx,dy,dz].every(d=>Number.isInteger(d)&&d>0&&d<=8));
   for(let xx=x;xx<x+dx;xx++)for(let yy=y;yy<y+dy;yy++)for(let zz=z;zz<z+dz;zz++){
    const key=`${xx},${yy},${zz}`;assert.equal(reconstructed.has(key),false,`overlap in model ${model.id}: ${key}`);
    assert.equal(original.cells.get(key),color,`extra cell or wrong color in model ${model.id}: ${key}`);
    reconstructed.set(key,color);
   }
   assert.equal(model.palette[color],original.palette[color]);
  }
  assert.equal(reconstructed.size,original.cells.size);assert.equal(model.nativeVoxelCount,original.cells.size);
  assert.ok(model.boxes.length<model.nativeVoxelCount/10);
 }
});

test('the importer regenerates committed model and provenance artifacts deterministically',()=>{
 const run=spawnSync('python3',[importer.pathname,'--check'],{cwd:root,encoding:'utf8'});
 assert.equal(run.status,0,run.stderr||run.stdout);
});

test('scaled maps use nine and thirty-six independent native buildings with canonical stable data',async()=>{
 const {neighborhoodVoxels,cityVoxels,getScaledBuildingPlacements}=await import('./scaled-map-generators.js');
 for(const [map,generator,count,minId] of [['neighborhood',neighborhoodVoxels,9,1000000],['city',cityVoxels,36,2000000]] as const){
  const voxels=generator(),placements=getScaledBuildingPlacements(map),objects=new Set(voxels.map(v=>v.objectId));
  assert.equal(objects.size,count);assert.equal(placements.length,count);assert.equal(generator(),voxels);assert.ok(Object.isFrozen(voxels));
  assert.equal(new Set(voxels.map(v=>v.id)).size,voxels.length);assert.ok(voxels.every(v=>v.id>=minId&&v.group==='house'));
  assert.deepEqual(generator(),voxels);
  for(const p of placements){
   const building=voxels.filter(v=>v.objectId===p.objectId);
   assert.ok(building.length>0);assert.ok(building.some(v=>v.anchored));
   for(const v of building){
    assert.ok(v.size);assert.ok([v.size.x,v.size.y,v.size.z].every(n=>n>0&&n<=4));
    assert.ok(Math.abs(v.weight!-(v.size.x*v.size.y*v.size.z)/(p.scale**3))<1e-7);
    assert.equal(v.anchored,Math.abs(v.position.y-v.size.y/2+0.5)<1e-9);
    assert.ok(Object.isFrozen(v)&&Object.isFrozen(v.position)&&Object.isFrozen(v.size));
   }
  }
  assert.ok(voxels.length<(map==='city'?13000:2500),'merged native models stay within simulation budget');
 }
});

test('placements keep an open neighborhood plaza and six non-overlapping city districts with a real skyline',async()=>{
 const {getScaledBuildingPlacements,neighborhoodVoxels,cityVoxels}=await import('./scaled-map-generators.js');
 const neighborhood=getScaledBuildingPlacements('neighborhood'),city=getScaledBuildingPlacements('city');
 assert.equal(new Set(neighborhood.map(p=>p.modelId)).size,9);
 assert.equal(new Set(city.map(p=>p.blockId)).size,6);
 assert.equal(neighborhood.find(p=>p.modelId===6)?.scale,0.3);
 assert.equal(neighborhood.find(p=>p.modelId===7)?.scale,0.4);
 assert.ok(neighborhood.every(p=>p.height<31));
 assert.ok(city.some(p=>p.height>=50));assert.ok(city.some(p=>p.height<10));
 for(const placements of [neighborhood,city])for(let i=0;i<placements.length;i++)for(let j=i+1;j<placements.length;j++){
  const a=placements[i],b=placements[j];assert.ok(Math.abs(a.x-b.x)>=(a.width+b.width)/2||Math.abs(a.z-b.z)>=(a.depth+b.depth)/2);
 }
 assert.ok(neighborhood.every(p=>Math.abs(p.x)>=p.width/2+10||Math.abs(p.z)>=p.depth/2+10));
 const bounds=(vs:readonly Voxel[])=>[Math.max(...vs.map(v=>v.position.x+v.size!.x/2))-Math.min(...vs.map(v=>v.position.x-v.size!.x/2)),Math.max(...vs.map(v=>v.position.z+v.size!.z/2))-Math.min(...vs.map(v=>v.position.z-v.size!.z/2))];
 const [nw,nd]=bounds(neighborhoodVoxels()),[cw,cd]=bounds(cityVoxels());
 assert.ok(nw>=80&&nd>=70);assert.ok(cw>=210&&cd>=150);assert.ok(cw>nw*2&&cd>nd*2);
});

test('world-space rotated and scaled damage boxes preserve exact source occupancy and palette colors',async()=>{
 const {getScaledBuildingPlacements,neighborhoodVoxels,cityVoxels}=await import('./scaled-map-generators.js');
 const originals=new Map<number,ReturnType<typeof readNative>>();
 for(const [map,voxels] of [['neighborhood',neighborhoodVoxels()],['city',cityVoxels()]] as const){
  for(const p of getScaledBuildingPlacements(map)){
   if(!originals.has(p.modelId))originals.set(p.modelId,readNative(new URL(`../assets/source-buildings/${p.modelId}.vox`,import.meta.url)));
   const original=originals.get(p.modelId)!,points=[...original.cells.keys()].map(key=>key.split(',').map(Number));
   const min=[0,1,2].map(axis=>Math.min(...points.map(point=>point[axis]))),max=[0,1,2].map(axis=>Math.max(...points.map(point=>point[axis])));
   const centerX=(min[0]+max[0]+1)/2,centerY=(min[1]+max[1]+1)/2;
   const restored=new Set<string>(),building=voxels.filter(v=>v.objectId===p.objectId);
   assert.equal(building.reduce((sum,v)=>sum+v.weight!,0),original.cells.size);
   for(const v of building){
    const wx=(v.position.x-p.x)/p.scale,wz=(v.position.z-p.z)/p.scale;
    const [lx,ly]=p.quarterTurns===1?[wz,-wx]:p.quarterTurns===2?[-wx,-wz]:p.quarterTurns===3?[-wz,wx]:[wx,wz];
    const dx=(p.quarterTurns%2?v.size!.z:v.size!.x)/p.scale,dy=(p.quarterTurns%2?v.size!.x:v.size!.z)/p.scale,dz=v.size!.y/p.scale;
    const start=[lx+centerX-dx/2,ly+centerY-dy/2,(v.position.y+.5)/p.scale-dz/2];
    assert.ok([...start,dx,dy,dz].every(n=>Math.abs(n-Math.round(n))<1e-7),'world transformation stays on the original native grid');
    const [x,y,z]=start.map(Math.round);
    for(let xx=x;xx<x+Math.round(dx);xx++)for(let yy=y;yy<y+Math.round(dy);yy++)for(let zz=z;zz<z+Math.round(dz);zz++){
     const key=`${xx},${yy},${zz}`,color=original.cells.get(key);assert.ok(color!==undefined,`unexpected fill in ${p.objectId}`);
     assert.equal(v.color,original.palette[color]);assert.equal(restored.has(key),false);restored.add(key);
    }
   }
   assert.equal(restored.size,original.cells.size);
  }
 }
});
