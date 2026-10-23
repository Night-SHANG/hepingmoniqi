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

test('echo captures its origin, survives host loss after activation and emits exactly three unique simulation-clock pulses',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([voxel(1,8)],1);assert.equal(p.attach({...attached('echo'),weapon:'echo'}),true);
  const origin=p.getProjectiles()[0].position;
  const first=p.detonateAttached();assert.equal(first.length,1);assert.equal(first[0].id,'echo:echo:0');
  assert.deepEqual(p.detonateAttached(),[]);assert.equal(p.getPendingWorkCount!(),2);
  p.syncVoxels([],1);assert.deepEqual(p.step(0),[]);assert.equal(p.getPendingWorkCount!(),2);
  assert.deepEqual(advance(p,.64),[]);const second=advance(p,.01);assert.equal(second.length,1);
  const third=advance(p,.65);assert.equal(third.length,1);
  const all=[...first,...second,...third];assert.deepEqual(all.map(e=>e.id),['echo:echo:0','echo:echo:1','echo:echo:2']);
  assert.ok(all.every(e=>JSON.stringify(e.position)===JSON.stringify(origin)));assert.equal(p.getPendingWorkCount!(),0);assert.deepEqual(advance(p,3),[]);
 }finally{p.dispose();}
});
test('unactivated echo host loss cancels; epoch and explicit same-epoch reset clear future pulses',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([voxel(1,8)],1);assert.equal(p.attach({...attached('lost'),weapon:'echo'}),true);p.syncVoxels([],1);assert.deepEqual(p.detonateAttached(),[]);
  assert.equal(p.attach(ground('reset-echo','echo')),true);p.detonateAttached();p.syncVoxels([],2);assert.deepEqual(advance(p,2),[]);assert.equal(p.getPendingWorkCount!(),0);
  assert.equal(p.attach({...ground('same-epoch','echo'),epoch:2}),true);p.detonateAttached();p.reset!();assert.deepEqual(advance(p,2),[]);assert.equal(p.getPendingWorkCount!(),0);
 }finally{p.dispose();}
});
test('split parent creates exactly three real distinct moving children without parent damage or recursive splitting',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([],1);assert.equal(p.launch({...shot('split','split'),origin:{x:0,y:40,z:0},target:{x:8,y:40,z:0}}),true);
  assert.deepEqual(advance(p,.65),[]);const children=p.getProjectiles();assert.equal(children.length,3);
  assert.deepEqual(children.map(c=>c.id),['split:child:0','split:child:1','split:child:2']);assert.ok(children.every(c=>c.stage==='child' && c.trigger==='automatic'));
  assert.equal(new Set(children.map(c=>JSON.stringify(c.position))).size,3);assert.equal(p.getPendingWorkCount!(),3);
  assert.deepEqual(p.step(0),[]);assert.deepEqual(p.getProjectiles(),children);advance(p,.1);assert.ok(p.getProjectiles().every((c,i)=>c.position.y!==children[i].position.y && c.velocity!.y<children[i].velocity!.y));
  const events=advance(p,1.1);assert.equal(events.length,3);assert.equal(new Set(events.map(e=>e.id)).size,3);assert.ok(events.every(e=>e.reason==='timer' && Math.abs(e.age-1.2)<1e-8));assert.equal(p.getPendingWorkCount!(),0);assert.deepEqual(advance(p,3),[]);
 }finally{p.dispose();}
});
test('split impact precedes parent timer; remote placed or flying parents wait and manual activation never duplicates children',async()=>{
 for(const placed of [false,true]){
  const p=await createProjectilePhysics();try{
   p.syncVoxels([voxel(1,8)],1);
   if(placed)assert.equal(p.attach({...attached('manual'),weapon:'split'}),true);else assert.equal(p.launch({...shot('manual','split'),trigger:'remote'}),true);
   assert.deepEqual(advance(p,4),[]);assert.equal(p.getProjectiles().length,1);assert.deepEqual(p.detonateAttached(),[]);assert.equal(p.getProjectiles().length,3);assert.deepEqual(p.detonateAttached(),[]);assert.equal(p.getProjectiles().length,3);
   assert.equal(advance(p,1.2).length,3);
  }finally{p.dispose();}
 }
 const p=await createProjectilePhysics();try{p.syncVoxels([voxel(1,8)],1);p.launch(shot('impact','split'));assert.deepEqual(advance(p,.5),[]);assert.equal(p.getProjectiles().length,3);}finally{p.dispose();}
});
test('new effects preserve low-fps and slowed clocks, preview isolation, reset and uncapped finite children',async()=>{
 const a=await createProjectilePhysics(),b=await createProjectilePhysics();try{
  for(const p of [a,b]){p.syncVoxels([],1);assert.equal(p.attach(ground('echo-clock','echo')),true);p.detonateAttached();assert.equal(p.launch({...shot('split-clock','split'),origin:{x:0,y:40,z:0},target:{x:8,y:40,z:0}}),true);}
  const expected=advance(a,1);assert.deepEqual(b.step(1),expected);assert.deepEqual(a.getProjectiles(),b.getProjectiles());
  const before=b.getProjectiles(),pending=b.getPendingWorkCount!();b.preview(shot('preview-split','split'));assert.deepEqual(b.getProjectiles(),before);assert.equal(b.getPendingWorkCount!(),pending);
  const more=advance(a,.5);assert.deepEqual([...b.step(.25),...b.step(.25)],more);assert.deepEqual(a.getProjectiles(),b.getProjectiles());
  b.reset!();assert.equal(b.getPendingWorkCount!(),0);assert.deepEqual(advance(b,3),[]);
  for(let i=0;i<60;i++)assert.equal(b.attach(ground(`many-${i}`,'split')),true);b.detonateAttached();assert.equal(b.getProjectiles().length,180);assert.equal(advance(b,1.2).length,180);
 }finally{a.dispose();b.dispose();}
});
test('parent and derived effect ids reserve atomically so later commands cannot replace child bodies or pulse identities',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([],1);assert.equal(p.attach(ground('taken:child:1')),true);assert.equal(p.attach(ground('taken','split')),false);
  assert.equal(p.launch(shot('taken','split')),false);assert.equal(p.launch(shot('good','split')),true);
  assert.equal(p.attach(ground('good:child:0')),false);assert.equal(p.launch(shot('good:child:2')),false);
  assert.equal(p.attach(ground('echo-id','echo')),true);assert.equal(p.attach(ground('echo-id:echo:2')),false);
  p.reset!();assert.equal(p.attach(ground('taken','split')),true);
 }finally{p.dispose();}
});
test('placed split children visibly bounce on the real substrate before their one-shot timer expires',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([],1);assert.equal(p.attach(ground('bounce-split','split')),true);p.detonateAttached();
  let down=false,bounced=false;for(let i=0;i<130;i++){
   assert.deepEqual(p.step(1/120),[]);const child=p.getProjectiles()[0];assert.ok(child.position.y>-.5);
   if(child.velocity!.y<-.2)down=true;if(down && child.velocity!.y>.2)bounced=true;
  }
  assert.equal(bounced,true);assert.equal(advance(p,14/120).length,3);
 }finally{p.dispose();}
});
test('activated echo preserves its placed face normal and owns copies of origin through every view and event',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([voxel(1,8)],1);const command:AttachedCommand={...attached('wall-echo'),weapon:'echo',surface:{voxelId:1,position:{x:.4825,y:8,z:0},normal:{x:1,y:0,z:0}}};
  assert.equal(p.attach(command),true);const first=p.detonateAttached()[0],origin={...first.position};
  command.surface.normal.x=-1;first.position.x=999;const view=p.getProjectiles()[0];assert.deepEqual(view.normal,{x:1,y:0,z:0});view.normal!.x=-1;view.position.x=888;
  assert.deepEqual(p.getProjectiles()[0].normal,{x:1,y:0,z:0});p.syncVoxels([],1);assert.deepEqual(advance(p,.65)[0].position,origin);
 }finally{p.dispose();}
});
test('derived effect ids fit the domain limit and overlong parents reject atomically without pending work',async()=>{
 for(const [weapon,acceptedLength,rejectedLength] of [['echo',153,154],['split',152,153]] as const){
  for(const method of ['launch','attach'] as const){
   const p=await createProjectilePhysics();try{
    p.syncVoxels([],1);const rejected='x'.repeat(rejectedLength),accepted='y'.repeat(acceptedLength);
    const submit=(id:string)=>method==='launch'?p.launch(shot(id,weapon)):p.attach(ground(id,weapon));
    assert.equal(submit(rejected),false);assert.equal(p.getPendingWorkCount!(),0);assert.deepEqual(p.getProjectiles(),[]);
    // Rejection must not reserve even the otherwise-valid parent ID.
    assert.equal(p.attach(ground(rejected,'shock')),true);p.reset!();
    assert.equal(submit(accepted),true);assert.equal(p.getPendingWorkCount!(),1);
   }finally{p.dispose();}
  }
 }
});

// Passage tests use hand-positioned live colliders, not the selected aim point.
test('phase follows gravity through three distinct structural contacts and ends before a fourth',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([voxel(1,12),voxel(2,8),voxel(3,4),voxel(4,1)],1);
  assert.equal(p.launch({...shot('passage','phase'),origin:{x:0,y:20,z:0},target:{x:0,y:12,z:0}}),true);
  const initial=p.getProjectiles()[0],events:Detonation[]=[];
  assert.equal(initial.radius,.28);assert.equal(p.getPendingWorkCount!(),1);
  for(let i=0;i<360;i++){
   const next=p.step(1/120);events.push(...next);
   if(next.length&&events.length<3)assert.equal(p.getPendingWorkCount!(),1);
  }
  assert.equal(events.length,3);assert.deepEqual(events.map(e=>e.id),['passage:phase:0','passage:phase:1','passage:phase:2']);
  for(const [i,y] of [12,8,4].entries()){
   assert.equal(events[i].weapon,'phase');assert.equal(events[i].reason,'impact');
   assert.ok(Math.abs(events[i].position.y-(y+.4825))<.002,JSON.stringify(events[i]));
   assert.ok(Math.abs(events[i].position.x)<.002&&Math.abs(events[i].position.z)<.002);
   assert.notDeepEqual(events[i].position,{x:0,y:12,z:0});
   if(i)assert.ok(events[i].age>events[i-1].age);
  }
  assert.equal(p.getPendingWorkCount!(),0);assert.deepEqual(p.getProjectiles(),[]);assert.deepEqual(advance(p,3),[]);
 }finally{p.dispose();}
});
test('phase cannot repeatedly spend its hits inside the same voxel or disable terrain for another tool',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([voxel(1,8)],1);assert.equal(p.launch(shot('single-voxel','phase')),true);
  assert.equal(advance(p,2).length,1);assert.equal(p.getPendingWorkCount!(),0);
  assert.equal(p.launch(shot('normal-after','pulse')),true);const normal=advance(p,2);assert.equal(normal.length,1);assert.ok(normal[0].position.y>8.4825);
 }finally{p.dispose();}
});
test('phase crosses removed roof geometry without a hit at the old selected point',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([voxel(1,12),voxel(2,4)],1);p.syncVoxels([voxel(2,4)],1);
  assert.equal(p.launch({...shot('hole-passage','phase'),origin:{x:0,y:20,z:0},target:{x:0,y:12,z:0}}),true);
  const events=advance(p,3);assert.equal(events.length,1);assert.ok(events[0].position.y<5);
 }finally{p.dispose();}
});
test('phase stops on the actual substrate without inventing structural damage and expires on a miss',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([],1);assert.equal(p.launch(shot('phase-ground','phase')),true);assert.deepEqual(advance(p,3),[]);assert.equal(p.getPendingWorkCount!(),0);
  assert.equal(p.launch({...shot('phase-miss','phase'),origin:{x:40,y:20,z:40},target:{x:40,y:10,z:40},trigger:'remote'}),true);
  assert.deepEqual(advance(p,13),[]);assert.equal(p.getPendingWorkCount!(),0);
 }finally{p.dispose();}
});
test('remote phase flies without structural damage then activates in place without resetting its velocity or charging another entity',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([voxel(1,12),voxel(2,8),voxel(3,4),voxel(4,1)],1);
  assert.equal(p.launch({...shot('remote-phase','phase'),origin:{x:0,y:20,z:0},target:{x:0,y:12,z:0},trigger:'remote'}),true);
  assert.deepEqual(advance(p,.55),[]);const waiting=p.getProjectiles()[0];assert.ok(waiting.position.y<12);assert.equal(waiting.trigger,'remote');
  assert.deepEqual(p.detonateAttached(),[]);const active=p.getProjectiles()[0];
  assert.deepEqual(active.position,waiting.position);assert.deepEqual(active.velocity,waiting.velocity);assert.equal(active.trigger,'automatic');assert.equal(p.getPendingWorkCount!(),1);
  assert.deepEqual(p.detonateAttached(),[]);const events=advance(p,3);assert.equal(events.length,3);assert.ok(events.every(e=>e.position.y<9));
  assert.equal(p.getPendingWorkCount!(),0);
 }finally{p.dispose();}
});
test('placed phase releases inward through its real host face and ground placement releases upward',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([voxel(1,8),voxel(2,4),voxel(3,1)],1);assert.equal(p.attach({...attached('placed-phase'),weapon:'phase'}),true);
  assert.deepEqual(advance(p,13),[]);assert.deepEqual(p.detonateAttached(),[]);assert.equal(p.getProjectiles().length,1);assert.equal(p.getProjectiles()[0].state,'flying');assert.ok(p.getProjectiles()[0].velocity!.y<0);
  const events=advance(p,2);assert.equal(events.length,3);assert.ok(events[0].position.y>8);
  p.syncVoxels([],1);assert.equal(p.attach(ground('ground-phase','phase')),true);assert.deepEqual(p.detonateAttached(),[]);assert.ok(p.getProjectiles()[0].velocity!.y>0);assert.deepEqual(advance(p,3),[]);assert.equal(p.getPendingWorkCount!(),0);
 }finally{p.dispose();}
});
test('phase preview never mutates live hit deduplication and reset clears all old contacts',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([voxel(1,12),voxel(2,4)],1);assert.equal(p.launch({...shot('live-phase','phase'),origin:{x:0,y:20,z:0},target:{x:0,y:12,z:0}}),true);
  let first:Detonation[]=[];for(let i=0;i<120&&!first.length;i++)first=p.step(1/120);assert.equal(first.length,1);
  const before=p.getProjectiles();const preview=p.preview({...shot('phase-preview','phase'),origin:{x:0,y:20,z:0},target:{x:0,y:12,z:0}});assert.ok(preview.impact);assert.deepEqual(p.getProjectiles(),before);
  assert.equal(advance(p,2).length,1,'preview must not consume the live second hit');
  p.syncVoxels([voxel(1,12),voxel(2,4)],2);assert.deepEqual(advance(p,3),[]);assert.equal(p.getPendingWorkCount!(),0);
  assert.equal(p.launch({...shot('live-phase','phase'),epoch:2}),true);p.reset!();assert.deepEqual(advance(p,3),[]);assert.equal(p.getPendingWorkCount!(),0);
 }finally{p.dispose();}
});
test('phase derived event IDs are atomically reserved and stay within 160 characters',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([],1);assert.equal(p.launch(shot('x'.repeat(153),'phase')),false);assert.equal(p.getPendingWorkCount!(),0);
  assert.equal(p.attach(ground('taken:phase:1')),true);assert.equal(p.launch(shot('taken','phase')),false);
  assert.equal(p.launch(shot('y'.repeat(152),'phase')),true);assert.equal(p.launch(shot('y'.repeat(152)+':phase:0')),false);
  p.reset!();assert.equal(p.launch(shot('taken','phase')),true);
 }finally{p.dispose();}
});

test('phase sensor overlap never creates an impact event for another projectile',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([],1);assert.equal(p.launch(shot('ghost-overlap','phase')),true);assert.equal(p.launch(shot('real-flight','pulse')),true);
  assert.deepEqual(advance(p,.1),[]);assert.equal(p.getProjectiles().length,2);
  const events=advance(p,3);assert.equal(events.length,1);assert.equal(events[0].weapon,'pulse');assert.ok(events[0].position.y<0);
 }finally{p.dispose();}
});
test('phase sweep uses its full radius, not a center ray, while a wider gap remains empty',async()=>{
 for(const [offset,expected] of [[.65,1],[.8,0]]){
  const p=await createProjectilePhysics();try{
   p.syncVoxels([voxel(1,8)],1);p.launch({...shot(`edge-${offset}`,'phase'),origin:{x:offset,y:16,z:0},target:{x:offset,y:8,z:0}});
   assert.equal(advance(p,3).length,expected);
  }finally{p.dispose();}
 }
});
test('phase continuous sweep catches several structures crossed in one fixed step',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([-4,-2,0,2].map((x,i)=>({...voxel(i,16),position:{x,y:16,z:0}})),1);
  p.launch({...shot('fast-phase','phase'),origin:{x:-10,y:16,z:0},target:{x:1000,y:16,z:0}});
  const events=p.step(1/30);assert.equal(events.length,3);assert.ok(events.every(e=>e.position.x<1));assert.equal(p.getPendingWorkCount!(),0);
 }finally{p.dispose();}
});

test('phase remembers a voxel when its gravity arc crosses the same structure a second time',async()=>{
 const p=await createProjectilePhysics();try{
  p.syncVoxels([voxel(1,8)],1);p.launch({...shot('return-through','phase'),origin:{x:0,y:1,z:0},target:{x:0,y:8,z:0}});
  const events=advance(p,4);assert.equal(events.length,1);assert.ok(events[0].position.y<8);assert.equal(p.getPendingWorkCount!(),0);
 }finally{p.dispose();}
});
test('phase fixed-step contacts agree at 1fps and 120fps and preserve pause semantics',async()=>{
 const a=await createProjectilePhysics(),b=await createProjectilePhysics();try{
  for(const p of [a,b]){p.syncVoxels([voxel(1,12),voxel(2,8),voxel(3,4)],1);p.launch({...shot('phase-clock','phase'),origin:{x:0,y:20,z:0},target:{x:0,y:12,z:0}});}
  const paused=b.getProjectiles();assert.deepEqual(b.step(0),[]);assert.deepEqual(b.getProjectiles(),paused);
  assert.deepEqual(b.step(1),advance(a,1));assert.deepEqual(b.getProjectiles(),a.getProjectiles());assert.equal(b.getPendingWorkCount!(),a.getPendingWorkCount!());
 }finally{a.dispose();b.dispose();}
});
test('phase damage events retain one inventory spend while live geometry is removed after each contact',async()=>{
 const {createWorld}=await import('./domain');const world=createWorld(),p=await createProjectilePhysics();try{
  const snapshot=world.getSnapshot();assert.equal(world.restore({...snapshot,research:620}),true);
  assert.equal(world.startRound('courtyard',{charge:0,pulse:0,shock:0,echo:0,split:0,phase:1}),true);
  p.syncVoxels(world.getVoxels(),world.epoch);
  assert.equal(p.launch({id:'single-inventory',epoch:world.epoch,weapon:'phase',power:1,origin:{x:3,y:25,z:-3},target:{x:3,y:14,z:-3}}),true);
  assert.equal(world.recordShot('phase'),true);let hits=0;
  for(let i=0;i<600;i++)for(const event of p.step(1/120)){
   hits++;const result=world.damage({id:event.id,epoch:event.epoch,weapon:event.weapon,power:event.power,target:event.position});assert.equal(result.accepted,true);p.syncVoxels(world.getVoxels(),world.epoch);
  }
  assert.ok(hits>=1&&hits<=3);assert.equal(world.getRound().used,3);assert.equal(world.getRound().remaining!.phase,0);assert.equal(p.getPendingWorkCount!(),0);
 }finally{p.dispose();}
});
