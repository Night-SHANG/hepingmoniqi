import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProjectilePhysics} from '../physics.js';
import {createStructuralSimulation} from './simulation.js';
import type {Cell,SceneFixture} from './types.js';
const cell=(id:number,x:number,y:number,z:number):Cell=>({id,objectId:'test-ground',role:'terrain',position:{x,y,z},material:'soil',color:0x886644,hp:20,maxHp:20,anchor:true});
function fixture():SceneFixture {const cells:Cell[]=[];let id=0;for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)cells.push(cell(id++,x,-1,z));return{id:'shared-test',cells};}
test('projectile and destructible soil share one live Rapier world and real holes',async()=>{
 const s=await createStructuralSimulation(fixture());const p=await createProjectilePhysics({host:s.physicsHost});
 try{
  const shoot=(id:string)=>p.launch({id,epoch:s.epoch,origin:{x:0,y:5,z:0},target:{x:0,y:-1,z:0},weapon:'pulse',power:1});
  assert.ok(shoot('first'));let events:ReturnType<typeof p.step>=[];for(let i=0;i<240&&!events.length;i++)events=p.step(1/120);
  assert.equal(events.length,1);assert.ok(events[0].position.y>-.6,'real remaining soil collision');
  assert.ok(s.blast({id:'hole',epoch:s.epoch,position:{x:0,y:-1,z:0},radius:1.6,damage:100,impulse:0}));
  assert.ok(shoot('second'));events=[];for(let i=0;i<120;i++)events.push(...p.step(1/120));
  assert.equal(events.length,0,'no invisible permanent floor explosion');assert.ok(p.getProjectiles()[0].position.y< -2);
 }finally{p.dispose();s.dispose();}
});
test('shared grenade fuse uses one clock, pause is exact, reset cancels old projectiles',async()=>{
 const s=await createStructuralSimulation(fixture());const p=await createProjectilePhysics({host:s.physicsHost});
 try{
  assert.ok(p.launch({id:'grenade',epoch:s.epoch,origin:{x:0,y:4,z:0},target:{x:1,y:0,z:0},weapon:'charge',power:1}));
  p.step(1);assert.ok(Math.abs(p.getProjectiles()[0].age-1)<1e-8);
  const frozen=p.getProjectiles();p.step(0);assert.deepEqual(p.getProjectiles(),frozen);
  p.step(1);const events=p.step(1);assert.equal(events.length,1);assert.ok(Math.abs(events[0].age-3)<1e-8);
  assert.ok(p.launch({id:'old',epoch:s.epoch,origin:{x:0,y:4,z:0},target:{x:1,y:0,z:0},weapon:'charge',power:1}));s.reset();assert.equal(p.getProjectiles().length,0);assert.equal(p.step(1).length,0);
  assert.ok(p.launch({id:'new',epoch:s.epoch,origin:{x:0,y:4,z:0},target:{x:1,y:0,z:0},weapon:'charge',power:1}));
 }finally{p.dispose();s.dispose();}
});
test('shared remote package follows its actual moving host and detonates at its current pose',async()=>{
 const f=fixture();f.cells.push({...cell(1000,0,0,0),role:'building',objectId:'floating-block',anchor:false,hp:100,maxHp:100});
 const s=await createStructuralSimulation(f);const p=await createProjectilePhysics({host:s.physicsHost});
 try{
  assert.ok(p.attach({id:'pack',epoch:s.epoch,surface:{voxelId:1000,position:{x:0,y:.5,z:0},normal:{x:0,y:1,z:0}},power:1}));
  s.blast({id:'remove-support',epoch:s.epoch,position:{x:0,y:-1,z:0},radius:1.6,damage:100,impulse:0});
  p.step(.4);const host=s.views().find(c=>c.id===1000)!;const pack=p.getProjectiles().find(c=>c.id==='pack')!;
  assert.ok(host.position.y<-.1);assert.ok(Math.abs(pack.position.y-host.position.y-.58)<.08,'attached body must follow its host');
  const event=p.detonateAttached()[0];assert.ok(Math.abs(event.position.y-pack.position.y)<1e-6);
 }finally{p.dispose();s.dispose();}
});
test('shared echo and split retain all deferred work until the real last event',async()=>{
 for(const weapon of ['echo','split'] as const){
  const s=await createStructuralSimulation(fixture());const p=await createProjectilePhysics({host:s.physicsHost});
  try{
   assert.ok(p.attach({id:weapon,epoch:s.epoch,weapon,surface:{voxelId:40,position:{x:0,y:-.5,z:0},normal:{x:0,y:1,z:0}},power:1}));
   const events=p.detonateAttached();assert.ok(s.pending()>0,'delayed stages or real children prevent settlement');
   for(let i=0;i<300;i++)events.push(...p.step(1/120));
   assert.equal(events.length,3);assert.equal(new Set(events.map(e=>e.id)).size,3);assert.equal(p.getPendingWorkCount!(),0);assert.equal(s.pending(),0);
  }finally{p.dispose();s.dispose();}
 }
});
test('shared passage contacts three distinct packed slabs instead of duplicating one collider',async()=>{
 const cells:Cell[]=[];let id=0;for(const y of [12,8,4,0])for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)cells.push(cell(id++,x,y,z));
 const s=await createStructuralSimulation({id:'packed-slabs',cells});const p=await createProjectilePhysics({host:s.physicsHost});
 try{
  assert.ok(p.launch({id:'passage',epoch:s.epoch,weapon:'phase',power:1,origin:{x:0,y:20,z:0},target:{x:0,y:12,z:0}}));
  const events:ReturnType<typeof p.step>=[];for(let i=0;i<360;i++)events.push(...p.step(1/120));
  assert.equal(events.length,3);for(const [i,y] of [12,8,4].entries())assert.ok(Math.abs(events[i].position.y-y-.5)<.03,JSON.stringify(events));
  assert.equal(s.pending(),0);
 }finally{p.dispose();s.dispose();}
});
test('diagonal passage across a merged slab cannot re-hit the same sweep collider indefinitely',async()=>{
 const cells:Cell[]=[];let id=0;for(let x=0;x<8;x++)for(let z=0;z<8;z++)cells.push(cell(id++,x,0,z));
 const s=await createStructuralSimulation({id:'diagonal',cells});const p=await createProjectilePhysics({host:s.physicsHost});
 try{
  p.launch({id:'diagonal',epoch:s.epoch,weapon:'phase',power:1,origin:{x:-8,y:8,z:1},target:{x:6,y:0,z:1}});
  const events:ReturnType<typeof p.step>=[];for(let i=0;i<360;i++)events.push(...p.step(1/120));
  assert.ok(events.length>=1&&events.length<=3);assert.equal(new Set(events.map(e=>e.id)).size,events.length);
 }finally{p.dispose();s.dispose();}
});
test('destroyed package host cannot leave pending work dependent on a render getter',async()=>{
 const s=await createStructuralSimulation(fixture());const p=await createProjectilePhysics({host:s.physicsHost});
 try{
  p.attach({id:'pack',epoch:s.epoch,surface:{voxelId:40,position:{x:0,y:-.5,z:0},normal:{x:0,y:1,z:0}},power:1});
  s.blast({id:'erase',epoch:s.epoch,position:{x:0,y:-1,z:0},radius:.6,damage:100,impulse:0});
  assert.equal(s.pending(),0);assert.equal(p.getPendingWorkCount!(),0);assert.deepEqual(p.detonateAttached(),[]);
 }finally{p.dispose();s.dispose();}
});
test('callback mode delivers once without retaining duplicate pull events',async()=>{
 const s=await createStructuralSimulation(fixture());const seen:string[]=[];const p=await createProjectilePhysics({host:s.physicsHost,onDetonation:e=>seen.push(e.id)});
 try{
  p.launch({id:'callback',epoch:s.epoch,weapon:'charge',power:1,origin:{x:0,y:4,z:0},target:{x:1,y:0,z:0}});
  for(let i=0;i<5;i++)s.step(1);
  assert.deepEqual(seen,['callback']);assert.deepEqual(p.step(0),[]);assert.deepEqual(p.step(1),[]);assert.deepEqual(seen,['callback']);
 }finally{p.dispose();s.dispose();}
});
