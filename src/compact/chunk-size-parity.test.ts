import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createCompactGameFixture} from './fixture';
import {CompactAuthorityStore} from './store';
import {createCompactSurfaceSource, type SurfaceEdit} from './surface-source';
import {createCompactSurfaceRenderer} from './surface-renderer';

function createRenderer(chunkSize:number) {
 const scene=new THREE.Scene(),box=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
 const render=createCompactSurfaceRenderer(scene,box,material,{chunkSize});
 return {chunkSize,scene,render,dispose(){render.dispose();box.dispose();material.dispose();}};
}
type Renderer=ReturnType<typeof createRenderer>;

/** Sort by exact owning lattice cell and outward normal, not chunk order.
 * Hash every emitted vertex, normal and float32 linear color, preserving each
 * face's six-vertex order/winding. Chunking must not alter any of those bytes.
 * The frozen pristine value accompanies the independently certified palette /
 * vertex / normal hash in surface-renderer.test.ts.
 */
function faceFingerprint(renderer:Renderer) {
 const faces:{key:string;positions:Buffer;normals:Buffer;colors:Buffer}[]=[];
 for(const object of renderer.render.group.children){
  const geometry=(object as THREE.Mesh).geometry;
  const positions=geometry.getAttribute('position') as THREE.BufferAttribute;
  const normals=geometry.getAttribute('normal') as THREE.BufferAttribute;
  const colors=geometry.getAttribute('color') as THREE.BufferAttribute;
  assert.ok(positions.array instanceof Float32Array);
  assert.ok(normals.array instanceof Int8Array);
  assert.ok(colors.array instanceof Float32Array);
  assert.equal(positions.count%6,0);
  assert.equal(normals.count,positions.count);assert.equal(colors.count,positions.count);
  for(let vertex=0;vertex<positions.count;vertex+=6){
   const key=[
    (positions.getX(vertex)+positions.getX(vertex+5))/2-normals.getX(vertex)*.5,
    (positions.getY(vertex)+positions.getY(vertex+5))/2-normals.getY(vertex)*.5,
    (positions.getZ(vertex)+positions.getZ(vertex+5))/2-normals.getZ(vertex)*.5,
    normals.getX(vertex),normals.getY(vertex),normals.getZ(vertex),
   ].join(',');
   faces.push({key,
    positions:Buffer.from(positions.array.buffer,positions.array.byteOffset+vertex*12,72),
    normals:Buffer.from(normals.array.buffer,normals.array.byteOffset+vertex*3,18),
    colors:Buffer.from(colors.array.buffer,colors.array.byteOffset+vertex*12,72),
   });
  }
 }
 faces.sort((a,b)=>a.key.localeCompare(b.key,'en'));
 const hash=createHash('sha256');
 for(let index=0;index<faces.length;index++){
  const face=faces[index];
  if(index)assert.notEqual(face.key,faces[index-1].key,'An exposed cell face must not be duplicated');
  hash.update(face.positions).update(face.normals).update(face.colors);
 }
 return {faces:faces.length,hash:hash.digest('hex')};
}

test('16 and 32 city chunks retain exact face bytes after crater, signed boundaries and HP edits',t=>{
 // One fixture and authority source, two render partitions. No Rapier world,
 // full-city CellView list, browser or WebGL context is constructed here.
 const fixture=createCompactGameFixture('city'),store=new CompactAuthorityStore(fixture);
 const source=createCompactSurfaceSource(store),renderers=[createRenderer(16),createRenderer(32)];
 const assertParity=(phase:string,faces:number,hash:string)=>{
  const fingerprints=renderers.map(faceFingerprint);
  assert.deepEqual(fingerprints[0],{faces,hash},`${phase}: chunk 16 changed certified face bytes`);
  assert.deepEqual(fingerprints[1],fingerprints[0],`${phase}: chunk size changed visible geometry, normals or colors`);
 };
 const apply=(phase:string,edits:readonly SurfaceEdit[])=>{
  for(const renderer of renderers){
   const started=performance.now();renderer.render.applyEdits(edits);
   const report=renderer.render.flush();
   t.diagnostic(JSON.stringify({scope:'Node CPU only; not browser latency or GPU timing',phase,
    chunkSize:renderer.chunkSize,ms:performance.now()-started,chunks:report.chunks,
    colorChunks:report.colorChunks,queriedCells:report.queriedCells,
    outputBytes:report.outputBytes,peakTemporaryBytes:report.peakTemporaryBytes}));
  }
 };
 const edit=(id:number,remove:boolean)=>{
  const row=store.writable(id);assert.ok(row);
  if(remove){row.state='gone';row.hp=0;}else row.hp*=.5;
  store.markChanged(id);
 };
 const idAt=(x:number,y:number,z:number)=>{
  const id=fixture.idAt(x,y,z);assert.notEqual(id,null);return id!;
 };
 try{
  assert.equal(fixture.count,454913);assert.equal(fixture.terrainCount,401800);assert.equal(fixture.structureCount,53113);
  for(const renderer of renderers){
   const started=performance.now(),report=renderer.render.bind(source),diagnostics=renderer.render.getDiagnostics();
   t.diagnostic(JSON.stringify({scope:'Node CPU only; not browser latency or GPU timing',phase:'bind',
    chunkSize:renderer.chunkSize,ms:performance.now()-started,chunks:report.chunks,
    queriedCells:report.queriedCells,peakTemporaryBytes:report.peakTemporaryBytes}));
   assert.equal(diagnostics.faces,203018);assert.equal(diagnostics.typedBufferBytes,32888916);
   assert.equal(diagnostics.staticMeshes,renderer.chunkSize===16?438:105);
   assert.equal(diagnostics.retainedCellViews,0);assert.equal(diagnostics.retainedHaloBytes,0);
  }
  assertParity('pristine',203018,'46812df7932483f716e715924636026e01ef0a187d8aa15d00a61a760b7d05a7');
  assert.equal(store.diagnostics().mutableStates,0);

  let cursor=store.revision;
  const crater=fixture.idsInSphere({x:-45,y:-1,z:43},2.2).filter(id=>fixture.roleOf(id)==='terrain');
  assert.equal(crater.length,23);
  for(const id of crater)edit(id,true);
  let batch=store.changesSince(cursor);cursor=batch.revision;
  apply('23-cell-crater',batch.edits);
  assertParity('crater',203054,'6aea76598d4764a7bbaa086527e99ee4f6d5609428f6a790a9b2d3a8cad40de6');

  // Cover either side of positive and negative boundaries for both sizes.
  // The HP edit is topology-neutral: only its exact linear colors may change.
  for(const x of [15,16,31,32,-16,-17,-32,-33])edit(idAt(x,-1,x),true);
  edit(idAt(50,-1,45),false);
  batch=store.changesSince(cursor);cursor=batch.revision;
  apply('signed-boundaries-and-HP',batch.edits);
  assertParity('boundaries-and-HP',203088,'f9424263627f9a9bbb29e74cd0880a63e0d167a1e0883bd81942a6312eacbbf1');

  const camera=new THREE.PerspectiveCamera(42,1440/900,.8,1600);
  camera.position.set(250,205,285);camera.lookAt(0,18,0);camera.updateMatrixWorld(true);
  const raycaster=new THREE.Raycaster();
  const samples=renderers.map(renderer=>{
   renderer.scene.updateMatrixWorld(true);
   const result:(null|{id:number|null;position:number[];normal:number[]})[]=[],started=performance.now();
   for(let x=0;x<5;x++)for(let y=0;y<5;y++){
    raycaster.setFromCamera(new THREE.Vector2(-.73+x*.331,-.63+y*.287),camera);
    const hit=raycaster.intersectObjects(renderer.render.raycastObjects,true)[0];
    const surface=hit?renderer.render.resolveIntersection(hit):null;
    const rounded=(values:Record<string,number>)=>Object.values(values).map(value=>Math.round(value*1e7)/1e7);
    result.push(surface?{id:surface.voxelId,position:rounded(surface.position),normal:rounded(surface.normal)}:null);
   }
   t.diagnostic(JSON.stringify({scope:'Node CPU only; not browser latency',phase:'25-camera-rays',
    chunkSize:renderer.chunkSize,ms:performance.now()-started,hits:result.filter(Boolean).length}));
   return result;
  });
  assert.equal(samples[0].filter(Boolean).length,8,'The ray comparison must include actual geometry hits');
  assert.deepEqual(samples[1],samples[0],'Chunk size must preserve nearest actual cell, position and normal');

  for(const renderer of renderers){
   const revision=renderer.render.getDiagnostics().revision,empty=store.changesSince(cursor);
   renderer.render.applyEdits(empty.edits);const idle=renderer.render.flush();renderer.render.setMoving([]);
   assert.equal(idle.chunks,0);assert.equal(idle.colorChunks,0);assert.equal(idle.queriedCells,0);
   assert.equal(renderer.render.getDiagnostics().revision,revision,'Idle updates must not invalidate either partition');
  }
 }finally{for(const renderer of renderers)renderer.dispose();}
});
