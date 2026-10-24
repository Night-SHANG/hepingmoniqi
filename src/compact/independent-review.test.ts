import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {createDenseFixture} from './fixture.js';
import {createStructuralSimulation} from '../structural/simulation.js';
import {createSupportGraph} from '../structural/support.js';
import {createProjectilePhysics} from '../physics.js';
import * as THREE from 'three';
import {createStructuralGameWorld} from '../structural/game-world.js';
import {createCompactSurfaceRenderer} from './surface-renderer.js';
import {createCompactSurfaceSource} from './surface-source.js';
import {getEnvironmentSpec} from '../scene-environments.js';
import {getSceneLaunchOrigin} from '../scene.js';
import type {Cell, SceneFixture, StructuralCompactQueries, CompactStructuralSnapshot} from '../structural/types.js';

// Independent kernel review deliberately uses 72–75 cells, never another city.
const soil=():Cell[]=>{
 const cells:Cell[]=[];
 for(let y=-1;y>=-8;y--)for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)cells.push({id:cells.length+1,objectId:'soil',role:'terrain',position:{x,y,z},material:'soil',color:0x887755,hp:100,maxHp:100,anchor:y===-8});
 return cells;
};
async function compact(cells:Cell[],name:string,maxActiveBodies=2){
 const source:SceneFixture={id:`independent-${name}`,cells};
 return createStructuralSimulation(createDenseFixture(source),{maxActiveBodies,compactSupportFactory:store=>{
  const graph=()=>createSupportGraph(source.cells.filter(c=>store.stateOf(c.id)==='static'));
  let current=graph();
  return {remove:ids=>current.remove(ids),unsupported:()=>current.unsupported(),reset(){current=graph();}};
 }});
}
const cut=(s:Awaited<ReturnType<typeof compact>>,id:string,y:number)=>s.blast({id,epoch:s.epoch,position:{x:0,y,z:0},radius:.2,damage:1000,impulse:0});
function noDenseViews(s:Awaited<ReturnType<typeof compact>>){
 s.views=()=>{throw new Error('Independent compact review forbids a full inventory');};
 s.liveViews=()=>{throw new Error('Independent compact review forbids a full inventory');};
}
const query=(s:Awaited<ReturnType<typeof compact>>,x:number)=>s.physicsHost.world.castRay(new RAPIER.Ray({x,y:3,z:0},{x:0,y:-1,z:0}),20,true);

test('independent: sparse hole restore immediately exposes surviving exact colliders without a solver tick',async()=>{
 const s=await compact(soil(),'restore-query');
 try{
  noDenseViews(s);s.step(1/120);assert.ok(query(s,1));
  for(let y=-1;y>=-8;y--)assert.ok(cut(s,`cut-${y}`,y));
  const saved=s.snapshot() as CompactStructuralSnapshot;
  assert.equal(saved.cells.length,8);assert.equal(query(s,0),null);
  s.reset();s.step(1/120);assert.ok(query(s,0));
  assert.ok(s.restore(saved));
  assert.equal(query(s,0),null,'Restoring must not fill the excavated eight-layer shaft');
  assert.ok(query(s,1),'Surviving collision queries must work immediately after restore, before the next step');
  assert.equal((s.snapshot() as CompactStructuralSnapshot).tick,saved.tick,'A query must not advance the physics clock');
 }finally{s.dispose();}
});

test('independent: rejected sparse restore leaves armed projectile, host, epoch and query state intact',async()=>{
 const s=await compact(soil(),'atomic-armed'),p=await createProjectilePhysics({host:s.physicsHost});
 try{
  noDenseViews(s);s.step(1/120);cut(s,'partial-hole',-1);
  assert.ok(p.launch({id:'armed-review',epoch:s.epoch,weapon:'pulse',power:1,trigger:'remote',origin:{x:1,y:8,z:0},target:{x:1,y:-1,z:0}}));
  p.step(1/120);
  const before=s.snapshot() as CompactStructuralSnapshot,world=s.physicsHost.world,epoch=s.epoch,shots=p.getProjectiles(),pending=s.pending(),hit=query(s,1);
  assert.ok(hit);assert.ok(pending>0);
  for(const mutate of [
   (v:CompactStructuralSnapshot)=>{v.cells[0].hp=Number.NaN;},
   (v:CompactStructuralSnapshot)=>{v.cells.push(structuredClone(v.cells[0]));},
   (v:CompactStructuralSnapshot)=>{v.fixtureSignature+=':wrong-recipe';},
   (v:CompactStructuralSnapshot)=>{v.queue.push('missing-piece');},
  ]){
   const malformed=structuredClone(before);mutate(malformed);
   assert.equal(s.restore(malformed),false);
   assert.equal(s.physicsHost.world,world);assert.equal(s.epoch,epoch);
   assert.deepEqual(p.getProjectiles(),shots);assert.equal(s.pending(),pending);
   assert.deepEqual(s.snapshot(),before);assert.equal(query(s,1)?.collider.handle,hit.collider.handle);
  }
 }finally{p.dispose();s.dispose();}
});

test('independent: a post-reload second real projectile passes through the full-depth shaft',async()=>{
 const s=await compact(soil(),'second-projectile'),p=await createProjectilePhysics({host:s.physicsHost});
 try{
  noDenseViews(s);s.step(1/120);
  const launch=(id:string)=>p.launch({id,epoch:s.epoch,weapon:'pulse',power:1,origin:{x:0,y:4,z:0},target:{x:0,y:-1,z:0}});
  assert.ok(launch('first'));const first=[];
  for(let n=0;n<180&&!first.length;n++)first.push(...p.step(1/120));
  assert.equal(first.length,1);assert.ok(first[0].position.y>-.6);
  for(let y=-1;y>=-8;y--)assert.ok(cut(s,`hole-${y}`,y));
  const saved=JSON.parse(JSON.stringify(s.snapshot()));s.reset();assert.ok(s.restore(saved));
  assert.equal(s.compact!.diagnostics().mutableStates,8);
  assert.ok(launch('second'));const second=[];let minimumY=Infinity;
  for(let n=0;n<180;n++){second.push(...p.step(1/120));for(const shot of p.getProjectiles())minimumY=Math.min(minimumY,shot.position.y);}
  assert.equal(second.length,0,'A removed column cannot behave like a hidden ground plane');
  assert.ok(minimumY< -8,`Second real projectile reached ${minimumY}, not below the finite floor`);
  assert.equal(s.research(),0,'Terrain has no objective reward');
 }finally{p.dispose();s.dispose();}
});

test('independent: sparse renderer cursors replace restored state without leaking old per-cell views',async()=>{
 const s=await compact(soil(),'query-ownership');
 try{
  noDenseViews(s);const binding:StructuralCompactQueries=s.compact!,before=binding.changesSince();
  const pristine=binding.cell(5)!;assert.equal(pristine.state,'static');
  cut(s,'removed',-1);const removed=binding.cell(5)!;
  assert.equal(removed.state,'gone');assert.equal(pristine.state,'static');
  const saved=s.snapshot();const stale=binding.changesSince(before.revision);
  assert.deepEqual(stale.ids,[5]);assert.ok(s.restore(saved));
  const replacement=binding.changesSince(stale.revision);
  assert.equal(replacement.reset,true);assert.deepEqual(replacement.ids,[]);
  assert.deepEqual(binding.changedCells().map(c=>c.id),[5]);
  assert.equal(binding.diagnostics().mutableStates,1);assert.equal(binding.diagnostics().retainedPristineStates,0);
  s.reset();assert.deepEqual(binding.changedCells(),[]);assert.equal(binding.diagnostics().mutableStates,0);
  assert.equal(binding.cell(5)!.state,'static');assert.equal(removed.state,'gone');
 }finally{s.dispose();}
});

test('independent: exact compact courtyard ray and default timed grenade earn actual partial research',async()=>{
 // Explicitly requested by the integration lead after the serial city baseline
 // finished. One courtyard world, actual camera launch, no legacy dense view.
 const world=createStructuralGameWorld();let p:Awaited<ReturnType<typeof createProjectilePhysics>>|undefined;
 const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshBasicMaterial();
 const renderer=createCompactSurfaceRenderer(scene,geometry,material);
 try{
  assert.ok(await world.startRound('courtyard',{charge:2,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0}));
  world.getVoxels=()=>{throw new Error('Full materialization is forbidden in camera-origin preflight');};
  const binding=world.getRenderBinding()!;renderer.bind(createCompactSurfaceSource(binding.source));renderer.setMoving(binding.movingViews());scene.updateMatrixWorld(true);
  const environment=getEnvironmentSpec('courtyard',{authoritative:true}),camera=new THREE.PerspectiveCamera(42,1440/900,environment.camera.near,environment.camera.far);
  camera.position.set(...environment.camera.position);camera.lookAt(new THREE.Vector3(...environment.camera.target));camera.updateMatrixWorld();
  const building=world.getVoxel(360)!;assert.equal(building.group,'house');
  const point=new THREE.Vector3(building.position.x,building.position.y,building.position.z).project(camera),ray=new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(point.x,point.y),camera);
  const hit=ray.intersectObjects(renderer.raycastObjects,true)[0];assert.ok(hit);
  const surface=renderer.resolveIntersection(hit)!;assert.equal(surface.voxelId,360);
  const origin=getSceneLaunchOrigin(camera,surface.position);
  p=await createProjectilePhysics({host:world.physicsHost!});assert.ok(world.recordShot('charge'));
  assert.ok(p.launch({id:'native-courtyard-default',epoch:world.epoch,weapon:'charge',power:1,origin,target:surface.position}));
  const detonations=[];let ticks=0;
  for(;ticks<3600;ticks++){
   for(const event of p.step(1/120)){detonations.push(event);assert.ok(world.damage({id:event.id,epoch:event.epoch,target:event.position,weapon:event.weapon,power:event.power}).accepted);}
   if(detonations.length&&world.pending()===0)break;
  }
  assert.equal(detonations.length,1);assert.equal(detonations[0].reason,'timer');assert.ok(Math.abs(detonations[0].age-3)<1e-8);
  assert.equal(world.pending(),0);
  assert.equal(world.getRound().remaining!.charge,1);
  const changed=binding.changedCells();
  console.log('INDEPENDENT_MAIN_PREFLIGHT '+JSON.stringify({at:new Date().toISOString(),map:'courtyard',id:360,power:1,origin,surface,
   detonation:detonations[0],ticks,research:world.getResearch(),objective:world.getObjective(),changedCells:changed.length,
   staticPartiallyDamaged:changed.filter(c=>c.state==='static'&&c.hp<c.maxHp).length,pending:world.pending()}));
  assert.ok(world.getResearch()>0&&world.getResearch()<200);assert.ok(changed.length>0);
 }finally{p?.dispose();world.suspend();renderer.dispose();geometry.dispose();material.dispose();}
});
