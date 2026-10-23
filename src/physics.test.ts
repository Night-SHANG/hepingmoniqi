import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectilePhysics } from './physics.js';
import type { AttachedCommand, Detonation, ProjectileCommand, ProjectilePhysics, Voxel } from './contracts.js';
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
test('rejects malformed inputs and bounds elapsed-frame catchup without an active-ordnance gameplay cap',async()=>{
 const p=await createProjectilePhysics();try{p.syncVoxels([],1);assert.equal(p.launch({...shot('bad'),origin:{x:NaN,y:0,z:0}}),false);assert.equal(p.launch({...shot('bad'),power:Infinity}),false);for(let i=0;i<60;i++)assert.equal(p.launch(shot(String(i),'charge')),true);assert.deepEqual(p.step(Infinity),[]);p.step(100);assert.equal(p.getProjectiles().length,60);assert.ok(p.getProjectiles().every(v=>v.age>=.999 && v.age<=1.001));}finally{p.dispose();}
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
test('foreground 1–10fps preserves the same body path and three-second fuse as 120fps',async()=>{
 const reference=await createProjectilePhysics();const slow:ProjectilePhysics[]=[];
 try{
  reference.syncVoxels([voxel(1,8)],1);reference.launch(shot('low-fps','charge'));
  const states=[];
  for(let second=0;second<2;second++){advance(reference,1);states.push(reference.getProjectiles());}
  const expectedBlast=advance(reference,1);
  assert.equal(expectedBlast.length,1);
  for(const fps of [1,2,5,10]){
   const p=await createProjectilePhysics();slow.push(p);p.syncVoxels([voxel(1,8)],1);p.launch(shot('low-fps','charge'));
   for(let second=0;second<2;second++){
    for(let frame=0;frame<fps;frame++)assert.deepEqual(p.step(1/fps),[]);
    assert.deepEqual(p.getProjectiles(),states[second],`${fps}fps body and clock must catch up`);
   }
   const blasts:Detonation[]=[];for(let frame=0;frame<fps;frame++)blasts.push(...p.step(1/fps));
   assert.deepEqual(blasts,expectedBlast,`${fps}fps must detonate at 3s, not at a frame-count deadline`);
  }
 }finally{reference.dispose();for(const p of slow)p.dispose();}
});
test('low-fps quarter-speed advances body and fuse together; a paused frame advances neither',async()=>{
 const slow=await createProjectilePhysics(),reference=await createProjectilePhysics();try{
  for(const p of [slow,reference]){p.syncVoxels([voxel(1,8)],1);p.launch(shot('slow-motion','charge'));}
  for(let second=0;second<4;second++)assert.deepEqual(slow.step(1*.25),[]);
  advance(reference,1);assert.deepEqual(slow.getProjectiles(),reference.getProjectiles());
  const paused=slow.getProjectiles();for(let second=0;second<20;second++)assert.deepEqual(slow.step(0),[]);assert.deepEqual(slow.getProjectiles(),paused);
  for(let second=0;second<7;second++)assert.deepEqual(slow.step(1*.25),[]);
  const blast=slow.step(1*.25);assert.equal(blast.length,1);assert.ok(Math.abs(blast[0].age-3)<1e-8);
 }finally{slow.dispose();reference.dispose();}
});
const attached = (id='package',voxelId:number|null=1):AttachedCommand => ({id,epoch:1,surface:{voxelId,position:{x:0,y:8.4825,z:0},normal:{x:0,y:1,z:0}},power:1});
test('remote package attaches to a live surface and waits indefinitely for one manual detonation',async()=>{
 const p=await createProjectilePhysics();try{
 p.syncVoxels([voxel(1,8)],1);assert.equal(p.attach(attached()),true);
 assert.equal(p.attach(attached()),false);const placed=p.getProjectiles()[0];assert.equal(placed.state,'attached');assert.equal(placed.hostVoxelId,1);assert.equal(placed.fuseRemaining,null);assert.ok(placed.position.y>8.4825);
 assert.deepEqual(advance(p,20),[]);assert.deepEqual(p.getProjectiles()[0].position,placed.position);
 const events=p.detonateAttached();assert.equal(events.length,1);assert.equal(events[0].reason,'remote');assert.deepEqual(events[0].position,placed.position);assert.deepEqual(p.detonateAttached(),[]);assert.deepEqual(p.getProjectiles(),[]);
 }finally{p.dispose();}
});
test('remote package rejects invented surfaces and retains deep-owned placement state',async()=>{
 const p=await createProjectilePhysics();try{
 p.syncVoxels([voxel(1,8)],1);
 assert.equal(p.attach(attached('unknown',99)),false);
 for(const surface of [{position:{x:0,y:80,z:0},normal:{x:0,y:1,z:0}}, {position:{x:0,y:8,z:0},normal:{x:0,y:1,z:0}}, {position:{x:0,y:8.4825,z:0},normal:{x:0,y:0,z:0}}, {position:{x:0,y:8.4825,z:0},normal:{x:1,y:0,z:0}}])assert.equal(p.attach({...attached('bad'),surface:{voxelId:1,...surface}}),false);
 assert.equal(p.attach({...attached('stale'),epoch:0}),false);
 const command=attached();assert.equal(p.attach(command),true);command.surface.position.y=100;command.surface.normal.y=-1;const view=p.getProjectiles()[0];assert.ok(view.position.y<9);view.position.y=200;view.normal!.y=-1;assert.ok(p.getProjectiles()[0].position.y<9);assert.equal(p.getProjectiles()[0].normal!.y,1);
 }finally{p.dispose();}
});
test('host destruction or epoch change invalidates attached packages without fabricated explosions, with no eight-package cap',async()=>{
 const p=await createProjectilePhysics();try{
 p.syncVoxels([voxel(1,8)],1);for(let i=0;i<60;i++)assert.equal(p.attach(attached(`p${i}`)),true);assert.equal(p.getProjectiles().length,60);
 p.syncVoxels([],1);assert.deepEqual(p.getProjectiles(),[]);assert.deepEqual(p.detonateAttached(),[]);
 p.syncVoxels([voxel(1,8)],2);assert.equal(p.attach({...attached('new'),epoch:2}),true);p.syncVoxels([voxel(1,8)],3);assert.deepEqual(p.getProjectiles(),[]);assert.deepEqual(p.detonateAttached(),[]);
 }finally{p.dispose();}
});
test('flight views expose actual velocity and grenade rigid-body rotation',async()=>{
 const p=await createProjectilePhysics();try{
 p.syncVoxels([],1);p.launch(shot('grenade','charge'));const initial=p.getProjectiles()[0];assert.equal(initial.state,'flying');assert.ok(initial.velocity);assert.ok(initial.rotation);advance(p,.2);const next=p.getProjectiles()[0];assert.notDeepEqual(next.rotation,initial.rotation);assert.ok(next.velocity!.y<initial.velocity!.y);
 }finally{p.dispose();}
});
test('starter grenade keeps a local roof bounce and detonates close enough to damage the aimed cottage',async()=>{
 const {createWorld}=await import('./domain.js');const {PerspectiveCamera,Vector3}=await import('three');
 const world=createWorld(),p=await createProjectilePhysics();try{
 const camera=new PerspectiveCamera(42,1.6,.2,250);camera.position.set(27,23,32);camera.lookAt(0,4.5,0);camera.updateMatrixWorld();
 const target=new Vector3(.46526905451609124,12.189553688105082,4.482499986886978),direction=target.clone().sub(camera.position).normalize();
 const origin=camera.position.clone().addScaledVector(direction,8).addScaledVector(new Vector3(1,0,0).applyQuaternion(camera.quaternion),1.1).addScaledVector(new Vector3(0,1,0).applyQuaternion(camera.quaternion),-2);
 p.syncVoxels(world.getVoxels(),world.epoch);p.launch({id:'starter',epoch:world.epoch,origin,target,weapon:'charge',power:1});
 const blasts=advance(p,3);assert.equal(blasts.length,1);assert.equal(blasts[0].reason,'timer');
 const result=world.damage({id:'starter',epoch:world.epoch,target:blasts[0].position,weapon:'charge',power:1});assert.ok(result.removed.some(v=>v.group==='house'),'Actual 3s grenade blast must damage nearby house, not bounce out of the starter experience');
 }finally{p.dispose();}
});

const ground = (id:string,weapon:ProjectileCommand['weapon']='shock'):AttachedCommand => ({id,epoch:1,weapon,power:1,surface:{voxelId:null,position:{x:3,y:0,z:4},normal:{x:0,y:1,z:0}}});
test('all three launched tools support remote arming, survive fuse and lifetime, and detonate at the current position exactly once',async()=>{
 for(const weapon of ['pulse','charge','shock'] as const){
  const p=await createProjectilePhysics();try{
   p.syncVoxels([voxel(1,8)],1);
   assert.equal(p.launch({...shot(`remote-${weapon}`,weapon),trigger:'remote'}),true);
   assert.deepEqual(advance(p,4),[]);assert.equal(p.getProjectiles().length,1);
   const bouncing=p.getProjectiles()[0];assert.equal(bouncing.trigger,'remote');assert.equal(bouncing.fuseRemaining,null);assert.ok(bouncing.age>3);
   assert.deepEqual(advance(p,16),[]);assert.equal(p.getProjectiles().length,1);
   const resting=p.getProjectiles()[0];assert.ok(resting.position.y>=-.5);assert.notDeepEqual(resting.position,shot('target').target);
   const blasts=p.detonateAttached();assert.equal(blasts.length,1);assert.equal(blasts[0].weapon,weapon);assert.equal(blasts[0].reason,'remote');assert.deepEqual(blasts[0].position,resting.position);assert.equal(blasts[0].age,resting.age);
   assert.deepEqual(p.getProjectiles(),[]);assert.deepEqual(p.detonateAttached(),[]);assert.deepEqual(advance(p,4),[]);
  }finally{p.dispose();}
 }
});
test('sixty ground placements retain every weapon and detonate once without a gameplay cap',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([],1);
  const weapons=['pulse','charge','shock'] as const;
  for(let i=0;i<60;i++)assert.equal(p.attach(ground(`ground-${i}`,weapons[i%3])),true);
  assert.equal(p.getProjectiles().length,60);assert.ok(p.getProjectiles().every(v=>v.trigger==='remote' && v.hostVoxelId===null));
  assert.deepEqual(advance(p,13),[]);assert.equal(p.getProjectiles().length,60);
  const blasts=p.detonateAttached();assert.equal(blasts.length,60);assert.equal(new Set(blasts.map(b=>b.id)).size,60);
  for(let i=0;i<60;i++)assert.equal(blasts.find(b=>b.id===`ground-${i}`)?.weapon,weapons[i%3]);
  assert.deepEqual(p.detonateAttached(),[]);assert.deepEqual(p.getProjectiles(),[]);
 }finally{p.dispose();}
});
test('ground placement validates real island plane and survives unrelated host destruction',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([voxel(1,8)],1);assert.equal(p.attach(attached('roof')),true);assert.equal(p.attach(ground('ground')),true);
  for(const surface of [
   {voxelId:null,position:{x:0,y:1,z:0},normal:{x:0,y:1,z:0}},
   {voxelId:null,position:{x:0,y:0,z:0},normal:{x:0,y:-1,z:0}},
   {voxelId:null,position:{x:28,y:0,z:0},normal:{x:0,y:1,z:0}},
   {voxelId:null,position:{x:0,y:0,z:23},normal:{x:0,y:1,z:0}},
  ])assert.equal(p.attach({...ground('bad'),surface}),false);
  p.syncVoxels([],1);assert.deepEqual(p.getProjectiles().map(v=>v.id),['ground']);assert.equal(p.detonateAttached()[0].id,'ground');
 }finally{p.dispose();}
});
test('manual detonation consumes packages and remote flights but leaves automatic fuses untouched',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([],1);assert.equal(p.attach(ground('placed','pulse')),true);
  assert.equal(p.launch({...shot('manual','charge'),trigger:'remote'}),true);
  assert.equal(p.launch({...shot('automatic','charge'),origin:{x:10,y:16,z:0},target:{x:10,y:8,z:0}}),true);
  advance(p,.25);assert.deepEqual(new Set(p.detonateAttached().map(b=>b.id)),new Set(['placed','manual']));
  assert.deepEqual(p.getProjectiles().map(v=>v.id),['automatic']);assert.equal(advance(p,3)[0].reason,'timer');
 }finally{p.dispose();}
});
test('reset clears all remotely armed ordnance and rejects stale launch and placement commands',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([],1);p.attach(ground('placed'));p.launch({...shot('remote','charge'),trigger:'remote'});advance(p,1);
  p.syncVoxels([],2);assert.deepEqual(p.detonateAttached(),[]);assert.deepEqual(p.getProjectiles(),[]);assert.deepEqual(advance(p,15),[]);
  assert.equal(p.attach(ground('stale')),false);assert.equal(p.launch({...shot('stale'),trigger:'remote'}),false);
  assert.equal(p.attach({...ground('placed'),epoch:2}),true);assert.equal(p.launch({...shot('remote'),epoch:2,trigger:'remote'}),true);
 }finally{p.dispose();}
});
test('independent preview matches actual first collision and does not launch, advance, or reserve the command id',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([voxel(1,8),voxel(2,1)],1);const command=shot('preview');
  const preview=p.preview(command);assert.ok(preview.points.length>2);assert.deepEqual(preview.points[0],command.origin);assert.ok(preview.impact);assert.ok(preview.impact.y>8);assert.ok(preview.duration>0 && preview.duration<6);
  assert.deepEqual(p.getProjectiles(),[]);assert.equal(p.launch(command),true);
  const blast=advance(p,2);assert.equal(blast.length,1);assert.deepEqual(blast[0].position,preview.impact);assert.ok(Math.abs(blast[0].age-preview.duration)<1e-8);
  p.syncVoxels([voxel(2,1)],1);const throughHole=p.preview(shot('hole'));assert.ok(throughHole.impact && throughHole.impact.y<2);
  assert.equal(p.launch(shot('hole')),true);assert.deepEqual(advance(p,2)[0].position,throughHole.impact);
 }finally{p.dispose();}
});
test('preview uses real flight geometry for every weapon and leaves already moving bodies unchanged',async()=>{
 for(const weapon of ['pulse','charge','shock'] as const){
  const p=await createProjectilePhysics();try{
   p.syncVoxels([voxel(1,8)],1);const command={...shot(`geometry-${weapon}`,weapon),trigger:'remote' as const};
   const preview=p.preview(command);assert.ok(preview.impact);assert.equal(p.launch(command),true);
   advance(p,preview.duration);assert.deepEqual(p.getProjectiles()[0].position,preview.impact);
   const before=p.getProjectiles();p.preview({...shot('another',weapon),origin:{x:5,y:16,z:0},target:{x:5,y:8,z:0}});assert.deepEqual(p.getProjectiles(),before);
  }finally{p.dispose();}
 }
});
test('preview returns a six-second physical miss and rejects invalid, stale or disposed requests without side effects',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([],1);const miss={...shot('miss'),trigger:'remote' as const,origin:{x:40,y:20,z:40},target:{x:40,y:10,z:40}};
  const preview=p.preview(miss);assert.equal(preview.impact,null);assert.ok(Math.abs(preview.duration-6)<1e-8);assert.ok(preview.points.at(-1)!.y<0);assert.deepEqual(p.getProjectiles(),[]);
  for(const command of [{...shot('stale'),epoch:0},{...shot('zero'),target:shot('zero').origin},{...shot('nan'),origin:{x:NaN,y:0,z:0}}])assert.deepEqual(p.preview(command),{points:[],impact:null,duration:0});
  p.dispose();assert.deepEqual(p.preview(shot('disposed')),{points:[],impact:null,duration:0});
 }finally{p.dispose();}
});
test('a package dropped with zero initial velocity still has a finite orientation and preview',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([],1);
  const command:ProjectileCommand={id:'drop',epoch:1,origin:{x:0,y:1.8225,z:0},target:{x:0,y:0,z:0},weapon:'shock',power:1,trigger:'remote'};
  const preview=p.preview(command);assert.ok(preview.impact && Object.values(preview.impact).every(Number.isFinite));
  assert.equal(p.launch(command),true);const initial=p.getProjectiles()[0];
  assert.ok(Object.values(initial.rotation!).every(Number.isFinite));
  assert.deepEqual(advance(p,1),[]);assert.ok(Object.values(p.getProjectiles()[0].position).every(Number.isFinite));
 }finally{p.dispose();}
});
test('automatic high-arc grenade preview ends at its actual fuse rather than promising post-detonation flight',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([],1);
  const command:ProjectileCommand={...shot('high-arc','charge'),origin:{x:0,y:40,z:0},target:{x:0,y:80,z:0}};
  const preview=p.preview(command);assert.equal(preview.impact,null);assert.ok(Math.abs(preview.duration-3)<1e-8);
  assert.equal(p.launch(command),true);const events=advance(p,3);assert.equal(events.length,1);assert.equal(events[0].reason,'timer');
  assert.deepEqual(preview.points.at(-1),events[0].position);assert.ok(events[0].position.y>0);
 }finally{p.dispose();}
});
