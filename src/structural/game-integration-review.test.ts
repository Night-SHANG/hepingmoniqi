import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStructuralGameWorld} from './game-world.js';
import {createProjectilePhysics} from '../physics.js';
import {createWorld} from '../domain.js';
import type {Loadout} from '../contracts.js';
const stock=(charge=2):Loadout=>({charge,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0});
const legacy=()=>{const s=createWorld().getSnapshot();s.research=1400;return s;};

test('independent formal: lazy metadata does not allocate physics; activating another adapter releases the first world',async()=>{
 const main=createStructuralGameWorld(),free=createStructuralGameWorld({free:true});
 try{
  assert.equal(main.physicsHost,null);main.getSnapshot();main.getVoxels();main.getObjective();assert.equal(main.physicsHost,null);
  await main.activate();assert.ok(main.physicsHost);await free.activate();assert.ok(free.physicsHost);assert.equal(main.physicsHost,null,'Only one live Rapier authority may remain');
  await main.activate();assert.ok(main.physicsHost);assert.equal(free.physicsHost,null);
 }finally{main.suspend();free.suspend();}
});

test('independent formal: legacy migration keeps research and stock but requires an explicit new round',async()=>{
 const w=createStructuralGameWorld();try{
  const old=legacy();assert.ok(await w.restore(old));assert.equal(w.getSnapshot().research,1400);assert.deepEqual(w.getRound(),old.round);assert.ok(w.migrationPending);
  assert.equal(w.recordShot('charge'),false);assert.equal(w.damage({id:'before-migration',epoch:w.epoch,weapon:'charge',power:1,target:{x:0,y:0,z:0}}).accepted,false);
  assert.ok(await w.startRound('courtyard',stock()));assert.equal(w.migrationPending,false);assert.ok(w.recordShot('charge'));assert.equal(w.getRound().remaining!.charge,1);assert.equal(w.getRound().used,1);
 }finally{w.suspend();}
});

test('independent formal: free shots and destruction do not spend stock or mutate the suspended main save',async()=>{
 const main=createStructuralGameWorld(),free=createStructuralGameWorld({free:true});try{
  await main.restore(legacy());await main.startRound('courtyard',stock());main.recordShot('charge');main.suspend();const preserved=main.getSnapshot();
  await free.restore(legacy());await free.startRound('courtyard',stock());const inventory=free.getRound().remaining,rp=free.getSnapshot().research;
  for(let i=0;i<3;i++)assert.ok(free.recordShot('charge'));assert.deepEqual(free.getRound().remaining,inventory);
  const target=free.getVoxels().find(v=>v.role==='building'||v.role==='foundation')!;assert.ok(target);
  assert.ok(free.damage({id:'free-damage',epoch:free.epoch,weapon:'charge',power:1,target:target.position}).accepted);
  for(let i=0;i<600;i++)free.step(1/120);
  assert.equal(free.getSnapshot().research,rp);assert.deepEqual(main.getSnapshot(),preserved);
 }finally{main.suspend();free.suspend();}
});

test('independent formal: actual shared grenade changes terrain only at detonation and saved crater survives restore',async()=>{
 const w=createStructuralGameWorld();let p:Awaited<ReturnType<typeof createProjectilePhysics>>|undefined;
 try{
  await w.startRound('courtyard',stock());const initial=w.getVoxels();
  const tops=new Map<string,(typeof initial)[number]>();for(const v of initial){const key=`${v.position.x},${v.position.z}`;if(!tops.has(key)||tops.get(key)!.position.y<v.position.y)tops.set(key,v);}
  const soil=[...tops.values()].find(v=>v.role==='terrain');assert.ok(soil,'Fixture needs exposed destructible soil');
  const before=structuredClone(w.getVoxels());const events:string[]=[];
  p=await createProjectilePhysics({host:w.physicsHost!,onDetonation:e=>{events.push(e.id);w.damage({id:e.id,epoch:e.epoch,weapon:e.weapon,power:e.power,target:e.position});}});
  assert.ok(w.recordShot('charge'));assert.ok(p.launch({id:'actual-grenade',epoch:w.epoch,weapon:'charge',power:1,origin:{...soil.position,y:soil.position.y+7},target:soil.position}));
  assert.deepEqual(w.getVoxels(),before,'Launch cannot damage terrain');assert.throws(()=>w.finishRound(),/pending|settle|active|work/i);
  p.step(1);assert.equal(events.length,0);p.step(1);assert.equal(events.length,0);p.step(1);assert.deepEqual(events,['actual-grenade']);
  const after=w.getVoxels();assert.ok(after.length<before.length||after.some(v=>v.hp<(before.find(b=>b.id===v.id)?.hp??0)));
  assert.ok(after.some(v=>v.role==='terrain'&&v.position.y<soil.position.y-2),'A thick finite crater floor must remain');
  p.dispose();p=undefined;const saved=w.getSnapshot(),savedVoxels=structuredClone(w.getVoxels()),oldEpoch=w.epoch;
  await w.reset();assert.ok(w.epoch>oldEpoch);assert.ok(await w.restore(saved));assert.deepEqual(w.getVoxels(),savedVoxels);assert.equal(w.getSnapshot().research,saved.research);
  assert.equal(w.damage({id:'stale-after-restore',epoch:oldEpoch,weapon:'charge',power:1,target:soil.position}).accepted,false);
 }finally{p?.dispose();w.suspend();}
});

test('independent formal: invalid cross-map physical save cannot replace the current epoch or cancel armed work',async()=>{
 const source=createStructuralGameWorld(),target=createStructuralGameWorld();let p:Awaited<ReturnType<typeof createProjectilePhysics>>|undefined;
 try{
  await source.loadMap('warehouse',true);const bad=source.getSnapshot();source.suspend();
  (bad.structural as any).simulation.accumulator=-1;
  await target.startRound('courtyard',stock());p=await createProjectilePhysics({host:target.physicsHost!});
  assert.ok(p.launch({id:'must-survive-bad-load',epoch:target.epoch,weapon:'charge',power:1,trigger:'remote',origin:{x:0,y:20,z:0},target:{x:0,y:0,z:0}}));
  const epoch=target.epoch,before=p.getProjectiles(),round=target.getRound();
  assert.equal(await target.restore(bad),false);assert.equal(target.epoch,epoch,'Invalid foreign-map save must not change epoch');assert.deepEqual(p.getProjectiles(),before,'Invalid load must not cancel armed work');assert.deepEqual(target.getRound(),round);
 }finally{p?.dispose();target.suspend();source.suspend();}
});

test('independent formal: native-proven courtyard UI rocket trajectory damages the selected soil column',async()=>{
 const THREE=await import('three'),{getEnvironmentSpec}=await import('../scene-environments.js'),{getSceneLaunchOrigin}=await import('../scene.js');
 const w=createStructuralGameWorld();let p:Awaited<ReturnType<typeof createProjectilePhysics>>|undefined;
 try{
  await w.restore(legacy());await w.startRound('courtyard',{...stock(0),pulse:1});
  const soil=w.getVoxel(-1383)!;assert.equal(soil.role,'terrain');const env=getEnvironmentSpec('courtyard',{authoritative:true});
  const camera=new THREE.PerspectiveCamera(42,1440/900,env.camera.near,env.camera.far);camera.position.set(...env.camera.position);camera.lookAt(new THREE.Vector3(...env.camera.target));camera.updateMatrixWorld();
  const target={...soil.position,y:soil.position.y+.5},origin=getSceneLaunchOrigin(camera,target);let hits=0;
  const soilHP=()=>w.getVoxels().filter(v=>v.role==='terrain').reduce((sum,v)=>sum+v.hp,0),before=soilHP();
  p=await createProjectilePhysics({host:w.physicsHost!,onDetonation:e=>{hits++;w.damage({id:e.id,epoch:e.epoch,target:e.position,weapon:e.weapon,power:e.power});}});
  assert.ok(w.recordShot('pulse'));assert.ok(p.launch({id:'ui-rocket-soil',epoch:w.epoch,origin,target,weapon:'pulse',power:1}));
  for(let i=0;i<480&&!hits;i++)p.step(1/120);assert.equal(hits,1);assert.ok(soilHP()<before,'A real camera-launched rocket must damage soil rather than miss or hit only a roof');
 }finally{p?.dispose();w.suspend();}
});

test('independent formal: progression may seed free mode but a free-mode save cannot overwrite main mode',async()=>{
 const main=createStructuralGameWorld(),free=createStructuralGameWorld({free:true});
 try{
  await main.restore(legacy());await main.startRound('courtyard',stock());const mainSave=main.getSnapshot();
  assert.ok(await free.restore(mainSave));assert.equal(free.getResearch(),1400);
  const target=free.getVoxels().find(v=>v.role==='building')!;assert.ok(free.damage({id:'unlimited-destruction',epoch:free.epoch,weapon:'nova',power:1,target:target.position}).accepted);
  const freeSave=free.getSnapshot();free.suspend();await main.activate();const before=main.getSnapshot(),epoch=main.epoch;
  assert.equal(await main.restore(freeSave),false,'Unlimited free-mode scene must not become main-mode progress');assert.equal(main.epoch,epoch);assert.deepEqual(main.getSnapshot(),before);
 }finally{main.suspend();free.suspend();}
});

test('independent formal: real camera grenade at the browser roof target earns research before settlement',async()=>{
 const THREE=await import('three'),{getEnvironmentSpec}=await import('../scene-environments.js'),{getSceneLaunchOrigin}=await import('../scene.js');
 const w=createStructuralGameWorld();let p:Awaited<ReturnType<typeof createProjectilePhysics>>|undefined;
 try{
  await w.restore(legacy());await w.startRound('courtyard',stock());const roof=w.getVoxel(803)!;assert.equal(roof.group,'house');const spec=getEnvironmentSpec('courtyard',{authoritative:true});
  const camera=new THREE.PerspectiveCamera(42,1440/900,spec.camera.near,spec.camera.far);camera.position.set(...spec.camera.position);camera.lookAt(new THREE.Vector3(...spec.camera.target));camera.updateMatrixWorld();
  const target={...roof.position,y:roof.position.y+.5};p=await createProjectilePhysics({host:w.physicsHost!,onDetonation:e=>w.damage({id:e.id,epoch:e.epoch,target:e.position,weapon:e.weapon,power:e.power})});
  w.recordShot('charge');assert.ok(p.launch({id:'main-ui-grenade',epoch:w.epoch,origin:getSceneLaunchOrigin(camera,target),target,weapon:'charge',power:1}));
  for(let i=0;i<1800&&w.pending();i++)p.step(1/120);assert.equal(w.pending(),0);assert.ok(w.getResearch()>1400);assert.ok(w.finishRound().researchEarned>0);
 }finally{p?.dispose();w.suspend();}
});
