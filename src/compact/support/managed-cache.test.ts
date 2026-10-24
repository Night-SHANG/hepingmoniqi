import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getManagedCompactGameFixture,isManagedCompactFixture} from '../managed-fixture.js';
import {createCompactGameFixture,createDenseFixture} from '../fixture.js';
import {CompactAuthorityStore} from '../store.js';
import {createStructuralGameWorld} from '../../structural/game-world.js';
import type {MapId,Loadout} from '../../contracts.js';
import type {CompactSupportOptions} from './index.js';
import {CompactSupportLattice} from './lattice.js';
import {IndexedStructure} from './indexed-structure.js';
import {encodePristine} from './node-codec.js';

// Isolate loader namespaces without mutating the suite's registered host loader.
let namespace=0;
const freshApi=async():Promise<typeof import('./index.js')>=>import(new URL(`./index.ts?managed-cache-${namespace++}`,import.meta.url).href);
const artifact=async(map:MapId):Promise<CompactSupportOptions>=>({artifactBytes:await readFile(new URL(`./assets/${map}-seed-11.bin`,import.meta.url)),expectation:JSON.parse(await readFile(new URL(`./assets/${map}-seed-11.manifest.json`,import.meta.url),'utf8'))});
const stock:Loadout={charge:6,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0};

test('managed cold validation runs once; concurrent and warm graphs own independent live cuts and store-specific resets',async t=>{
 const api=await freshApi(),fixture=getManagedCompactGameFixture('courtyard'),first=new CompactAuthorityStore(fixture),second=new CompactAuthorityStore(fixture);let loads=0,hashes=0;
 const digest=crypto.subtle.digest.bind(crypto.subtle);t.mock.method(crypto.subtle,'digest',(...args:Parameters<typeof digest>)=>{hashes++;return digest(...args);});
 const cleanup=api.configureCompactSupportAssetLoader(async map=>{loads++;return artifact(map);});
 try{
  const [a,b]=await Promise.all([api.createCompactSupport(first),api.createCompactSupport(second)]);
  assert.equal(loads,1,'concurrent requests must coalesce before loading');assert.ok(hashes>=6,'cold path must still execute native digest validation');
  const coldHashes=hashes,c=await api.createCompactSupport(new CompactAuthorityStore(fixture));assert.equal(hashes,coldHashes,'warm hydration must not repeat validation');assert.equal(loads,1);
  const id=fixture.idAt(0,-1,0)!,before=b.diagnostics().liveMembers;a.remove([id]);assert.equal(a.diagnostics().liveMembers,before-1);assert.equal(b.diagnostics().liveMembers,before);assert.equal(c.diagnostics().liveMembers,before);
  const row=first.writable(id)!;row.state='gone';first.markChanged(id);a.reset();b.reset();assert.equal(a.diagnostics().liveMembers,before-1);assert.equal(b.diagnostics().liveMembers,before);
  first.reset();a.reset();assert.equal(a.diagnostics().liveMembers,before);b.remove([id]);a.reset();assert.equal(a.diagnostics().liveMembers,before);assert.equal(b.diagnostics().liveMembers,before-1);
  a.dispose();b.reset();assert.equal(b.diagnostics().liveMembers,before);b.dispose();c.dispose();
 }finally{cleanup();}
});

test('explicit artifacts always revalidate after a managed cache hit and never poison the validated baseline',async()=>{
 const api=await freshApi(),fixture=getManagedCompactGameFixture('courtyard'),store=new CompactAuthorityStore(fixture);let loads=0;
 const cleanup=api.configureCompactSupportAssetLoader(async map=>{loads++;return artifact(map);});
 try{
  (await api.createCompactSupport(store)).dispose();const good=await artifact('courtyard'),bad=new Uint8Array(good.artifactBytes);bad[bad.length-1]^=255;
  await assert.rejects(api.createCompactSupport(store,{...good,artifactBytes:bad}),/digest|payload/i);
  await assert.rejects(api.createCompactSupport(store,{...good,expectation:{...good.expectation,mapId:'warehouse'}}),/map/i);
  const warm=await api.createCompactSupport(store);assert.equal(loads,1);assert.equal(warm.diagnostics().liveMembers,fixture.count);warm.dispose();
 }finally{cleanup();}
});

test('fresh, proxied and dense fixtures do not gain managed cache privilege from copied metadata',async t=>{
 const api=await freshApi(),managed=getManagedCompactGameFixture('courtyard');let loads=0,hashes=0;
 const digest=crypto.subtle.digest.bind(crypto.subtle);t.mock.method(crypto.subtle,'digest',(...args:Parameters<typeof digest>)=>{hashes++;return digest(...args);});
 const cleanup=api.configureCompactSupportAssetLoader(async map=>{loads++;return artifact(map);});
 try{
  for(const fixture of [createCompactGameFixture('courtyard'),new Proxy(managed,{})]){
   const store=new CompactAuthorityStore(fixture);(await api.createCompactSupport(store)).dispose();const before=hashes;(await api.createCompactSupport(store)).dispose();assert.ok(hashes>before);assert.equal(isManagedCompactFixture(fixture),false);
  }
  assert.equal(loads,4);
  const fixture=createDenseFixture({id:'dense-cache-check',cells:[{id:1,objectId:'dense',role:'building',position:{x:0,y:0,z:0},material:'wood',color:1,hp:1,maxHp:1,anchor:true}]}),source=new CompactSupportLattice(fixture),encoded=encodePristine(source,new IndexedStructure(source),{mapId:fixture.id,seed:11,sourceChecksums:{fixture:'a'.repeat(64)}}),options={artifactBytes:encoded.bytes,expectation:encoded.manifest},store=new CompactAuthorityStore(fixture);
  (await api.createCompactSupport(store,options)).dispose();const before=hashes;(await api.createCompactSupport(store,options)).dispose();assert.ok(hashes>before);
 }finally{cleanup();}
});

test('loader cleanup and replacement invalidate validated entries, and rejected promises can be retried',async()=>{
 const api=await freshApi(),fixture=getManagedCompactGameFixture('courtyard'),store=new CompactAuthorityStore(fixture);
 const oldCleanup=api.configureCompactSupportAssetLoader(artifact);(await api.createCompactSupport(store)).dispose();oldCleanup();
 await assert.rejects(api.createCompactSupport(store),/outside the browser/i);
 let calls=0,valid=false;const cleanup=api.configureCompactSupportAssetLoader(async map=>{calls++;const data=await artifact(map);return valid?data:{...data,artifactBytes:new Uint8Array(16)};});
 try{
  oldCleanup();await assert.rejects(api.createCompactSupport(store));assert.equal(calls,1);valid=true;
  const graph=await api.createCompactSupport(store);assert.equal(calls,2);assert.equal(graph.diagnostics().cells,fixture.count);graph.dispose();(await api.createCompactSupport(store)).dispose();assert.equal(calls,2);
 }finally{cleanup();}
});

test('validated support templates retain at most two fixture identities using access-order eviction',async()=>{
 const api=await freshApi(),fixtures=['courtyard','warehouse','tower'].map(map=>getManagedCompactGameFixture(map as MapId)),stores=fixtures.map(f=>new CompactAuthorityStore(f)),calls=new Map<MapId,number>();
 const cleanup=api.configureCompactSupportAssetLoader(async map=>{calls.set(map,(calls.get(map)??0)+1);return artifact(map);});
 const load=async(index:number)=>(await api.createCompactSupport(stores[index])).dispose();
 try{await load(0);await load(1);await load(0);await load(2);await load(0);assert.equal(calls.get('courtyard'),1);await load(1);assert.equal(calls.get('warehouse'),2);}finally{cleanup();}
});

test('an evicted pending validation cannot resurrect a template after it completes',async()=>{
 const api=await freshApi(),fixtures=['courtyard','warehouse','tower'].map(map=>getManagedCompactGameFixture(map as MapId)),stores=fixtures.map(f=>new CompactAuthorityStore(f));let calls=0,release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),cleanup=api.configureCompactSupportAssetLoader(async map=>{if(map==='courtyard'&&++calls===1)await gate;return artifact(map);});
 try{
  const pending=api.createCompactSupport(stores[0]);(await api.createCompactSupport(stores[1])).dispose();(await api.createCompactSupport(stores[2])).dispose();release();(await pending).dispose();
  (await api.createCompactSupport(stores[0])).dispose();assert.equal(calls,2,'pending completion must not restore the evicted cache entry');
 }finally{release();cleanup();}
});

test('pending completions from a retired loader namespace cannot hide a replacement loader rejection',async()=>{
 const api=await freshApi(),fixture=getManagedCompactGameFixture('courtyard'),store=new CompactAuthorityStore(fixture);let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),cleanup=api.configureCompactSupportAssetLoader(async map=>{await gate;return artifact(map);});
 const pending=api.createCompactSupport(store);cleanup();let calls=0;const replacement=api.configureCompactSupportAssetLoader(async()=>{calls++;throw new Error('replacement missing artifact');});
 try{release();(await pending).dispose();await assert.rejects(api.createCompactSupport(store),/replacement missing artifact/);await assert.rejects(api.createCompactSupport(store),/replacement missing artifact/);assert.equal(calls,2);}finally{release();replacement();}
});

test('managed damaged retry and free-play restore share only pristine fixture/support data',async()=>{
 const api=await freshApi();let loads=0;const cleanup=api.configureCompactSupportAssetLoader(async map=>{loads++;return artifact(map);});
 const main=createStructuralGameWorld({compactSupportFactory:api.createCompactSupport}),free=createStructuralGameWorld({free:true,compactSupportFactory:api.createCompactSupport});
 try{
  await main.startRound('courtyard',stock);const original=main.getRenderBinding()!.fixture;assert.ok(isManagedCompactFixture(original));main.recordShot('charge');
  main.damage({id:'managed-damage',epoch:main.epoch,target:main.getVoxel(360)!.position,weapon:'charge',power:.01});const saved=main.getSnapshot();main.suspend();
  assert.ok(await free.restore(saved));assert.equal(free.getRenderBinding()!.fixture,original);free.damage({id:'free-damage',epoch:free.epoch,target:free.getVoxel(360)!.position,weapon:'charge',power:1});assert.deepEqual(main.getSnapshot(),saved);
  free.suspend();assert.ok(await main.restore(saved));assert.equal(main.getRenderBinding()!.fixture,original);assert.equal(main.getRound().remaining!.charge,5);assert.deepEqual((main.getSnapshot().structural as any).simulation.changes,(saved.structural as any).simulation.changes);assert.equal(main.getResearch(),saved.research);assert.equal(loads,1);
 }finally{main.suspend();free.suspend();cleanup();}
});

test('missing, wrong-map and corrupt first-load artifacts reject before replacing the active world',async()=>{
 const api=await freshApi();let mode='missing';const cleanup=api.configureCompactSupportAssetLoader(async map=>{if(map==='warehouse'){if(mode==='missing')throw new Error('missing asset');if(mode==='wrong')return artifact('tower');if(mode==='corrupt'){const value=await artifact(map);return {...value,artifactBytes:new Uint8Array(16)};}}return artifact(map);});
 const current=createStructuralGameWorld({compactSupportFactory:api.createCompactSupport}),candidate=createStructuralGameWorld({compactSupportFactory:api.createCompactSupport});
 try{
  await current.startRound('courtyard',stock);const host=current.physicsHost!,native=host.world,saved=current.getSnapshot();
  for(mode of ['missing','wrong','corrupt']){await assert.rejects(candidate.loadMap('warehouse',true));assert.equal(current.physicsHost,host);assert.equal(host.world,native);assert.deepEqual(current.getSnapshot(),saved);assert.equal(candidate.physicsHost,null);}
  mode='valid';assert.ok(await candidate.loadMap('warehouse',true));assert.ok(candidate.physicsHost);assert.equal(current.physicsHost,null);
 }finally{current.suspend();candidate.suspend();cleanup();}
});
