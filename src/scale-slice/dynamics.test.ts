import test from 'node:test';
import assert from 'node:assert/strict';
import { compileScaleFixture } from './fixture.js';
import { ScaleAuthority } from './model.js';
import { createScaleDynamics } from './dynamics.js';
import type { Cell, SceneFixture } from '../structural/types.js';

const cell=(id:number,x:number,y:number,z:number,objectId:string,role:Cell['role']='building',hp=100,anchor=false):Cell=>({id,objectId,role,position:{x,y,z},material:role==='terrain'?'soil':'stone',color:0x778899,hp,maxHp:hp,anchor});
const authority=(cells:Cell[])=>new ScaleAuthority(compileScaleFixture({id:'scale-dynamics-small',cells} as SceneFixture));
const advance=(d:Awaited<ReturnType<typeof createScaleDynamics>>,seconds:number)=>{for(let i=0;i<Math.ceil(seconds*120);i++)d.step(1/120);};
const region=(m:ScaleAuthority,object:string)=>m.regionViews().find(r=>r.objectId===object)!;
const destroy=(m:ScaleAuthority,object:string)=>m.applyImpact({id:`remove:${object}`,epoch:m.epoch,targetRegionIds:[region(m,object).id],damage:10000});
const side=(id:number,x:number,top:number)=>Array.from({length:top+2},(_,i)=>cell(id+i,x,i-1,0,`side-${x}`,'terrain',10000,true));

// Removing support must replace (not duplicate) the original collider and a real
// falling body's contact must injure its independently anchored receiver.
test('falling connected regions injure a separate receiver, settle, and stop farming resting damage',async()=>{
 const m=authority([
  cell(1,0,3,0,'upper-support','terrain',1,true),
  cell(2,0,4,0,'falling','building',500),cell(3,0,5,0,'falling','building',500),
  cell(4,0,-1,0,'floor','terrain',10000,true),cell(5,0,0,0,'receiver','foundation',1000),
  cell(6,10,-1,0,'far-floor','terrain',10000,true),cell(7,10,0,0,'far','building',100),
  ...side(100,-1,3),
  ...Array.from({length:15},(_,i)=>cell(200+i,1+i%5,-1,Math.floor(i/5)-1,'catch-floor','terrain',10000,true)),
 ]),d=await createScaleDynamics(m);
 try{
  const beforeFar=region(m,'far').hp;
  destroy(m,'upper-support');d.sync();
  assert.equal(region(m,'falling').state,'dynamic');
  advance(d,8);
  assert.ok(region(m,'receiver').hp<1000,'actual contact must injure a distinct target');
  assert.equal(region(m,'far').hp,beforeFar);
  assert.equal(region(m,'falling').state,'rubble');
  assert.ok(region(m,'falling').position.y<4);
  assert.equal(d.stats().pendingGroups,0);
  const hp=region(m,'receiver').hp,impactCount=d.impacts().length;
  advance(d,8);
  assert.equal(region(m,'receiver').hp,hp,'resting solver forces are not fresh impacts');
  assert.equal(d.impacts().length,impactCount);
 }finally{d.dispose();}
});

// A new sphere must cross an absent lattice cell; an AABB/hidden plane shortcut
// would stop this projectile even if the rendered hole looks correct.
test('exact occupied masks leave windows open to a new physical projectile with no hidden ground',async()=>{
 const cells=[cell(1,-1,0,0,'wall','terrain',100,true),cell(2,1,0,0,'wall','terrain',100,true),cell(3,0,1,0,'lintel','terrain',100,true),cell(4,-1,1,0,'wall','terrain',100,true),cell(5,1,1,0,'wall','terrain',100,true)];
 const m=authority(cells),d=await createScaleDynamics(m);
 try{
  d.launchProjectile({id:'window',position:{x:0,y:0,z:-3},velocity:{x:0,y:0,z:8},radius:.15,gravityScale:0});
  advance(d,1);
  assert.ok(d.projectile('window')!.position.z>3);
  assert.equal(d.drainProjectileContacts().length,0);
  d.launchProjectile({id:'void',position:{x:8,y:0,z:0},velocity:{x:0,y:-2,z:0},radius:.15});
  advance(d,1);
  assert.ok(d.projectile('void')!.position.y< -5,'no permanent substrate or hidden floor may remain');
 }finally{d.dispose();}
});

test('sleeping rubble keeps pose and durability through save/restore and reset rejects stale physics',async()=>{
 const cells=[cell(1,0,2,0,'support','terrain',1,true),cell(2,0,3,0,'falling','building',1000),cell(3,0,-1,0,'floor','terrain',10000,true),...side(100,-1,2)];
 const m=authority(cells),d=await createScaleDynamics(m);
 const other=authority(cells),restored=await createScaleDynamics(other);
 try{
  destroy(m,'support');d.sync();advance(d,8);
  const saved=d.snapshot(),r=region(m,'falling');
  assert.equal(r.state,'rubble');
  assert.equal(restored.restore(saved),true);
  const roundTrip=region(other,'falling');
  assert.deepEqual([roundTrip.id,roundTrip.hp,roundTrip.state],[r.id,r.hp,r.state]);
  assert.ok(Math.hypot(roundTrip.position.x-r.position.x,roundTrip.position.y-r.position.y,roundTrip.position.z-r.position.z)<1e-5);
  assert.ok(Math.abs(roundTrip.rotation.x*r.rotation.x+roundTrip.rotation.y*r.rotation.y+roundTrip.rotation.z*r.rotation.z+roundTrip.rotation.w*r.rotation.w-1)<1e-5);
  advance(restored,2);
  const settled=region(other,'falling');
  assert.equal(settled.state,'rubble');
  assert.ok(Math.hypot(settled.position.x-r.position.x,settled.position.y-r.position.y,settled.position.z-r.position.z)<1e-5);
  const oldEpoch=m.epoch;
  d.reset();assert.ok(m.epoch>oldEpoch);
  assert.equal(region(m,'falling').state,'static');
  assert.equal(d.impacts().length,0);
  assert.equal(m.applyImpact({id:'stale',epoch:oldEpoch,targetRegionIds:[region(m,'falling').id],damage:100}).accepted,false);
 }finally{d.dispose();restored.dispose();}
});

test('body saturation aggregates every important region deterministically without a stranded queue',async()=>{
 const cells:Cell[]=[];
 for(let i=0;i<7;i++){
  cells.push(cell(i*3+1,i*4,2,0,`support-${i}`,'terrain',1,true));
  cells.push(cell(i*3+2,i*4,3,0,`fall-${i}`,'building',1000));
  cells.push(cell(i*3+3,i*4,-1,0,`floor-${i}`,'terrain',10000,true));
  cells.push(...side(100+i*10,i*4-1,2));
 }
 const m=authority(cells),d=await createScaleDynamics(m,{maxBodies:2});
 try{
  for(let i=0;i<7;i++)destroy(m,`support-${i}`);
  d.sync();
  assert.equal(d.stats().pendingGroups,0);
  assert.ok(d.stats().bodyCount<=2);
  assert.equal(d.stats().dynamicRegionCount,7);
  assert.ok(d.stats().aggregatedGroups>=5);
  advance(d,8);
  assert.ok(m.regionViews().filter(r=>r.objectId.startsWith('fall-')).every(r=>r.state==='rubble'&&r.position.y<3));
  assert.equal(d.stats().pendingGroups,0);
 }finally{d.dispose();}
});

test('collision records report committed regional HP loss, not the per-cell requested damage',async()=>{
 const cells=[cell(1,0,2,0,'support','terrain',1,true),cell(2,0,3,0,'falling','building',1000),cell(3,0,-1,0,'floor','terrain',10000,true),cell(4,1,-1,0,'floor','terrain',10000,true),cell(5,0,0,0,'receiver','foundation',1000),cell(6,1,0,0,'receiver','foundation',1000),...side(100,-1,2)];
 const m=authority(cells),d=await createScaleDynamics(m);
 try{
  const target=region(m,'receiver');assert.equal(target.hp,2000);
  destroy(m,'support');d.sync();advance(d,3);
  const committed=d.impacts().filter(e=>e.targetRegionId===target.id&&e.reason==='collision').reduce((n,e)=>n+e.damage,0);
  assert.ok(committed>0);
  assert.ok(Math.abs(committed-(target.hp-m.region(target.id)!.hp))<1e-8);
 }finally{d.dispose();}
});

test('a bounded foreground physics pump carries and eventually drains admitted time instead of dropping it',async()=>{
 const m=authority([cell(1,0,-1,0,'floor','terrain',10000,true)]),d=await createScaleDynamics(m,{maxStepsPerFrame:2});
 try{
  assert.equal(d.step(1),2);assert.ok(d.stats().debtSeconds>.98);
  while(d.stats().debtSeconds>1e-8)d.step(0);
  assert.equal(d.stats().steps,120);assert.ok(d.stats().debtSeconds<1e-8);
  const before=d.stats();assert.throws(()=>d.step(-1));assert.deepEqual(d.stats(),before);
 }finally{d.dispose();}
});

test('saving an immediately edited resting mask preserves one exact native collider set before another step',async()=>{
 const cells=[cell(1,0,2,0,'support','terrain',1,true),cell(2,0,3,0,'falling','building',1000),cell(3,1,3,0,'falling','building',1000),cell(4,0,-1,0,'floor','terrain',10000,true),cell(5,1,-1,0,'floor','terrain',10000,true),...side(100,-1,2)];
 const m=authority(cells),d=await createScaleDynamics(m),other=authority(cells),copy=await createScaleDynamics(other);
 try{
  destroy(m,'support');d.sync();advance(d,5);
  const before=region(m,'falling');assert.equal(before.state,'rubble');
  m.applyImpact({id:'remove-settled',epoch:m.epoch,targetRegionIds:[before.id],damage:1e6});
  // Snapshot owns synchronization even if a caller has not pumped physics yet.
  const saved=d.snapshot();assert.equal(copy.restore(saved),true);
  assert.equal(other.region(before.id)!.state,'gone');
  assert.equal(copy.stats().dynamicRegionCount,0);
  assert.equal(copy.stats().colliderCount,d.stats().colliderCount);
 }finally{d.dispose();copy.dispose();}
});

test('a real body leaving the finite excavated world records explicit escape once, never an invisible floor',async()=>{
 const cells=[cell(1,0,2,0,'support','terrain',1,true),{...cell(2,0,3,0,'falling','building',1000),objective:true},...side(100,-1,2)];
 const m=authority(cells),d=await createScaleDynamics(m);
 try{
  destroy(m,'support');d.sync();advance(d,8);
  assert.equal(region(m,'falling').state,'gone');
  assert.ok(region(m,'falling').position.y< -65);
  assert.equal(d.stats().escapedBodies,1);assert.equal(d.stats().escapedRegions,1);
  const escaped=d.impacts().filter(e=>e.reason==='escaped-world');
  assert.equal(escaped.length,1);assert.equal(escaped[0].damage,1000);
  const reward=m.stats().research;advance(d,2);assert.equal(m.stats().research,reward);
  assert.equal(d.stats().bodyCount,0);
 }finally{d.dispose();}
});
