import RAPIER from '@dimforge/rapier3d-compat';
import { ScaleAuthority } from './model.js';
import type { Point, Rotation } from '../structural/types.js';
import type { ScaleBox } from './fixture.js';

export interface ScaleDynamicsOptions {maxBodies?:number;stepSeconds?:number;maxStepsPerFrame?:number}
export interface ScaleProjectile {id:string;position:Point;velocity:Point;radius:number;gravityScale?:number}
export interface ScaleProjectileContact {id:string;epoch:number;targetRegionId:string;position:Point;tick:number}
export interface ScaleImpact {id:string;epoch:number;sourceRegionId:string;targetRegionId:string;damage:number;speed:number;tick:number;reason:'collision'|'escaped-world'}
export interface ScaleDynamicsStats {bodyCount:number;activeBodyCount:number;sleepingBodyCount:number;dynamicRegionCount:number;colliderCount:number;staticColliderCount:number;projectileCount:number;pendingGroups:number;oldestPendingTicks:number;aggregatedGroups:number;escapedBodies:number;escapedRegions:number;steps:number;debtSeconds:number;peakDebtSeconds:number;physicsMs:number;maxStepMs:number;nativeSnapshotBytes:number;snapshotMs:number;restoreMs:number}
const ZERO:Point={x:0,y:0,z:0},IDENTITY:Rotation={x:0,y:0,z:0,w:1};
const DENSITY={soil:5,road:6,wood:2,stone:8,roof:3,glass:1,foliage:.6,metal:10};
const clone=<T>(value:T):T=>structuredClone(value);
const p=(v:Point):Point=>({x:v.x,y:v.y,z:v.z});
const q=(v:Rotation):Rotation=>({...p(v),w:v.w});
const add=(a:Point,b:Point):Point=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const sub=(a:Point,b:Point):Point=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const len=(v:Point)=>Math.hypot(v.x,v.y,v.z);
const mul=(a:Rotation,b:Rotation):Rotation=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
const inverse=(a:Rotation):Rotation=>({x:-a.x,y:-a.y,z:-a.z,w:a.w});
function rotate(v:Point,r:Rotation):Point{const t=mul(mul(r,{...v,w:0}),inverse(r));return p(t);}
const pair=(a:string,b:string)=>JSON.stringify(a<b?[a,b]:[b,a]);
const finitePoint=(v:unknown):v is Point=>!!v&&typeof v==='object'&&['x','y','z'].every(k=>Number.isFinite((v as Record<string,number>)[k]));
const finiteRotation=(v:unknown):v is Rotation=>finitePoint(v)&&Number.isFinite((v as Rotation).w)&&Math.abs(Math.hypot(v.x,v.y,v.z,(v as Rotation).w)-1)<1e-4;
let initialization:Promise<void>|undefined;
type Region=ReturnType<ScaleAuthority['regionViews']>[number];
type Binding={regionId:string;colliders:RAPIER.Collider[];bodyId?:string;localPosition:Point;localRotation:Rotation;aliveCellCount:number};
type Body={id:string;native:RAPIER.RigidBody;regions:Set<string>;quiet:number;groupIds:Set<string>};
type Projectile={command:ScaleProjectile;native:RAPIER.RigidBody;collider:RAPIER.Collider};
type BodySave={id:string;handle?:number;position:Point;rotation:Rotation;velocity:Point;angularVelocity:Point;sleeping:boolean;quiet:number;regionIds:string[];groupIds:string[]};
type BindingSave={regionId:string;colliderHandles:number[];bodyId?:string;localPosition:Point;localRotation:Rotation;aliveCellCount:number};
export interface ScaleDynamicsSnapshot {schema:'scale-dynamics/v1';nativeBase64:string;bindings:BindingSave[];contacts:[string,[number,number]][];activeEpisodes:[string,number][];authority:ReturnType<ScaleAuthority['snapshot']>;epoch:number;tick:number;serial:number;accumulator:number;aggregatedGroups:number;escapedBodies:number;escapedRegions:number;bodies:BodySave[];projectiles:{command:ScaleProjectile;position:Point;velocity:Point;bodyHandle?:number;colliderHandle?:number}[];episodes:[string,number][];impacts:ScaleImpact[]}

/** One Rapier world owns terrain, falling masks, sleeping rubble and projectiles.
 * Saturation is an explicit approximation: nearest bodies share rigid motion,
 * but no occupied box, authoritative identity or damage transaction is dropped. */
export async function createScaleDynamics(authority:ScaleAuthority,options:ScaleDynamicsOptions={}){
 await (initialization??=RAPIER.init());
 const maxBodies=options.maxBodies??32,stepSeconds=options.stepSeconds??1/120,maxSteps=options.maxStepsPerFrame??16;
 if(!Number.isSafeInteger(maxBodies)||maxBodies<1||maxBodies>512||!Number.isFinite(stepSeconds)||stepSeconds<=0||stepSeconds>.1||!Number.isSafeInteger(maxSteps)||maxSteps<1)throw new RangeError('Invalid scale dynamics budget');
 let world=new RAPIER.World({x:0,y:-18,z:0}),events=new RAPIER.EventQueue(true);
 world.timestep=stepSeconds;world.integrationParameters.maxCcdSubsteps=4;
 const bindings=new Map<string,Binding>(),bodies=new Map<string,Body>(),colliderRegions=new Map<number,string>(),projectiles=new Map<string,Projectile>(),colliderProjectiles=new Map<number,string>();
 const activeContacts=new Map<string,[number,number]>(),episodeCounts=new Map<string,number>(),episodes=new Map<string,number>();
 let tick=0,serial=0,accumulator=0,aggregatedGroups=0,escapedBodies=0,escapedRegions=0,peakDebtSeconds=0,physicsMs=0,maxStepMs=0,nativeSnapshotBytes=0,snapshotMs=0,restoreMs=0,disposed=false,lastGeometryRevision=-1;
 const impactLog:ScaleImpact[]=[],projectileContacts:ScaleProjectileContact[]=[];
 function removeBinding(id:string){const b=bindings.get(id);if(!b)return;for(const collider of b.colliders){for(const [key,handles]of activeContacts)if(handles.includes(collider.handle))activeContacts.delete(key);colliderRegions.delete(collider.handle);world.removeCollider(collider,true);}bindings.delete(id);if(b.bodyId)bodies.get(b.bodyId)?.regions.delete(id);}
 function makeBinding(region:Region,body?:Body){
  const position=region.position,rotation=region.rotation,inv=body?inverse(q(body.native.rotation())):IDENTITY;
  const localPosition=body?rotate(sub(position,p(body.native.translation())),inv):p(position),localRotation=body?mul(inv,rotation):q(rotation);
  const colliders=authority.activeBoxes(region.id).map((box:ScaleBox)=>{
   const at=add(position,rotate(sub(box.center,region.center),rotation)),local=body?rotate(sub(at,p(body.native.translation())),inv):at;
   const desc=RAPIER.ColliderDesc.cuboid(box.halfExtents.x,box.halfExtents.y,box.halfExtents.z).setTranslation(local.x,local.y,local.z).setRotation(localRotation).setDensity(DENSITY[region.material]).setFriction(.8).setRestitution(0).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
   const collider=world.createCollider(desc,body?.native);colliderRegions.set(collider.handle,region.id);return collider;
  });
  bindings.set(region.id,{regionId:region.id,colliders,bodyId:body?.id,localPosition,localRotation,aliveCellCount:region.aliveCellCount});body?.regions.add(region.id);
 }
 function freshBody(position:Point,rotation:Rotation=IDENTITY,id=`body-${++serial}`,sleeping=false){
  const native=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x,position.y,position.z).setRotation(rotation).setCcdEnabled(true).setLinearDamping(.08).setAngularDamping(.18).setSleeping(sleeping));
  const body:Body={id,native,regions:new Set(),quiet:0,groupIds:new Set()};bodies.set(id,body);return body;
 }
 function cleanBodies(){for(const body of bodies.values())if(!body.regions.size){world.removeRigidBody(body.native);bodies.delete(body.id);}}
 function publishPoses(){for(const body of bodies.values()){
  const position=p(body.native.translation()),rotation=q(body.native.rotation()),status=body.native.isSleeping()?'rubble':'dynamic';
  for(const id of body.regions){const binding=bindings.get(id)!;authority.updateRegionPose(id,{position:add(position,rotate(binding.localPosition,rotation)),rotation:mul(rotation,binding.localRotation)},status);}
 }}
 function installPending(){
  for(const group of authority.pendingDetachedGroups()){
   const regions=group.regionIds.map(id=>authority.region(id)).filter((r):r is Region=>!!r&&r.state!=='gone');
   if(!regions.length){authority.acknowledgeDetachedGroup(group.id);continue;}
   if(regions.every(r=>bindings.get(r.id)?.bodyId)){authority.acknowledgeDetachedGroup(group.id);continue;}
   let body:Body;
   if(bodies.size<maxBodies)body=freshBody(group.originalCenter);
   else{body=[...bodies.values()].sort((a,b)=>len(sub(p(a.native.translation()),group.originalCenter))-len(sub(p(b.native.translation()),group.originalCenter))||a.id.localeCompare(b.id))[0];aggregatedGroups++;}
   // Preserve the current pose of both cohorts and conserve their total linear
   // momentum when disconnected groups share a capped body. No teleport to seed.
   const oldMass=body.native.mass(),oldVelocity=p(body.native.linvel());
   body.groupIds.add(group.id);
   for(const r of regions){if(bindings.get(r.id)?.bodyId===body.id)continue;removeBinding(r.id);makeBinding(r,body);}
   body.native.recomputeMassPropertiesFromColliders();
   const totalMass=body.native.mass();
   if(oldMass>0&&totalMass>0)body.native.setLinvel({x:oldVelocity.x*oldMass/totalMass,y:oldVelocity.y*oldMass/totalMass,z:oldVelocity.z*oldMass/totalMass},true);
   body.native.wakeUp();body.quiet=0;authority.acknowledgeDetachedGroup(group.id);
  }
 }
 function sync(ids?:readonly string[],publish=true){
  if(disposed)throw new Error('Scale dynamics is disposed');
  const regions=ids?ids.map(id=>authority.region(id)).filter((r):r is Region=>!!r):authority.regionViews();
  for(const r of regions){
   const existing=bindings.get(r.id);
   if(r.state==='gone'||r.aliveCellCount===0){removeBinding(r.id);continue;}
   if(existing&&existing.aliveCellCount!==r.aliveCellCount){const body=existing.bodyId?bodies.get(existing.bodyId):undefined;removeBinding(r.id);makeBinding(r,body);}
   else if(!existing&&r.state==='static')makeBinding(r);
  }
  cleanBodies();installPending();if(publish)publishPoses();lastGeometryRevision=authority.geometryRevision;
 }
 function contactNormal(a:RAPIER.Collider,b:RAPIER.Collider):Point{
  let normal:Point|undefined;
  world.contactPair(a,b,m=>{if(!normal&&m.numSolverContacts())normal=p(m.normal());});
  const toward=sub(p(b.translation()),p(a.translation()));
  if(!normal){const length=len(toward);normal=length?{x:toward.x/length,y:toward.y/length,z:toward.z/length}:{x:0,y:-1,z:0};}
  if(normal.x*toward.x+normal.y*toward.y+normal.z*toward.z<0)normal={x:-normal.x,y:-normal.y,z:-normal.z};
  return normal;
 }
 function singleStep(){
  const started=performance.now();tick++;
  const velocities=new Map<string,{velocity:Point;angular:Point;center:Point}>();
  for(const body of bodies.values())velocities.set(body.id,{velocity:p(body.native.linvel()),angular:p(body.native.angvel()),center:p(body.native.worldCom())});
  world.step(events);
  const newContacts:[number,number][]=[];
  events.drainCollisionEvents((a,b,began)=>{const key=a<b?`${a},${b}`:`${b},${a}`;if(began){activeContacts.set(key,[a,b]);newContacts.push([a,b]);}else activeContacts.delete(key);});
  const touching=new Set<string>(),supported=new Set<string>();
  for(const [contactKey,[a,b]] of activeContacts){
   const ca=world.getCollider(a),cb=world.getCollider(b);if(!ca||!cb){activeContacts.delete(contactKey);continue;}
   const ra=colliderRegions.get(a),rb=colliderRegions.get(b);if(!ra||!rb||ra===rb)continue;
   touching.add(pair(ra,rb));
   const ba=bindings.get(ra)?.bodyId,bb=bindings.get(rb)?.bodyId;
   if(ba&&ba!==bb)supported.add(ba);if(bb&&bb!==ba)supported.add(bb);
  }
  // Restored sleepers have no serialized native contact cache. Probe actual
  // nearby shapes after the first real step, rather than waking rubble merely
  // because the event queue has not emitted a fresh collision-start episode.
  for(const body of bodies.values())if(body.native.isSleeping()&&!supported.has(body.id)){
   for(const id of body.regions){
    for(const collider of bindings.get(id)!.colliders){
     const half=collider.halfExtents();if(!half)continue;
     const radius=Math.hypot(half.x,half.y,half.z)+.04;
     world.collidersWithAabbIntersectingAabb(collider.translation(),{x:radius,y:radius,z:radius},other=>{
      const otherId=colliderRegions.get(other.handle);if(!otherId||bindings.get(otherId)?.bodyId===body.id)return true;
      if(collider.contactCollider(other,.04)){supported.add(body.id);return false;}return true;
     });
     if(supported.has(body.id))break;
    }
    if(supported.has(body.id))break;
   }
  }
  for(const key of episodes.keys())if(!touching.has(key))episodes.delete(key);
  const actions:{sourceId:string;targetId:string;damage:number;speed:number;id:string}[]=[];
  for(const [a,b]of newContacts){
   for(const [ph,rh]of [[a,b],[b,a]]){const projectileId=colliderProjectiles.get(ph),targetRegionId=colliderRegions.get(rh);if(projectileId&&targetRegionId){const projectile=projectiles.get(projectileId);if(projectile)projectileContacts.push({id:projectileId,epoch:authority.epoch,targetRegionId,position:p(projectile.native.translation()),tick});}}
   const ra=colliderRegions.get(a),rb=colliderRegions.get(b);if(!ra||!rb||ra===rb)continue;
   const key=pair(ra,rb);if(episodes.has(key))continue;
   const count=(episodeCounts.get(key)??0)+1;episodeCounts.set(key,count);episodes.set(key,count);
   const ca=world.getCollider(a),cb=world.getCollider(b);if(!ca||!cb)continue;
   const ba=bindings.get(ra)?.bodyId,bb=bindings.get(rb)?.bodyId;if(ba&&ba===bb)continue;
   const normal=contactNormal(ca,cb);
   const at=add(p(ca.translation()),p(cb.translation()));at.x/=2;at.y/=2;at.z/=2;
   const velocity=(id:string|undefined)=>{const v=id?velocities.get(id):undefined;if(!v)return ZERO;const arm=sub(at,v.center);return {x:v.velocity.x+v.angular.y*arm.z-v.angular.z*arm.y,y:v.velocity.y+v.angular.z*arm.x-v.angular.x*arm.z,z:v.velocity.z+v.angular.x*arm.y-v.angular.y*arm.x};};
   const relative=sub(velocity(ba),velocity(bb)),speed=relative.x*normal.x+relative.y*normal.y+relative.z*normal.z;
   if(speed<2.5)continue;
   for(const [sourceId,targetId,sourceBody]of [[ra,rb,ba],[rb,ra,bb]] as const){
    if(!sourceBody)continue;const mass=bodies.get(sourceBody)?.native.mass()??0;
    const damage=Math.min(100,.0125*Math.min(128,mass)*speed*speed);
    actions.push({sourceId,targetId,damage,speed,id:`${authority.epoch}:impact:${key}:${count}:${targetId}`});
   }
  }
  publishPoses();
  const changed=new Set<string>();
  for(const action of actions){
   const previousHp=authority.region(action.targetId)?.hp??0;
   const result=authority.applyImpact({id:action.id,epoch:authority.epoch,targetRegionIds:[action.targetId],damage:action.damage});
   if(result.accepted){const committed=previousHp-(authority.region(action.targetId)?.hp??0);if(committed>0)impactLog.push({id:action.id,epoch:authority.epoch,sourceRegionId:action.sourceId,targetRegionId:action.targetId,damage:committed,speed:action.speed,tick,reason:'collision'});for(const id of result.changedRegionIds)changed.add(id);}
  }
  if(changed.size)sync([...changed]);
  for(const body of [...bodies.values()]){
   const below=[...body.regions].every(id=>bindings.get(id)!.colliders.every(c=>{
    const half=c.halfExtents(),rotation=q(c.rotation());if(!half)return false;
    const extent=Math.abs(2*(rotation.x*rotation.y+rotation.z*rotation.w))*half.x+Math.abs(1-2*(rotation.x*rotation.x+rotation.z*rotation.z))*half.y+Math.abs(2*(rotation.y*rotation.z-rotation.x*rotation.w))*half.z;
    return c.translation().y+extent<authority.fixture.bounds.minY-64;
   }));
   if(below){const ids=[...body.regions],previousHp=new Map(ids.map(id=>[id,authority.region(id)?.hp??0])),id=`${authority.epoch}:escape:${body.id}`;const result=authority.applyImpact({id,epoch:authority.epoch,targetRegionIds:ids,damage:Number.MAX_SAFE_INTEGER});if(result.accepted){escapedBodies++;escapedRegions+=ids.length;for(const targetRegionId of ids)impactLog.push({id:`${id}:${targetRegionId}`,epoch:authority.epoch,sourceRegionId:targetRegionId,targetRegionId,damage:previousHp.get(targetRegionId)!-(authority.region(targetRegionId)?.hp??0),speed:len(body.native.linvel()),tick,reason:'escaped-world'});sync(result.changedRegionIds);}continue;}
   const quiet=supported.has(body.id)&&len(body.native.linvel())<.18&&len(body.native.angvel())<.18;
   body.quiet=quiet?body.quiet+1:0;
   if(body.quiet>=90)body.native.sleep();
   // A sleeping island with no contact must not hover after terrain excavation.
   if(body.native.isSleeping()&&!supported.has(body.id))body.native.wakeUp();
  }
  publishPoses();
  const elapsed=performance.now()-started;physicsMs+=elapsed;maxStepMs=Math.max(maxStepMs,elapsed);
 }
 function launchProjectile(command:ScaleProjectile){
  if(!command.id||projectiles.has(command.id)||!finitePoint(command.position)||!finitePoint(command.velocity)||!Number.isFinite(command.radius)||command.radius<=0||command.radius>10||!Number.isFinite(command.gravityScale??1))throw new Error('Invalid or duplicate scale projectile');
  const native=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(command.position.x,command.position.y,command.position.z).setLinvel(command.velocity.x,command.velocity.y,command.velocity.z).setGravityScale(command.gravityScale??1).setCcdEnabled(true));
  const collider=world.createCollider(RAPIER.ColliderDesc.ball(command.radius).setDensity(.1).setRestitution(0).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),native);
  projectiles.set(command.id,{command:clone(command),native,collider});colliderProjectiles.set(collider.handle,command.id);
 }
 function clearWorld(){events.free();world.free();world=new RAPIER.World({x:0,y:-18,z:0});world.timestep=stepSeconds;world.integrationParameters.maxCcdSubsteps=4;events=new RAPIER.EventQueue(true);bindings.clear();bodies.clear();colliderRegions.clear();projectiles.clear();colliderProjectiles.clear();activeContacts.clear();episodes.clear();episodeCounts.clear();projectileContacts.length=0;}
 function encodeNative(bytes:Uint8Array){const parts:string[]=[];for(let i=0;i<bytes.length;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));return btoa(parts.join(''));}
 function decodeNative(encoded:string){const binary=atob(encoded),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}
 function snapshot():ScaleDynamicsSnapshot{
  if(authority.geometryRevision!==lastGeometryRevision)sync();
  const started=performance.now(),bytes=world.takeSnapshot();nativeSnapshotBytes=bytes.byteLength;
  const result:ScaleDynamicsSnapshot={schema:'scale-dynamics/v1',nativeBase64:encodeNative(bytes),bindings:[...bindings.values()].map(b=>({regionId:b.regionId,colliderHandles:b.colliders.map(c=>c.handle),bodyId:b.bodyId,localPosition:p(b.localPosition),localRotation:q(b.localRotation),aliveCellCount:b.aliveCellCount})),contacts:[...activeContacts].map(([key,value])=>[key,[...value]]),activeEpisodes:[...episodes],authority:authority.snapshot(),epoch:authority.epoch,tick,serial,accumulator,aggregatedGroups,escapedBodies,escapedRegions,bodies:[...bodies.values()].map(b=>({id:b.id,handle:b.native.handle,position:p(b.native.translation()),rotation:q(b.native.rotation()),velocity:p(b.native.linvel()),angularVelocity:p(b.native.angvel()),sleeping:b.native.isSleeping(),quiet:b.quiet,regionIds:[...b.regions],groupIds:[...b.groupIds]})),projectiles:[...projectiles.values()].map(v=>({command:clone(v.command),position:p(v.native.translation()),velocity:p(v.native.linvel()),bodyHandle:v.native.handle,colliderHandle:v.collider.handle})),episodes:[...episodeCounts],impacts:clone(impactLog)};
  snapshotMs=performance.now()-started;return result;
 }
 function validSnapshot(s:ScaleDynamicsSnapshot):ScaleAuthority|undefined{
  try{
   if(!s||s.schema!=='scale-dynamics/v1'||!s.authority||s.epoch!==s.authority.epoch||!Array.isArray(s.bodies)||s.bodies.length>maxBodies||!Array.isArray(s.projectiles)||!Array.isArray(s.episodes)||!Array.isArray(s.impacts)||![s.epoch,s.tick,s.serial,s.aggregatedGroups,s.escapedBodies,s.escapedRegions].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isFinite(s.accumulator)||s.accumulator<0)return undefined;
   // Validate authority in a plain-data model, before changing either the live
   // authority or native world. There is still exactly one native physics host.
   const candidate=new ScaleAuthority(authority.fixture);if(!candidate.restore(s.authority))return undefined;
   const seen=new Set<string>(),bodyIds=new Set<string>(),groupIds=new Set(s.authority.groups.map(g=>g.id));
   for(const b of s.bodies){
    if(!/^body-\d+$/.test(b.id)||Number(b.id.slice(5))>s.serial||bodyIds.has(b.id)||!finitePoint(b.position)||!finiteRotation(b.rotation)||!finitePoint(b.velocity)||!finitePoint(b.angularVelocity)||typeof b.sleeping!=='boolean'||!Array.isArray(b.regionIds)||!b.regionIds.length||!Array.isArray(b.groupIds)||new Set(b.groupIds).size!==b.groupIds.length||b.groupIds.some(id=>!groupIds.has(id))||!Number.isSafeInteger(b.quiet)||b.quiet<0)return undefined;
    bodyIds.add(b.id);
    for(const id of b.regionIds){const r=candidate.region(id);if(seen.has(id)||!r||!['dynamic','rubble'].includes(r.state)||!r.groupId||!b.groupIds.includes(r.groupId))return undefined;seen.add(id);}
   }
   const pending=new Set(candidate.pendingDetachedGroups().flatMap(g=>g.regionIds));
   for(const r of candidate.regionViews())if((r.state==='dynamic'||r.state==='rubble')&&!seen.has(r.id)&&!pending.has(r.id))return undefined;
   const projectileIds=new Set<string>();
   for(const v of s.projectiles){const c=v.command;if(!c?.id||projectileIds.has(c.id)||!finitePoint(v.position)||!finitePoint(v.velocity)||!finitePoint(c.position)||!finitePoint(c.velocity)||!Number.isFinite(c.radius)||c.radius<=0||c.radius>10||!Number.isFinite(c.gravityScale??1))return undefined;projectileIds.add(c.id);}
   const episodeKeys=new Set<string>();
   for(const [key,count]of s.episodes){if(episodeKeys.has(key)||!Number.isSafeInteger(count)||count<1)return undefined;const ids=JSON.parse(key);if(!Array.isArray(ids)||ids.length!==2||!ids.every(id=>candidate.region(id)))return undefined;episodeKeys.add(key);}
   for(const e of s.impacts)if(!e||typeof e.id!=='string'||e.epoch!==s.epoch||!candidate.region(e.sourceRegionId)||!candidate.region(e.targetRegionId)||!Number.isFinite(e.damage)||e.damage<0||!Number.isFinite(e.speed)||e.speed<0||!Number.isSafeInteger(e.tick)||e.tick<0||e.tick>s.tick||!['collision','escaped-world'].includes(e.reason))return undefined;
   return candidate;
  }catch{return undefined;}
 }
 function restore(input:unknown):boolean{
  const started=performance.now(),s=input as ScaleDynamicsSnapshot,candidateModel=validSnapshot(s);
  if(!candidateModel||typeof s.nativeBase64!=='string'||!s.nativeBase64.length||s.nativeBase64.length>256*1024*1024||!Array.isArray(s.bindings)||!Array.isArray(s.contacts)||!Array.isArray(s.activeEpisodes))return false;
  let candidate:RAPIER.World|undefined;
  try{
   const bytes=decodeNative(s.nativeBase64);candidate=RAPIER.World.restoreSnapshot(bytes);
   if(!candidate||candidate.bodies.len()!==s.bodies.length+s.projectiles.length||candidate.colliders.len()!==s.bindings.reduce((n,b)=>n+b.colliderHandles.length,0)+s.projectiles.length)throw new Error('Native inventory mismatch');
   if(Math.abs(candidate.timestep-stepSeconds)>1e-7||len(sub(candidate.gravity,{x:0,y:-18,z:0}))>1e-6)throw new Error('Native world settings mismatch');
   const close=(a:Point,b:Point)=>len(sub(a,b))<1e-4,bodyById=new Map(s.bodies.map(b=>[b.id,b])),bodyHandles=new Set<number>(),colliderHandles=new Set<number>(),boundIds=new Set<string>();
   for(const b of s.bodies){
    if(!Number.isFinite(b.handle)||bodyHandles.has(b.handle!))throw new Error('Native body handle mismatch');
    const native=candidate.getRigidBody(b.handle!);if(!native||!native.isDynamic()||native.isSleeping()!==b.sleeping||!close(native.translation(),b.position)||!close(native.linvel(),b.velocity)||!close(native.angvel(),b.angularVelocity)||Math.abs(Math.abs(native.rotation().x*b.rotation.x+native.rotation().y*b.rotation.y+native.rotation().z*b.rotation.z+native.rotation().w*b.rotation.w)-1)>1e-4)throw new Error('Native body state mismatch');bodyHandles.add(b.handle!);
   }
   for(const b of s.bindings){
    const r=candidateModel.region(b.regionId),body=b.bodyId?bodyById.get(b.bodyId):undefined;
    if(!r||r.state==='gone'||boundIds.has(b.regionId)||!finitePoint(b.localPosition)||!finiteRotation(b.localRotation)||b.aliveCellCount!==r.aliveCellCount||!Array.isArray(b.colliderHandles)||b.bodyId&&!body||!b.bodyId&&r.state!=='static'||body&&!body.regionIds.includes(r.id))throw new Error('Native region binding mismatch');
    const boxes=candidateModel.activeBoxes(r.id);if(boxes.length!==b.colliderHandles.length)throw new Error('Native occupied mask mismatch');boundIds.add(r.id);
    for(let i=0;i<boxes.length;i++){
     const handle=b.colliderHandles[i];if(!Number.isFinite(handle)||colliderHandles.has(handle))throw new Error('Duplicate native collider');
     const collider=candidate.getCollider(handle),box=boxes[i],half=collider?.halfExtents(),offset=rotate(sub(box.center,r.center),r.rotation);
     // Rapier 0.21's restored JS wrapper can cache body zero as the parent of
     // a parentless collider; the serialized native parent is authoritative.
     const parent=candidate.colliders.raw.coParent(handle);
     if(!collider||!half||!close(half,box.halfExtents)||!close(collider.translation(),add(r.position,offset))||(body?parent!==body.handle:parent!==undefined))throw new Error('Native shape does not match authority');
     const rotation=collider.rotation();if(Math.abs(Math.abs(rotation.x*r.rotation.x+rotation.y*r.rotation.y+rotation.z*r.rotation.z+rotation.w*r.rotation.w)-1)>1e-4)throw new Error('Native rotation mismatch');colliderHandles.add(handle);
    }
    if(body){const native=candidate.getRigidBody(body.handle!)!;if(!close(add(p(native.translation()),rotate(b.localPosition,q(native.rotation()))),r.position))throw new Error('Native local pose mismatch');}
   }
   for(const r of candidateModel.regionViews())if(r.state!=='gone'&&!boundIds.has(r.id))throw new Error('Missing occupied region binding');
   for(const v of s.projectiles){
    if(!Number.isFinite(v.bodyHandle)||!Number.isFinite(v.colliderHandle)||bodyHandles.has(v.bodyHandle!)||colliderHandles.has(v.colliderHandle!))throw new Error('Native projectile handle mismatch');
    const body=candidate.getRigidBody(v.bodyHandle!),collider=candidate.getCollider(v.colliderHandle!);
    if(!body||!collider||!body.isDynamic()||collider.parent()?.handle!==body.handle||!close(body.translation(),v.position)||!close(body.linvel(),v.velocity)||Math.abs(collider.radius()-v.command.radius)>1e-6)throw new Error('Native projectile mismatch');bodyHandles.add(v.bodyHandle!);colliderHandles.add(v.colliderHandle!);
   }
   for(const [key,handles]of s.contacts)if(typeof key!=='string'||!Array.isArray(handles)||handles.length!==2||!handles.every(h=>colliderHandles.has(h)))throw new Error('Native contact mismatch');
   const counts=new Map(s.episodes);for(const [key,count]of s.activeEpisodes)if(counts.get(key)!==count)throw new Error('Native episode mismatch');
   // Everything, including native handles and occupied shape masks, is now
   // validated. The temporary candidate was never stepped or made authoritative.
   if(!authority.restore(s.authority))throw new Error('Authority changed during restore');
   events.free();world.free();world=candidate;candidate=undefined;events=new RAPIER.EventQueue(true);
   bindings.clear();bodies.clear();colliderRegions.clear();projectiles.clear();colliderProjectiles.clear();activeContacts.clear();episodes.clear();episodeCounts.clear();projectileContacts.length=0;
   for(const b of s.bodies)bodies.set(b.id,{id:b.id,native:world.getRigidBody(b.handle!)!,regions:new Set(b.regionIds),groupIds:new Set(b.groupIds),quiet:b.quiet});
   for(const b of s.bindings){const colliders=b.colliderHandles.map(h=>world.getCollider(h)!);bindings.set(b.regionId,{regionId:b.regionId,colliders,bodyId:b.bodyId,localPosition:p(b.localPosition),localRotation:q(b.localRotation),aliveCellCount:b.aliveCellCount});for(const collider of colliders)colliderRegions.set(collider.handle,b.regionId);}
   for(const v of s.projectiles){const native=world.getRigidBody(v.bodyHandle!)!,collider=world.getCollider(v.colliderHandle!)!;projectiles.set(v.command.id,{command:clone(v.command),native,collider});colliderProjectiles.set(collider.handle,v.command.id);}
   for(const [key,handles]of s.contacts)activeContacts.set(key,[...handles]);for(const [key,count]of s.activeEpisodes)episodes.set(key,count);for(const [key,count]of s.episodes)episodeCounts.set(key,count);
   tick=s.tick;serial=s.serial;accumulator=s.accumulator;aggregatedGroups=s.aggregatedGroups;escapedBodies=s.escapedBodies;escapedRegions=s.escapedRegions;impactLog.splice(0,impactLog.length,...clone(s.impacts));lastGeometryRevision=authority.geometryRevision;
   nativeSnapshotBytes=bytes.byteLength;restoreMs=performance.now()-started;return true;
  }catch{candidate?.free();return false;}
 }
 const api={
  get world(){return world;},get epoch(){return authority.epoch;},sync,
  movingRegionIds(){return [...bodies.values()].flatMap(body=>[...body.regions]);},
  step(dt:number){if(!Number.isFinite(dt)||dt<0)throw new RangeError('Invalid scale physics time');if(authority.geometryRevision!==lastGeometryRevision)sync();accumulator+=dt;peakDebtSeconds=Math.max(peakDebtSeconds,accumulator);let steps=0;while(accumulator+1e-10>=stepSeconds&&steps<maxSteps){singleStep();accumulator=Math.max(0,accumulator-stepSeconds);steps++;}return steps;},
  launchProjectile,
  projectile(id:string){const v=projectiles.get(id);return v?{id,position:p(v.native.translation()),velocity:p(v.native.linvel()),radius:v.command.radius}:undefined;},
  removeProjectile(id:string){const v=projectiles.get(id);if(!v)return false;colliderProjectiles.delete(v.collider.handle);world.removeRigidBody(v.native);projectiles.delete(id);return true;},
  drainProjectileContacts(){return projectileContacts.splice(0).map(v=>clone(v));},
  impacts(){return clone(impactLog);},
  stats():ScaleDynamicsStats{return {bodyCount:bodies.size,activeBodyCount:[...bodies.values()].filter(b=>!b.native.isSleeping()).length,sleepingBodyCount:[...bodies.values()].filter(b=>b.native.isSleeping()).length,dynamicRegionCount:[...bindings.values()].filter(b=>b.bodyId).length,colliderCount:world.colliders.len(),staticColliderCount:[...bindings.values()].filter(b=>!b.bodyId).reduce((n,b)=>n+b.colliders.length,0),projectileCount:projectiles.size,pendingGroups:authority.pendingDetachedGroups().length,oldestPendingTicks:0,aggregatedGroups,escapedBodies,escapedRegions,steps:tick,debtSeconds:accumulator,peakDebtSeconds,physicsMs,maxStepMs,nativeSnapshotBytes,snapshotMs,restoreMs};},
  snapshot,restore,
  reset(){authority.reset();clearWorld();tick=0;serial=0;accumulator=0;aggregatedGroups=0;escapedBodies=0;escapedRegions=0;peakDebtSeconds=0;physicsMs=0;maxStepMs=0;nativeSnapshotBytes=0;snapshotMs=0;restoreMs=0;impactLog.length=0;sync();},
  dispose(){if(disposed)return;disposed=true;events.free();world.free();bindings.clear();bodies.clear();projectiles.clear();},
 };
 sync();return api;
}
export type ScaleDynamics=Awaited<ReturnType<typeof createScaleDynamics>>;
