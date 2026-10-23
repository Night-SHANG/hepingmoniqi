import {WORLD_BOUNDS} from './world-layout.js';
import type {MapId} from './contracts.js';
import RAPIER from '@dimforge/rapier3d-compat';
import type { AttachedCommand, Detonation, ProjectileCommand, ProjectilePhysics, ProjectileView, TrajectoryPreview, Vec3, Voxel, WeaponId } from './contracts.js';

// Fictional play-space constants. No real weapon or blast modelling.
const STEP = 1 / 120;
const MAX_FRAME_SECONDS = 1; // At most 120 solver steps per rendered frame.
const GRAVITY = 18;
const MAX_LIFETIME = 12;
const PREVIEW_SECONDS = 6;
const PREVIEW_SAMPLE_STEPS = 4;
const HALF_VOXEL = .4825;
let initialization: Promise<void> | undefined;
type Ball = { command: ProjectileCommand; body: RAPIER.RigidBody; collider: RAPIER.Collider; age: number; radius: number; stage?:'parent'|'child'; contacted?:boolean; phaseHits?:Set<number> };
type Simulation = { world:RAPIER.World; events:RAPIER.EventQueue; balls:Map<string,Ball>; byCollider:Map<number,string>; voxelByCollider:Map<number,number>; groundHandle:number };
const finiteVector = (p: Vec3) => p && [p.x,p.y,p.z].every(n => Number.isFinite(n) && Math.abs(n) <= 10000);
const copy = (p: Vec3):Vec3 => ({x:p.x,y:p.y,z:p.z});
const isWeapon = (weapon:unknown):weapon is WeaponId => weapon==='pulse' || weapon==='charge' || weapon==='shock' || weapon==='echo' || weapon==='split' || weapon==='phase' || weapon==='heavy' || weapon==='nova';
const isRemote = (command:ProjectileCommand) => command.trigger==='remote';
const weaponRadius = (weapon:WeaponId) => weapon==='nova'?1.05:weapon==='heavy'?.62:weapon==='charge'?.27:weapon==='shock'?.3:weapon==='phase'?.28:.2;

/** Shared by the live launch and its independent Rapier preview. */
function launchVelocity(command:ProjectileCommand):Vec3 {
 const {origin:o,target:t}=command;
 const duration=Math.max(.45,Math.min(1.5,Math.hypot(t.x-o.x,t.y-o.y,t.z-o.z)/26));
 return {x:(t.x-o.x)/duration,y:(t.y-o.y)/duration+GRAVITY*duration/2,z:(t.z-o.z)/duration};
}
function createBall(world:RAPIER.World,command:ProjectileCommand,velocity?:Vec3,child=false):Ball {
 const o=command.origin,v=velocity??launchVelocity(command);
 // Aim defines only the initial velocity, never an explosion trigger or homing target.
 const descriptor=RAPIER.RigidBodyDesc.dynamic().setTranslation(o.x,o.y,o.z).setLinvel(v.x,v.y,v.z).setCcdEnabled(true);
 if(command.weapon==='shock'){
  // The package's local +z is its outward face, just as in the visible model.
  const length=Math.hypot(v.x,v.y,v.z),z=length>1e-8?v.z/length:1;
  const q=length<=1e-8 ? {x:0,y:0,z:0,w:1} : z < -.999999 ? {x:0,y:1,z:0,w:0} : {x:-v.y/length,y:v.x/length,z:0,w:1+z};
  const qLength=Math.hypot(q.x,q.y,q.z,q.w);
  descriptor.setRotation({x:q.x/qLength,y:q.y/qLength,z:q.z/qLength,w:q.w/qLength});
 }
 const body=world.createRigidBody(descriptor);
 if(command.weapon==='charge')body.setAngvel({x:3.2,y:1.3,z:2.1},true);
 if(command.weapon==='shock')body.setAngvel({x:2.4,y:.8,z:1.2},true);
 const radius=child?.16:weaponRadius(command.weapon);
 // Preserve the mature round rocket/grenade CCD shapes. Packages use a real
 // oriented box matching the model footprint instead of pretending to be a ball.
 const shape=command.weapon==='shock' ? RAPIER.ColliderDesc.cuboid(.725*radius,.51*radius,.24*radius) : RAPIER.ColliderDesc.ball(radius);
 if(command.weapon==='phase')shape.setSensor(true); // This entity alone passes through structures; all terrain remains solid.
 const collider=world.createCollider(shape.setRestitution(child?.48:command.weapon==='charge'?.42:isRemote(command)?.25:0).setFriction(.8).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),body);
 return {command:{...command,origin:copy(o),target:copy(command.target)},body,collider,age:0,radius,stage:command.weapon==='split'?(child?'child':'parent'):undefined,phaseHits:command.weapon==='phase'?new Set<number>():undefined};
}
function removeBall(simulation:Simulation,ball:Ball) {
 simulation.byCollider.delete(ball.collider.handle);
 simulation.balls.delete(ball.command.id);
 simulation.world.removeRigidBody(ball.body);
}
/** Three actual child bodies; offsets/spread are deliberately stylized game units. */
function splitParent(simulation:Simulation,command:ProjectileCommand,position:Vec3,velocity:Vec3,normal:Vec3={x:0,y:1,z:0}) {
 const tangent=Math.abs(normal.y)>.5?{x:1,y:0,z:0}:{x:0,y:1,z:0};
 const bitangent={x:normal.y*tangent.z-normal.z*tangent.y,y:normal.z*tangent.x-normal.x*tangent.z,z:normal.x*tangent.y-normal.y*tangent.x};
 for(let i=0;i<3;i++){
  const angle=i*Math.PI*2/3,dx=tangent.x*Math.cos(angle)+bitangent.x*Math.sin(angle),dy=tangent.y*Math.cos(angle)+bitangent.y*Math.sin(angle),dz=tangent.z*Math.cos(angle)+bitangent.z*Math.sin(angle);
  const origin={x:position.x+normal.x*.3+dx*.34,y:position.y+normal.y*.3+dy*.34,z:position.z+normal.z*.3+dz*.34};
  const child=createBall(simulation.world,{...command,id:`${command.id}:child:${i}`,origin,target:{x:origin.x,y:origin.y+1,z:origin.z},trigger:'automatic'},{x:velocity.x+dx*3+normal.x*3,y:velocity.y+dy*3+normal.y*3,z:velocity.z+dz*3+normal.z*3},true);
  simulation.balls.set(child.command.id,child);simulation.byCollider.set(child.collider.handle,child.command.id);
 }
}
function simulateStep(simulation:Simulation):{detonations:Detonation[];contacts:Map<string,Vec3>;ended:Map<string,Vec3>} {
 const {world,events,balls,byCollider}=simulation;
 const phaseOrigins=new Map([...balls.values()].filter(ball=>ball.phaseHits).map(ball=>[ball.command.id,copy(ball.body.translation())]));
 world.step(events);
 for(const ball of balls.values())ball.age+=STEP;
 const contacts=new Map<string,Vec3>();
 events.drainCollisionEvents((first,second,started)=>{
  if(!started || [first,second].some(handle=>balls.get(byCollider.get(handle)??'')?.phaseHits))return;
  for(const handle of [first,second]){
   const id=byCollider.get(handle),ball=id===undefined?undefined:balls.get(id);
   if(!ball || ball.phaseHits)continue;
   contacts.set(ball.command.id,copy(ball.body.translation()));
   if((ball.command.weapon==='charge' || isRemote(ball.command)) && !ball.contacted){
    // Stylized soft casing absorbs lateral impact energy, preserving the starter
    // grenade's local roof bounce and letting remotely armed tools come to rest.
    const v=ball.body.linvel();ball.body.setLinvel({x:v.x*.2,y:v.y,z:v.z*.2},true);
    ball.body.setLinearDamping(1.2);ball.body.setAngularDamping(.8);ball.contacted=true;
   }
  }
 });
 const detonations:Detonation[]=[],ended=new Map<string,Vec3>();
 for(const ball of [...balls.values()]){
  if(ball.phaseHits){
   const origin=phaseOrigins.get(ball.command.id)!,position=copy(ball.body.translation());
   const displacement={x:position.x-origin.x,y:position.y-origin.y,z:position.z-origin.z};
   // A continuous sphere sweep covers the distance the actual gravity-driven body
   // travelled this solver step. Filters exclude only this entity's prior hits,
   // never remove/disable terrain or change another projectile's collisions.
   while(balls.has(ball.command.id)){
    const hit=world.castShape(origin,{x:0,y:0,z:0,w:1},displacement,new RAPIER.Ball(ball.radius),0,1,true,undefined,undefined,ball.collider,ball.body,collider=>{
     if(collider.handle===simulation.groundHandle)return true;
     const voxelId=simulation.voxelByCollider.get(collider.handle);
     return !isRemote(ball.command)&&voxelId!==undefined&&!ball.phaseHits!.has(voxelId);
    });
    if(!hit)break;
    const center={x:origin.x+displacement.x*hit.time_of_impact,y:origin.y+displacement.y*hit.time_of_impact,z:origin.z+displacement.z*hit.time_of_impact};
    const contact=copy(hit.witness1);
    if(!contacts.has(ball.command.id))contacts.set(ball.command.id,contact);
    if(hit.collider.handle===simulation.groundHandle){ended.set(ball.command.id,center);removeBall(simulation,ball);break;}
    const index=ball.phaseHits.size;ball.phaseHits.add(simulation.voxelByCollider.get(hit.collider.handle)!);
    detonations.push({id:`${ball.command.id}:phase:${index}`,epoch:ball.command.epoch,position:contact,weapon:'phase',power:ball.command.power,reason:'impact',age:ball.age});
    if(ball.phaseHits.size===3){ended.set(ball.command.id,center);removeBall(simulation,ball);}
   }
   if(balls.has(ball.command.id)&&(ball.age>=MAX_LIFETIME || position.y < -100 || Math.hypot(position.x,position.z)>300)){ended.set(ball.command.id,position);removeBall(simulation,ball);}
   continue;
  }
  if(isRemote(ball.command))continue; // Armed remote ordnance survives until manual detonation/reset.
  if(ball.command.weapon==='split' && ball.stage!=='child' && (ball.age+1e-9>=.65 || contacts.has(ball.command.id))){
   const position=copy(ball.body.translation()),velocity=copy(ball.body.linvel());
   ended.set(ball.command.id,position);removeBall(simulation,ball);splitParent(simulation,ball.command,position,velocity);continue;
  }
  const timed=(ball.command.weapon==='charge' && ball.age+1e-9>=3) || (ball.stage==='child' && ball.age+1e-9>=1.2);
  const impact=ball.command.weapon!=='charge' && ball.command.weapon!=='split' && contacts.has(ball.command.id);
  if(timed || impact){
   detonations.push({id:ball.command.id,epoch:ball.command.epoch,position:copy(ball.body.translation()),weapon:ball.command.weapon,power:ball.command.power,reason:timed?'timer':'impact',age:ball.age,stage:ball.stage});
   ended.set(ball.command.id,copy(ball.body.translation()));removeBall(simulation,ball);
  }else{
   const position=ball.body.translation();
   if(ball.age>=MAX_LIFETIME || position.y < -100 || Math.hypot(position.x,position.z)>300){ended.set(ball.command.id,copy(position));removeBall(simulation,ball);}
  }
 }
 return {detonations,contacts,ended};
}

export async function createProjectilePhysics(): Promise<ProjectilePhysics> {
 await (initialization ??= RAPIER.init());
 const world = new RAPIER.World({x:0,y:-GRAVITY,z:0});
 world.timestep = STEP;
 world.integrationParameters.maxCcdSubsteps = 4;
 const events = new RAPIER.EventQueue(true);
 // Physics substrate top is -.5; the scene's selectable island surface is y=0.
 let mapId:MapId='courtyard';
 let groundCollider=world.createCollider(RAPIER.ColliderDesc.cuboid(27,.5,22).setTranslation(0,-1,0).setFriction(.85));
 const terrain = new Map<number,{collider:RAPIER.Collider;position:Vec3;half:Vec3}>();
 const balls = new Map<string,Ball>();
 const packages = new Map<string,{command:AttachedCommand;position:Vec3;normal:Vec3;age:number}>();
 const byCollider = new Map<number,string>();
 const voxelByCollider=new Map<number,number>();
 const simulation:Simulation={world,events,balls,byCollider,voxelByCollider,groundHandle:groundCollider.handle};
 const launched = new Set<string>();
 const emitters=new Map<string,{base:Detonation;elapsed:number;next:number;normal?:Vec3}>();
 function activateEcho(base:Detonation,normal?:Vec3):Detonation {
  emitters.set(base.id,{base:{...base,position:copy(base.position)},elapsed:0,next:1,normal:normal?copy(normal):undefined});
  return {...base,id:`${base.id}:echo:0`,stage:'emitter'};
 }
 function reset() {
  if(disposed)return;
  for(const ball of balls.values())removeBall(simulation,ball);
  packages.clear();emitters.clear();launched.clear();accumulator=0;events.clear();
 }
 function getPendingWorkCount(){return balls.size+packages.size+[...emitters.values()].reduce((sum,e)=>sum+3-e.next,0);}

 let epoch = 0, accumulator = 0, disposed = false;
 function syncVoxels(voxels:readonly Voxel[], nextEpoch:number) {
  if(disposed) return;
  if(nextEpoch !== epoch) {
   reset();epoch=nextEpoch;
  }
  const ids = new Set<number>();
  for(const voxel of voxels) {
   ids.add(voxel.id);
   const prior=terrain.get(voxel.id), p=voxel.position, half=voxel.size?{x:voxel.size.x/2,y:voxel.size.y/2,z:voxel.size.z/2}:{x:HALF_VOXEL,y:HALF_VOXEL,z:HALF_VOXEL};
   if(prior && prior.position.x===p.x && prior.position.y===p.y && prior.position.z===p.z && prior.half.x===half.x && prior.half.y===half.y && prior.half.z===half.z)continue;
   if(prior){voxelByCollider.delete(prior.collider.handle);world.removeCollider(prior.collider,true);}
   const collider=world.createCollider(RAPIER.ColliderDesc.cuboid(half.x,half.y,half.z).setTranslation(p.x,p.y,p.z).setFriction(.75));
   terrain.set(voxel.id,{collider,position:copy(p),half});voxelByCollider.set(collider.handle,voxel.id);
  }
  for(const [id,entry] of terrain)if(!ids.has(id)){voxelByCollider.delete(entry.collider.handle);world.removeCollider(entry.collider,true);terrain.delete(id);}
  for(const [id,pack] of packages)if(pack.command.surface.voxelId!==null && !ids.has(pack.command.surface.voxelId))packages.delete(id);
 }
 function setMap(next:MapId){
  if(disposed||next===mapId)return;
  reset();mapId=next;world.removeCollider(groundCollider,true);
  const bounds=WORLD_BOUNDS[next];
  groundCollider=world.createCollider(RAPIER.ColliderDesc.cuboid(bounds.halfX,.5,bounds.halfZ).setTranslation(0,-1,0).setFriction(.85));
  simulation.groundHandle=groundCollider.handle;
 }
 function commandIds(id:string,weapon:WeaponId):string[]{
  return weapon==='phase'?[id,...[0,1,2].map(i=>`${id}:phase:${i}`)]:weapon==='split'?[id,...[0,1,2].map(i=>`${id}:child:${i}`)]:weapon==='echo'?[id,...[0,1,2].map(i=>`${id}:echo:${i}`)]:[id];
 }
 function idsAvailable(id:string,weapon:WeaponId){return commandIds(id,weapon).every(candidate=>candidate.length<=160 && !launched.has(candidate));}
 function reserveIds(id:string,weapon:WeaponId){for(const candidate of commandIds(id,weapon))launched.add(candidate);}
 function validCommand(command:ProjectileCommand):boolean {
  return !disposed && !!command && typeof command.id==='string' && command.id.length>0 && command.id.length<=160 && command.epoch===epoch && idsAvailable(command.id,command.weapon) && isWeapon(command.weapon) && (command.trigger===undefined || command.trigger==='automatic' || command.trigger==='remote') && Number.isFinite(command.power) && command.power>0 && command.power<=3 && finiteVector(command.origin) && finiteVector(command.target) && Math.hypot(command.target.x-command.origin.x,command.target.y-command.origin.y,command.target.z-command.origin.z)>=.01;
 }
 function launch(command:ProjectileCommand):boolean {
  if(!validCommand(command))return false;
  const ball=createBall(world,command);
  balls.set(command.id,ball);byCollider.set(ball.collider.handle,command.id);reserveIds(command.id,command.weapon);
  return true;
 }
 function preview(command:ProjectileCommand):TrajectoryPreview {
  if(!validCommand(command))return {points:[],impact:null,duration:0};
  // Snapshotting includes the current static geometry, sleeping bodies and CCD
  // state. No live clock, body, id reservation or collision queue is touched.
  const previewWorld=RAPIER.World.restoreSnapshot(world.takeSnapshot());
  const previewEvents=new RAPIER.EventQueue(true);
  try{
   const previewBalls=new Map<string,Ball>(),previewByCollider=new Map<number,string>();
   for(const [id,ball] of balls){
    const cloned={...ball,phaseHits:ball.phaseHits?new Set(ball.phaseHits):undefined,body:previewWorld.getRigidBody(ball.body.handle),collider:previewWorld.getCollider(ball.collider.handle)};
    previewBalls.set(id,cloned);previewByCollider.set(cloned.collider.handle,id);
   }
   const ball=createBall(previewWorld,command);
   previewBalls.set(command.id,ball);previewByCollider.set(ball.collider.handle,command.id);
   const copied:Simulation={world:previewWorld,events:previewEvents,balls:previewBalls,byCollider:previewByCollider,voxelByCollider:new Map(voxelByCollider),groundHandle:groundCollider.handle};
   const points:Vec3[]=[copy(command.origin)];
   for(let index=1;index<=Math.round(PREVIEW_SECONDS/STEP);index++){
    const {contacts,ended}=simulateStep(copied);
    const finalPosition=ended.get(command.id),impact=contacts.get(command.id);
    const position=finalPosition??copy(ball.body.translation());
    if(impact || finalPosition || index%PREVIEW_SAMPLE_STEPS===0)points.push(position);
    // Never promise a post-fuse path. First contact, a real automatic fuse, or
    // removal at the live simulation boundary ends the prediction immediately.
    if(impact || finalPosition)return {points,impact:impact??null,duration:index*STEP};
   }
   return {points,impact:null,duration:PREVIEW_SECONDS};
  }finally{previewEvents.free();previewWorld.free();}
 }
 function attach(command:AttachedCommand):boolean {
  if(disposed || !command || typeof command.id!=='string' || !command.id.length || command.id.length>160 || command.epoch!==epoch || !idsAvailable(command.id,command.weapon??'shock') || (command.weapon!==undefined && !isWeapon(command.weapon)) || !Number.isFinite(command.power) || command.power<=0 || command.power>3 || !command.surface || !finiteVector(command.surface.position) || !finiteVector(command.surface.normal))return false;
  const {position:p,normal:n,voxelId}=command.surface;
  const axes=['x','y','z'] as const;
  const axis=axes.find(a=>Math.abs(Math.abs(n[a])-1)<1e-4);
  if(!axis || axes.some(a=>a!==axis && Math.abs(n[a])>1e-4))return false;
  if(voxelId===null){
   // Do not confuse the selectable visual ground plane with the substrate's
   // lower collision surface, or interpret a missing host as a ground package.
   if(axis!=='y' || n.y<0 || Math.abs(p.y)>1e-4 || Math.abs(p.x)>WORLD_BOUNDS[mapId].halfX || Math.abs(p.z)>WORLD_BOUNDS[mapId].halfZ)return false;
  }else{
   if(!Number.isSafeInteger(voxelId))return false;
   const host=terrain.get(voxelId);if(!host)return false;
   // Validate a real outward live face rather than arbitrary mouse coordinates.
   if(Math.abs((p[axis]-host.position[axis])*n[axis]-host.half[axis])>.025 || axes.some(a=>a!==axis && Math.abs(p[a]-host.position[a])>host.half[a]+.025))return false;
  }
  const normal={x:0,y:0,z:0};normal[axis]=Math.sign(n[axis]);
  const position={x:p.x+normal.x*.08,y:p.y+normal.y*.08,z:p.z+normal.z*.08};
  const stored={...command,surface:{voxelId,position:copy(p),normal:copy(normal)}};
  packages.set(command.id,{command:stored,position,normal,age:0});reserveIds(command.id,command.weapon??'shock');return true;
 }
 function detonateAttached():Detonation[] {
  if(disposed)return [];
  const result:Detonation[]=[];
  for(const pack of packages.values())if(pack.command.epoch===epoch && (pack.command.surface.voxelId===null || terrain.has(pack.command.surface.voxelId))){
   const weapon=pack.command.weapon??'shock';
   if(weapon==='phase'){
    const direction=pack.command.surface.voxelId===null?{x:0,y:1,z:0}:{x:-pack.normal.x,y:-pack.normal.y,z:-pack.normal.z};
    // Placement starts one radius outside the actual face so the first witness
    // is its real surface, rather than an initially overlapping sensor center.
    const position={x:pack.command.surface.position.x+pack.normal.x*(weaponRadius('phase')+.01),y:pack.command.surface.position.y+pack.normal.y*(weaponRadius('phase')+.01),z:pack.command.surface.position.z+pack.normal.z*(weaponRadius('phase')+.01)};
    const ball=createBall(world,{id:pack.command.id,epoch,weapon,power:pack.command.power,origin:position,target:{x:position.x+direction.x,y:position.y+direction.y,z:position.z+direction.z},trigger:'automatic'},{x:direction.x*18,y:direction.y*18,z:direction.z*18});
    balls.set(ball.command.id,ball);byCollider.set(ball.collider.handle,ball.command.id);
   }else if(weapon==='split')splitParent(simulation,{id:pack.command.id,epoch,weapon,power:pack.command.power,origin:pack.position,target:pack.position},pack.position,{x:0,y:0,z:0},pack.normal);
   else {
    const event:Detonation={id:pack.command.id,epoch,position:copy(pack.position),weapon,power:pack.command.power,reason:'remote',age:pack.age};
    result.push(weapon==='echo'?activateEcho(event,pack.normal):event);
   }
  }
  packages.clear();
  for(const ball of [...balls.values()])if(isRemote(ball.command)){
   if(ball.phaseHits){ball.command={...ball.command,trigger:'automatic'};continue;}
   const position=copy(ball.body.translation()),velocity=copy(ball.body.linvel());
   if(ball.command.weapon==='split')splitParent(simulation,ball.command,position,velocity);
   else {
    const event:Detonation={id:ball.command.id,epoch,position,weapon:ball.command.weapon,power:ball.command.power,reason:'remote',age:ball.age};
    result.push(ball.command.weapon==='echo'?activateEcho(event):event);
   }
   removeBall(simulation,ball);
  }
  return result;
 }
 function step(deltaSeconds:number):Detonation[] {
  const results:Detonation[]=[];
  if(disposed || !Number.isFinite(deltaSeconds) || deltaSeconds<=0)return results;
  // Preserve foreground elapsed time down to 1fps. Body and fuse always advance
  // together in fixed steps; exceptionally long stalls are bounded to avoid a spiral.
  // The caller passes zero during pause/hidden tabs and applies intentional slow motion.
  accumulator+=Math.min(deltaSeconds,MAX_FRAME_SECONDS);
  while(accumulator+1e-10>=STEP){
   accumulator-=STEP;
   // Advance only emitters that existed before this step, so activation starts at t=0.
   for(const [id,emitter] of emitters){
    emitter.elapsed+=STEP;
    while(emitter.next<3 && emitter.elapsed+1e-9>=emitter.next*.65){
     results.push({...emitter.base,id:`${id}:echo:${emitter.next}`,position:copy(emitter.base.position),age:emitter.base.age+emitter.next*.65,stage:'emitter',reason:'timer'});emitter.next++;
    }
    if(emitter.next===3)emitters.delete(id);
   }
   for(const event of simulateStep(simulation).detonations)results.push(event.weapon==='echo'?activateEcho(event):event);
   for(const pack of packages.values())pack.age+=STEP;
  }
  return results;
 }
 function getProjectiles():ProjectileView[] {
  return [
   ...[...balls.values()].map(ball=>({id:ball.command.id,stage:ball.stage,position:copy(ball.body.translation()),radius:ball.radius,weapon:ball.command.weapon,age:ball.age,fuseRemaining:isRemote(ball.command)?null:ball.stage==='child'?Math.max(0,1.2-ball.age):ball.command.weapon==='split'?Math.max(0,.65-ball.age):ball.command.weapon==='charge'?Math.max(0,3-ball.age):null,velocity:copy(ball.body.linvel()),rotation:{...ball.body.rotation()},trigger:ball.command.trigger??'automatic',state:'flying' as const})),
   ...[...emitters.values()].map(e=>({id:e.base.id,stage:'emitter' as const,normal:e.normal?copy(e.normal):undefined,position:copy(e.base.position),radius:weaponRadius('echo'),weapon:'echo' as const,age:e.elapsed,fuseRemaining:Math.max(0,e.next*.65-e.elapsed),trigger:'automatic' as const,state:'attached' as const,velocity:{x:0,y:0,z:0}})),
   ...[...packages.values()].map(pack=>({id:pack.command.id,stage:pack.command.weapon==='split'?'parent' as const:pack.command.weapon==='echo'?'emitter' as const:undefined,position:copy(pack.position),radius:weaponRadius(pack.command.weapon??'shock'),weapon:pack.command.weapon??'shock',age:pack.age,fuseRemaining:null,trigger:'remote' as const,state:'attached' as const,normal:copy(pack.normal),hostVoxelId:pack.command.surface.voxelId,velocity:{x:0,y:0,z:0}}))
  ];
 }
 return {setMap,syncVoxels,launch,preview,attach,detonateAttached,step,getProjectiles,getPendingWorkCount,reset,dispose(){if(disposed)return;disposed=true;balls.clear();packages.clear();emitters.clear();byCollider.clear();voxelByCollider.clear();terrain.clear();launched.clear();events.free();world.free();}};
}
