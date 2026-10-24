import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';

import {installCompactQueryRefresh, type CompactQueryBounds} from './query-refresh.js';
import {createDenseFixture} from './fixture.js';
import {createStructuralSimulation} from '../structural/simulation.js';
import {createSupportGraph} from '../structural/support.js';
import {createProjectilePhysics} from '../physics.js';
import type {Cell, CompactStructuralSnapshot} from '../structural/types.js';
const zero={x:0,y:0,z:0}, identity={x:0,y:0,z:0,w:1};
const ray=(x=0,y=10,z=0)=>new RAPIER.Ray({x,y,z},{x:0,y:-2,z:0});
const rotation=(angle:number)=>({x:0,y:0,z:Math.sin(angle/2),w:Math.cos(angle/2)});
async function fixture(){await RAPIER.init();return new RAPIER.World(zero);}
function candidates(world:RAPIER.World){const result:RAPIER.Collider[]=[];world.forEachCollider(c=>result.push(c));return result;}
function near(a:number,b:number,message=''){assert.ok(Math.abs(a-b)<2e-5,`${message}: ${a} != ${b}`);}
function vector(a:RAPIER.Vector,b:RAPIER.Vector,message=''){for(const k of ['x','y','z'] as const)near(a[k],b[k],`${message}.${k}`);}
function shapeHit(a:RAPIER.ColliderShapeCastHit|null,b:RAPIER.ColliderShapeCastHit|null){
 assert.equal(a?.collider.handle,b?.collider.handle);assert.ok(a&&b);near(a.time_of_impact,b.time_of_impact,'toi');
 for(const field of ['witness1','witness2','normal1','normal2'] as const)vector(a[field],b[field],field);
}

test('compact query adapter sees fresh exact colliders before any solver step',async()=>{
 const world=await fixture();let dirty=true;
 const dispose=installCompactQueryRefresh(world,{isDirty:()=>dirty,markDirty:()=>{dirty=true;},candidates:()=>candidates(world).reverse()});
 try{
  const nearCollider=world.createCollider(RAPIER.ColliderDesc.cuboid(.5,.5,.5).setTranslation(0,4,0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(.5,.5,.5).setTranslation(0,0,0));
  const hit=world.castRay(ray(),10,true);assert.ok(hit,'fresh collider must be queryable without world.step');
  assert.equal(hit.collider,nearCollider);near(hit.timeOfImpact,2.75);
  assert.equal(world.castRay(ray(2),10,true),null);
  assert.equal(world.castRay(ray(),2,true),null);
  assert.equal(world.castRay(new RAPIER.Ray({x:0,y:4,z:0},{x:0,y:1,z:0}),10,true)?.timeOfImpact,0);
  near(world.castRay(new RAPIER.Ray({x:0,y:4,z:0},{x:0,y:1,z:0}),10,false)!.timeOfImpact,.5);
  const normal=world.castRayAndGetNormal(ray(),10,true);assert.ok(normal);vector(normal.normal,{x:0,y:1,z:0});
 }finally{dispose();world.free();}
});

test('compact pairwise rays and shape casts match native rotated fixed and dynamic world geometry',async()=>{
 const world=await fixture();let dispose=()=>{};
 try{
  world.createCollider(RAPIER.ColliderDesc.cuboid(1,.4,.7).setTranslation(-3,2,1).setRotation(rotation(.6)));
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(3,2,1).setRotation(rotation(-.7)));
  world.createCollider(RAPIER.ColliderDesc.cuboid(.7,.3,.5).setTranslation(.25,0,0),body);
  world.step();
  const rays=[ray(-3,8,1),ray(3,8,1)];
  const rayExpected=rays.map(r=>world.castRayAndGetNormal(r,10,true));
  const casts=[{position:{x:-3,y:8,z:1},shape:new RAPIER.Ball(.2)},{position:{x:3,y:8,z:1},shape:new RAPIER.Cuboid(.2,.15,.3)}];
  const expected=casts.map(c=>world.castShape(c.position,rotation(.3),{x:0,y:-2,z:0},c.shape,.07,10,true));
  dispose=installCompactQueryRefresh(world,{isDirty:()=>true,candidates:()=>candidates(world)});
  rays.forEach((r,i)=>{const actual=world.castRayAndGetNormal(r,10,true),native=rayExpected[i];assert.ok(actual&&native);assert.equal(actual.collider.handle,native.collider.handle);near(actual.timeOfImpact,native.timeOfImpact);vector(actual.normal,native.normal);assert.equal(actual.featureType,native.featureType);assert.equal(actual.featureId,native.featureId);});
  casts.forEach((c,i)=>shapeHit(world.castShape(c.position,rotation(.3),{x:0,y:-2,z:0},c.shape,.07,10,true),expected[i]));
 }finally{dispose();world.free();}
});

test('compact dirty queries honor native flags, groups, disabled state, exclusions and predicates',async()=>{
 const world=await fixture();let dispose=()=>{};
 try{
  const fixed=world.createCollider(RAPIER.ColliderDesc.ball(.3).setTranslation(0,1,0).setCollisionGroups(0x00010003));
  const dynamic=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,3,0));
  const dc=world.createCollider(RAPIER.ColliderDesc.ball(.3).setCollisionGroups(0x00020001),dynamic);
  const kinematic=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0,5,0));
  world.createCollider(RAPIER.ColliderDesc.ball(.3).setCollisionGroups(0x00010002),kinematic);
  const sensor=world.createCollider(RAPIER.ColliderDesc.ball(.3).setTranslation(0,7,0).setSensor(true));
  world.createCollider(RAPIER.ColliderDesc.ball(.3).setTranslation(0,9,0).setEnabled(false));
  const disabledBody=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,9.5,0).setEnabled(false));
  world.createCollider(RAPIER.ColliderDesc.ball(.3),disabledBody);
  world.step();
  type Filters=Parameters<RAPIER.World['castRay']> extends [any,any,any,...infer Rest]?Rest:never;
  const filters:Filters[]=[[],[RAPIER.QueryFilterFlags.EXCLUDE_SENSORS],[RAPIER.QueryFilterFlags.EXCLUDE_SOLIDS],
   [RAPIER.QueryFilterFlags.ONLY_DYNAMIC],[RAPIER.QueryFilterFlags.ONLY_KINEMATIC],[RAPIER.QueryFilterFlags.ONLY_FIXED],
   [RAPIER.QueryFilterFlags.EXCLUDE_FIXED],[RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC],[RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC],
   [undefined,0x00010002],[undefined,0x00020001],[undefined,0],[undefined,undefined,sensor],
   [RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,undefined,undefined,kinematic],
   [undefined,undefined,undefined,undefined,c=>c===fixed||c===dc],
   [undefined,undefined,undefined,undefined,()=>false]];
  const expected=filters.map(f=>({ray:world.castRay(ray(),10,true,...f),normal:world.castRayAndGetNormal(ray(),10,true,...f),shape:world.castShape({x:0,y:10,z:0},identity,{x:0,y:-2,z:0},new RAPIER.Ball(.1),0,10,true,...f)}));
  dispose=installCompactQueryRefresh(world,{isDirty:()=>true,candidates:()=>candidates(world)});
  filters.forEach((f,i)=>{
   const actual=world.castRay(ray(),10,true,...f),normal=world.castRayAndGetNormal(ray(),10,true,...f),shape=world.castShape({x:0,y:10,z:0},identity,{x:0,y:-2,z:0},new RAPIER.Ball(.1),0,10,true,...f);
   assert.equal(actual?.collider.handle,expected[i].ray?.collider.handle,`ray filter ${i}`);
   assert.equal(normal?.collider.handle,expected[i].normal?.collider.handle,`normal filter ${i}`);
   assert.equal(shape?.collider.handle,expected[i].shape?.collider.handle,`shape filter ${i}`);
  });
 }finally{dispose();world.free();}
});

test('compact query bounds include non-unit/infinite rays and rotated swept shape extents',async()=>{
 const world=await fixture();const bounds:CompactQueryBounds[]=[];
 const dispose=installCompactQueryRefresh(world,{isDirty:()=>true,candidates:(b:CompactQueryBounds)=>{bounds.push(b);return [];}});
 try{
  world.castRay(new RAPIER.Ray({x:2,y:3,z:4},{x:-2,y:0,z:1}),5,true);
  const finite=bounds.pop()!;for(const [key,value] of Object.entries({minX:-8,maxX:2,minY:3,maxY:3,minZ:4,maxZ:9}))near(finite[key as keyof CompactQueryBounds],value);
  world.castRay(new RAPIER.Ray({x:2,y:3,z:4},{x:0,y:-1,z:0}),Infinity,true);
  const infinite=bounds.pop()!;assert.equal(infinite.minY,-Infinity);for(const [key,value] of Object.entries({minX:2,maxX:2,maxY:3,minZ:4,maxZ:4}))near(infinite[key as keyof CompactQueryBounds],value);
  world.castShape({x:2,y:3,z:4},rotation(Math.PI/2),{x:-2,y:0,z:1},new RAPIER.Cuboid(3,1,.5),.2,5,true);
  const b=bounds.pop()!;assert.ok(b.minX<=-9.2&&b.maxX>=3.2&&b.minY<=-.2&&b.maxY>=6.2&&b.minZ<=3.3&&b.maxZ>=9.7);
 }finally{dispose();world.free();}
});

test('compact queries preserve poses, velocities, timestep and serialized physics state',async()=>{
 const world=await fixture();let dispose=()=>{};
 try{
  world.timestep=1/120;
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,3,0).setRotation(rotation(.7)).setLinvel(1,2,3).setAngvel({x:4,y:5,z:6}));
  world.createCollider(RAPIER.ColliderDesc.cuboid(.5,1,.4),body);
  dispose=installCompactQueryRefresh(world,{isDirty:()=>true,candidates:()=>candidates(world)});
  const before=world.takeSnapshot();
  for(let n=0;n<8;n++){assert.ok(world.castRay(ray(),10,true));assert.ok(world.castRayAndGetNormal(ray(),10,true));assert.ok(world.castShape({x:0,y:10,z:0},identity,{x:0,y:-1,z:0},new RAPIER.Ball(.2),0,20,true));}
  assert.deepEqual(world.takeSnapshot(),before,'query-only work must not run even a zero-dt solver step');
  assert.equal(world.timestep,Math.fround(1/120));vector(body.linvel(),{x:1,y:2,z:3});vector(body.angvel(),{x:4,y:5,z:6});
 }finally{dispose();world.free();}
});

test('compact clean queries delegate natively and lifecycle hooks restore exact original methods',async()=>{
 const world=await fixture();let dirty=true,enumerations=0;
 const names=['castRay','castRayAndGetNormal','castShape','createCollider','removeCollider','removeRigidBody'] as const;
 const originals=names.map(name=>world[name]),descriptors=names.map(name=>Object.getOwnPropertyDescriptor(world,name));
 const dispose=installCompactQueryRefresh(world,{isDirty:()=>dirty,markDirty:()=>{dirty=true;},candidates:()=>{enumerations++;return candidates(world);}});
 try{
  const collider=world.createCollider(RAPIER.ColliderDesc.ball(.5));
  assert.ok(world.castRay(ray(),10,true));assert.equal(enumerations,1);
  world.step();dirty=false;
  assert.ok(world.castRay(ray(),10,true));assert.ok(world.castRayAndGetNormal(ray(),10,true));assert.ok(world.castShape({x:0,y:10,z:0},identity,{x:0,y:-1,z:0},new RAPIER.Ball(.2),0,20,true));
  assert.equal(enumerations,1,'clean queries must not enumerate candidates');
  const fresh=world.createCollider(RAPIER.ColliderDesc.ball(.5).setTranslation(0,4,0));assert.equal(dirty,true);
  assert.equal(world.castRay(ray(),10,true)?.collider,fresh);
  dirty=false;world.removeCollider(fresh,true);assert.equal(dirty,true);assert.equal(world.castRay(ray(),10,true)?.collider,collider);
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());world.createCollider(RAPIER.ColliderDesc.ball(.1),body);
  dirty=false;world.removeRigidBody(body);assert.equal(dirty,true);
  dispose();dispose();
  names.forEach((name,i)=>{assert.equal(world[name],originals[i]);assert.deepEqual(Object.getOwnPropertyDescriptor(world,name),descriptors[i]);});
 }finally{dispose();world.free();}
});

test('compact equal-time hits are deterministic independent of candidate order',async()=>{
 const world=await fixture();let reverse=false;
 const first=world.createCollider(RAPIER.ColliderDesc.ball(.5));world.createCollider(RAPIER.ColliderDesc.ball(.5));
 const dispose=installCompactQueryRefresh(world,{isDirty:()=>true,candidates:()=>{const all=candidates(world);return reverse?all.reverse():all;}});
 try{
  for(reverse of [false,true]){
   assert.equal(world.castRay(ray(),10,true)?.collider,first);
   assert.equal(world.castRayAndGetNormal(ray(),10,true)?.collider,first);
   assert.equal(world.castShape({x:0,y:10,z:0},identity,{x:0,y:-1,z:0},new RAPIER.Ball(.2),0,20,true)?.collider,first);
  }
 }finally{dispose();world.free();}
});

test('compact casts match the native strict f32 maxToi boundary, including zero',async()=>{
 const world=await fixture();let dispose=()=>{};
 try{
  world.createCollider(RAPIER.ColliderDesc.cuboid(.5,.5,.5).setTranslation(0,4,0));world.step();
  const limits=[0,2.65,Math.fround(2.65),2.74999999,2.75,2.75000001,2.7500002,3];
  const expected=limits.map(limit=>({ray:world.castRay(ray(),limit,true)?.timeOfImpact,normal:world.castRayAndGetNormal(ray(),limit,true)?.timeOfImpact,shape:world.castShape({x:0,y:10,z:0},identity,{x:0,y:-2,z:0},new RAPIER.Ball(.2),0,limit,true)?.time_of_impact}));
  const insideRay=new RAPIER.Ray({x:0,y:4,z:0},{x:0,y:1,z:0});assert.equal(world.castRay(insideRay,0,true),null);
  dispose=installCompactQueryRefresh(world,{isDirty:()=>true,candidates:()=>candidates(world)});
  limits.forEach((limit,i)=>{
   assert.equal(world.castRay(ray(),limit,true)?.timeOfImpact,expected[i].ray,`ray limit ${limit}`);
   assert.equal(world.castRayAndGetNormal(ray(),limit,true)?.timeOfImpact,expected[i].normal,`normal limit ${limit}`);
   assert.equal(world.castShape({x:0,y:10,z:0},identity,{x:0,y:-2,z:0},new RAPIER.Ball(.2),0,limit,true)?.time_of_impact,expected[i].shape,`shape limit ${limit}`);
  });
  assert.equal(world.castRay(insideRay,0,true),null);
  assert.equal(world.castRayAndGetNormal(insideRay,0,true),null);
  assert.equal(world.castShape({x:0,y:4,z:0},identity,{x:0,y:1,z:0},new RAPIER.Ball(.2),0,0,true),null);
 }finally{dispose();world.free();}
});

test('compact bounded candidates never miss native f32 face and endpoint rounding',async()=>{
 const world=await fixture();let dispose=()=>{};
 try{
  const collider=world.createCollider(RAPIER.ColliderDesc.cuboid(.5,.5,.5).setTranslation(1,4,0));world.step();
  const rays=[ray(1.50000002),ray(.499999999),new RAPIER.Ray({x:1,y:10,z:.50000002},{x:0,y:-2,z:0})];
  const expected=rays.map(r=>world.castRay(r,3,true));assert.ok(expected.every(Boolean));
  dispose=installCompactQueryRefresh(world,{isDirty:()=>true,candidates:(b:CompactQueryBounds)=>b.minX<=1.5&&b.maxX>=.5&&b.minY<=4.5&&b.maxY>=3.5&&b.minZ<=.5&&b.maxZ>=-.5?[collider]:[]});
  rays.forEach((r,i)=>assert.equal(world.castRay(r,3,true)?.timeOfImpact,expected[i]!.timeOfImpact));
 }finally{dispose();world.free();}
});

test('compact unusual cast shapes use conservative candidates and native exact geometry',async()=>{
 const world=await fixture();let dispose=()=>{};
 try{
  world.createCollider(RAPIER.ColliderDesc.cuboid(1,.5,1).setTranslation(3,1,2).setRotation(rotation(.4)));world.step();
  const shape=new RAPIER.ConvexPolyhedron(new Float32Array([-.2,-.2,-.2,.2,-.2,-.2,0,.3,-.2,0,0,.3]));
  const args=[{x:3,y:6,z:2},rotation(.6),{x:0,y:-1,z:0},shape,.1,10,true] as const;
  const expected=world.castShape(...args);assert.ok(expected);
  dispose=installCompactQueryRefresh(world,{isDirty:()=>true,candidates:(bounds:CompactQueryBounds)=>{
   assert.deepEqual(bounds,{minX:-Infinity,maxX:Infinity,minY:-Infinity,maxY:Infinity,minZ:-Infinity,maxZ:Infinity});return candidates(world);
  }});
  shapeHit(world.castShape(...args),expected);
 }finally{dispose();world.free();}
});

test('compact shape casts retain native stopAtPenetration and targetDistance behavior',async()=>{
 const world=await fixture();let dispose=()=>{};
 try{
  world.createCollider(RAPIER.ColliderDesc.cuboid(.5,.5,.5));world.step();
  const inputs:Parameters<RAPIER.World['castShape']>[]=[];
  for(const x of [.5,1])for(const direction of [-1,1])for(const stop of [false,true])for(const distance of [0,.2])inputs.push([{x,y:0,z:0},identity,{x:direction,y:0,z:0},new RAPIER.Ball(.2),distance,3,stop]);
  const expected=inputs.map(args=>world.castShape(...args));
  dispose=installCompactQueryRefresh(world,{isDirty:()=>true,candidates:()=>candidates(world)});
  inputs.forEach((args,i)=>{const actual=world.castShape(...args);if(expected[i])shapeHit(actual,expected[i]);else assert.equal(actual,null);});
 }finally{dispose();world.free();}
});

test('compact immediate restored hole and solid queries leave armed projectile fuses and kernel clock untouched',async()=>{
 const cells:Cell[]=[];
 for(let y=-1;y>=-8;y--)for(let x=-1;x<=1;x++)cells.push({id:cells.length+1,objectId:'soil',role:'terrain',position:{x,y,z:0},material:'soil',color:0x887755,hp:100,maxHp:100,anchor:y===-8});
 const source={id:'query-only-armed-clock',cells};
 const simulation=await createStructuralSimulation(createDenseFixture(source),{compactSupportFactory:store=>{
  let graph=createSupportGraph(source.cells);
  return {remove:ids=>graph.remove(ids),unsupported:()=>graph.unsupported(),reset(){graph=createSupportGraph(source.cells.filter(c=>store.stateOf(c.id)==='static'));}};
 }});
 const projectiles=await createProjectilePhysics({host:simulation.physicsHost});
 try{
  simulation.step(1/120);
  for(let y=-1;y>=-8;y--)assert.ok(simulation.blast({id:`cut-${y}`,epoch:simulation.epoch,position:{x:0,y,z:0},radius:.2,damage:1000,impulse:0}));
  const saved=simulation.snapshot() as CompactStructuralSnapshot;simulation.reset();assert.ok(simulation.restore(saved));
  assert.ok(projectiles.launch({id:'armed-clock',epoch:simulation.epoch,weapon:'charge',power:1,origin:{x:1,y:5,z:0},target:{x:1,y:-1,z:0}}));
  const world=simulation.physicsHost.world,before=simulation.snapshot(),shots=projectiles.getProjectiles(),physics=world.takeSnapshot();
  for(let n=0;n<5;n++){
   assert.equal(world.castRay(ray(0),20,true),null,'the restored eight-layer shaft stays empty');
   assert.ok(world.castRay(ray(1),20,true,RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC),'surviving soil is immediately queryable');
   assert.ok(world.castRayAndGetNormal(ray(1),20,true,RAPIER.QueryFilterFlags.ONLY_DYNAMIC),'new armed projectile is immediately queryable');
   assert.ok(world.castShape({x:1,y:3,z:0},identity,{x:0,y:-1,z:0},new RAPIER.Ball(.1),0,20,true,RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC));
  }
  assert.deepEqual(simulation.snapshot(),before);assert.equal((simulation.snapshot() as CompactStructuralSnapshot).tick,saved.tick);
  assert.deepEqual(projectiles.getProjectiles(),shots,'no fuse, age, position, rotation or velocity changes');
  assert.deepEqual(world.takeSnapshot(),physics,'queries do not step or modify the native physics state');
 }finally{projectiles.dispose();simulation.dispose();}
});
