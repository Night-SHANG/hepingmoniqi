import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { MapId, Voxel } from './contracts';

const maps:MapId[]=['courtyard','warehouse','bridge','tower','cantilever','neighborhood','city'];

test('each map has a genuinely distinct bounded environment rather than one reused meadow',async()=>{
 const api=await import('./scene-environments').catch(()=>null);
 assert.ok(api,'map-aware environment module must exist');
 const specs=maps.map(map=>api!.getEnvironmentSpec(map));
 assert.equal(new Set(specs.map(spec=>JSON.stringify(spec.blocks))).size,maps.length);
 for(const spec of specs){
  assert.ok(spec.blocks.length>30&&spec.blocks.length<5000,spec.mapId);
  assert.ok(spec.blocks.every(b=>[b.x,b.y,b.z,b.sx,b.sy,b.sz].every(Number.isFinite)&&b.sx>0&&b.sy>0&&b.sz>0));
  assert.ok(spec.blocks.some(b=>b.role==='ground'));
  assert.ok(spec.blocks.every(b=>b.role!=='building'),'buildings must remain authored asset voxels');
 }
 assert.ok(specs[1].blocks.some(b=>b.role==='loading-bay'));
 assert.ok(specs[2].water.length>0);
 assert.ok(specs[3].blocks.some(b=>b.role==='plaza'));
 assert.ok(specs[4].blocks.some(b=>b.role==='cliff'));
 assert.ok(specs[5].blocks.some(b=>b.role==='road'));
 assert.ok(specs[6].blocks.some(b=>b.role==='bridge'));
 assert.ok(specs[6].water.length>0);
});

test('courtyard camera stays exact and scaled-map cameras adapt clipping controls and shadow bounds',async()=>{
 const {getEnvironmentSpec}=await import('./scene-environments');
 const yard=getEnvironmentSpec('courtyard');
 assert.deepEqual(yard.camera.position,[27,23,32]);assert.deepEqual(yard.camera.target,[0,4.5,0]);
 assert.equal(yard.camera.near,.2);assert.equal(yard.camera.far,250);assert.equal(yard.camera.minDistance,19);assert.equal(yard.camera.maxDistance,72);
 const street=getEnvironmentSpec('neighborhood'),city=getEnvironmentSpec('city');
 assert.equal(street.bounds.halfX,52);assert.equal(street.bounds.halfZ,42);
 assert.equal(city.bounds.halfX,122);assert.equal(city.bounds.halfZ,102);
 assert.ok(city.camera.far>street.camera.far&&street.camera.far>yard.camera.far);
 assert.ok(city.camera.maxDistance>street.camera.maxDistance&&street.camera.maxDistance>yard.camera.maxDistance);
 assert.ok(city.shadowExtent>street.shadowExtent&&street.shadowExtent>yard.shadowExtent);
});

test('environment switching disposes owned resources without disposing the shared cube',async()=>{
 const {createEnvironmentRenderer}=await import('./scene-environments');
 const scene=new THREE.Scene(),cube=new THREE.BoxGeometry();let cubeDisposed=0;
 cube.addEventListener('dispose',()=>cubeDisposed++);
 for(const map of maps){
  const env=createEnvironmentRenderer(scene,cube,map);let releases=0;
  const materials=new Set<THREE.Material>();env.object.traverse(o=>{if(o instanceof THREE.Mesh){for(const mat of Array.isArray(o.material)?o.material:[o.material])materials.add(mat);}});
  for(const mat of materials)mat.addEventListener('dispose',()=>releases++);
  assert.ok(scene.children.includes(env.object));env.dispose();env.dispose();
  assert.equal(releases,materials.size);assert.equal(scene.children.length,0);
 }
 assert.equal(cubeDisposed,0);cube.dispose();
});

test('sized voxels use exact native merged extents and reuse GPU instance capacity',async()=>{
 const api=await import('./scene');
 assert.equal(typeof api.createVoxelInstanceRenderer,'function');
 const scene=new THREE.Scene(),cube=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
 const render=api.createVoxelInstanceRenderer(scene,cube,material);
 const voxel:Voxel={id:1,position:{x:30,y:2,z:0},size:{x:4,y:4,z:4},weight:512,color:0xffffff,material:'stone',hp:5,maxHp:5};
 render.set([voxel]);const first=render.mesh,matrix=new THREE.Matrix4();first.getMatrixAt(0,matrix);
 assert.deepEqual(new THREE.Vector3().setFromMatrixScale(matrix).toArray(),[4,4,4]);
 const ray=new THREE.Raycaster(new THREE.Vector3(40,2,0),new THREE.Vector3(-1,0,0));
 assert.equal(ray.intersectObject(first,false)[0].point.x,32);
 render.set([{...voxel,position:{x:45,y:2,z:0}}]);assert.equal(render.mesh,first);
 const moved=new THREE.Raycaster(new THREE.Vector3(55,2,0),new THREE.Vector3(-1,0,0));assert.equal(moved.intersectObject(render.mesh,false)[0].point.x,47);
 render.set([]);assert.equal(render.mesh,first);assert.equal(render.mesh.count,0);
 render.dispose();cube.dispose();material.dispose();
});

test('scaled camera presets fit every actual licensed-building corner at square and wide aspects',async()=>{
 const {getEnvironmentSpec}=await import('./scene-environments');
 const {getScaledBuildingPlacements}=await import('./scaled-map-generators');
 for(const map of ['neighborhood','city'] as const){
  const spec=getEnvironmentSpec(map);
  for(const aspect of [1,1.6,2]){
   const camera=new THREE.PerspectiveCamera(42,aspect,spec.camera.near,spec.camera.far);
   camera.position.set(...spec.camera.position);camera.lookAt(...spec.camera.target);camera.updateMatrixWorld();
   for(const building of getScaledBuildingPlacements(map))for(const dx of [-building.width/2,building.width/2])for(const dz of [-building.depth/2,building.depth/2])for(const y of [-.5,building.height-.5]){
    const point=new THREE.Vector3(building.x+dx,y,building.z+dz).project(camera);
    assert.ok(Math.abs(point.x)<.95&&Math.abs(point.y)<.95&&Math.abs(point.z)<1,`${map} ${building.objectId} aspect${aspect}`);
   }
  }
 }
});

test('scaled roads and decorative trees do not intersect actual source building footprints',async()=>{
 const {getEnvironmentSpec}=await import('./scene-environments');
 const {getScaledBuildingPlacements}=await import('./scaled-map-generators');
 for(const map of ['neighborhood','city'] as const){
  const spec=getEnvironmentSpec(map),buildings=getScaledBuildingPlacements(map);
  for(const block of spec.blocks.filter(block=>block.role==='road'||block.role==='tree'))for(const building of buildings){
   const overlapX=Math.abs(block.x-building.x)<(block.sx+building.width)/2-1e-5;
   const overlapZ=Math.abs(block.z-building.z)<(block.sz+building.depth)/2-1e-5;
   assert.ok(!(overlapX&&overlapZ),`${map} ${block.role} (${block.x},${block.z}) overlaps ${building.objectId}`);
  }
 }
});

test('city camera launch origins remain inside the real radial physics bound, including maximum zoom',async()=>{
 const api=await import('./scene');assert.equal(typeof api.getSceneLaunchOrigin,'function');
 const {getEnvironmentSpec}=await import('./scene-environments');const spec=getEnvironmentSpec('city');
 const camera=new THREE.PerspectiveCamera(42,1.6,spec.camera.near,spec.camera.far);
 for(const scale of [1,2]){
  camera.position.set(...spec.camera.position).multiplyScalar(scale);camera.lookAt(...spec.camera.target);camera.updateMatrixWorld();
  for(const point of [{x:0,y:0,z:0},{x:110,y:0,z:80},{x:-110,y:51,z:-80}]){
   const origin=api.getSceneLaunchOrigin(camera,point);assert.ok(Math.hypot(origin.x,origin.z)<=280.0001);assert.ok(origin.y>point.y);
  }
 }
});

test('scaled scenic tree trunks and every hill tier rest on visible connected terrain',async()=>{
 const {getEnvironmentSpec}=await import('./scene-environments');
 for(const map of ['neighborhood','city'] as const){
  const spec=getEnvironmentSpec(map),halfX=map==='city'?120:50,halfZ=map==='city'?100:40;
  const terrain=spec.blocks.filter(b=>b.role==='scenic-terrain');
  assert.ok(terrain.length>0,`${map} needs a visible scenic foundation`);
  const contains=(base:typeof terrain[number],part:typeof terrain[number])=>Math.abs(base.x-part.x)+part.sx/2<=base.sx/2+.001&&Math.abs(base.z-part.z)+part.sz/2<=base.sz/2+.001;
  for(const trunk of spec.blocks.filter(b=>b.role==='tree'&&b.color===0x765334&&(Math.abs(b.x)>halfX||Math.abs(b.z)>halfZ))){
   const bottom=trunk.y-trunk.sy/2;
   assert.ok(terrain.some(base=>contains(base,trunk)&&Math.abs(base.y+base.sy/2-bottom)<.001),`${map} tree (${trunk.x},${trunk.z}) floats`);
  }
  const hills=spec.blocks.filter(b=>b.role==='hill');
  for(const hill of hills){
   const bottom=hill.y-hill.sy/2;
   assert.ok([...terrain,...hills].some(base=>base!==hill&&contains(base,hill)&&Math.abs(base.y+base.sy/2-bottom)<.001),`${map} hill (${hill.x},${hill.z}) has no aligned support`);
  }
  // The northern backdrop continuously connects to the map, instead of detached islands.
  for(let z=-halfZ;z>-(map==='city'?320:150);z-=5)assert.ok(terrain.some(b=>Math.abs(b.x)<b.sx/2&&Math.abs(z-b.z)<=b.sz/2),`${map} scenic gap at z=${z}`);
 }
});

test('city scenic banks do not fill the visible river channel',async()=>{
 const {getEnvironmentSpec}=await import('./scene-environments');
 const spec=getEnvironmentSpec('city'),terrain=spec.blocks.filter(b=>b.role==='scenic-terrain');
 assert.ok(terrain.length>0);
 for(let z=-120;z<=120;z+=20)assert.ok(!terrain.some(b=>b.y+b.sy/2>-.5&&Math.abs(146-b.x)<b.sx/2&&Math.abs(z-b.z)<b.sz/2),'river must stay open');
});

test('authoritative environments keep camera and exterior scenery without invulnerable in-map geometry',async()=>{
 const {getEnvironmentSpec,createEnvironmentRenderer}=await import('./scene-environments');
 for(const map of maps){
  const legacy=getEnvironmentSpec(map),spec=getEnvironmentSpec(map,{authoritative:true});
  assert.deepEqual(spec.camera,legacy.camera);assert.deepEqual(spec.bounds,legacy.bounds);
  assert.ok(spec.blocks.length>0,'keep outside scenery');
  for(const b of [...spec.blocks,...spec.water]){
   const intersects=Math.abs(b.x)-b.sx/2<spec.bounds.halfX-1e-6&&Math.abs(b.z)-b.sz/2<spec.bounds.halfZ-1e-6;
   assert.equal(intersects,false,`${map}: duplicate ${b.role} at (${b.x},${b.z})`);
  }
  const scene=new THREE.Scene(),cube=new THREE.BoxGeometry(),environment=createEnvironmentRenderer(scene,cube,map,{authoritative:true});
  assert.equal(environment.spec.blocks.length,spec.blocks.length);environment.dispose();cube.dispose();
 }
});
