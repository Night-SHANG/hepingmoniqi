import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGrowingInstancePool, createTrajectoryOverlay, advanceEffectAges, hasActiveVisualEffects, PULSE_LIFETIME, copyLiveAimSurface } from './scene-runtime';

test('projectile instance pools grow past 48 without losing any real transforms',()=>{
  const scene=new THREE.Scene(), geometry=new THREE.BoxGeometry(), material=new THREE.MeshBasicMaterial();
  const pool=createGrowingInstancePool(scene,geometry,material,4);
  const matrix=new THREE.Matrix4(), actual=new THREE.Matrix4();
  for(const count of [8,48,60,100,257]){
    pool.reserve(count);
    assert.ok(pool.mesh.instanceMatrix.count>=count);
    for(let i=0;i<count;i++)pool.mesh.setMatrixAt(i,matrix.makeTranslation(i,2,-i));
    pool.mesh.count=count;
    for(let i=0;i<count;i++){
      pool.mesh.getMatrixAt(i,actual);
      assert.deepEqual(actual.elements.slice(12,15),[i,2,-i]);
    }
    assert.equal(scene.children.length,1);
  }
  const existing=pool.mesh;
  pool.reserve(1);
  assert.equal(pool.mesh,existing,'smaller later updates reuse capacity');
  pool.dispose();assert.equal(scene.children.length,0);geometry.dispose();material.dispose();
});

test('growing a live pool preserves its existing instance transforms and colors',()=>{
  const scene=new THREE.Scene(), geometry=new THREE.BoxGeometry(), material=new THREE.MeshBasicMaterial();
  const pool=createGrowingInstancePool(scene,geometry,material,1);
  pool.mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(4,5,6));
  pool.mesh.setColorAt(0,new THREE.Color(0xff9900));pool.mesh.count=1;
  let released=false;pool.mesh.addEventListener('dispose',()=>{released=true;});
  pool.reserve(100);
  const actual=new THREE.Matrix4(),color=new THREE.Color();pool.mesh.getMatrixAt(0,actual);pool.mesh.getColorAt(0,color);
  assert.deepEqual(actual.elements.slice(12,15),[4,5,6]);assert.equal(color.getHex(),0xff9900);
  assert.equal(pool.mesh.count,1);assert.equal(released,true);assert.equal(scene.children.length,1);
  pool.dispose();geometry.dispose();material.dispose();
});

test('planning overlay renders only supplied physics samples and the supplied impact',()=>{
  const scene=new THREE.Scene(),overlay=createTrajectoryOverlay(scene);
  const preview={points:[{x:1,y:2,z:3},{x:4,y:5,z:6},{x:8,y:2,z:9}],impact:{x:8,y:1,z:9},duration:1.25};
  overlay.setPreview(preview);
  const points=overlay.line.geometry.getAttribute('position');
  assert.equal(points.count,3);assert.deepEqual(Array.from(points.array),[1,2,3,4,5,6,8,2,9]);
  assert.deepEqual(overlay.endpoint.position.toArray(),[8,1,9]);
  assert.equal(overlay.line.visible,true);assert.equal(overlay.endpoint.visible,true);
  assert.equal(overlay.line.material.depthTest,false);assert.equal(overlay.line.material.depthWrite,false);
  assert.deepEqual(preview.points[0],{x:1,y:2,z:3},'rendering must not move physics samples');
  overlay.dispose();assert.equal(scene.children.length,0);
});

test('planning endpoint uses the last simulated point without inventing an impact and clears completely',()=>{
  const scene=new THREE.Scene(),overlay=createTrajectoryOverlay(scene);
  overlay.setPreview({points:[{x:2,y:4,z:6},{x:8,y:10,z:12}],impact:null,duration:3});
  assert.deepEqual(overlay.endpoint.position.toArray(),[8,10,12]);
  overlay.setPreview(null);assert.equal(overlay.line.visible,false);assert.equal(overlay.endpoint.visible,false);
  overlay.setPreview({points:[],impact:null,duration:0});assert.equal(overlay.line.visible,false);assert.equal(overlay.endpoint.visible,false);
  overlay.dispose();
});

test('settlement waits for core spectacle, not six-second decorative chips',()=>{
  assert.equal(hasActiveVisualEffects(0,[]),true);
  assert.equal(hasActiveVisualEffects(.85,[]),false);
  const chips=[{age:0,life:1},{age:0,life:6}];
  const survivors=advanceEffectAges(chips,1);
  assert.deepEqual(survivors,[{age:1,life:6}]);
  assert.equal(hasActiveVisualEffects(.85,survivors),false);
  const expired=advanceEffectAges(survivors,5);
  assert.deepEqual(expired,[]);assert.equal(hasActiveVisualEffects(10,expired),false);
});

test('paused visual effects do not age and ambient animation does not keep settlement pending',()=>{
  const chips=[{age:.5,life:2}];
  assert.deepEqual(advanceEffectAges(chips,0),[{age:.5,life:2}]);
  assert.equal(hasActiveVisualEffects(10,[]),false);
});

test('ground aiming remains valid without voxels while missing voxel faces are rejected',()=>{
  const ground={position:{x:12,y:0,z:10},normal:{x:0,y:1,z:0},voxelId:null};
  const copy=copyLiveAimSurface(ground,[]);
  assert.deepEqual(copy,ground);assert.notEqual(copy,ground);assert.notEqual(copy!.position,ground.position);
  assert.equal(copyLiveAimSurface({...ground,voxelId:7},[]),null);
  assert.equal(copyLiveAimSurface(null,[]),null);
  assert.deepEqual(copyLiveAimSurface({...ground,voxelId:7},[{id:7}]),{...ground,voxelId:7});
});

test('explicit scene reset clears effects regardless of next map voxel count',async()=>{const {clearedVisualEffects}=await import('./scene-runtime');const state=clearedVisualEffects([{age:0,life:6}],0);assert.equal(hasActiveVisualEffects(state.pulseAge,state.chips),false);assert.equal(state.chips.length,0);});

test('effect lifetimes keep simulated seconds at 1fps while cosmetic motion stays bounded',async()=>{const {effectFrameDeltas}=await import('./scene-runtime');for(const fps of [1,2,5,60]){let effects=[{age:0,life:6}];for(let i=0;i<fps*6+1;i++){const delta=effectFrameDeltas(1/fps,1);assert.ok(delta.motion<=.045);effects=advanceEffectAges(effects,delta.age);}assert.equal(effects.length,0,`${fps}fps must not extend six-second effect into minutes`);}});
test('effect lifetime respects intentional pause and slow motion',async()=>{const {effectFrameDeltas}=await import('./scene-runtime');assert.deepEqual(effectFrameDeltas(1,0),{motion:0,age:0});assert.equal(effectFrameDeltas(1,.25).age,.25);});

 test('core settlement window covers shipped explosion and delayed impact audio',async()=>{const {readFileSync}=await import('node:fs');const {CORE_EFFECT_LIFETIME}=await import('./scene-runtime');const source=JSON.parse(readFileSync(new URL('../public/audio/SOURCES.json',import.meta.url),'utf8'));const samples=Object.values(source).find(v=>Array.isArray(v)&&v.some(x=>x.file==='blast.wav')) as {file:string;durationSeconds:number}[];assert.ok(samples);assert.ok(CORE_EFFECT_LIFETIME>=samples.find(x=>x.file==='blast.wav')!.durationSeconds);assert.ok(CORE_EFFECT_LIFETIME>=.12+samples.find(x=>x.file==='wood-impact.wav')!.durationSeconds);});
