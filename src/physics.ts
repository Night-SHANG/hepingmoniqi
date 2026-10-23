import RAPIER from '@dimforge/rapier3d-compat';
import type { AttachedCommand, Detonation, ProjectileCommand, ProjectilePhysics, ProjectileView, Vec3, Voxel } from './contracts.js';

// Fictional play-space constants. No real weapon or blast modelling.
const STEP = 1 / 120;
const MAX_FRAME_SECONDS = 1; // At most 120 solver steps per rendered frame.
const GRAVITY = 18;
const MAX_ACTIVE = 24;
const MAX_ATTACHED = 8;
const MAX_LIFETIME = 12;
const HALF_VOXEL = .4825;
let initialization: Promise<void> | undefined;
type Ball = { command: ProjectileCommand; body: RAPIER.RigidBody; collider: RAPIER.Collider; age: number; radius: number; contacted?:boolean };
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
 const packages = new Map<string,{command:AttachedCommand;position:Vec3;normal:Vec3;age:number}>();
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
   packages.clear(); launched.clear(); accumulator=0; epoch=nextEpoch;
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
  for(const [id,pack] of packages)if(!ids.has(pack.command.surface.voxelId))packages.delete(id);
 }
 function launch(command:ProjectileCommand):boolean {
  if(disposed || !command || typeof command.id!=='string' || !command.id.length || command.id.length>160 || command.epoch!==epoch || balls.size>=MAX_ACTIVE || launched.has(command.id) || !['pulse','charge'].includes(command.weapon) || !Number.isFinite(command.power) || command.power<=0 || command.power>3 || !finiteVector(command.origin) || !finiteVector(command.target))return false;
  const {origin:o,target:t}=command;
  const distance=Math.hypot(t.x-o.x,t.y-o.y,t.z-o.z);
  if(distance<.01)return false;
  const duration=Math.max(.45,Math.min(1.5,distance/26));
  // Aim defines only the initial velocity, never an explosion trigger or homing target.
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(o.x,o.y,o.z).setLinvel((t.x-o.x)/duration,(t.y-o.y)/duration+GRAVITY*duration/2,(t.z-o.z)/duration).setCcdEnabled(true));
  if(command.weapon==='charge')body.setAngvel({x:3.2,y:1.3,z:2.1},true);
  const radius=command.weapon==='charge'?.27:.2;
  const collider=world.createCollider(RAPIER.ColliderDesc.ball(radius).setRestitution(command.weapon==='charge'?.42:0).setFriction(.8).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),body);
  const stored={...command,origin:copy(o),target:copy(t)};
  balls.set(command.id,{command:stored,body,collider,age:0,radius});
  byCollider.set(collider.handle,command.id);launched.add(command.id);
  return true;
 }
 function attach(command:AttachedCommand):boolean {
  if(disposed || !command || typeof command.id!=='string' || !command.id.length || command.id.length>160 || command.epoch!==epoch || packages.size>=MAX_ATTACHED || launched.has(command.id) || !Number.isFinite(command.power) || command.power<=0 || command.power>3 || !command.surface || !Number.isSafeInteger(command.surface.voxelId) || !finiteVector(command.surface.position) || !finiteVector(command.surface.normal))return false;
  const host=terrain.get(command.surface.voxelId);if(!host)return false;
  const {position:p,normal:n}=command.surface;
  // Voxel faces are axis aligned. Validate a real outward face, not arbitrary
  // mouse coordinates or a vanished target. The renderer uses the same half size.
  const axes=['x','y','z'] as const;
  const axis=axes.find(a=>Math.abs(Math.abs(n[a])-1)<1e-4);
  if(!axis || axes.some(a=>a!==axis && Math.abs(n[a])>1e-4))return false;
  if(Math.abs((p[axis]-host.position[axis])*n[axis]-HALF_VOXEL)>.025 || axes.some(a=>a!==axis && Math.abs(p[a]-host.position[a])>HALF_VOXEL+.025))return false;
  const normal={x:0,y:0,z:0};normal[axis]=Math.sign(n[axis]);
  const position={x:p.x+normal.x*.08,y:p.y+normal.y*.08,z:p.z+normal.z*.08};
  const stored={...command,surface:{voxelId:command.surface.voxelId,position:copy(p),normal:copy(normal)}};
  packages.set(command.id,{command:stored,position,normal,age:0});launched.add(command.id);return true;
 }
 function detonateAttached():Detonation[] {
  if(disposed)return [];
  const result:Detonation[]=[];
  for(const pack of packages.values())if(pack.command.epoch===epoch && terrain.has(pack.command.surface.voxelId))result.push({id:pack.command.id,epoch,position:copy(pack.position),weapon:'shock',power:pack.command.power,reason:'remote',age:pack.age});
  packages.clear();return result;
 }
 function step(deltaSeconds:number):Detonation[] {
  const results:Detonation[]=[];
  if(disposed || !Number.isFinite(deltaSeconds) || deltaSeconds<=0)return results;
  // Preserve foreground elapsed time down to 1fps. Body and fuse always advance
  // together in fixed steps; exceptionally long stalls are bounded to avoid a spiral.
  // The caller passes zero during pause/hidden tabs and applies intentional slow motion.
  accumulator+=Math.min(deltaSeconds,MAX_FRAME_SECONDS);
  while(accumulator+1e-10>=STEP) {
   accumulator-=STEP;world.step(events);
   for(const ball of balls.values())ball.age+=STEP;
   for(const pack of packages.values())pack.age+=STEP;
   const impacts=new Set<string>();
   events.drainCollisionEvents((first,second,started)=>{
    if(!started)return;
    for(const handle of [first,second]){
     const id=byCollider.get(handle), ball=id===undefined?undefined:balls.get(id);
     if(ball && ball.command.weapon!=='charge')impacts.add(ball.command.id);
     else if(ball && !ball.contacted){
      // Stylized soft casing: keep a visible vertical bounce, but absorb most
      // lateral impact energy so the starter grenade stays near the hit surface.
      const v=ball.body.linvel();ball.body.setLinvel({x:v.x*.2,y:v.y,z:v.z*.2},true);
      ball.body.setLinearDamping(1.2);ball.body.setAngularDamping(.8);ball.contacted=true;
     }
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
  return [
   ...[...balls.values()].map(ball=>({id:ball.command.id,position:copy(ball.body.translation()),radius:ball.radius,weapon:ball.command.weapon,age:ball.age,fuseRemaining:ball.command.weapon==='charge'?Math.max(0,3-ball.age):null,velocity:copy(ball.body.linvel()),rotation:{...ball.body.rotation()},state:'flying' as const})),
   ...[...packages.values()].map(pack=>({id:pack.command.id,position:copy(pack.position),radius:.3,weapon:'shock' as const,age:pack.age,fuseRemaining:null,state:'attached' as const,normal:copy(pack.normal),hostVoxelId:pack.command.surface.voxelId,velocity:{x:0,y:0,z:0}}))
  ];
 }
 return {syncVoxels,launch,attach,detonateAttached,step,getProjectiles,dispose(){if(disposed)return;disposed=true;balls.clear();packages.clear();byCollider.clear();terrain.clear();launched.clear();events.free();world.free();}};
}
