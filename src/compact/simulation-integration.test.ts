import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {createStructuralSimulation} from '../structural/simulation.js';
import {createSupportGraph} from '../structural/support.js';
import type {Cell, SceneFixture, StructuralSimulation} from '../structural/types.js';

const cell=(id:number,x:number,y:number,z=0,over:Partial<Cell>={}):Cell=>({id,objectId:`object-${id}`,role:'building',position:{x,y,z},material:'stone',color:0x888888,hp:100,maxHp:100,...over});
const floor=(width=9)=>Array.from({length:width},(_,x)=>cell(1000+x,x-(width-1)/2,0,0,{role:'terrain',anchor:true,hp:10000,maxHp:10000}));
const blast=(s:StructuralSimulation,id:string,x:number,y:number,radius=.25,damage=100,impulse=0)=>s.blast({id,epoch:s.epoch,position:{x,y,z:0},radius,damage,impulse});
const run=(s:StructuralSimulation,seconds:number)=>{for(let n=0;n<seconds*120;n++)s.step(1/120);};
async function compact(source:SceneFixture,maxActiveBodies=32){
 const module=await import('./fixture.js').catch(()=>null);
 assert.ok(module?.createDenseFixture,'compact fixture descriptors must enter the existing simulation kernel');
 const fixture=module.createDenseFixture(source);
 // Small-fixture support uses the unchanged reference graph. Production support is
 // independently precompiled; this isolates the storage adapter and single kernel.
 const supportFactory=(store:any)=>{
  let graph=createSupportGraph(source.cells.filter(c=>store.read(c.id)?.state==='static'));
  return {remove:(ids:readonly number[])=>graph.remove(ids),unsupported:()=>graph.unsupported(),reset(){graph=createSupportGraph(source.cells.filter(c=>store.read(c.id)?.state==='static'));}};
 };
 return createStructuralSimulation(fixture as any,{maxActiveBodies,compactSupportFactory:supportFactory} as any);
}
function equalViews(actual:StructuralSimulation,expected:StructuralSimulation,tolerance=0){
 const a=actual.views(),b=expected.views();assert.equal(a.length,b.length);
 for(let i=0;i<a.length;i++){
  const {position:ap,rotation:aq,...av}=a[i],{position:bp,rotation:bq,...bv}=b[i];assert.deepEqual(av,bv);
  for(const axis of ['x','y','z'] as const)assert.ok(Math.abs(ap[axis]-bp[axis])<=tolerance,`position ${a[i].id}.${axis}: ${ap[axis]} != ${bp[axis]}`);
  for(const axis of ['x','y','z','w'] as const)assert.ok(Math.abs(aq[axis]-bq[axis])<=tolerance,`rotation ${a[i].id}.${axis}`);
 }
 assert.equal(actual.pending(),expected.pending());assert.equal(actual.research(),expected.research());
}

test('compact authority shares the dense detach, queue, sleep, rubble and reward kernel',async()=>{
 const fixture={id:'compact-parity',cells:[...floor(),cell(5,-3,1),cell(2,-3,2),cell(9,0,1),cell(4,0,2),cell(7,3,1),cell(6,3,2)]};
 const dense=await createStructuralSimulation(fixture,{maxActiveBodies:1}),sparse=await compact(fixture,1);
 try{
  equalViews(sparse,dense);for(const [id,x]of [['left',-3],['middle',0],['right',3]] as const){assert.equal(blast(sparse,id,x,1),blast(dense,id,x,1));equalViews(sparse,dense);}
  assert.equal(sparse.pending(),3);run(sparse,18);run(dense,18);equalViews(sparse,dense,1e-4);assert.equal(sparse.pending(),0);assert.equal(sparse.events().filter(e=>e.kind==='sleep').length,3);
  const reward=sparse.research(),rubble=sparse.physicsHost.cell(4)!;blast(sparse,'wake',rubble.position.x,rubble.position.y-.1,.2,20,5);assert.equal(sparse.physicsHost.cell(4)!.state,'dynamic');assert.equal(sparse.research(),reward);
 }finally{sparse.dispose();dense.dispose();}
});

test('compact local blast retains source ordinal for first-member rigid-body impulse',async()=>{
 const fixture={id:'ordinal-impulse',cells:[...floor(),cell(30,1,3),cell(-50,0,3)]};
 const dense=await createStructuralSimulation(fixture),sparse=await compact(fixture);
 try{
  const command={id:'twist',epoch:1,position:{x:.4,y:2.9,z:.2},radius:2,damage:0,impulse:4};
  assert.ok(dense.blast(command));assert.ok(sparse.blast(command));run(dense,.1);run(sparse,.1);equalViews(sparse,dense,1e-5);
  const a:any=sparse.snapshot(),b:any=dense.snapshot();assert.deepEqual(a.bodies.map((c:any)=>c.cells),b.bodies.map((c:any)=>c.cells));assert.deepEqual(a.shots,b.shots);
 }finally{sparse.dispose();dense.dispose();}
});

test('compact static collision holes and host point resolution follow exact occupancy',async()=>{
 const s=await compact({id:'hole',cells:Array.from({length:16},(_,x)=>cell(x+1,x,0,0,{anchor:true,role:'terrain'}))});
 try{
  const host=s.physicsHost;s.step(1/120);const ray=(x:number)=>host.world.castRay(new RAPIER.Ray({x,y:3,z:0},{x:0,y:-1,z:0}),10,true);
  const untouched=ray(10)!.collider.handle;assert.equal(host.colliderCell(untouched,{x:10,y:.5,z:0}),11);
  assert.ok(blast(s,'hole',2,0));assert.equal(ray(2),null);assert.equal(ray(10)!.collider.handle,untouched);assert.equal(host.cell(3)!.state,'gone');
 }finally{s.dispose();}
});

test('compact sparse restore validates before replacing the world and preserves queued body poses',async()=>{
 const s=await compact({id:'sparse-restore',cells:[...floor(),cell(1,-2,1),cell(2,-2,2),cell(3,2,1),cell(4,2,2)]},1);
 try{
  blast(s,'left',-2,1);blast(s,'right',2,1);run(s,.2);
  const saved:any=s.snapshot(),views=s.views(),world=s.physicsHost.world,epoch=s.epoch;
  assert.equal(saved.schema,'structural-simulation-compact/v1');assert.equal(saved.cells.length,4);assert.ok(saved.fixtureSignature.startsWith('compact:'));
  const bad=structuredClone(saved);bad.cells[0].hp=NaN;assert.equal(s.restore(bad),false);assert.equal(s.physicsHost.world,world);assert.equal(s.epoch,epoch);assert.deepEqual(s.snapshot(),saved);
  run(s,.3);assert.ok(s.restore(saved));assert.notEqual(s.physicsHost.world,world);assert.ok(s.epoch>epoch);assert.deepEqual(s.views(),views);assert.equal(s.pending(),2);assert.equal(blast(s,'left',-2,1),false);run(s,15);assert.equal(s.pending(),0);
  s.reset();assert.equal(s.pending(),0);assert.equal(s.research(),0);assert.equal((s.snapshot() as any).cells.length,0);
 }finally{s.dispose();}
});

test('compact delta and per-cell reads stay sparse, immutable and independent of full diagnostics',async()=>{
 const s=await compact({id:'sparse-query',cells:[...floor(),cell(1,0,1),cell(2,0,2)]});
 try{
  const port=(s as any).compact;assert.ok(port,'a compact delta/query port must be exposed');
  const start=port.changesSince();assert.equal(start.reset,true);assert.deepEqual(start.ids,[]);assert.equal(port.diagnostics().mutableStates,0);
  const prior=port.cell(1);assert.ok(Object.isFrozen(prior));assert.ok(Object.isFrozen(prior.position));
  assert.throws(()=>{prior.position.y=999;},TypeError);assert.equal(s.physicsHost.cell(1)!.position.y,1);
  s.views=()=>{throw new Error('full views must not enter compact updates');};s.liveViews=()=>{throw new Error('full liveViews must not enter compact updates');};
  blast(s,'drop',0,1);const delta=port.changesSince(start.revision);assert.equal(delta.reset,false);assert.deepEqual(new Set(delta.ids),new Set([1,2]));assert.equal(port.diagnostics().mutableStates,2);assert.equal(port.movingViews().length,1);assert.equal(prior.state,'static');
  run(s,.1);const moved=port.changesSince(delta.revision);assert.deepEqual(moved.ids,[2]);assert.equal(port.aggregate().loss,200);assert.equal((s.snapshotSparse() as any).cells.length,2);
 }finally{s.dispose();}
});

test('compact secondary impact credits a true contact episode once and restores that episode',async()=>{
 const fixture={id:'contact',cells:[cell(1,0,0,0,{anchor:true,role:'terrain'}),cell(2,0,1,0,{hp:200,maxHp:200}),cell(10,0,-4,0,{anchor:true,role:'terrain',hp:10000,maxHp:10000}),cell(11,0,-3,0,{hp:1000,maxHp:1000})]};
 const s=await compact(fixture);
 try{
  blast(s,'drop',0,0);for(let n=0;n<600&&!s.events().some(e=>e.kind==='impact'&&e.targetId===11);n++)s.step(1/120);
  assert.equal(s.events().filter(e=>e.kind==='impact'&&e.targetId===11).length,1);const hp=s.physicsHost.cell(11)!.hp,reward=s.research(),saved=s.snapshot();assert.ok(s.restore(saved));run(s,10);assert.equal(s.physicsHost.cell(11)!.hp,hp);assert.equal(s.research(),reward);assert.equal(s.events().filter(e=>e.kind==='impact'&&e.targetId===11).length,1);
 }finally{s.dispose();}
});

test('compact moving reads reuse immutable identities until authoritative pose changes',async()=>{
 const s=await compact({id:'sparse-identities',cells:[...floor(),cell(1,0,1),cell(2,0,2)]});
 try{
  blast(s,'drop',0,1);const port=s.compact!,first=port.movingViews()[0];assert.equal(port.movingViews()[0],first);
  s.step(1/120);const next=port.movingViews()[0];assert.notEqual(next,first);assert.equal(port.cell(2),next);assert.equal(first.position.y,2);
  run(s,8);const rubble=port.movingViews()[0];assert.equal(rubble.state,'rubble');run(s,1);assert.equal(port.movingViews()[0],rubble);
  const beforeReset=port.source.generation;s.reset();assert.ok(port.source.generation>beforeReset);assert.deepEqual(port.changedCells(),[]);assert.deepEqual(port.movingViews(),[]);
 }finally{s.dispose();}
});

test('compact first-layer damage and full-depth hole stay on the existing projectile clock',async()=>{
 const cells:Cell[]=[];let id=1;for(let y=-1;y>=-8;y--)for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)cells.push(cell(id++,x,y,z,{role:'terrain',anchor:y===-8,hp:20,maxHp:20}));
 const s=await compact({id:'eight-layers',cells});const {createProjectilePhysics}=await import('../physics.js');const p=await createProjectilePhysics({host:s.physicsHost});
 try{
  const shoot=(id:string)=>p.launch({id,epoch:s.epoch,origin:{x:0,y:5,z:0},target:{x:0,y:-1,z:0},weapon:'pulse',power:1});
  assert.ok(shoot('first'));let events:ReturnType<typeof p.step>=[];for(let n=0;n<240&&!events.length;n++)events=p.step(1/120);assert.equal(events.length,1);assert.ok(events[0].position.y>-.6);
  blast(s,'top',0,-1,.25,100);s.step(1/120);let ray=s.physicsHost.world.castRay(new RAPIER.Ray({x:0,y:2,z:0},{x:0,y:-1,z:0}),20,true);assert.ok(ray);assert.equal(s.physicsHost.cell(s.physicsHost.colliderCell(ray.collider.handle,{x:0,y:-1.5,z:0})!)!.position.y,-2);
  for(let y=-2;y>=-8;y--)blast(s,`layer-${y}`,0,y,.25,100);
  assert.ok(shoot('second'));events=[];for(let n=0;n<120;n++)events.push(...p.step(1/120));assert.deepEqual(events,[]);assert.ok(p.getProjectiles()[0].position.y< -8);
  const old=s.epoch;s.reset();assert.ok(s.epoch>old);assert.deepEqual(p.getProjectiles(),[]);assert.equal(p.step(1).length,0);
 }finally{p.dispose();s.dispose();}
});

test('compact attached echo stages share the authoritative host and cancel after reset',async()=>{
 const cells:Cell[]=[];let id=0;for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)cells.push(cell(id++,x,-1,z,{role:'terrain',anchor:true,hp:20,maxHp:20}));
 const s=await compact({id:'compact-ordnance',cells});const {createStructuralOrdnance}=await import('../structural/ordnance.js');const effects:string[]=[];const p=await createStructuralOrdnance(s,e=>effects.push(e.id));
 try{
  assert.ok(p.attach({id:'echo',epoch:s.epoch,weapon:'echo',surface:{voxelId:40,position:{x:0,y:-.5,z:0},normal:{x:0,y:1,z:0}},power:1}));assert.equal(p.detonateAttached().length,1);assert.ok(s.physicsHost.cell(40)!.hp<20);assert.equal(p.detonateAttached().length,0);assert.ok(s.pending()>0);
  p.step(1);assert.equal(effects.length,2);p.step(.5);assert.equal(effects.length,3);assert.equal(s.pending(),0);assert.equal(new Set(effects).size,3);
  s.reset();assert.deepEqual(p.getProjectiles(),[]);p.step(1);assert.equal(effects.length,3);assert.equal(s.research(),0);
 }finally{p.dispose();s.dispose();}
});

test('compact world replacement preserves host notifications and rejects stale ordnance epochs',async()=>{
 const s=await compact({id:'host-lifecycle',cells:floor()});const notices:string[]=[];let known=s.physicsHost.world;
 const unsubscribe=s.physicsHost.register({beforeWorldReplace(){assert.equal(s.physicsHost.world,known);notices.push('before');},afterWorldReplace(world,epoch){known=world;assert.equal(s.physicsHost.world,world);assert.equal(s.epoch,epoch);notices.push('after');}});
 try{
  const saved=s.snapshot(),epoch=s.epoch;assert.equal(s.restore({}),false);assert.deepEqual(notices,['after']);assert.ok(s.restore(saved));assert.deepEqual(notices,['after','before','after']);
  assert.equal(s.blast({id:'stale',epoch,position:{x:0,y:0,z:0},radius:1,damage:1,impulse:0}),false);s.reset();assert.deepEqual(notices,['after','before','after','before','after']);unsubscribe();s.reset();assert.equal(notices.length,5);
 }finally{s.dispose();}
});

test('compact local updates never request dense inventory or retain pristine State objects',async()=>{
 const {createDenseFixture}=await import('./fixture.js');const source={id:'bounded-kernel',cells:Array.from({length:4096},(_,id)=>cell(id,id%64,0,Math.floor(id/64),{anchor:true}))};
 const base=createDenseFixture(source);let originalReads=0;
 const guarded=new Proxy(base,{get(target,key){if(key==='cells'||key==='diagnosticCells')throw new Error('Forbidden dense inventory read');if(key==='original')return(id:number)=>{originalReads++;return target.original(id);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const s=await createStructuralSimulation(guarded,{compactSupportFactory:store=>{let graph=createSupportGraph(source.cells);return {remove:ids=>graph.remove(ids),unsupported:()=>graph.unsupported(),reset(){graph=createSupportGraph(source.cells.filter(c=>store.stateOf(c.id)==='static'));}};}});
 try{
  assert.equal(originalReads,0);assert.equal(s.compact!.diagnostics().mutableStates,0);const before=s.compact!.changesSince();
  assert.ok(blast(s,'small',0,0,.1,25));assert.ok(originalReads<12,`local blast synthesized ${originalReads} originals`);assert.equal(s.compact!.diagnostics().mutableStates,1);assert.equal(s.compact!.changesSince(before.revision).ids.length,1);assert.equal((s.snapshot() as any).cells.length,1);
  originalReads=0;for(let n=0;n<120;n++){s.step(1/60);s.research();s.compact!.changesSince(s.compact!.revision);}assert.equal(originalReads,0);assert.equal(s.compact!.diagnostics().mutableStates,1);
 }finally{s.dispose();}
});

test('compact incremental fractional HP rewards produce self-validating sparse saves',async()=>{
 const s=await compact({id:'fractional-save',cells:Array.from({length:10},(_,id)=>cell(id,id*2,0,0,{anchor:true,hp:.6,maxHp:.6,material:'glass'}))});
 try{
  for(let i=0;i<=40;i++){const id=(i*7)%10;blast(s,String(i),id*2,0,.1,[.01,.03,.05,.1,.2][i%5]);}
  const saved=s.snapshot(),views=s.views(),research=s.research();assert.ok(s.restore(saved),'incrementally accounted fractional HP must never reject its own strict sparse snapshot');assert.equal(s.research(),research);assert.deepEqual(s.views(),views);
 }finally{s.dispose();}
});

test('dense fixture compatibility does not reinterpret unrelated caller metadata as a compact descriptor',async()=>{
 const source={id:'dense-metadata',kind:'custom-scene',cells:[cell(2**40,0,0,0,{anchor:true})]};
 const s=await createStructuralSimulation(source);
 try{assert.equal(s.compact,undefined);assert.equal(s.views()[0].id,2**40);assert.equal((s.snapshot() as any).schema,'structural-simulation/v1');}finally{s.dispose();}
});

test('compact sparse restore cannot replace immutable specs with unvalidated extra fields',async()=>{
 const source=cell(1,0,0,0,{anchor:true}),s=await compact({id:'restore-spec-authority',cells:[source]});
 try{
  blast(s,'partial',0,0,.1,1);const saved:any=s.snapshot();saved.cells[0].spec={...source,id:999,hp:1,maxHp:1,material:'wood'};
  assert.ok(s.restore(saved));const view=s.compact!.cell(1)!;assert.equal(view.id,1);assert.equal(view.material,'stone');assert.equal(view.maxHp,100);assert.equal((s.snapshot() as any).cells[0].id,1);
 }finally{s.dispose();}
});

test('restore ignores injected native-body properties in serialized chunks on both routes',async()=>{
 const fixture={id:'restore-native-authority',cells:[...floor(),cell(1,-2,1),cell(2,-2,2),cell(3,2,1),cell(4,2,2)]};
 for(const dense of [false,true]){
  const s=dense?await createStructuralSimulation(fixture,{maxActiveBodies:1}):await compact(fixture,1);
  try{blast(s,'left',-2,1);blast(s,'right',2,1);const saved:any=s.snapshot();const queued=saved.bodies.find((b:any)=>b.status==='queued');assert.ok(queued);queued.body={poison:true};assert.ok(s.restore(saved));assert.doesNotThrow(()=>s.snapshot());run(s,15);assert.equal(s.pending(),0);}finally{s.dispose();}
 }
});

test('compact native query candidates are local exact boxes including negative chunk faces and infinite rays',async()=>{
 await RAPIER.init();const {createDenseFixture}=await import('./fixture.js'),{CompactAuthorityStore}=await import('./store.js'),{CompactStaticColliders}=await import('./static-colliders.js');
 const store=new CompactAuthorityStore(createDenseFixture({id:'local-native-candidates',cells:Array.from({length:32},(_,n)=>cell(n,n-8,0,0,{anchor:true}))}));
 const world=new RAPIER.World({x:0,y:0,z:0}),index=new CompactStaticColliders(world,store);
 try{
  assert.equal(typeof (index as any).collidersInBounds,'function','static query candidates must not enumerate the city');
  const at=(x:number)=>({minX:x,maxX:x,minY:0,maxY:0,minZ:0,maxZ:0});
  const candidates=(bounds:any)=>[...(index as any).collidersInBounds(bounds)] as RAPIER.Collider[];
  assert.equal(candidates(at(0)).length,1);assert.equal(candidates(at(100)).length,0);assert.equal(candidates(at(-.5)).length,2);assert.equal(candidates(at(7.5)).length,2);
  const all=candidates({minX:-Infinity,maxX:Infinity,minY:-Infinity,maxY:Infinity,minZ:-Infinity,maxZ:Infinity});assert.equal(all.length,4);assert.ok(all.every(c=>(index as any).owns(c.handle)));
  const foreign=world.createCollider(RAPIER.ColliderDesc.ball(.1).setTranslation(40,0,0));assert.equal((index as any).owns(foreign.handle),false);
  const hole=store.writable(16)!;hole.hp=0;hole.loss=hole.spec.hp;hole.state='gone';store.markChanged(16);index.markDirtyAt(hole.spec.position);index.flush();assert.equal(candidates(at(8)).length,0);assert.equal(candidates(at(9)).length,1);
 }finally{index.dispose();world.free();}
});

test('compact phase projectiles contact three distinct exact slabs on the shared clock',async()=>{
 const cells:Cell[]=[];let id=1;for(const y of [12,8,4,0])for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)cells.push(cell(id++,x,y,z,{role:'terrain',anchor:true}));
 const s=await compact({id:'compact-phase-slabs',cells}),{createProjectilePhysics}=await import('../physics.js'),p=await createProjectilePhysics({host:s.physicsHost});
 try{
  assert.ok(p.launch({id:'phase',epoch:s.epoch,weapon:'phase',power:1,origin:{x:0,y:20,z:0},target:{x:0,y:12,z:0}}));const events:ReturnType<typeof p.step>=[];for(let n=0;n<360;n++)events.push(...p.step(1/120));
  assert.equal(events.length,3);for(const [i,y]of [12,8,4].entries())assert.ok(Math.abs(events[i].position.y-y-.5)<.03,JSON.stringify(events));assert.equal(s.pending(),0);
 }finally{p.dispose();s.dispose();}
});

test('validated compact setup invokes handoff exactly once before its first world and never on reset or restore',async()=>{
 const {createDenseFixture}=await import('./fixture.js'),source={id:'prepare-handoff',cells:floor()};const notices:string[]=[];
 const s=await createStructuralSimulation(createDenseFixture(source),{
  compactSupportFactory:async store=>{notices.push('validating');await Promise.resolve();notices.push('validated');let graph=createSupportGraph(source.cells);return {remove:ids=>graph.remove(ids),unsupported:()=>graph.unsupported(),reset(){graph=createSupportGraph(source.cells.filter(c=>store.stateOf(c.id)==='static'));}};},
  beforeWorldCreate:()=>{assert.deepEqual(notices,['validating','validated']);notices.push('handoff');},
 });
 try{assert.deepEqual(notices,['validating','validated','handoff']);const saved=s.snapshot();s.reset();assert.ok(s.restore(saved));assert.equal(notices.filter(n=>n==='handoff').length,1);}finally{s.dispose();}
});

test('failed async support validation never hands off or destroys an existing armed world',async()=>{
 const {createDenseFixture}=await import('./fixture.js'),source={id:'failed-prepare',cells:floor()},old=await compact(source);const {createProjectilePhysics}=await import('../physics.js'),p=await createProjectilePhysics({host:old.physicsHost});
 try{
  assert.ok(p.launch({id:'armed',epoch:old.epoch,weapon:'charge',power:1,origin:{x:0,y:4,z:0},target:{x:1,y:0,z:0}}));p.step(.1);const previous=old.physicsHost.world,shots=p.getProjectiles(),snapshot=old.snapshot();let handedOff=false;
  await assert.rejects(createStructuralSimulation(createDenseFixture(source),{compactSupportFactory:async()=>{await Promise.resolve();throw new Error('invalid manifest');},beforeWorldCreate:()=>{handedOff=true;old.dispose();}}),/invalid manifest/);
  assert.equal(handedOff,false);assert.equal(old.physicsHost.world,previous);assert.deepEqual(p.getProjectiles(),shots);assert.deepEqual(old.snapshot(),snapshot);assert.ok(old.pending()>0);
 }finally{p.dispose();old.dispose();}
});
