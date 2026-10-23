import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStructuralSimulation} from './simulation.js';
import {createProjectilePhysics} from '../physics.js';
import type {Cell} from './types.js';
const fixture=()=>{const cells:Cell[]=[];let id=0;for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++)cells.push({id:id++,objectId:'ground',role:'terrain',position:{x,y:0,z},material:'soil',color:0x887766,hp:100,maxHp:100,anchor:true});return{id:'independent-shared-review',cells};};

test('independent shared: unsupported shared preview is explicit rather than a misleading terrain-free trajectory',async()=>{
 const s=await createStructuralSimulation(fixture()),p=await createProjectilePhysics({host:s.physicsHost});
 try{
  const command={id:'phase-review',epoch:s.epoch,weapon:'phase' as const,power:1,origin:{x:0,y:6,z:0},target:{x:0,y:0,z:0}};
  const predicted=p.preview(command);assert.ok(p.launch(command));
  const events=[];for(let i=0;i<120;i++)events.push(...p.step(1/120));
  assert.ok(events.length>0,'Live phase must hit terrain');
  assert.deepEqual(predicted,{points:[],impact:null,duration:0},'Shared preview must explicitly decline unsupported prediction');
 }finally{p.dispose();s.dispose();}
});

test('independent shared: explicit projectile reset clears events already produced by the host clock',async()=>{
 const s=await createStructuralSimulation(fixture()),p=await createProjectilePhysics({host:s.physicsHost});
 try{
  p.launch({id:'before-reset',epoch:s.epoch,weapon:'charge',power:1,origin:{x:0,y:6,z:0},target:{x:0,y:0,z:0}});
  s.step(1);s.step(1);s.step(1);
  assert.equal(p.getProjectiles().length,0);
  p.reset!();assert.equal(p.getPendingWorkCount!(),0);
  assert.deepEqual(p.step(1/120),[],'Reset cannot leak old host-produced detonations to caller');
 }finally{p.dispose();s.dispose();}
});

test('independent shared: attached package follows the full rotating host transform and detonates at that pose',async()=>{
 const f=fixture();f.cells=f.cells.filter(c=>c.id===24);f.cells.push({id:1000,objectId:'rotor',role:'building',position:{x:0,y:1,z:0},material:'stone',color:0xffffff,hp:100,maxHp:100});
 const s=await createStructuralSimulation(f),p=await createProjectilePhysics({host:s.physicsHost});
 try{
  assert.ok(p.attach({id:'rotating-package',epoch:s.epoch,power:1,surface:{voxelId:1000,position:{x:.5,y:1,z:0},normal:{x:1,y:0,z:0}}}));
  s.blast({id:'excavate',epoch:s.epoch,position:{x:0,y:0,z:0},radius:.15,damage:1000,impulse:0});
  // Set a controlled physical fixture angular velocity, never mutate renderer or projectile state.
  s.physicsHost.world.forEachRigidBody(body=>body.setAngvel({x:0,y:0,z:3},true));
  p.step(.2);
  const host=s.views().find(c=>c.id===1000)!,pack=p.getProjectiles()[0],q=host.rotation;
  assert.ok(Math.abs(q.z)>.1,'Fixture must genuinely rotate');
  const normal={x:1-2*(q.y*q.y+q.z*q.z),y:2*(q.x*q.y+q.w*q.z),z:2*(q.x*q.z-q.w*q.y)};
  for(const axis of ['x','y','z'] as const){
   assert.ok(Math.abs(pack.normal![axis]-normal[axis])<1e-5);
   assert.ok(Math.abs(pack.position[axis]-host.position[axis]-.58*normal[axis])<1e-5);
  }
  const event=p.detonateAttached()[0];assert.deepEqual(event.position,pack.position);assert.equal(p.getPendingWorkCount!(),0);
 }finally{p.dispose();s.dispose();}
});

test('independent shared: host restore cancels remote packages, echo stages and old buffered events atomically',async()=>{
 const s=await createStructuralSimulation(fixture()),p=await createProjectilePhysics({host:s.physicsHost});
 try{
  const saved=s.snapshot();
  const attach=(id:string,weapon:'echo'|'shock')=>p.attach({id,epoch:s.epoch,weapon,power:1,surface:{voxelId:24,position:{x:0,y:.5,z:0},normal:{x:0,y:1,z:0}}});
  assert.ok(attach('echo','echo'));assert.equal(p.detonateAttached().length,1);s.step(.7);
  assert.ok(attach('remote','shock'));assert.ok(s.pending()>0);
  const old=s.epoch;assert.ok(s.restore(saved));assert.ok(s.epoch>old);
  assert.equal(s.pending(),0);assert.deepEqual(p.getProjectiles(),[]);assert.deepEqual(p.detonateAttached(),[]);
  assert.deepEqual(p.step(1),[]);assert.equal(s.research(),0);
  assert.ok(attach('new-world-package','shock'));assert.equal(p.detonateAttached().length,1);
 }finally{p.dispose();s.dispose();}
});
