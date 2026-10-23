import RAPIER from '@dimforge/rapier3d-compat';
import type { Detonation, ProjectileCommand, ProjectilePhysics, ProjectileView, Vec3, Voxel } from './contracts.js';

// Fictional play-space constants. No real weapon or blast modelling.
const STEP = 1 / 120;
const GRAVITY = 18;
const MAX_ACTIVE = 24;
const MAX_LIFETIME = 12;
const HALF_VOXEL = .4825;
let initialization: Promise<void> | undefined;
type Ball = { command: ProjectileCommand; body: RAPIER.RigidBody; collider: RAPIER.Collider; age: number; radius: number };
const finiteVector = (p: Vec3) => p && [p.x,p.y,p.z].every(n => Number.isFinite(n) && Math.abs(n) <= 10000);
const copy = (p: Vec3):Vec3 => ({x:p.x,y:p.y,z:p.z});

export async function createProjectilePhysics(): Promise<ProjectilePhysics> {
 await (initialization ??= RAPIER.init());
 const world = new RAPIER.World({x:0,y:-GRAVITY,z:0});
 world.timestep = STEP;
 world.integrationParameters.maxCcdSubsteps = 4;
 const events = new RAPIER.EventQueue(true);
 // The unbreakable terrain substrate sits below the destructible lattice.
 world.createCollider(RAPIER.ColliderDesc.cuboid(27,.5,22).setTranslation(0,-1,0).setFriction(.85));
 const terrain = new Map<number,{collider:RAPIER.Collider;position:Vec3}>();
 const balls = new Map<string,Ball>();
 const byCollider = new Map<number,string>();
 const launched = new Set<string>();
 let epoch = 0, accumulator = 0, disposed = false;
 function remove(ball:Ball) {
  byCollider.delete(ball.collider.handle);
  balls.delete(ball.command.id);
  world.removeRigidBody(ball.body);
 }
 function syncVoxels(voxels:readonly Voxel[], nextEpoch:number) {
  if(disposed) return;
  if(nextEpoch !== epoch) {
   for(const ball of balls.values()) remove(ball);
   launched.clear(); accumulator=0; epoch=nextEpoch;
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
 }
 function launch(command:ProjectileCommand):boolean {
  if(disposed || !command || typeof command.id!=='string' || !command.id.length || command.id.length>160 || command.epoch!==epoch || balls.size>=MAX_ACTIVE || launched.has(command.id) || !['pulse','charge','shock'].includes(command.weapon) || !Number.isFinite(command.power) || command.power<=0 || command.power>3 || !finiteVector(command.origin) || !finiteVector(command.target))return false;
  const {origin:o,target:t}=command;
  const distance=Math.hypot(t.x-o.x,t.y-o.y,t.z-o.z);
  if(distance<.01)return false;
  const duration=Math.max(.45,Math.min(1.5,distance/26));
  // Aim defines only the initial velocity, never an explosion trigger or homing target.
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(o.x,o.y,o.z).setLinvel((t.x-o.x)/duration,(t.y-o.y)/duration+GRAVITY*duration/2,(t.z-o.z)/duration).setCcdEnabled(true));
  const radius=command.weapon==='charge'?.27:command.weapon==='shock'?.25:.2;
  const collider=world.createCollider(RAPIER.ColliderDesc.ball(radius).setRestitution(command.weapon==='charge'?.42:0).setFriction(.8).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),body);
  const stored={...command,origin:copy(o),target:copy(t)};
  balls.set(command.id,{command:stored,body,collider,age:0,radius});
  byCollider.set(collider.handle,command.id);launched.add(command.id);
  return true;
 }
 function step(deltaSeconds:number):Detonation[] {
  const results:Detonation[]=[];
  if(disposed || !Number.isFinite(deltaSeconds) || deltaSeconds<=0)return results;
  // Discard long background-tab gaps rather than teleporting shots or detonating during pause.
  accumulator+=Math.min(deltaSeconds,.25);
  while(accumulator+1e-10>=STEP) {
   accumulator-=STEP;world.step(events);
   for(const ball of balls.values())ball.age+=STEP;
   const impacts=new Set<string>();
   events.drainCollisionEvents((first,second,started)=>{
    if(!started)return;
    for(const handle of [first,second]){
     const id=byCollider.get(handle), ball=id===undefined?undefined:balls.get(id);
     if(ball && ball.command.weapon!=='charge')impacts.add(ball.command.id);
    }
   });
   for(const ball of balls.values()) {
    const timed=ball.command.weapon==='charge' && ball.age+1e-9>=3;
    const impact=impacts.has(ball.command.id);
    if(timed || impact) {
     results.push({id:ball.command.id,epoch:ball.command.epoch,position:copy(ball.body.translation()),weapon:ball.command.weapon,power:ball.command.power,reason:timed?'timer':'impact',age:ball.age});
     remove(ball);
    } else if(ball.age>=MAX_LIFETIME || ball.body.translation().y < -100 || Math.hypot(ball.body.translation().x,ball.body.translation().z)>300)remove(ball);
   }
  }
  return results;
 }
 function getProjectiles():ProjectileView[] {
  return [...balls.values()].map(ball=>({id:ball.command.id,position:copy(ball.body.translation()),radius:ball.radius,weapon:ball.command.weapon,age:ball.age,fuseRemaining:ball.command.weapon==='charge'?Math.max(0,3-ball.age):null}));
 }
 return {syncVoxels,launch,step,getProjectiles,dispose(){if(disposed)return;disposed=true;balls.clear();byCollider.clear();terrain.clear();launched.clear();events.free();world.free();}};
}
