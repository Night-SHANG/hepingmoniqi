import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createStructuralGameWorld} from '../structural/game-world.js';
import {createProjectilePhysics} from '../physics.js';
import {createCompactSupport} from './support/index.js';
import type {CompactAuthorityStore} from './store.js';
import type {Loadout} from '../contracts.js';

const stock=(charge=6):Loadout=>({charge,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0});
const support=async(store:CompactAuthorityStore)=>createCompactSupport(store,{
 artifactBytes:await readFile(new URL(`./support/assets/${store.fixture.map}-seed-11.bin`,import.meta.url)),
 expectation:JSON.parse(await readFile(new URL(`./support/assets/${store.fixture.map}-seed-11.manifest.json`,import.meta.url),'utf8')),
});
const invalidSupport=async(store:CompactAuthorityStore)=>createCompactSupport(store,{
 artifactBytes:(await readFile(new URL(`./support/assets/${store.fixture.map}-seed-11.bin`,import.meta.url))).subarray(0,32),
 expectation:JSON.parse(await readFile(new URL(`./support/assets/${store.fixture.map}-seed-11.manifest.json`,import.meta.url),'utf8')),
});
const world=(free=false)=>createStructuralGameWorld({free,compactSupportFactory:support});
const port=(w:ReturnType<typeof world>)=>{
 assert.equal(typeof w.getRenderBinding,'function','the game must expose sparse renderer queries instead of a full-world array');
 const binding=w.getRenderBinding();assert.ok(binding);return binding;
};
const finish=(w:ReturnType<typeof world>)=>{for(let i=0;i<2400&&w.pending();i++)w.step(1/120);assert.equal(w.pending(),0);};

test('actual game starts with zero mutable cells and earns fractional objective research before destruction',async()=>{
 const w=world();try{
  assert.equal(typeof w.getRenderBinding,'function');assert.equal(w.getRenderBinding(),null);
  assert.ok(await w.startRound('courtyard',stock()));const binding=port(w);
  assert.equal(binding.fixture.kind,'compact-fixture');assert.equal(binding.diagnostics().mutableStates,0);
  assert.equal(binding.fixture.diagnostics().retainedCellObjects,0);
  const target=w.getVoxel(360)!;assert.equal(target.group,'house');const before=target.hp;
  const result=w.damage({id:'partial',epoch:w.epoch,target:target.position,weapon:'charge',power:.01});
  assert.ok(result.accepted);assert.equal(result.newlyDestroyed,0);assert.equal(result.removed.length,0);assert.equal(result.detached.length,0);
  assert.ok(w.getVoxel(360)!.hp<before);assert.equal(w.getVoxel(360)!.structuralState,'static');assert.equal(w.getResearch(),1);
  assert.ok(binding.diagnostics().mutableStates<20);assert.ok(binding.changedCells().length<20);
  assert.equal(w.getSnapshot().totalCount,binding.fixture.count);assert.deepEqual(w.getSnapshot().voxels,[]);
 }finally{w.suspend();}
});

test('compact free play cannot spend stock or mutate suspended main progress',async()=>{
 const main=world(),free=world(true);try{
  await main.startRound('courtyard',stock());main.recordShot('charge');main.damage({id:'main-partial',epoch:main.epoch,target:main.getVoxel(360)!.position,weapon:'charge',power:.01});main.suspend();const preserved=main.getSnapshot();
  await free.restore(preserved);const binding=port(free),inventory=free.getRound(),research=free.getResearch();
  assert.ok(free.recordShot('charge'));assert.ok(free.recordShot('charge'));assert.deepEqual(free.getRound(),inventory);
  free.damage({id:'free',epoch:free.epoch,target:free.getVoxel(360)!.position,weapon:'charge',power:1});finish(free);
  assert.equal(free.getResearch(),research);assert.deepEqual(main.getSnapshot(),preserved);assert.ok(binding.changedCells().length>0);
  const freeSave=free.getSnapshot();assert.equal(await main.restore(freeSave),false);assert.deepEqual(main.getSnapshot(),preserved);
 }finally{main.suspend();free.suspend();}
});

test('compact retry preserves spent inventory, duplicate damage and settled state',async()=>{
 const w=world();try{
  await w.startRound('courtyard',stock(2));port(w);assert.ok(w.recordShot('charge'));
  const command={id:'once',epoch:w.epoch,target:w.getVoxel(360)!.position,weapon:'charge' as const,power:.01};
  assert.ok(w.damage(command).accepted);const research=w.getResearch();assert.equal(w.damage(command).accepted,false);assert.equal(w.getResearch(),research);assert.equal(w.getRound().remaining!.charge,1);
  const saved=w.getSnapshot();await w.reset();assert.ok(await w.restore(saved));assert.equal(w.getRound().remaining!.charge,1);
  assert.equal(w.damage({...command,epoch:w.epoch}).accepted,false);finish(w);w.finishRound();const settled=w.getSnapshot();
  assert.equal(w.recordShot('charge'),false);assert.equal(w.damage({...command,id:'late',epoch:w.epoch}).accepted,false);w.step(1);assert.deepEqual(w.getSnapshot(),settled);
 }finally{w.suspend();}
});

test('compact schema9 JSON save roundtrips sparse cells and rejects bad cross-map restore with armed work intact',async()=>{
 const source=world(),target=world();let projectile:Awaited<ReturnType<typeof createProjectilePhysics>>|undefined;
 try{
  await source.loadMap('warehouse',true);port(source);const bad=source.getSnapshot();source.suspend();(bad.structural as any).simulation.accumulator=-1;
  await target.startRound('courtyard',stock());const binding=port(target);target.recordShot('charge');
  target.damage({id:'cut',epoch:target.epoch,target:{x:0,y:-1,z:0},weapon:'shock',power:1});target.step(.2);
  const saved=JSON.parse(JSON.stringify(target.getSnapshot())),changed=binding.changedCells(),round=target.getRound();
  assert.equal(saved.schemaVersion,9);assert.equal(saved.structural.simulation.schema,'structural-simulation/v1');assert.ok(saved.structural.simulation.changes.length<saved.totalCount);assert.equal('fixtureSignature' in saved.structural.simulation,false);
  await target.reset();assert.ok(await target.restore(saved));assert.deepEqual(port(target).changedCells(),changed);assert.deepEqual(target.getRound(),round);
  projectile=await createProjectilePhysics({host:target.physicsHost!});
  assert.ok(projectile.launch({id:'armed',epoch:target.epoch,weapon:'charge',power:1,trigger:'remote',origin:{x:20,y:20,z:0},target:{x:20,y:0,z:0}}));
  assert.throws(()=>target.finishRound(),/pending|settle|active|work/i);
  const epoch=target.epoch,host=target.physicsHost!.world,before=target.getSnapshot(),shots=projectile.getProjectiles();
  assert.equal(await target.restore(bad),false);assert.equal(target.epoch,epoch);assert.equal(target.physicsHost!.world,host);assert.deepEqual(target.getSnapshot(),before);assert.deepEqual(projectile.getProjectiles(),shots);
 }finally{projectile?.dispose();source.suspend();target.suspend();}
});

test('compact reward exclusion survives sparse suspend, restore and secondary work',async()=>{
 const w=world();try{
  await w.startRound('courtyard',stock());port(w);
  w.damage({id:'soil',epoch:w.epoch,target:{x:20,y:-1,z:0},weapon:'charge',power:.01});assert.equal(w.getResearch(),0);
  w.damage({id:'no-reward',epoch:w.epoch,target:{x:0,y:-1,z:0},weapon:'shock',power:2,reward:false});w.step(.2);
  const saved=w.getSnapshot();w.suspend();await w.activate();assert.equal(w.getResearch(),0);assert.ok(await w.restore(saved));finish(w);assert.equal(w.getResearch(),0);
 }finally{w.suspend();}
});

test('pose-only physics steps keep gameplay revision and metadata allocation stable while reads retain current poses',async()=>{
 const w=world();let restoreOriginal:(()=>void)|undefined;
 try{
  await w.loadMap('tower',true);const binding=port(w);
  w.damage({id:'falling',epoch:w.epoch,target:{x:0,y:10,z:0},weapon:'shock',power:1});
  const moving=binding.movingViews()[0];assert.ok(moving);const initial=w.getVoxel(moving.id)!;
  const original=binding.fixture.original.bind(binding.fixture);let metadataReads=0;
  binding.fixture.original=id=>{metadataReads++;return original(id);};restoreOriginal=()=>{binding.fixture.original=original;};
  let pureSteps=0;
  for(let i=0;i<12;i++){
   const cursor=binding.revision,revision=w.revision;metadataReads=0;w.step(1/120);
   const edits=binding.changesSince(cursor).edits;
   if(edits.length&&edits.every(edit=>!edit.appearanceChanged)){
    pureSteps++;assert.equal(w.revision,revision,'Pose-only motion must not rebuild gameplay voxel caches');
    assert.equal(metadataReads,0,'Pose-only motion must not compose immutable source metadata for gameplay');
   }
  }
  assert.ok(pureSteps>=3);restoreOriginal();restoreOriginal=undefined;
  const current=w.getVoxel(moving.id)!;assert.notDeepEqual(current.position,initial.position);
  assert.deepEqual(current.position,binding.cell(moving.id)!.position);assert.deepEqual(current.rotation,binding.cell(moving.id)!.rotation);
  const diagnostic=w.getVoxels().find(v=>v.id===moving.id)!;assert.deepEqual(diagnostic,current);
  const saved=w.getSnapshot();w.suspend();assert.deepEqual(w.getVoxel(moving.id),current);assert.deepEqual(w.getVoxels().find(v=>v.id===moving.id),current);
  await w.activate();assert.deepEqual(w.getVoxel(moving.id),current);assert.ok(await w.restore(saved));assert.deepEqual(w.getVoxel(moving.id),current);
 }finally{restoreOriginal?.();w.suspend();}
});

test('damage returns a removed moving voxel at its current pre-hit pose without a full-world transaction snapshot',async()=>{
 const w=world();try{
  await w.loadMap('tower',true);const binding=port(w);
  w.damage({id:'release',epoch:w.epoch,target:{x:0,y:10,z:0},weapon:'shock',power:1});
  const target=binding.movingViews().find(v=>v.hp<24)!;assert.ok(target);w.step(.1);
  const before=w.getVoxel(target.id)!;assert.notDeepEqual(before.position,target.position);
  const result=w.damage({id:'moving-hit',epoch:w.epoch,target:before.position,weapon:'charge',power:3});
  assert.ok(result.accepted);assert.deepEqual(result.removed.find(v=>v.id===target.id),before);assert.equal(w.getVoxel(target.id),null);
 }finally{w.suspend();}
});

test('invalid support during activation leaves the current armed native world intact until a validated handoff',async()=>{
 const current=world();let reject=true,projectile:Awaited<ReturnType<typeof createProjectilePhysics>>|undefined;
 const candidate=createStructuralGameWorld({compactSupportFactory:store=>reject?invalidSupport(store):support(store)});
 try{
  await current.startRound('courtyard',stock());projectile=await createProjectilePhysics({host:current.physicsHost!});
  assert.ok(projectile.launch({id:'keep-armed',epoch:current.epoch,weapon:'charge',power:1,trigger:'remote',origin:{x:20,y:20,z:0},target:{x:20,y:0,z:0}}));
  const host=current.physicsHost!,native=host.world,epoch=current.epoch,saved=current.getSnapshot(),shots=projectile.getProjectiles();
  await assert.rejects(candidate.activate());assert.equal(candidate.physicsHost,null);assert.equal(current.physicsHost,host);assert.equal(current.physicsHost!.world,native);assert.equal(current.epoch,epoch);assert.deepEqual(current.getSnapshot(),saved);assert.deepEqual(projectile.getProjectiles(),shots);
  reject=false;await candidate.activate();assert.ok(candidate.physicsHost);assert.equal(current.physicsHost,null);
 }finally{projectile?.dispose();candidate.suspend();current.suspend();}
});

test('invalid support during a validated cross-map restore cannot suspend the armed current world',async()=>{
 const source=world(),current=createStructuralGameWorld({compactSupportFactory:store=>store.fixture.map==='warehouse'?invalidSupport(store):support(store)});let projectile:Awaited<ReturnType<typeof createProjectilePhysics>>|undefined;
 try{
  await source.loadMap('warehouse',true);const foreign=source.getSnapshot();source.suspend();
  await current.startRound('courtyard',stock());projectile=await createProjectilePhysics({host:current.physicsHost!});
  assert.ok(projectile.launch({id:'keep-restore-armed',epoch:current.epoch,weapon:'charge',power:1,trigger:'remote',origin:{x:20,y:20,z:0},target:{x:20,y:0,z:0}}));
  const host=current.physicsHost!,native=host.world,epoch=current.epoch,saved=current.getSnapshot(),shots=projectile.getProjectiles();
  await assert.rejects(current.restore(foreign));assert.equal(current.physicsHost,host);assert.equal(current.physicsHost!.world,native);assert.equal(current.epoch,epoch);assert.deepEqual(current.getSnapshot(),saved);assert.deepEqual(projectile.getProjectiles(),shots);
 }finally{projectile?.dispose();source.suspend();current.suspend();}
});
