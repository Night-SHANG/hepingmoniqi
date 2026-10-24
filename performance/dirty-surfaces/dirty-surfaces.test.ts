import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Cell} from '../../src/structural/types.ts';
import {CompactTerrain} from '../terrain/compact-terrain.ts';
import {CompactStructures} from '../structure-store/compact-structures.ts';
import {CompactSurfaceSource,DirtySurfaceChunks} from './dirty-surfaces.ts';

// Independent dense oracle is bounded to these test fixtures, never the city path.
const dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const corners=[[[.5,-.5,-.5],[.5,.5,-.5],[.5,-.5,.5],[.5,.5,.5]],[[-.5,-.5,.5],[-.5,.5,.5],[-.5,-.5,-.5],[-.5,.5,-.5]],[[-.5,.5,.5],[.5,.5,.5],[-.5,.5,-.5],[.5,.5,-.5]],[[-.5,-.5,-.5],[.5,-.5,-.5],[-.5,-.5,.5],[.5,-.5,.5]],[[.5,-.5,.5],[.5,.5,.5],[-.5,-.5,.5],[-.5,.5,.5]],[[-.5,-.5,-.5],[-.5,.5,-.5],[.5,-.5,-.5],[.5,.5,-.5]]];
const key=(x:number,y:number,z:number)=>`${x},${y},${z}`;
function fixture(bounds={minX:-20,maxX:20,minZ:-2,maxZ:2},cells:Cell[]=[]){
 const terrain=new CompactTerrain({map:'test',...bounds}),structures=new CompactStructures(cells),source=new CompactSurfaceSource(terrain,structures,bounds),mesh=new DirtySurfaceChunks(source,16);
 mesh.initialize();return{terrain,structures,source,mesh,bounds};
}
function oracle(f:ReturnType<typeof fixture>){
 const cells=new Map<string,number>();
 for(let x=f.bounds.minX;x<=f.bounds.maxX;x++)for(let z=f.bounds.minZ;z<=f.bounds.maxZ;z++)for(let y=-8;y<0;y++){
  const id=f.terrain.staticAt(x,y,z);if(id!==null)cells.set(key(x,y,z),f.terrain.cell(id)!.color);
 }
 for(let i=0;i<f.structures.cellCount;i++){const c=f.structures.cell(f.structures.idAtIndex(i)!)!;if(c.state==='static')cells.set(key(c.position.x,c.position.y,c.position.z),c.color);}
 const faces:string[]=[];
 for(const [k,color]of cells){const[x,y,z]=k.split(',').map(Number);dirs.forEach(([dx,dy,dz],face)=>{if(!cells.has(key(x+dx,y+dy,z+dz)))faces.push(`${k}:${face}:${color}`);});}
 return faces.sort();
}
function actual(f:ReturnType<typeof fixture>){
 const faces:string[]=[];
 for(const geometry of f.mesh.geometries())for(let i=0;i<geometry.colors.length;i++){
  const n=Array.from(geometry.normals.subarray(i*18,i*18+3));const face=dirs.findIndex(d=>d.every((v,j)=>v===n[j]));assert.notEqual(face,-1);
  const p=geometry.positions.subarray(i*18,i*18+18);const center=[0,1,2].map(axis=>(Math.min(...[0,1,2,3,4,5].map(v=>p[v*3+axis]))+Math.max(...[0,1,2,3,4,5].map(v=>p[v*3+axis])))/2-n[axis]*.5);
  const [x,y,z]=center;faces.push(`${key(x,y,z)}:${face}:${geometry.colors[i]}`);
  for(let v=0;v<6;v++){const c=corners[face][[0,1,2,2,1,3][v]];assert.deepEqual(Array.from(p.subarray(v*3,v*3+3)),[x+c[0],y+c[1],z+c[2]]);assert.deepEqual(Array.from(geometry.normals.subarray(i*18+v*3,i*18+v*3+3)),n);}
 }
 return faces.sort();
}
function remove(f:ReturnType<typeof fixture>,x:number,y:number,z:number){const id=f.terrain.idAt(x,y,z)!;return f.source.captureEdit(id,()=>f.terrain.damage(id,1e9));}
function cell(id:number,x:number,y:number,z:number):Cell{return{id,objectId:'test:structure',role:'building',position:{x,y,z},material:'wood',color:0x995533,hp:2,maxHp:2};}

test('live first-layer digging reveals the new floor, exact corners, colors, and normals',()=>{
 const f=fixture();assert.deepEqual(actual(f),oracle(f));
 f.mesh.applyEdits([remove(f,-5,-1,0)]);const report=f.mesh.rebuildDirty();
 assert.deepEqual(actual(f),oracle(f));assert.ok(actual(f).includes('-5,-2,0:2:9134656'));assert.equal(report.chunks,2);
});
test('a full eight-layer shaft has cavity walls and no false floor at its bottom',()=>{
 const f=fixture();f.mesh.applyEdits(Array.from({length:8},(_,i)=>remove(f,-5,-i-1,0)));f.mesh.rebuildDirty();
 const faces=actual(f);assert.deepEqual(faces,oracle(f));assert.ok(faces.includes('-6,-8,0:0:10121288'));assert.ok(!faces.some(v=>v.startsWith('-5,-8,0:')||v.startsWith('-5,-9,0:')));
});
test('negative chunk-boundary holes update only existing face-sharing chunks, not diagonals',()=>{
 const f=fixture({minX:-33,maxX:2,minZ:-33,maxZ:2});const before=new Map(f.mesh.entries());
 f.mesh.applyEdits([remove(f,-16,-2,-16)]);const report=f.mesh.rebuildDirty();
 assert.deepEqual([...report.keys].sort(),['-1,-1,-1','-1,-1,-2','-2,-1,-1']);assert.deepEqual(actual(f),oracle(f));
 for(const[k,g]of before)if(!report.keys.includes(k))assert.strictEqual(f.mesh.getGeometry(k),g);
});
test('structure dynamic departure vacates its original static surface, not its new pose',()=>{
 const f=fixture({minX:-2,maxX:2,minZ:-2,maxZ:2},[cell(7,0,0,0),cell(8,0,1,0)]);
 const edit=f.source.captureEdit(7,()=>f.structures.promote(7,'falling',{x:40,y:9,z:40},{x:0,y:0,z:0,w:1},'dynamic'));
 f.mesh.applyEdits([edit]);f.mesh.rebuildDirty();const faces=actual(f);assert.deepEqual(faces,oracle(f));assert.ok(faces.some(v=>v.startsWith('0,1,0:3:')));assert.ok(faces.some(v=>v.startsWith('0,-1,0:2:')));assert.ok(!faces.some(v=>v.startsWith('40,9,40:')));
});
test('adjacent edits, duplicate revisions, and HP-only changes never rebuild unaffected geometry',()=>{
 const f=fixture({minX:-40,maxX:40,minZ:-20,maxZ:20});const before=new Map(f.mesh.entries());
 const one=remove(f,-15,-2,-15),two=remove(f,-14,-2,-15);f.mesh.applyEdits([one,two,one,two]);const report=f.mesh.rebuildDirty();
 assert.deepEqual(report.keys,['-1,-1,-1']);assert.equal(report.chunks,1);assert.equal(f.mesh.getGeometry('-1,-1,-1')!.revision,2);
 for(const[k,g]of before)if(k!=='-1,-1,-1')assert.strictEqual(f.mesh.getGeometry(k),g);
 f.mesh.applyEdits([two,one]);assert.equal(f.mesh.rebuildDirty().chunks,0);
 const id=f.terrain.idAt(-13,-2,-15)!;const hpOnly=f.source.captureEdit(id,()=>f.terrain.damage(id,.01));f.mesh.applyEdits([hpOnly]);assert.equal(f.mesh.rebuildDirty().chunks,0);assert.deepEqual(actual(f),oracle(f));
});
test('terrain dynamic departure also removes original occupancy and exposes adjacent soil',()=>{
 const f=fixture();const id=f.terrain.idAt(-5,-2,0)!;f.mesh.applyEdits([f.source.captureEdit(id,()=>f.terrain.promote(id,'falling-soil',{x:100,y:20,z:0},{x:0,y:0,z:0,w:1},'dynamic'))]);f.mesh.rebuildDirty();assert.deepEqual(actual(f),oracle(f));
});
test('a later no-op notification cannot hide an earlier occupancy edit delivered out of order',()=>{
 const f=fixture();const removal=remove(f,-5,-2,0),id=f.terrain.idAt(-5,-2,0)!;
 const noop=f.source.captureEdit(id,()=>f.terrain.damage(id,1));f.mesh.applyEdits([noop,removal]);const report=f.mesh.rebuildDirty();
 assert.equal(report.chunks,2);assert.deepEqual(actual(f),oracle(f));
 f.mesh.applyEdits([removal,noop]);assert.equal(f.mesh.rebuildDirty().chunks,0);
});
test('caller mutation of bounds cannot change the original registered chunk coverage',()=>{
 const bounds={minX:-2,maxX:2,minZ:-2,maxZ:2},terrain=new CompactTerrain({map:'ownership',...bounds});
 const source=new CompactSurfaceSource(terrain,new CompactStructures([]),bounds);
 bounds.minX=64;bounds.maxX=80;bounds.minZ=64;bounds.maxZ=80;
 assert.deepEqual([...source.registerChunks(16)].sort(),['-1,-1,-1','-1,-1,0','0,-1,-1','0,-1,0']);
 const mesh=new DirtySurfaceChunks(source,16);mesh.initialize();assert.equal(mesh.diagnostics().faces,210);
});
