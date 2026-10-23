import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectilePhysics } from './physics.js';
import type { Detonation, ProjectileCommand, ProjectilePhysics, Voxel } from './contracts.js';
const voxel = (id:number,y:number):Voxel => ({id,position:{x:0,y,z:0},color:0xffffff,material:'roof',hp:2,maxHp:2});
const shot = (id:string,weapon:ProjectileCommand['weapon']='pulse'):ProjectileCommand => ({id,epoch:1,origin:{x:0,y:16,z:0},target:{x:0,y:8,z:0},weapon,power:1});
const advance = (physics:ProjectilePhysics,seconds:number) => { const result:Detonation[]=[];for(let i=0;i<Math.round(seconds*120);i++)result.push(...physics.step(1/120));return result; };
test('actual Rapier body flies before a single collision detonation; removed roof no longer catches same aim',async()=>{
 const p=await createProjectilePhysics(); try{
 p.syncVoxels([voxel(1,8),voxel(2,1)],1);
 assert.equal(p.launch(shot('first')),true);assert.equal(p.launch(shot('first')),false);
 assert.equal(p.getProjectiles().length,1);assert.equal(advance(p,.1).length,0);
 assert.ok(p.getProjectiles()[0].position.y<16);
 const first=advance(p,2);assert.equal(first.length,1);assert.equal(first[0].reason,'impact');assert.ok(first[0].position.y>8);
 p.syncVoxels([voxel(2,1)],1);p.launch(shot('second'));
 const second=advance(p,2);assert.equal(second.length,1);assert.ok(second[0].position.y<2,JSON.stringify(second));assert.equal(advance(p,2).length,0);
 }finally{p.dispose();}
});
test('charge collides and bounces without detonation, pauses, then detonates at its current location after three simulated seconds',async()=>{
 const p=await createProjectilePhysics();try{
 p.syncVoxels([voxel(1,8)],1);p.launch(shot('timed','charge'));
 assert.equal(advance(p,1).length,0); const before=p.getProjectiles()[0];assert.ok(before.position.y>8);
 assert.deepEqual(p.step(0),[]);assert.deepEqual(p.getProjectiles()[0],before);
 assert.equal(advance(p,1.9).length,0);const current=p.getProjectiles()[0].position;
 const blast=advance(p,.1);assert.equal(blast.length,1);assert.equal(blast[0].reason,'timer');assert.ok(Math.abs(blast[0].age-3)<.009);assert.ok(Math.abs(blast[0].position.y-current.y)<1);assert.notDeepEqual(blast[0].position,shot('x').target);
 }finally{p.dispose();}
});
test('epoch reset removes flying charges and old events, permits reused ids only in the new epoch',async()=>{
 const p=await createProjectilePhysics();try{p.syncVoxels([],1);p.launch(shot('reuse','charge'));advance(p,.5);p.syncVoxels([],2);assert.equal(p.getProjectiles().length,0);assert.deepEqual(advance(p,4),[]);assert.equal(p.launch(shot('stale')),false);assert.equal(p.launch({...shot('reuse'),epoch:2}),true);}finally{p.dispose();}
});
test('rejects malformed inputs and bounds active projectiles and elapsed-frame catchup',async()=>{
 const p=await createProjectilePhysics();try{p.syncVoxels([],1);assert.equal(p.launch({...shot('bad'),origin:{x:NaN,y:0,z:0}}),false);assert.equal(p.launch({...shot('bad'),power:Infinity}),false);for(let i=0;i<24;i++)assert.equal(p.launch(shot(String(i),'charge')),true);assert.equal(p.launch(shot('overflow')),false);assert.deepEqual(p.step(Infinity),[]);p.step(100);assert.ok(p.getProjectiles().every(v=>v.age<=.251));}finally{p.dispose();}
});
test('timed projectile visibly reverses after roof contact rather than passing through the collider',async()=>{
 const p=await createProjectilePhysics();try{p.syncVoxels([voxel(1,8)],1);p.launch(shot('bounce','charge'));let prior=16;let bounced=false;for(let i=0;i<160;i++){assert.deepEqual(p.step(1/120),[]);const y=p.getProjectiles()[0].position.y;if(y>prior+.005)bounced=true;assert.ok(y>=8.6,`penetrated roof: ${y}`);prior=y;}assert.equal(bounced,true);}finally{p.dispose();}
});
test('misses outside the island expire without a manufactured impact explosion',async()=>{
 const p=await createProjectilePhysics();try{p.syncVoxels([],1);assert.equal(p.launch({...shot('miss'),origin:{x:40,y:20,z:40},target:{x:40,y:10,z:40}}),true);assert.deepEqual(advance(p,13),[]);assert.deepEqual(p.getProjectiles(),[]);}finally{p.dispose();}
});
test('fixed timestep gives matching trajectories at different frame rates',async()=>{
 const a=await createProjectilePhysics(),b=await createProjectilePhysics();try{for(const p of [a,b]){p.syncVoxels([],1);p.launch(shot('consistent','charge'));}for(let i=0;i<60;i++)a.step(1/60);for(let i=0;i<30;i++)b.step(1/30);assert.deepEqual(a.getProjectiles(),b.getProjectiles());}finally{a.dispose();b.dispose();}
});
