import test from 'node:test';
import assert from 'node:assert/strict';
import { createStructuralSimulation } from './structural/simulation.js';
import type {Cell,CellView,SceneFixture,StructuralSimulation} from './structural/types.js';

const cell=(id:number,x:number,y:number,z:number,role:Cell['role']='building',hp=100,anchor=false):Cell=>({id,objectId:`object-${id}`,role,position:{x,y,z},material:role==='terrain'?'soil':'stone',color:0x778899,hp,maxHp:hp,anchor});
const fixture=(cells:Cell[]):SceneFixture=>({id:'independent-regression',cells});
const advance=(s:StructuralSimulation,seconds:number,observe?:(views:CellView[])=>void)=>{for(let i=0;i<Math.ceil(seconds*120);i++){s.step(1/120);observe?.(s.views());}};
const live=(s:StructuralSimulation,id:number)=>s.views().find(v=>v.id===id&&v.state!=='gone');
const removeSupport=(s:StructuralSimulation,id:number,x=0)=>s.blast({id:`support-${id}`,epoch:s.epoch,position:{x,y:0,z:0},radius:.15,damage:100,impulse:0});

test('independent: excavated soil releases foundation and roof as authoritative bodies; no old-ground ghost floor',async()=>{
 const s=await createStructuralSimulation(fixture([cell(1,0,0,0,'terrain',1,true),cell(2,0,1,0,'foundation'),cell(3,0,2,0,'building')]));
 try{
  assert.ok(removeSupport(s,1));
  const observed=new Set<string>();let minimumY=Infinity;
  advance(s,2,views=>{for(const v of views.filter(v=>v.id===2||v.id===3)){observed.add(v.state);if(v.state!=='gone')minimumY=Math.min(minimumY,v.position.y);}});
  assert.ok(observed.has('dynamic'),'Detached cells must become actual dynamic authority, not disappear into visual chips');
  assert.ok(minimumY< -1,'A removed soil cell must not leave a permanent terrain slab or old static collider');
  const ids=s.views().map(v=>v.id);assert.equal(ids.length,new Set(ids).size,'Static/dynamic representations cannot duplicate stable IDs');
 }finally{s.dispose();}
});

test('independent: a falling structural piece damages a separate receiver, never an untouched distant structure',async()=>{
 const s=await createStructuralSimulation(fixture([
  cell(1,0,0,0,'terrain',1,true),cell(2,0,1,0,'foundation',200),cell(3,0,2,0,'building',200),cell(4,0,3,0,'building',200),
  cell(10,0,-4,0,'terrain',1000,true),cell(11,0,-3,0,'foundation',30),
  cell(20,10,0,0,'terrain',1000,true),cell(21,10,1,0,'building',100)
 ]));
 try{
  assert.ok(removeSupport(s,1));const untouched=structuredClone(live(s,21));
  advance(s,6);
  assert.ok(!live(s,11)||live(s,11)!.hp<30,'The actual collision must reduce the receiver HP');
  assert.deepEqual(live(s,21),untouched,'No radius shortcut may damage an uncontacted distant building');
  const impacts=s.events().filter(e=>e.kind==='impact'&&e.targetId===11);
  assert.ok(impacts.length>0,'Secondary damage must have an attributable target event');
  assert.equal(new Set(impacts.map(e=>e.id)).size,impacts.length,'Impact events must carry unique identities');
 }finally{s.dispose();}
});

test('independent: quiet resting fixtures do not farm HP loss, rewards, or pending work',async()=>{
 const s=await createStructuralSimulation(fixture([cell(1,0,0,0,'terrain',100,true),cell(2,0,1,0,'foundation'),cell(3,0,2,0)]));
 try{
  const views=structuredClone(s.views()),research=s.research();advance(s,15);
  assert.deepEqual(s.views(),views);assert.equal(s.research(),research);assert.equal(s.pending(),0);
  assert.equal(s.events().filter(e=>e.kind==='impact').length,0);
 }finally{s.dispose();}
});

test('independent: repeated blast IDs and stale epochs cannot duplicate damage or rewards after reset',async()=>{
 const s=await createStructuralSimulation(fixture([cell(1,0,0,0,'terrain',1,true),cell(2,0,1,0,'building',100)]));
 try{
  const old=s.epoch,command={id:'exactly-once',epoch:old,position:{x:0,y:0,z:0},radius:.15,damage:100,impulse:0};
  assert.equal(s.blast(command),true);const after=structuredClone(s.views()),earned=s.research();
  assert.equal(s.blast(command),false);assert.deepEqual(s.views(),after);assert.equal(s.research(),earned);
  s.reset();assert.ok(s.epoch>old);const rebuilt=structuredClone(s.views()),resetResearch=s.research();
  assert.equal(s.blast({...command,id:'late-from-old-world'}),false);advance(s,8);
  assert.deepEqual(s.views(),rebuilt);assert.equal(s.research(),resetResearch);assert.equal(s.pending(),0);
 }finally{s.dispose();}
});

test('independent: snapshots preserve terrain holes and airborne stable identities without paying rewards again',async()=>{
 const source=fixture([cell(1,0,0,0,'terrain',1,true),cell(2,0,1,0,'foundation'),cell(3,0,2,0)]);
 const s=await createStructuralSimulation(source),restored=await createStructuralSimulation(source);
 try{
  removeSupport(s,1);advance(s,.15);assert.ok(s.views().some(v=>v.state==='dynamic'));
  const snapshot=structuredClone(s.snapshot()),before=s.views(),earned=s.research();assert.equal(restored.restore(snapshot),true);
  const after=restored.views();assert.deepEqual(after.map(v=>[v.id,v.state,v.hp]),before.map(v=>[v.id,v.state,v.hp]));
  for(const v of before){const r=after.find(w=>w.id===v.id)!;assert.ok(Math.hypot(v.position.x-r.position.x,v.position.y-r.position.y,v.position.z-r.position.z)<1e-5);}
  assert.equal(restored.research(),earned);assert.ok(!live(restored,1),'Restore cannot resurrect excavated soil');
  const restoredViews=structuredClone(restored.views());
  assert.equal(restored.blast({id:'support-1',epoch:restored.epoch,position:{x:0,y:0,z:0},radius:.15,damage:100,impulse:0}),false,'A saved accepted shot ID must remain consumed after restore');
  restored.step(0);assert.deepEqual(restored.views(),restoredViews,'Zero simulation time cannot move airborne pieces');
  assert.equal(restored.restore({invalid:true}),false);assert.deepEqual(restored.views(),restoredViews,'Invalid restore must be atomic');assert.equal(restored.research(),earned);
 }finally{s.dispose();restored.dispose();}
});

test('independent: maxActiveBodies=1 drains all deferred pieces into persistent rubble instead of waiting forever',async()=>{
 const cells:Cell[]=[];let id=100;
 for(let x=-1;x<=21;x++)for(let z=-1;z<=1;z++)cells.push(cell(id++,x,-3,z,'terrain',10000,true));
 for(let i=0;i<6;i++){const x=i*4;cells.push(cell(i*3+1,x,0,0,'terrain',1,true),cell(i*3+2,x,1,0,'foundation',1000),cell(i*3+3,x,2,0,'building',1000));}
 const s=await createStructuralSimulation(fixture(cells),{maxActiveBodies:1});
 try{
  for(let i=0;i<6;i++)assert.ok(removeSupport(s,i*3+1,i*4));
  assert.ok(s.pending()>0,'Detached pieces must initially remain pending rather than be discarded');
  advance(s,30);
  assert.equal(s.pending(),0,'Saturation queue must actually activate and settle all important pieces');
  for(let i=0;i<6;i++){
   const foundation=live(s,i*3+2);assert.ok(foundation,`Queued foundation ${i} cannot silently disappear`);
   assert.equal(foundation.state,'rubble');assert.ok(foundation.position.y<0,'Settled geometry must live at its physical landing position');
  }
  const stable=s.views(),research=s.research();advance(s,6);assert.equal(s.research(),research,'Resting rubble cannot repeatedly reward source or target');assert.deepEqual(s.views(),stable);
 }finally{s.dispose();}
});

test('independent: forged intact-cell reward loss and invalid epoch snapshots are rejected atomically',async()=>{
 const s=await createStructuralSimulation(fixture([cell(1,0,0,0,'terrain',100,true),cell(2,0,1,0,'building',100)]));
 try{
  const baseline=structuredClone(s.snapshot()) as any,views=s.views(),research=s.research();
  const forged=structuredClone(baseline);forged.cells.find((c:any)=>c.id===2).loss=100;forged.research=200;
  const overflow=structuredClone(baseline);overflow.epoch=Number.MAX_SAFE_INTEGER;
  const rotated=structuredClone(baseline);rotated.cells.find((c:any)=>c.id===2).rotation={x:0,y:Math.SQRT1_2,z:0,w:Math.SQRT1_2};
  for(const [name,bad] of [['fabricated reward',forged],['epoch overflow',overflow],['fabricated static rotation',rotated]] as const){
   assert.equal(s.restore(bad),false,name);assert.deepEqual(s.views(),views);assert.equal(s.research(),research);
  }
 }finally{s.dispose();}
});

test('independent: removing terrain under settled rubble wakes its real body instead of leaving an anchored floating ruin',async()=>{
 const s=await createStructuralSimulation(fixture([cell(1,0,0,0,'terrain',1,true),cell(2,0,1,0,'building',1000),cell(10,0,-3,0,'terrain',1000,true)]));
 try{
  removeSupport(s,1);advance(s,5);const resting=live(s,2)!;assert.ok(resting);assert.equal(resting.state,'rubble');
  assert.ok(s.blast({id:'remove-resting-support',epoch:s.epoch,position:{x:0,y:-3,z:0},radius:.15,damage:2000,impulse:0}));
  let minimumY=resting.position.y;advance(s,1,views=>{const body=views.find(v=>v.id===2&&v.state!=='gone');if(body)minimumY=Math.min(minimumY,body.position.y);});
  assert.ok(minimumY<resting.position.y-1,'Persisted rubble must respond when its actual physical support is destroyed');
 }finally{s.dispose();}
});

test('independent: a later blast pushes already-airborne and sleeping pieces without manufacturing HP rewards',async()=>{
 for(const settled of [false,true]){
  const s=await createStructuralSimulation(fixture([cell(1,0,0,0,'terrain',1,true),cell(2,0,1,0,'building',1000),cell(10,0,-3,0,'terrain',1000,true)]));
  try{
   removeSupport(s,1);advance(s,settled?5:.1);const before=live(s,2)!;assert.equal(before.state,settled?'rubble':'dynamic');const reward=s.research();
   assert.ok(s.blast({id:'push-existing',epoch:s.epoch,position:{x:before.position.x-.3,y:before.position.y,z:before.position.z},radius:1,damage:0,impulse:8}));
   advance(s,.25);const after=live(s,2)!;assert.ok(after.position.x>before.position.x+.25,`${settled?'Sleeping':'Airborne'} existing piece must respond to a later impulse`);
   assert.equal(after.hp,before.hp);assert.equal(s.research(),reward,'A push with zero HP damage cannot pay extra rewards');
  }finally{s.dispose();}
 }
});

test('independent: falling completely below a finite map reaches an explicit terminal state without an invisible floor or extra reward',async()=>{
 const s=await createStructuralSimulation(fixture([cell(1,0,0,0,'terrain',1,true),cell(2,0,1,0,'building',100),cell(3,0,2,0,'building',100)]));
 try{
  removeSupport(s,1);const reward=s.research();let lowest=Infinity;
  advance(s,10,views=>{for(const v of views.filter(v=>v.state==='dynamic'))lowest=Math.min(lowest,v.position.y);});
  assert.ok(lowest< -20,'Out-of-bounds completion cannot substitute a hidden ground slab');
  assert.equal(s.pending(),0,'Fully departed pieces must not block the experiment forever');
  assert.ok(s.views().filter(v=>v.id===2||v.id===3).every(v=>v.state==='gone'));
  assert.equal(s.research(),reward,'Leaving bounds cannot award a previously credited source again');
  assert.equal(s.events().filter(e=>e.kind==='impact').length,0,'Map exit is not an invented damaging collision');
 }finally{s.dispose();}
});

test('independent: a settled piece launched away can genuinely strike the same target again as a new contact episode',async()=>{
 const s=await createStructuralSimulation(fixture([cell(1,0,0,0,'terrain',1,true),cell(2,0,1,0,'building',1000),cell(10,0,-4,0,'terrain',10000,true),cell(11,0,-3,0,'foundation',1000)]));
 try{
  removeSupport(s,1);advance(s,5);const first=live(s,11)!.hp,resting=live(s,2)!;
  assert.ok(first<1000);assert.equal(resting.state,'rubble');
  s.blast({id:'bounce-again',epoch:s.epoch,position:{x:resting.position.x,y:resting.position.y-.3,z:resting.position.z},radius:.5,damage:0,impulse:8});
  let highest=resting.position.y;advance(s,5,views=>{const c=views.find(v=>v.id===2&&v.state!=='gone');if(c)highest=Math.max(highest,c.position.y);});
  assert.ok(highest>resting.position.y+.5,'Source must actually separate from the receiver');
  assert.ok(live(s,11)!.hp<first,'A new real impact cannot be suppressed by the stale credited episode of a removed collider');
 }finally{s.dispose();}
});
