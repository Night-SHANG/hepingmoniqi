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
type Ball = { command: ProjectileCommand; body: RAPIER.RigidBody; collider: RAPIER.Collider; age: number; radius: number; contacted?:boolean };
type Simulation = { world:RAPIER.World; events:RAPIER.EventQueue; balls:Map<string,Ball>; byCollider:Map<number,string> };
const finiteVector = (p: Vec3) => p && [p.x,p.y,p.z].every(n => Number.isFinite(n) && Math.abs(n) <= 10000);
const copy = (p: Vec3):Vec3 => ({x:p.x,y:p.y,z:p.z});
const isWeapon = (weapon:unknown):weapon is WeaponId => weapon==='pulse' || weapon==='charge' || weapon==='shock';
const isRemote = (command:ProjectileCommand) => command.trigger==='remote';
const weaponRadius = (weapon:WeaponId) => weapon==='charge'?.27:weapon==='shock'?.3:.2;

/** Shared by the live launch and its independent Rapier preview. */
function launchVelocity(command:ProjectileCommand):Vec3 {
 const {origin:o,target:t}=command;
 const duration=Math.max(.45,Math.min(1.5,Math.hypot(t.x-o.x,t.y-o.y,t.z-o.z)/26));
 return {x:(t.x-o.x)/duration,y:(t.y-o.y)/duration+GRAVITY*duration/2,z:(t.z-o.z)/duration};
}
function createBall(world:RAPIER.World,command:ProjectileCommand):Ball {
 const o=command.origin,v=launchVelocity(command);
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
 const radius=weaponRadius(command.weapon);
 // Preserve the mature round rocket/grenade CCD shapes. Packages use a real
 // oriented box matching the model footprint instead of pretending to be a ball.
 const shape=command.weapon==='shock' ? RAPIER.ColliderDesc.cuboid(.725*radius,.51*radius,.24*radius) : RAPIER.ColliderDesc.ball(radius);
 const collider=world.createCollider(shape.setRestitution(command.weapon==='charge'?.42:isRemote(command)?.25:0).setFriction(.8).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),body);
 return {command:{...command,origin:copy(o),target:copy(command.target)},body,collider,age:0,radius};
}
function removeBall(simulation:Simulation,ball:Ball) {
 simulation.byCollider.delete(ball.collider.handle);
 simulation.balls.delete(ball.command.id);
 simulation.world.removeRigidBody(ball.body);
}
function simulateStep(simulation:Simulation):{detonations:Detonation[];contacts:Map<string,Vec3>;ended:Map<string,Vec3>} {
 const {world,events,balls,byCollider}=simulation;
 world.step(events);
 for(const ball of balls.values())ball.age+=STEP;
 const contacts=new Map<string,Vec3>();
 events.drainCollisionEvents((first,second,started)=>{
  if(!started)return;
  for(const handle of [first,second]){
   const id=byCollider.get(handle),ball=id===undefined?undefined:balls.get(id);
   if(!ball)continue;
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
 for(const ball of balls.values()){
  if(isRemote(ball.command))continue; // Armed remote ordnance survives until manual detonation/reset.
  const timed=ball.command.weapon==='charge' && ball.age+1e-9>=3;
  const impact=ball.command.weapon!=='charge' && contacts.has(ball.command.id);
  if(timed || impact){
   detonations.push({id:ball.command.id,epoch:ball.command.epoch,position:copy(ball.body.translation()),weapon:ball.command.weapon,power:ball.command.power,reason:timed?'timer':'impact',age:ball.age});
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
 world.createCollider(RAPIER.ColliderDesc.cuboid(27,.5,22).setTranslation(0,-1,0).setFriction(.85));
 const terrain = new Map<number,{collider:RAPIER.Collider;position:Vec3}>();
 const balls = new Map<string,Ball>();
 const packages = new Map<string,{command:AttachedCommand;position:Vec3;normal:Vec3;age:number}>();
 const byCollider = new Map<number,string>();
 const simulation:Simulation={world,events,balls,byCollider};
 const launched = new Set<string>();
 let epoch = 0, accumulator = 0, disposed = false;
 function syncVoxels(voxels:readonly Voxel[], nextEpoch:number) {
  if(disposed) return;
  if(nextEpoch !== epoch) {
   for(const ball of balls.values())removeBall(simulation,ball);
   packages.clear();launched.clear();accumulator=0;epoch=nextEpoch;
   events.clear();
  }
  const ids = new Set<number>();
  for(const voxel of voxels) {
   ids.add(voxel.id);
   const prior=terrain.get(voxel.id), p=voxel.position;
   if(prior && prior.position.x===p.x && prior.position.y===p.y && prior.position.z===p.z)continue;
   if(prior)world.removeCollider(prior.collider,true);
   const collider=world.createCollider(RAPIER.ColliderDesc.cuboid(HALF_VOXEL,HALF_VOXEL,HALF_VOXEL).setTranslation(p.x,p.y,p.z).setFriction(.75));
   terrain.set(voxel.id,{collider,position:copy(p)});
  }
  for(const [id,entry] of terrain)if(!ids.has(id)){world.removeCollider(entry.collider,true);terrain.delete(id);}
  for(const [id,pack] of packages)if(pack.command.surface.voxelId!==null && !ids.has(pack.command.surface.voxelId))packages.delete(id);
 }
 function validCommand(command:ProjectileCommand):boolean {
  return !disposed && !!command && typeof command.id==='string' && command.id.length>0 && command.id.length<=160 && command.epoch===epoch && !launched.has(command.id) && isWeapon(command.weapon) && (command.trigger===undefined || command.trigger==='automatic' || command.trigger==='remote') && Number.isFinite(command.power) && command.power>0 && command.power<=3 && finiteVector(command.origin) && finiteVector(command.target) && Math.hypot(command.target.x-command.origin.x,command.target.y-command.origin.y,command.target.z-command.origin.z)>=.01;
 }
 function launch(command:ProjectileCommand):boolean {
  if(!validCommand(command))return false;
  const ball=createBall(world,command);
  balls.set(command.id,ball);byCollider.set(ball.collider.handle,command.id);launched.add(command.id);
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
    const cloned={...ball,body:previewWorld.getRigidBody(ball.body.handle),collider:previewWorld.getCollider(ball.collider.handle)};
    previewBalls.set(id,cloned);previewByCollider.set(cloned.collider.handle,id);
   }
   const ball=createBall(previewWorld,command);
   previewBalls.set(command.id,ball);previewByCollider.set(ball.collider.handle,command.id);
   const copied:Simulation={world:previewWorld,events:previewEvents,balls:previewBalls,byCollider:previewByCollider};
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
  if(disposed || !command || typeof command.id!=='string' || !command.id.length || command.id.length>160 || command.epoch!==epoch || launched.has(command.id) || (command.weapon!==undefined && !isWeapon(command.weapon)) || !Number.isFinite(command.power) || command.power<=0 || command.power>3 || !command.surface || !finiteVector(command.surface.position) || !finiteVector(command.surface.normal))return false;
  const {position:p,normal:n,voxelId}=command.surface;
  const axes=['x','y','z'] as const;
  const axis=axes.find(a=>Math.abs(Math.abs(n[a])-1)<1e-4);
  if(!axis || axes.some(a=>a!==axis && Math.abs(n[a])>1e-4))return false;
  if(voxelId===null){
   // Do not confuse the selectable visual ground plane with the substrate's
   // lower collision surface, or interpret a missing host as a ground package.
   if(axis!=='y' || n.y<0 || Math.abs(p.y)>1e-4 || Math.abs(p.x)>27 || Math.abs(p.z)>22)return false;
  }else{
   if(!Number.isSafeInteger(voxelId))return false;
   const host=terrain.get(voxelId);if(!host)return false;
   // Validate a real outward live face rather than arbitrary mouse coordinates.
   if(Math.abs((p[axis]-host.position[axis])*n[axis]-HALF_VOXEL)>.025 || axes.some(a=>a!==axis && Math.abs(p[a]-host.position[a])>HALF_VOXEL+.025))return false;
  }
  const normal={x:0,y:0,z:0};normal[axis]=Math.sign(n[axis]);
  const position={x:p.x+normal.x*.08,y:p.y+normal.y*.08,z:p.z+normal.z*.08};
  const stored={...command,surface:{voxelId,position:copy(p),normal:copy(normal)}};
  packages.set(command.id,{command:stored,position,normal,age:0});launched.add(command.id);return true;
 }
 function detonateAttached():Detonation[] {
  if(disposed)return [];
  const result:Detonation[]=[];
  for(const pack of packages.values())if(pack.command.epoch===epoch && (pack.command.surface.voxelId===null || terrain.has(pack.command.surface.voxelId)))result.push({id:pack.command.id,epoch,position:copy(pack.position),weapon:pack.command.weapon??'shock',power:pack.command.power,reason:'remote',age:pack.age});
  packages.clear();
  for(const ball of balls.values())if(isRemote(ball.command)){
   result.push({id:ball.command.id,epoch,position:copy(ball.body.translation()),weapon:ball.command.weapon,power:ball.command.power,reason:'remote',age:ball.age});
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
   results.push(...simulateStep(simulation).detonations);
   for(const pack of packages.values())pack.age+=STEP;
  }
  return results;
 }
 function getProjectiles():ProjectileView[] {
  return [
   ...[...balls.values()].map(ball=>({id:ball.command.id,position:copy(ball.body.translation()),radius:ball.radius,weapon:ball.command.weapon,age:ball.age,fuseRemaining:ball.command.weapon==='charge'&&!isRemote(ball.command)?Math.max(0,3-ball.age):null,velocity:copy(ball.body.linvel()),rotation:{...ball.body.rotation()},trigger:ball.command.trigger??'automatic',state:'flying' as const})),
   ...[...packages.values()].map(pack=>({id:pack.command.id,position:copy(pack.position),radius:weaponRadius(pack.command.weapon??'shock'),weapon:pack.command.weapon??'shock',age:pack.age,fuseRemaining:null,trigger:'remote' as const,state:'attached' as const,normal:copy(pack.normal),hostVoxelId:pack.command.surface.voxelId,velocity:{x:0,y:0,z:0}}))
  ];
 }
 return {syncVoxels,launch,preview,attach,detonateAttached,step,getProjectiles,dispose(){if(disposed)return;disposed=true;balls.clear();packages.clear();byCollider.clear();terrain.clear();launched.clear();events.free();world.free();}};
}
