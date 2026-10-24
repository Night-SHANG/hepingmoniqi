import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as scene from '../scene.js';
import {createSceneEffectChannel} from '../scene-effects.js';
import {createCompactSurfaceRenderer} from './surface-renderer.js';
import type {CompactSurfaceSource,MovingSurfaceCell} from './surface-source.js';
import type {ProjectileView} from '../contracts.js';

// A running simulation is not itself visual activity. Reverting to unconditional
// timeScale > 0 draws must fail even though all physics callbacks still run.
test('settled running and slowed scenes submit no unchanged frames',()=>{
 for(const timeScale of [0,.25,1,2])assert.equal(scene.shouldRenderScene(timeScale,false,false),false);
});

test('camera, input and geometry invalidation draw even while paused',()=>{
 for(const timeScale of [0,.25,1]){
  assert.equal(scene.shouldRenderScene(timeScale,true,false),true);
  assert.equal(scene.shouldRenderScene(timeScale,false,true),true);
 }
});

test('active projectile and effect animation draws only while unpaused',()=>{
 const render=scene.shouldRenderScene;
 assert.equal(render(0,false,false,true),false);
 assert.equal(render(.25,false,false,true),true);
 assert.equal(render(1,false,false,true),true);
 assert.equal(render(1,false,false,false),false);
});

test('all smoke and dust tails draw through their final clearing frame, independently of settlement',()=>{
 const world=new THREE.Scene(),channel=createSceneEffectChannel(world);
 const render=scene.shouldRenderScene;
 const step=(dt:number,scale:number)=>{
  const activeBefore=channel.getDiagnostics().active>0;
  channel.step(dt*scale);channel.render();
  return render(scale,false,false,activeBefore);
 };
 try{
  channel.add({id:'smoke-tail',epoch:1,position:{x:0,y:0,z:0},kind:'detonation',tool:'charge'});
  assert.equal(step(.5,1),true);assert.equal(channel.hasActiveCore(),false);assert.equal(channel.getDiagnostics().active,1);
  const age=channel.getDiagnostics().events[0].age;
  assert.equal(step(1,0),false);assert.equal(channel.getDiagnostics().events[0].age,age);
  assert.equal(step(1,.25),true);assert.equal(channel.getDiagnostics().events[0].age,.75);
  assert.equal(step(1,1),true);assert.equal(channel.getDiagnostics().active,1);
  assert.equal(step(1,1),true,'the removal of the final smoke mesh must reach the canvas');
  assert.equal(channel.getDiagnostics().active,0);assert.equal(world.children.length,0);
  assert.equal(step(1,1),false,'the next unchanged running frame must remain idle');
  channel.add({id:'dust-only',epoch:1,position:{x:0,y:0,z:0},kind:'impact'});
  assert.equal(channel.hasActiveCore(),false);assert.equal(step(.1,1),true);
 }finally{channel.dispose();}
});

test('compact color edits redraw without refreshing shadows; topology, pose and final removal refresh both',()=>{
 const invalidation=scene.compactSurfaceInvalidation;
 assert.equal(typeof invalidation,'function','compact visuals need a separate geometry shadow decision');
 const world=new THREE.Scene(),box=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),renderer=createCompactSurfaceRenderer(world,box,material);
 let hp=10,live=true,revision=0;
 const source:CompactSurfaceSource={bounds:{minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0},staticIdAt:(x,y,z)=>live&&x===0&&y===0&&z===0?1:null,colorOf:()=>0x888888,hpOf:()=>hp,maxHpOf:()=>10,forEachChunk:(_size,visit)=>visit(0,0,0)};
 const moving:MovingSurfaceCell={id:2,objectId:'moving',role:'terrain',material:'stone',position:{x:2,y:2,z:0},rotation:{x:0,y:0,z:0,w:1},color:0x888888,hp:10,maxHp:10,state:'dynamic'};
 const update=(change:()=>void,reset=false)=>{const before=renderer.getDiagnostics();change();return invalidation(before,renderer.getDiagnostics(),reset);};
 try{
  renderer.bind(source);renderer.setMoving([]);
  assert.deepEqual(update(()=>{renderer.flush();renderer.setMoving([]);}),{render:false,shadows:false});
  assert.deepEqual(update(()=>{hp=5;renderer.applyEdits([{id:1,position:{x:0,y:0,z:0},revision:++revision,appearanceChanged:true,topologyChanged:false}]);renderer.flush();renderer.setMoving([]);}),{render:true,shadows:false});
  assert.deepEqual(update(()=>{live=false;renderer.applyEdits([{id:1,position:{x:0,y:0,z:0},revision:++revision,appearanceChanged:false,topologyChanged:true}]);renderer.flush();renderer.setMoving([]);}),{render:true,shadows:true});
  assert.deepEqual(update(()=>{renderer.flush();renderer.setMoving([moving]);}),{render:true,shadows:true});
  assert.deepEqual(update(()=>{renderer.flush();renderer.setMoving([{...moving,hp:5}]);}),{render:true,shadows:false});
  assert.deepEqual(update(()=>{renderer.flush();renderer.setMoving([{...moving,hp:5,position:{x:3,y:2,z:0}}]);}),{render:true,shadows:true});
  assert.deepEqual(update(()=>{renderer.flush();renderer.setMoving([]);}),{render:true,shadows:true});
  assert.equal(renderer.getDiagnostics().movingMatrixWrites,0,'last-member removal needs a count comparison');
  assert.deepEqual(update(()=>{renderer.bind(source);renderer.flush();renderer.setMoving([]);},true),{render:true,shadows:true});
 }finally{renderer.dispose();box.dispose();material.dispose();}
});

test('render timing keeps first matching submits, stamps next callback once, and returns bounded owned snapshots',()=>{
 const create=scene.createSceneRenderHistory;
 assert.equal(typeof create,'function','scene timing needs bounded submit history');
 const history=create();
 assert.deepEqual(history.getDiagnostics(),{renderCount:0,lastRenderAt:0,lastRenderedMap:null,lastRenderStartedAt:0,lastRenderCpuMs:0,recentRenders:[]});
 history.beginFrame(1);history.record('city',2,5);history.beginFrame(18);history.beginFrame(34);
 const first=history.getDiagnostics();
 assert.deepEqual(first.recentRenders,[{count:1,mapId:'city',startedAt:2,finishedAt:5,nextFrameAt:18}]);
 assert.equal(first.lastRenderCpuMs,3);assert.equal(first.lastRenderStartedAt,2);assert.equal(first.lastRenderAt,5);
 first.recentRenders[0].finishedAt=-1;first.recentRenders.push({...first.recentRenders[0],count:-1});
 assert.equal(history.getDiagnostics().recentRenders[0].finishedAt,5);assert.equal(history.getDiagnostics().recentRenders.length,1);
 for(let i=2;i<=20;i++){history.record('courtyard',i*20,i*20+2);history.beginFrame(i*20+16);}
 const latest=history.getDiagnostics();assert.equal(latest.renderCount,20);assert.equal(latest.recentRenders.length,16);assert.equal(latest.recentRenders[0].count,5);assert.equal(latest.recentRenders[15].count,20);assert.equal(latest.lastRenderedMap,'courtyard');
});

// Only the browser/WebGL boundary is replaced. Scene, controls, effects,
// projectile meshes and the rAF callback below are the real production code.
test('real scene rAF keeps stepping while idle and redraws paused API edits exactly once',async()=>{
 const {registerHooks}=await import('node:module');
 const browserGlobals=['window','document','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','__sceneTestElement'];
 const previous=new Map(browserGlobals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const documentTarget=new EventTarget();
 class Element extends EventTarget {
  style:Record<string,string>={};clientWidth=800;clientHeight=600;ownerDocument=documentTarget;children:Element[]=[];
  getRootNode(){return documentTarget;}setAttribute(){}append(...nodes:Element[]){this.children.push(...nodes);}remove(){}setPointerCapture(){}releasePointerCapture(){}
  getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}
  getContext(){return new Proxy({},{get:()=>()=>{}});}
 }
 let nextId=0,now=performance.now();const callbacks=new Map<number,FrameRequestCallback>();
 Object.assign(globalThis,{window:{devicePixelRatio:1},document:Object.assign(documentTarget,{hidden:false,createElement:()=>new Element()}),ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:(fn:FrameRequestCallback)=>{callbacks.set(++nextId,fn);return nextId;},cancelAnimationFrame:(id:number)=>callbacks.delete(id),__sceneTestElement:Element});
 const threeURL=import.meta.resolve('three');
 const mockURL='data:text/javascript,'+encodeURIComponent(`export * from ${JSON.stringify(threeURL)};export class WebGLRenderer {domElement=new globalThis.__sceneTestElement();shadowMap={};setPixelRatio(){}setSize(){}render(scene){scene.updateMatrixWorld(true);this.shadowMap.needsUpdate=false;}dispose(){}}`);
 const hook=registerHooks({resolve(specifier,context,nextResolve){return specifier==='three'&&context.parentURL?.includes('scene.ts?render-invalidation')?{url:mockURL,shortCircuit:true}:nextResolve(specifier,context);}});
 let api:ReturnType<typeof scene.createScene>|undefined;
 const tick=()=>{const current=[...callbacks.values()];callbacks.clear();now+=16;for(const fn of current)fn(now);};
 try{
  const path='../scene.ts?render-invalidation';const module=await import(path) as typeof scene;
  let steps=0;let projectiles:ProjectileView[]=[];const container=new Element();api=module.createScene(container as unknown as HTMLElement,{onAim(){},onFrame(){steps++;api?.setProjectiles(projectiles);}});
  const count=()=>Number((api!.getDiagnostics() as unknown as {renderCount:number}).renderCount);
  tick();assert.equal(count(),1);for(let i=0;i<60;i++)tick();assert.equal(steps,61);assert.equal(count(),1);
  api.setTimeScale(0);
  const edit=(change:()=>void)=>{const before=count();change();tick();assert.equal(count(),before+1);tick();assert.equal(count(),before+1);};
  edit(()=>api!.setTarget({x:0,y:0,z:0}));
  edit(()=>api!.setTrajectory(null));
  edit(()=>api!.playStructuralEvent!({id:'paused',epoch:1,kind:'impact',position:{x:0,y:0,z:0}}));
  edit(()=>api!.setReducedMotion(true));
  edit(()=>api!.clearEffects());
  const voxel={id:1,position:{x:0,y:0,z:0},size:{x:1,y:1,z:1},structuralState:'static' as const,role:'terrain' as const,color:0x888888,material:'stone' as const,hp:10,maxHp:10};
  edit(()=>api!.setVoxels([voxel]));edit(()=>api!.setVoxels([{...voxel,hp:5}]));
  const projectile:ProjectileView={id:'paused-badge',weapon:'charge',position:{x:2,y:2,z:0},radius:.3,age:0,fuseRemaining:3,state:'flying'};
  const changeProjectiles=(views:ProjectileView[])=>{projectiles=views;api!.setProjectiles(views);};
  edit(()=>changeProjectiles([projectile]));
  edit(()=>changeProjectiles([{...projectile,fuseRemaining:2}]));
  edit(()=>changeProjectiles([{...projectile,fuseRemaining:null}]));
  edit(()=>changeProjectiles([]));
  const beforeCamera=count(),wheel=Object.assign(new Event('wheel',{cancelable:true}),{deltaY:-120,deltaMode:0,clientX:400,clientY:300});
  container.children[0].dispatchEvent(wheel);tick();assert.ok(count()>beforeCamera,'paused camera input still draws');
  for(let i=0;i<240;i++)tick();const settled=count();for(let i=0;i<60;i++)tick();assert.equal(count(),settled,'camera damping eventually returns to idle');
 }finally{
  api?.dispose();hook.deregister();for(const [name,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}
 }
});
