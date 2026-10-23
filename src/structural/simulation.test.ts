import test from 'node:test';
import assert from 'node:assert/strict';
import { createStructuralSimulation } from './simulation.ts';
import type { Cell, SceneFixture, StructuralSimulation } from './types.ts';
const cell = (id:number,x:number,y:number,z=0,over:Partial<Cell>={}):Cell => ({id,objectId:`object-${id}`,role:'building',position:{x,y,z},material:'stone',color:0x999999,hp:100,maxHp:100,...over});
const floor = (width=5):Cell[] => Array.from({length:width},(_,i)=>cell(1000+i,i-(width-1)/2,0,0,{role:'terrain',anchor:true,hp:10000,maxHp:10000}));
const fixture = (cells:Cell[],id='fixture'):SceneFixture=>({id,cells});
const blast=(sim:StructuralSimulation,id:string,x:number,y:number,radius=.25,damage=100,impulse=0)=>sim.blast({id,epoch:sim.epoch,position:{x,y,z:0},radius,damage,impulse});
const run=(sim:StructuralSimulation,seconds:number)=>{for(let i=0;i<seconds*60;i++)sim.step(1/60);};
const get=(sim:StructuralSimulation,id:number)=>sim.views().find(c=>c.id===id)!;

test('removing one support detaches its connected roof with exact cells and awards loss once',async()=>{
 const sim=await createStructuralSimulation(fixture([...floor(),cell(1,0,1),cell(2,0,2),cell(3,1,2)]));
 try {assert.equal(blast(sim,'shot',0,1),true);assert.equal(get(sim,1).state,'gone');assert.equal(get(sim,2).state,'dynamic');assert.equal(get(sim,3).state,'dynamic');assert.equal(sim.pending(),1);assert.equal(sim.research(),200);assert.equal(blast(sim,'shot',0,1),false);run(sim,5);assert.equal(sim.research(),200);} finally {sim.dispose();}
});

test('terrain is removable support, not a hidden permanent ground plane',async()=>{
 const sim=await createStructuralSimulation(fixture([cell(1,0,0,0,{role:'terrain',anchor:true}),cell(2,0,1)]));
 try{blast(sim,'hole',0,0);assert.equal(get(sim,1).state,'gone');assert.equal(get(sim,2).state,'dynamic');run(sim,1);assert.ok(get(sim,2).position.y<-.5,'body must fall through the excavated hole');assert.equal(sim.research(),200);}finally{sim.dispose();}
});

test('stationary contact does not repeatedly damage a resting target or create research',async()=>{
 const sim=await createStructuralSimulation(fixture([...floor(),cell(1,0,1)]));
 try{run(sim,5);assert.equal(get(sim,1).hp,100);assert.equal(sim.research(),0);assert.equal(sim.events().filter(e=>e.kind==='impact').length,0);}finally{sim.dispose();}
});

test('body budget retains queued geometry and drains automatically into persistent rubble',async()=>{
 const sim=await createStructuralSimulation(fixture([...floor(9),cell(1,-3,1),cell(2,-3,2),cell(3,0,1),cell(4,0,2),cell(5,3,1),cell(6,3,2)]),{maxActiveBodies:1});
 try{blast(sim,'a',-3,1);blast(sim,'b',0,1);blast(sim,'c',3,1);assert.equal(sim.pending(),3);assert.deepEqual([2,4,6].map(id=>get(sim,id).state),['dynamic','dynamic','dynamic']);assert.equal(get(sim,6).position.y,2);run(sim,18);assert.equal(sim.pending(),0);for(const id of [2,4,6]){assert.equal(get(sim,id).state,'rubble');assert.ok(get(sim,id).position.y>.8&&get(sim,id).position.y<1.1);}assert.equal(sim.events().filter(e=>e.kind==='sleep').length,3);}finally{sim.dispose();}
});

test('pause, invalid input, foreground clamping and reset never replay stale shots',async()=>{
 const sim=await createStructuralSimulation(fixture([...floor(),cell(1,0,1),cell(2,0,2)]));
 try{blast(sim,'a',0,1);const old=sim.epoch;const before=sim.snapshot();sim.step(0);sim.step(NaN);sim.step(-1);assert.deepEqual(sim.snapshot(),before);sim.reset();assert.ok(sim.epoch>old);assert.equal(sim.pending(),0);assert.equal(sim.research(),0);assert.equal(get(sim,1).state,'static');assert.equal(sim.blast({id:'stale',epoch:old,position:{x:0,y:1,z:0},radius:1,damage:100,impulse:0}),false);assert.equal(sim.events().length,0);}finally{sim.dispose();}
});

test('snapshot round trip preserves active and queued cells; invalid snapshots are atomic',async()=>{
 const sim=await createStructuralSimulation(fixture([...floor(7),cell(1,-2,1),cell(2,-2,2),cell(3,2,1),cell(4,2,2)]),{maxActiveBodies:1});
 try{blast(sim,'a',-2,1);blast(sim,'b',2,1);run(sim,.2);const snap:any=sim.snapshot(),views=sim.views(),research=sim.research(),old=sim.epoch;assert.equal(sim.restore({...snap,fixtureId:'wrong'}),false);assert.deepEqual(sim.snapshot(),snap);const bad=structuredClone(snap);bad.cells[0].hp=NaN;assert.equal(sim.restore(bad),false);assert.deepEqual(sim.snapshot(),snap);run(sim,1);assert.equal(sim.restore(snap),true);assert.ok(sim.epoch>old);assert.deepEqual(sim.views(),views);assert.equal(sim.research(),research);assert.equal(sim.pending(),2);assert.equal(sim.blast({id:'a',epoch:sim.epoch,position:{x:-2,y:1,z:0},radius:1,damage:100,impulse:0}),false);run(sim,12);assert.equal(sim.pending(),0);}finally{sim.dispose();}
});

test('event views are copies and cumulative terrain damage gives no structural research',async()=>{
 const sim=await createStructuralSimulation(fixture([cell(1,0,0,0,{role:'terrain',anchor:true}),cell(2,4,0,0,{anchor:true})]));
 try{blast(sim,'a',0,0,.25,50);assert.equal(get(sim,1).hp,50);assert.equal(sim.research(),0);const events=sim.events();events[0].position.x=999;assert.equal(sim.events()[0].position.x,0);blast(sim,'b',4,0,.25,25);assert.equal(sim.research(),50);blast(sim,'c',4,0,.25,100);assert.equal(sim.research(),200);}finally{sim.dispose();}
});

test('a second cut splits an airborne connected piece into independent bodies without duplicating credit',async()=>{
 const sim=await createStructuralSimulation(fixture([...floor(),cell(1,0,1),cell(2,-1,2),cell(3,0,2),cell(4,1,2)]));
 try{blast(sim,'detach',0,1);assert.equal(sim.pending(),1);blast(sim,'cut',0,2);assert.equal(get(sim,3).state,'gone');assert.equal(sim.pending(),2);assert.equal(sim.research(),200);assert.equal(get(sim,2).state,'dynamic');assert.equal(get(sim,4).state,'dynamic');}finally{sim.dispose();}
});

test('deep out-of-world fall reaches a terminal state, not an age deletion or invisible floor',async()=>{
 const sim=await createStructuralSimulation(fixture([cell(1,0,0,0,{anchor:true,role:'terrain'}),cell(2,0,1)]));
 try{blast(sim,'hole',0,0);run(sim,1);assert.equal(get(sim,2).state,'dynamic');assert.ok(get(sim,2).position.y<-.5);run(sim,10);assert.equal(sim.pending(),0);assert.equal(get(sim,2).state,'gone');assert.ok(get(sim,2).position.y< -32);assert.equal(sim.research(),200);const s=sim.snapshot();assert.equal(sim.restore(s),true);assert.equal(sim.pending(),0);assert.equal(get(sim,2).state,'gone');assert.equal(sim.research(),200);}finally{sim.dispose();}
});

test('high airborne matter is not discarded by elapsed age while still inside the playable world',async()=>{
 const sim=await createStructuralSimulation(fixture([cell(1,0,0,0,{anchor:true,role:'terrain'}),cell(2,0,1000)]));
 try{run(sim,5);assert.equal(get(sim,2).state,'dynamic');assert.ok(get(sim,2).position.y>700);assert.equal(sim.pending(),1);}finally{sim.dispose();}
});

test('settled rubble can be damaged and launched again without rewarding its original cells twice',async()=>{
 const sim=await createStructuralSimulation(fixture([...floor(),cell(1,0,1),cell(2,0,2)]));
 try{blast(sim,'drop',0,1);run(sim,5);const rubble=get(sim,2);assert.equal(rubble.state,'rubble');const research=sim.research();sim.blast({id:'relaunch',epoch:sim.epoch,position:{x:0,y:rubble.position.y-.1,z:0},radius:.2,damage:20,impulse:5});assert.equal(get(sim,2).state,'dynamic');assert.ok(get(sim,2).hp<100);run(sim,.3);assert.ok(get(sim,2).position.y>rubble.position.y+.3);assert.equal(sim.research(),research);}finally{sim.dispose();}
});

test('a budget-blocked top piece yields its slot to the queued piece physically underneath it',async()=>{
 const sim=await createStructuralSimulation(fixture([...floor(),cell(1,0,5),cell(2,0,2)]),{maxActiveBodies:1});
 try{assert.equal(sim.pending(),2);run(sim,20);assert.equal(sim.pending(),0);assert.equal(get(sim,1).state,'rubble');assert.equal(get(sim,2).state,'rubble');assert.ok(get(sim,1).position.y<2.1);assert.ok(get(sim,2).position.y<1.1);}finally{sim.dispose();}
});

test('rotated airborne body snapshots preserve cell poses and linear/angular motion',async()=>{
 const source=fixture([...floor(9),cell(1,0,1),cell(2,0,2),cell(3,1,2)]);
 const sim=await createStructuralSimulation(source),restored=await createStructuralSimulation(source);
 try{blast(sim,'drop',0,1);sim.blast({id:'twist',epoch:sim.epoch,position:{x:1,y:1.8,z:.2},radius:.4,damage:0,impulse:4});run(sim,.1);const snap:any=sim.snapshot();assert.ok(Math.abs(snap.bodies[0].angvel.z)+Math.abs(snap.bodies[0].angvel.x)>.1);assert.equal(restored.restore(snap),true);const saved:any=restored.snapshot();for(const b of saved.bodies){const a=snap.bodies.find((x:any)=>x.id===b.id);for(const axis of ['x','y','z']){assert.ok(Math.abs(a.linvel[axis]-b.linvel[axis])<1e-5);assert.ok(Math.abs(a.angvel[axis]-b.angvel[axis])<1e-5);}}for(const a of sim.views()){const b=get(restored,a.id);assert.ok(Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y,a.position.z-b.position.z)<1e-5);assert.ok(Math.abs(a.rotation.x-b.rotation.x)+Math.abs(a.rotation.y-b.rotation.y)+Math.abs(a.rotation.z-b.rotation.z)+Math.abs(a.rotation.w-b.rotation.w)<1e-5);}run(sim,.1);run(restored,.1);for(const a of sim.views()){const b=get(restored,a.id);assert.ok(Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y,a.position.z-b.position.z)<.003);}}finally{sim.dispose();restored.dispose();}
});

test('accepted contact damage does not replay after restoring its still-touching episode',async()=>{
 const source=fixture([cell(1,0,0,0,{anchor:true,role:'terrain'}),cell(2,0,1,0,{hp:200,maxHp:200}),cell(10,0,-4,0,{anchor:true,role:'terrain',hp:10000,maxHp:10000}),cell(11,0,-3,0,{hp:1000,maxHp:1000})]);
 const sim=await createStructuralSimulation(source),restored=await createStructuralSimulation(source);
 try{blast(sim,'drop',0,0);for(let i=0;i<600&&!sim.events().some(e=>e.kind==='impact'&&e.targetId===11);i++)sim.step(1/120);assert.equal(sim.events().filter(e=>e.kind==='impact'&&e.targetId===11).length,1);const hp=get(sim,11).hp,research=sim.research(),snapshot=sim.snapshot();assert.equal(restored.restore(snapshot),true);run(restored,10);assert.equal(get(restored,11).hp,hp);assert.equal(restored.events().filter(e=>e.kind==='impact'&&e.targetId===11).length,1);assert.equal(restored.research(),research);}finally{sim.dispose();restored.dispose();}
});

test('foreground delta is clamped to one second and invalid finite extremes cannot poison physics',async()=>{
 const source=fixture([cell(1,0,0,0,{anchor:true,role:'terrain'}),cell(2,0,100)]),a=await createStructuralSimulation(source),b=await createStructuralSimulation(source);
 try{a.step(100);b.step(1);assert.deepEqual(a.views(),b.views());const before=a.snapshot();assert.equal(a.blast({id:'bad',epoch:a.epoch,position:{x:NaN,y:0,z:0},radius:1,damage:1,impulse:1}),false);assert.deepEqual(a.snapshot(),before);assert.equal(a.blast({id:'huge',epoch:a.epoch,position:{x:0,y:0,z:0},radius:1,damage:1,impulse:1e300}),false);}finally{a.dispose();b.dispose();}
});

test('snapshot rejects inconsistent rigid cell poses and forged moving rubble while leaving the world untouched',async()=>{
 const sim=await createStructuralSimulation(fixture([...floor(),cell(1,0,1),cell(2,0,2),cell(3,1,2)]));
 try{blast(sim,'drop',0,1);run(sim,.1);const snap:any=sim.snapshot(),bad=structuredClone(snap);bad.cells.find((c:any)=>c.id===3).position.x+=20;assert.equal(sim.restore(bad),false);assert.deepEqual(sim.snapshot(),snap);run(sim,10);const rubble:any=sim.snapshot(),moving=structuredClone(rubble);moving.bodies[0].linvel.x=3;assert.equal(sim.restore(moving),false);assert.deepEqual(sim.snapshot(),rubble);}finally{sim.dispose();}
});

test('shared physics host drives external bodies on the same fixed clock and broadcasts copied contacts',async()=>{
 const RAPIER=(await import('@dimforge/rapier3d-compat')).default;
 const sim=await createStructuralSimulation(fixture([...floor()]));
 try{const host=(sim as any).physicsHost;assert.ok(host,'The structural owner must expose the single live host');let body:any,steps=0,pending=1;const collisionBatches:any[]=[];host.register({afterWorldReplace(world:any){body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,3,0));world.createCollider(RAPIER.ColliderDesc.ball(.2).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),body);},afterStep(_world:any,collisions:any){steps++;collisionBatches.push(collisions);},pending(){return pending;}});assert.equal(sim.pending(),1);host.advance(0);assert.equal(steps,0);host.advance(1/60);assert.equal(steps,2);assert.ok(body.translation().y<3);for(let i=0;i<120;i++)host.advance(1/120);assert.ok(collisionBatches.flat().some((c:any)=>c.started));const first=structuredClone(collisionBatches);host.advance(1/60);assert.deepEqual(collisionBatches.slice(0,first.length),first);pending=0;assert.equal(sim.pending(),0);}finally{sim.dispose();}
});

test('shared host replaces its world atomically after validation and notifies consumers before freeing it',async()=>{
 const sim=await createStructuralSimulation(fixture([...floor()]));
 try{const host=(sim as any).physicsHost;assert.ok(host);const notices:string[]=[];let known=host.world;const unregister=host.register({beforeWorldReplace(){assert.equal(host.world,known);notices.push('before');},afterWorldReplace(world:any,epoch:number){known=world;assert.equal(world,host.world);assert.equal(epoch,host.epoch);notices.push('after');}});assert.deepEqual(notices,['after']);const save=sim.snapshot();assert.equal(sim.restore({}),false);assert.deepEqual(notices,['after']);const old=host.world;assert.equal(sim.restore(save),true);assert.notEqual(host.world,old);assert.deepEqual(notices,['after','before','after']);sim.reset();assert.deepEqual(notices,['after','before','after','before','after']);unregister();sim.reset();assert.equal(notices.length,5);}finally{sim.dispose();}
});

test('static geometry packs exact occupied volume, preserves native holes and only rebuilds the dirty chunk',async()=>{
 const RAPIER=(await import('@dimforge/rapier3d-compat')).default;
 const sim=await createStructuralSimulation(fixture(Array.from({length:16},(_,x)=>cell(x+1,x,0,0,{anchor:true,role:'terrain'}))));
 try{const host=sim.physicsHost;assert.equal(host.world.colliders.len(),2);const ray=(x:number)=>host.world.castRay(new RAPIER.Ray({x,y:3,z:0},{x:0,y:-1,z:0}),10,true);sim.step(1/120);const untouched=ray(10)!.collider.handle;assert.equal(host.colliderCell(untouched,{x:10,y:.5,z:0}),11);blast(sim,'hole',2,0);assert.equal(get(sim,3).state,'gone');assert.equal(host.world.colliders.len(),3);assert.equal(ray(2),null,'Packed box rebuilding cannot refill the removed lattice hole');assert.equal(ray(10)!.collider.handle,untouched,'Unchanged chunks retain their existing native collider');}finally{sim.dispose();}
});

test('a packed multi-cell target receives contact damage only at the actually struck cell',async()=>{
 const sim=await createStructuralSimulation(fixture([cell(1,0,0,0,{anchor:true,hp:1000,maxHp:1000}),cell(2,1,0,0,{anchor:true,hp:1000,maxHp:1000}),cell(3,2,0,0,{anchor:true,hp:1000,maxHp:1000}),cell(4,3,0,0,{anchor:true,hp:1000,maxHp:1000}),cell(20,2,5)]));
 try{run(sim,5);assert.ok(get(sim,3).hp<1000);assert.equal(get(sim,1).hp,1000);assert.equal(get(sim,2).hp,1000);assert.equal(get(sim,4).hp,1000);assert.ok(sim.events().some(e=>e.kind==='impact'&&e.targetId===3));}finally{sim.dispose();}
});

test('a large shell physically resting in a crater can sleep on wall friction rather than remain pending forever',async()=>{
 const {createStructuralFixture}=await import('./fixtures.ts');const f=createStructuralFixture('neighborhood'),sim=await createStructuralSimulation(f);
 try{const foundation=f.cells.find(c=>c.role==='foundation')!,own=f.cells.filter(c=>c.objectId===foundation.objectId),center=own.reduce((p,c)=>({x:p.x+c.position.x/own.length,y:-1,z:p.z+c.position.z/own.length}),{x:0,y:-1,z:0});sim.blast({id:'crater',epoch:sim.epoch,position:center,radius:9,damage:10,impulse:5});assert.ok(sim.pending()>0);run(sim,10);assert.equal(sim.pending(),0);assert.ok(sim.views().some(c=>c.state==='rubble'));}finally{sim.dispose();}
});
