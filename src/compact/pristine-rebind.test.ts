import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as sources from './surface-source.js';
import {createCompactSurfaceRenderer} from './surface-renderer.js';
import {CompactAuthorityStore} from './store.js';
import {createCompactGameFixture,type CompactFixture} from './fixture.js';
import type {MapId} from '../contracts.js';

async function managed(map:MapId='courtyard'):Promise<CompactFixture>{
 const path='./managed-fixture.js';
 return (await import(path)).getManagedCompactGameFixture(map);
}
function queries(store:CompactAuthorityStore,generation=()=>1){
 assert.equal(typeof sources.createCompactQuerySource,'function','only a privately registered authority source can prove pristine state');
 return sources.createCompactQuerySource(store,generation);
}
const source=(store:CompactAuthorityStore)=>sources.createCompactSurfaceSource(queries(store));
function renderer(){
 const scene=new THREE.Scene(),box=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),render=createCompactSurfaceRenderer(scene,box,material,{chunkSize:32});
 return {scene,render,dispose(){render.dispose();box.dispose();material.dispose();}};
}
const meshes=(r:ReturnType<typeof renderer>)=>r.render.group.children.map(mesh=>mesh as THREE.Mesh);
const visibleId=(fixture:CompactFixture)=>fixture.idAt(fixture.bounds.maxX,-1,fixture.bounds.maxZ)!;
function firstHit(r:ReturnType<typeof renderer>,fixture:CompactFixture){
 r.scene.updateMatrixWorld(true);
 return new THREE.Raycaster(new THREE.Vector3(fixture.bounds.maxX,20,fixture.bounds.maxZ),new THREE.Vector3(0,-1,0)).intersectObjects(r.render.raycastObjects,true)[0];
}

// Removing the trusted-source registration or keeping the unconditional full bind
// must fail before there is any geometry reuse or authority replacement.
test('pristine authority handoff retains exact meshes and buffers with no geometry work',async()=>{
 const factory=sources.createCompactQuerySource;assert.equal(typeof factory,'function','trusted query-source factory is required');
 const fixture=await managed(),old=new CompactAuthorityStore(fixture),next=new CompactAuthorityStore(fixture),r=renderer();
 try{
  r.render.bind(source(old));const previous=meshes(r),geometry=previous.map(mesh=>mesh.geometry),buffers=geometry.map(g=>[g.getAttribute('position').array,g.getAttribute('normal').array,g.getAttribute('color').array]);
  const hit=firstHit(r,fixture),id=visibleId(fixture);assert.equal(r.render.resolveIntersection(hit)?.voxelId,id);
  const before=new THREE.BufferGeometry(),report=r.render.bind(source(next)),after=new THREE.BufferGeometry();
  assert.equal(report.chunks,0,'a pristine same-fixture handoff must not rebuild static chunks');assert.equal(report.colorChunks,0);assert.equal(report.queriedCells,0);assert.equal(report.outputBytes,0);assert.equal(report.peakTemporaryBytes,0);assert.equal(after.id,before.id+1,'no new geometry object may be allocated');before.dispose();after.dispose();
  assert.deepEqual(meshes(r),previous);for(let i=0;i<previous.length;i++){assert.equal(previous[i].geometry,geometry[i]);assert.deepEqual([geometry[i].getAttribute('position').array,geometry[i].getAttribute('normal').array,geometry[i].getAttribute('color').array],buffers[i]);}
  assert.equal(r.render.resolveIntersection(hit)?.voxelId,id);
  const retained=old.read(id)!;old.writable(id)!.state='gone';old.markChanged(id);
  assert.equal(r.render.resolveIntersection(hit)?.voxelId,id,'old authority mutation cannot affect new hit resolution');
  const nextRow=next.writable(id)!;nextRow.state='gone';next.markChanged(id);
  assert.equal(r.render.resolveIntersection(hit),null,'all reused faces must query the replacement authority');assert.equal(retained.state,'static');assert.equal(old.read(id)!.state,'gone');
 }finally{r.dispose();}
});

test('incoming zero writable records is required, not revision, aggregate loss or a borrowed fixture',async()=>{
 const fixture=await managed(),id=visibleId(fixture),r=renderer();
 try{
  for(const change of ['writable','unpublished-damage','partial-damage','structural-damage','detached','rubble'] as const){
   const editedId=change==='structural-damage'?fixture.idAtOrdinal(0)!:id;
   r.render.bind(source(new CompactAuthorityStore(fixture)));const previous=meshes(r)[0],incoming=new CompactAuthorityStore(fixture),row=incoming.writable(editedId)!;
   if(change==='unpublished-damage'||change==='partial-damage'||change==='structural-damage')row.hp/=2;
   if(change==='partial-damage'||change==='structural-damage'){row.loss=row.spec.hp-row.hp;incoming.markChanged(editedId);}
   if(change==='detached'||change==='rubble'){row.state=change==='detached'?'dynamic':'rubble';incoming.markChanged(id);}
   assert.equal(incoming.diagnostics().mutableStates,1);if(change==='writable'||change==='unpublished-damage')assert.equal(incoming.revision,0);
   if(change==='structural-damage')assert.ok(incoming.aggregate().loss>0&&row.hp>0);else assert.equal(incoming.aggregate().loss,0,'terrain loss cannot prove pristine state');
   assert.ok(r.render.bind(source(incoming)).chunks>0,change);assert.notEqual(meshes(r)[0],previous,change);
  }
 }finally{r.dispose();}
});

test('accepted appearance and topology edits poison the rendered baseline across hidden authority reset',async()=>{
 const fixture=await managed(),id=visibleId(fixture),r=renderer();
 try{
  for(const topology of [false,true])for(const flush of [false,true]){
   const store=new CompactAuthorityStore(fixture);r.render.bind(source(store));const previous=meshes(r),row=store.writable(id)!;
   if(topology)row.state='gone';else row.hp/=2;store.markChanged(id);r.render.applyEdits(store.changesSince(0).edits);if(flush)r.render.flush();
   store.reset();assert.equal(store.diagnostics().mutableStates,0);
   const beforeReset=meshes(r);assert.ok(r.render.bind(source(store)).chunks>0,'old store reset must not certify already modified meshes');
   assert.notEqual(meshes(r)[0],beforeReset[0]);assert.equal(r.render.resolveIntersection(firstHit(r,fixture))?.voxelId,id);assert.ok(previous.length>0);
   assert.equal(r.render.bind(source(new CompactAuthorityStore(fixture))).chunks,0,'real pristine rebuild restores the reuse baseline');
  }
 }finally{r.dispose();}
});

test('moving state poisons the baseline even after its sparse pool is cleared',async()=>{
 const fixture=await managed(),store=new CompactAuthorityStore(fixture),r=renderer(),id=visibleId(fixture),cell=store.read(id)!;
 try{
  r.render.bind(source(store));r.render.setMoving([{...cell.spec,hp:cell.hp,state:'rubble',position:{x:0,y:10,z:0},rotation:cell.rotation}]);r.render.setMoving([]);
  assert.equal(r.render.getDiagnostics().movingCells,0);assert.ok(r.render.bind(source(new CompactAuthorityStore(fixture))).chunks>0);
  assert.equal(r.render.getDiagnostics().movingCells,0);assert.equal(r.render.getDiagnostics().changedRevisionEntries,0);
 }finally{r.dispose();}
});

test('cross-map, unbranded recipes and forged source facades never reuse trusted geometry',async()=>{
 const fixture=await managed(),r=renderer();
 try{
  const live=new CompactAuthorityStore(fixture),trusted=queries(live);
  const incoming=[
   source(new CompactAuthorityStore(await managed('warehouse'))),
   source(new CompactAuthorityStore(createCompactGameFixture('courtyard'))),
   source(new CompactAuthorityStore(Object.freeze({...fixture}))),
   sources.createCompactSurfaceSource(Object.freeze({...trusted})),
   Object.freeze({...sources.createCompactSurfaceSource(trusted)}),
  ];
  for(const next of incoming){r.render.bind(source(new CompactAuthorityStore(fixture)));const previous=meshes(r)[0];assert.ok(r.render.bind(next).chunks>0);assert.notEqual(meshes(r)[0],previous);}
 }finally{r.dispose();}
});

test('pristine bind clears old revision cursors and rereads trusted mutable-state proof at bind time',async()=>{
 const fixture=await managed(),store=new CompactAuthorityStore(fixture),r=renderer(),id=visibleId(fixture);let generation=41;
 try{
  const port=queries(store,()=>generation);assert.equal(port.generation,41);generation++;assert.equal(port.generation,42);assert.ok(Object.isFrozen(port));
  r.render.bind(sources.createCompactSurfaceSource(port));const incoming=new CompactAuthorityStore(fixture),pending=source(incoming);incoming.writable(id)!.hp/=2;
  assert.ok(r.render.bind(pending).chunks>0,'a once-pristine source cannot cache stale proof');
  incoming.reset();r.render.bind(source(incoming));
  const fresh=new CompactAuthorityStore(fixture);assert.equal(r.render.bind(source(fresh)).chunks,0);
  const row=fresh.writable(id)!;row.hp/=2;fresh.markChanged(id);r.render.applyEdits(fresh.changesSince(0).edits);assert.ok(r.render.flush().colorChunks>0,'revision 1 in the new authority must be applied');
 }finally{r.dispose();}
});

// The sole fake is the unavailable browser/WebGL boundary. Selection preview,
// scene binding, actual game world, support, authority and Three meshes are real.
test('real scene preview to fresh game world reuses surfaces, switches epoch cursors and leaves shadows idle',async()=>{
 const {registerHooks}=await import('node:module'),{createCompactPreview}=await import('./preview.js'),{createStructuralGameWorld}=await import('../structural/game-world.js');
 const globals=['window','document','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','__rebindTestElement','__rebindTestWorld','__rebindTestShadows'];
 const saved=new Map(globals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)])),documentTarget=new EventTarget();
 class Element extends EventTarget {
  style:Record<string,string>={};clientWidth=800;clientHeight=600;ownerDocument=documentTarget;
  getRootNode(){return documentTarget;}setAttribute(){}append(){}remove(){}setPointerCapture(){}releasePointerCapture(){}
  getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}getContext(){return new Proxy({},{get:()=>()=>{}});}
 }
 let frameId=0,now=performance.now();const frames=new Map<number,FrameRequestCallback>();
 Object.assign(globalThis,{window:{devicePixelRatio:1},document:Object.assign(documentTarget,{hidden:false,createElement:()=>new Element()}),ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:(fn:FrameRequestCallback)=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:(id:number)=>frames.delete(id),__rebindTestElement:Element,__rebindTestShadows:0});
 const threeURL=import.meta.resolve('three'),mockURL='data:text/javascript,'+encodeURIComponent(`export * from ${JSON.stringify(threeURL)};export class WebGLRenderer {domElement=new globalThis.__rebindTestElement();shadowMap={};setPixelRatio(){}setSize(){}render(scene){globalThis.__rebindTestWorld=scene;if(this.shadowMap.needsUpdate)globalThis.__rebindTestShadows++;scene.updateMatrixWorld(true);this.shadowMap.needsUpdate=false;}dispose(){}}`);
 const hook=registerHooks({resolve(specifier,context,nextResolve){return specifier==='three'&&context.parentURL?.includes('scene.ts?pristine-rebind')?{url:mockURL,shortCircuit:true}:nextResolve(specifier,context);}});
 const world=createStructuralGameWorld();let api:ReturnType<typeof import('../scene.js')['createScene']>|undefined;
 const tick=()=>{const current=[...frames.values()];frames.clear();now+=16;for(const fn of current)fn(now);};
 const diagnostics=()=>api!.getDiagnostics() as unknown as {renderCount:number;recentRenders:unknown[];voxelRender:ReturnType<ReturnType<typeof createCompactSurfaceRenderer>['getDiagnostics']>};
 const staticMeshes=()=>((globalThis as any).__rebindTestWorld as THREE.Scene).getObjectByName('compact-authoritative-static-surfaces')!.children;
 const shadows=()=>Number((globalThis as any).__rebindTestShadows);
 try{
  const path='../scene.ts?pristine-rebind',module=await import(path) as typeof import('../scene.js');
  api=module.createScene(new Element() as unknown as HTMLElement,{onAim(){}});api.setTimeScale(0);
  const preview=createCompactPreview('courtyard'),retained=preview.cell(360)!;api.setCompactWorld!(preview);
  assert.ok(diagnostics().voxelRender.lastRebuild.chunks>0,'a full bind report must not be overwritten by an immediate empty flush');tick();const before=[...staticMeshes()],initialShadows=shadows(),initialRender=diagnostics().renderCount;
  assert.equal(await world.startRound('courtyard',{charge:6,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0}),true);
  const live=world.getRenderBinding()!;assert.equal(live.fixture,preview.fixture);api.setCompactWorld!(live);
  assert.equal(diagnostics().voxelRender.lastBindReused,true);assert.equal(diagnostics().voxelRender.lastRebuild.chunks,0);assert.deepEqual(staticMeshes(),before);tick();assert.equal(shadows(),initialShadows,'authority-only handoff must not refresh unchanged shadows');assert.equal(diagnostics().renderCount,initialRender+1);
  for(let i=0;i<5;i++)tick();assert.equal(diagnostics().renderCount,initialRender+1,'handoff must return to idle');
  const damage=()=>world.damage({id:`partial-${world.epoch}`,epoch:world.epoch,target:world.getVoxel(360)!.position,weapon:'charge',power:.01});
  assert.ok(damage().accepted);api.setCompactWorld!(live);assert.ok(diagnostics().voxelRender.lastRebuild.colorChunks>0);tick();assert.equal(shadows(),initialShadows,'color-only edits still keep shadows idle');assert.equal(preview.cell(360)!.hp,retained.hp,'live damage cannot share preview authority');
  const oldEpoch=live.source.generation;await world.reset();const reset=world.getRenderBinding()!;assert.notEqual(reset.source.generation,oldEpoch);api.setCompactWorld!(reset);assert.equal(diagnostics().voxelRender.lastBindReused,false);assert.ok(diagnostics().voxelRender.lastRebuild.chunks>0);tick();assert.ok(shadows()>initialShadows);
  const resetMeshes=[...staticMeshes()],resetShadows=shadows();await world.reset();api.setCompactWorld!(world.getRenderBinding()!);assert.equal(diagnostics().voxelRender.lastBindReused,true);assert.deepEqual(staticMeshes(),resetMeshes);tick();assert.equal(shadows(),resetShadows);
  assert.ok(damage().accepted);api.setCompactWorld!(world.getRenderBinding()!);assert.ok(diagnostics().voxelRender.lastRebuild.colorChunks>0,'new epoch low revisions must not be suppressed by the old cursor');assert.ok(diagnostics().recentRenders.length>0);
 }finally{world.suspend();api?.dispose();hook.deregister();for(const [name,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}}
});
