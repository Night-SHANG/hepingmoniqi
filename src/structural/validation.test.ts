import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import * as simulation from './simulation.js';
import type {Cell,SceneFixture} from './types.js';
const cell=(id:number,x:number,y:number,over:Partial<Cell>={}):Cell=>({id,objectId:`cell-${id}`,role:'building',position:{x,y,z:0},material:'stone',color:0x888888,hp:100,maxHp:100,...over});
const fixture=():SceneFixture=>({id:'strict-validation',cells:[cell(1,0,0,{anchor:true,role:'terrain'}),cell(2,0,1),cell(3,0,2),cell(4,1,2),cell(5,8,0,{anchor:true})]});

test('explicit initial epoch governs initial events, host, snapshots and stale commands without restore',async()=>{
 const s=await simulation.createStructuralSimulation({id:'initial-epoch',cells:[cell(1,0,5)]},{initialEpoch:73});
 try{
  assert.equal(s.epoch,73);assert.equal(s.physicsHost.epoch,73);assert.equal((s.snapshot() as any).epoch,73);
  assert.equal(s.events()[0].epoch,73);assert.ok(s.events()[0].id.startsWith('73:'));
  assert.equal(s.blast({id:'old',epoch:1,position:{x:0,y:5,z:0},radius:.2,damage:1,impulse:0}),false);
  assert.equal(s.blast({id:'current',epoch:73,position:{x:0,y:5,z:0},radius:.2,damage:1,impulse:0}),true);
  s.reset();assert.equal(s.epoch,74);
 }finally{s.dispose();}
});

test('initial epoch rejects non-positive, fractional, nonfinite and overflow-edge values',async()=>{
 for(const initialEpoch of [0,-1,.5,NaN,Infinity,null as any,'73' as any,Number.MAX_SAFE_INTEGER-1,Number.MAX_SAFE_INTEGER]){
  await assert.rejects(simulation.createStructuralSimulation({id:'bad-epoch',cells:[]},{initialEpoch}),/epoch/i);
 }
 const s=await simulation.createStructuralSimulation({id:'safe-epoch',cells:[]},{initialEpoch:Number.MAX_SAFE_INTEGER-2});
 try{assert.equal(s.epoch,Number.MAX_SAFE_INTEGER-2);}finally{s.dispose();}
});

test('pure strict validator accepts owned snapshots without constructing or touching a Rapier world',async()=>{
 assert.equal(typeof simulation.validateStructuralSnapshot,'function','pure validator must be exported');
 const f=fixture(),s=await simulation.createStructuralSimulation(f),snapshot=s.snapshot(),before=structuredClone(snapshot),fixtureBefore=structuredClone(f);
 try{
  assert.equal(simulation.validateStructuralSnapshot(f,snapshot),true);
  assert.deepEqual(snapshot,before);assert.deepEqual(f,fixtureBefore);assert.deepEqual(s.snapshot(),before);
  // A separate process has never initialized the WASM runtime. Native world
  // construction fails there, but pure snapshot validation must still succeed.
  const source=`import assert from 'node:assert/strict';
   import RAPIER from '@dimforge/rapier3d-compat';
   import {validateStructuralSnapshot} from ${JSON.stringify(new URL('./simulation.ts',import.meta.url).href)};
   assert.throws(()=>new RAPIER.World({x:0,y:0,z:0}));
   assert.equal(validateStructuralSnapshot(${JSON.stringify(f)},${JSON.stringify(snapshot)}),true);
   assert.throws(()=>new RAPIER.World({x:0,y:0,z:0}));`;
  const isolated=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',source],{encoding:'utf8'});
  assert.equal(isolated.status,0,isolated.stderr);
 }finally{s.dispose();}
});

test('pure validation and restore share strict fixture, motion, ledger and queue rejection rules',async()=>{
 assert.equal(typeof simulation.validateStructuralSnapshot,'function');
 const f=fixture(),s=await simulation.createStructuralSimulation(f,{maxActiveBodies:1});
 try{
  s.blast({id:'drop',epoch:s.epoch,position:{x:0,y:1,z:0},radius:.2,damage:100,impulse:0});s.step(.05);
  const snapshot:any=s.snapshot();assert.equal(simulation.validateStructuralSnapshot(f,snapshot,{maxActiveBodies:1}),true);
  const corruptions:[string,(save:any)=>void][]=[
   ['fixture signature',v=>{v.fixtureSignature+='!';}],['fixture id',v=>{v.fixtureId='wrong';}],
   ['accumulator',v=>{v.accumulator=.1;}],['epoch',v=>{v.epoch=0;}],['tick',v=>{v.tick=-1;}],['serial',v=>{v.serial=0;}],
   ['cell health',v=>{v.cells[0].hp=101;}],['cell loss',v=>{v.cells.find((c:any)=>c.id===2).loss=0;}],
   ['body membership',v=>{v.bodies[0].cells.push(5);}],['local transform',v=>{v.bodies[0].transforms[0].position.y+=2;}],
   ['body rotation',v=>{v.bodies[0].rotation.w=0;}],['body velocity',v=>{v.bodies[0].linvel.x=10001;}],
   ['duplicate queue',v=>{v.queue=['missing','missing'];}],['research',v=>{v.research=0;}],
   ['shot ids',v=>{v.shots.push('drop');}],['episode',v=>{v.episodes=[['1:5',{n:1,credited:false}]];}],
   ['event provenance',v=>{v.events[0].epoch=v.epoch+1;}],['missing impact ledger',v=>{v.events[0]={...v.events[0],kind:'impact',targetId:5,damage:1};}],
  ];
  for(const [name,corrupt]of corruptions){const bad=structuredClone(snapshot);corrupt(bad);assert.equal(simulation.validateStructuralSnapshot(f,bad,{maxActiveBodies:1}),false,name);assert.equal(s.restore(bad),false,name);assert.deepEqual(s.snapshot(),snapshot,`${name} must not mutate live authority`);}
  assert.equal(simulation.validateStructuralSnapshot(f,snapshot),false,'budget mismatch');
  assert.equal(simulation.validateStructuralSnapshot({...f,id:'other'},snapshot,{maxActiveBodies:1}),false);
  assert.equal(simulation.validateStructuralSnapshot(f,null),false);
 }finally{s.dispose();}
});
