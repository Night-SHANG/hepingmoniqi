import RAPIER from '@dimforge/rapier3d-compat';
import type { CollisionRecord, ForceRecord, PhysicsParticipant, StructuralPhysicsHost } from './physics-host.js';
import { chunkKey, packStaticCells, type PackedBox } from './static-packing.js';
import { createSupportGraph } from './support.js';
import type { BlastCommand, Cell, CellView, Point, Rotation, SceneFixture, StructuralEvent, StructuralSimulation, SupportGraph } from './types.js';

// Fictional game rules, not a physical blast/engineering model. One metre lattice cells.
const DT=1/120, QUIET_TICKS=90, MIN_SPEED=3, MIN_IMPULSE=.5;
const IDENTITY:Rotation={x:0,y:0,z:0,w:1};
const ZERO:Point={x:0,y:0,z:0};
const copy=<T>(v:T):T=>structuredClone(v);
const point=(p:Point):Point=>({x:p.x,y:p.y,z:p.z});
const rotation=(q:Rotation):Rotation=>({x:q.x,y:q.y,z:q.z,w:q.w});
const multiply=(a:Rotation,b:Rotation):Rotation=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
const rotate=(p:Point,q:Rotation):Point=>{const v=multiply(multiply(q,{...p,w:0}),{x:-q.x,y:-q.y,z:-q.z,w:q.w});return point(v);};
const length=(p:Point)=>Math.hypot(p.x,p.y,p.z);
const pair=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;
const finitePoint=(p:any):p is Point=>!!p&&['x','y','z'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])&&Math.abs(p[k])<=1e9);
const finiteRotation=(q:any):q is Rotation=>finitePoint(q)&&typeof (q as Rotation).w==='number'&&Number.isFinite((q as Rotation).w)&&Math.abs(Math.hypot(q.x,q.y,q.z,(q as Rotation).w)-1)<1e-4;
const MASS:Record<Cell['material'],number>={soil:5,road:6,wood:2,stone:8,roof:3,glass:1,foliage:.6,metal:10};
let initialized:Promise<void>|undefined;
interface State { spec:Cell; hp:number; loss:number; state:CellView['state']; position:Point; rotation:Rotation; chunkId?:string }
interface Chunk { id:string; cells:number[]; rootShotId:string; status:'active'|'queued'|'rubble'; position:Point; rotation:Rotation; linvel:Point; angvel:Point; quiet:number; body?:RAPIER.RigidBody }
interface Episode { n:number; credited:boolean }
interface CellSave { id:number; hp:number; loss:number; state:CellView['state']; position:Point; rotation:Rotation; chunkId?:string }
interface LocalCell { id:number; position:Point; rotation:Rotation }
interface ChunkSave { transforms:LocalCell[]; id:string; cells:number[]; rootShotId:string; status:'active'|'queued'|'rubble'; position:Point; rotation:Rotation; linvel:Point; angvel:Point; quiet:number }
interface Save { schema:'structural-simulation/v1'; fixtureId:string; fixtureSignature:string; maxActiveBodies:number; epoch:number; tick:number; accumulator:number; serial:number; cells:CellSave[]; bodies:ChunkSave[]; queue:string[]; shots:string[]; processed:string[]; episodes:[string,Episode][]; episodeCounts:[string,number][]; research:number; events:StructuralEvent[] }

export async function createStructuralSimulation(fixture:SceneFixture,options:{maxActiveBodies?:number}={}):Promise<StructuralSimulation & {physicsHost:StructuralPhysicsHost}>{
 await (initialized??=RAPIER.init());
 const maxActiveBodies=options.maxActiveBodies??32;
 if(!Number.isSafeInteger(maxActiveBodies)||maxActiveBodies<1||maxActiveBodies>512)throw new Error('Invalid active body budget');
 if(!fixture||typeof fixture.id!=='string'||!fixture.id||!Array.isArray(fixture.cells))throw new Error('Invalid fixture');
 const ids=new Set<number>();
 for(const c of fixture.cells){if(!Number.isSafeInteger(c.id)||ids.has(c.id)||!finitePoint(c.position)||!Number.isFinite(c.hp)||c.hp<0||!Number.isFinite(c.maxHp)||c.maxHp<=0||c.hp>c.maxHp||!(c.material in MASS))throw new Error('Invalid fixture cell');ids.add(c.id);}
 const fixtureId=fixture.id;
 const original=copy(fixture.cells),fixtureSignature=JSON.stringify(original);
 const originals=new Map(original.map(c=>[c.id,c]));
 const retireBelowY=(original.length?original.reduce((n,c)=>Math.min(n,c.position.y),Infinity):0)-32;
 const totalHp=original.reduce((sum,c)=>sum+(c.role==='terrain'?0:c.hp),0);
 let epoch=1,tick=0,accumulator=0,serial=0,disposed=false,queriesDirty=true;
 let world:RAPIER.World,queueEvents:RAPIER.EventQueue,graph:SupportGraph;
 const cells=new Map<number,State>(),chunks=new Map<string,Chunk>(),colliders=new Map<number,RAPIER.Collider>(),colliderIds=new Map<number,number>();
 let queue:string[]=[],trace:StructuralEvent[]=[];
 const packedBoxes=new Map<number,PackedBox>(),packedChunks=new Map<string,Set<number>>(),dirtyStatic=new Set<string>(),chunkCells=new Map<string,number[]>(),positionIds=new Map<string,number>();
 for(const c of original){const key=chunkKey(c.position);const list=chunkCells.get(key)??[];list.push(c.id);chunkCells.set(key,list);positionIds.set(`${c.position.x},${c.position.y},${c.position.z}`,c.id);}
 const participants=new Set<PhysicsParticipant>();
 const shots=new Set<string>(),processed=new Set<string>(),episodes=new Map<string,Episode>(),episodeCounts=new Map<string,number>();
 const amount=()=>totalHp===0?0:Math.min(200,Math.ceil(200*[...cells.values()].reduce((n,c)=>n+(c.spec.role==='terrain'?0:c.loss),0)/totalHp));
 const emit=(event:Omit<StructuralEvent,'epoch'|'tick'>)=>{trace.push({...copy(event),epoch,tick});if(trace.length>8192)trace.splice(0,trace.length-8192);};
 function newWorld(){queriesDirty=true;world=new RAPIER.World({x:0,y:-18,z:0});world.timestep=DT;world.integrationParameters.maxCcdSubsteps=4;queueEvents=new RAPIER.EventQueue(true);}
 function colliderDesc(c:State,p:Point,q:Rotation){return RAPIER.ColliderDesc.cuboid(.5,.5,.5).setTranslation(p.x,p.y,p.z).setRotation(q).setMass(MASS[c.spec.material]).setFriction(.85).setRestitution(.02).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS|RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(0);}
// Rebuild only the 8³ chunks whose occupied authoritative cells changed.
 function flushStatic(){
  if(dirtyStatic.size)queriesDirty=true;
  for(const key of dirtyStatic){
   for(const handle of packedChunks.get(key)??[]){const box=packedBoxes.get(handle)!;const collider=world.getCollider(handle);for(const id of box.cellIds)if(colliders.get(id)?.handle===handle)colliders.delete(id);packedBoxes.delete(handle);world.removeCollider(collider,true);}
   const handles=new Set<number>();packedChunks.set(key,handles);
   const specs=(chunkCells.get(key)??[]).map(id=>cells.get(id)!).filter(c=>c.state==='static').map(c=>c.spec);
   for(const box of packStaticCells(specs)){
    const collider=world.createCollider(RAPIER.ColliderDesc.cuboid(box.half.x,box.half.y,box.half.z).setTranslation(box.center.x,box.center.y,box.center.z).setFriction(.85).setRestitution(.02).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS|RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(0));
    handles.add(collider.handle);packedBoxes.set(collider.handle,box);for(const id of box.cellIds)colliders.set(id,collider);
   }
  }
  dirtyStatic.clear();
 }
 function resolveCollider(handle:number,at?:Point):number|null{
  const individual=colliderIds.get(handle);if(individual!==undefined)return individual;
  const box=packedBoxes.get(handle);if(!box||!at)return null;
  const axis=(value:number,center:number,half:number)=>Math.max(center-half+.5,Math.min(center+half-.5,Math.round(value)));
  const x=axis(at.x,box.center.x,box.half.x),y=axis(at.y,box.center.y,box.half.y),z=axis(at.z,box.center.z,box.half.z);
  return positionIds.get(`${x},${y},${z}`)??null;
 }
 function addStatic(c:State){if(c.state==='static'){dirtyStatic.add(chunkKey(c.spec.position));return;}const collider=world.createCollider(colliderDesc(c,c.position,c.rotation));colliders.set(c.spec.id,collider);colliderIds.set(collider.handle,c.spec.id);}
 function removeCollider(id:number){const collider=colliders.get(id);if(!collider)return;if(packedBoxes.has(collider.handle)){dirtyStatic.add(chunkKey(cells.get(id)!.spec.position));colliders.delete(id);return;}colliderIds.delete(collider.handle);colliders.delete(id);world.removeCollider(collider,true);}
 function syncCell(c:State){if(c.state!=='dynamic')return;const collider=colliders.get(c.spec.id);if(collider){c.position=point(collider.translation());c.rotation=rotation(collider.rotation());}}
 function sync(){for(const chunk of chunks.values())if(chunk.body){for(const id of chunk.cells)syncCell(cells.get(id)!);chunk.position=point(chunk.body.translation());chunk.rotation=rotation(chunk.body.rotation());chunk.linvel=point(chunk.body.linvel());chunk.angvel=point(chunk.body.angvel());}}
 function activate(c:Chunk,restoring=false,transforms?:LocalCell[]){
  c.status='active';
  // Body axes start at the world orientation; each cell has its own exact offset/rotation.
  if(!restoring)c.position=c.cells.reduce((p,id)=>{const v=cells.get(id)!.position;return {x:p.x+v.x/c.cells.length,y:p.y+v.y/c.cells.length,z:p.z+v.z/c.cells.length};},point(ZERO));
  if(!restoring)c.rotation=rotation(IDENTITY);
  c.body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(c.position.x,c.position.y,c.position.z).setRotation(c.rotation).setLinvel(c.linvel.x,c.linvel.y,c.linvel.z).setAngvel(c.angvel).setCanSleep(true).setCcdEnabled(true).setLinearDamping(.18).setAngularDamping(.9));
  for(const id of c.cells){const state=cells.get(id)!;removeCollider(id);const inv={x:-c.rotation.x,y:-c.rotation.y,z:-c.rotation.z,w:c.rotation.w};const local=transforms?.find(t=>t.id===id);const p=local?.position??rotate({x:state.position.x-c.position.x,y:state.position.y-c.position.y,z:state.position.z-c.position.z},inv),q=local?.rotation??multiply(inv,state.rotation);const collider=world.createCollider(colliderDesc(state,p,q),c.body);colliders.set(id,collider);colliderIds.set(collider.handle,id);}
 }
 const pendingCount=()=>[...chunks.values()].filter(c=>c.status!=='rubble').length+[...participants].reduce((sum,p)=>{const n=p.pending?.()??0;return sum+(Number.isFinite(n)?Math.max(0,Math.floor(n)):0);},0);
 const activeCount=()=>[...chunks.values()].filter(c=>c.status==='active').length;
 function advance(){while(queue.length&&activeCount()<maxActiveBodies){const id=queue.shift()!;const c=chunks.get(id);if(c&&c.cells.length)activate(c);}}
 function spawn(ids:number[],rootShotId:string,velocity:Point=ZERO,angvel:Point=ZERO){
  if(!ids.length)return;
  const id=`piece-${++serial}`,positions=ids.map(id=>cells.get(id)!.position),position=positions.reduce((p,v)=>({x:p.x+v.x/ids.length,y:p.y+v.y/ids.length,z:p.z+v.z/ids.length}),point(ZERO));
  const chunk:Chunk={id,cells:[...ids],rootShotId,status:'queued',position,rotation:rotation(IDENTITY),linvel:point(velocity),angvel:point(angvel),quiet:0};chunks.set(id,chunk);queue.push(id);
  for(const cellId of ids){const c=cells.get(cellId)!;const wasStatic=c.state==='static';if(wasStatic)removeCollider(cellId);c.state='dynamic';c.chunkId=id;c.loss=c.spec.hp;if(wasStatic)addStatic(c);}
  emit({id:`${epoch}:detach:${id}`,kind:'detach',position,sourceId:id,rootShotId});
 }
 function detach(rootShotId:string,origin?:Point,impulse=0){
  const pieces=graph.unsupported();
  for(const piece of pieces){const ids=piece.cells.filter(id=>cells.get(id)?.state==='static');if(!ids.length)continue;graph.remove(ids);const center=ids.reduce((p,id)=>{const q=cells.get(id)!.position;return{x:p.x+q.x/ids.length,y:p.y+q.y/ids.length,z:p.z+q.z/ids.length};},point(ZERO));let v=point(ZERO);if(origin&&impulse>0){const d={x:center.x-origin.x,y:center.y-origin.y,z:center.z-origin.z},n=length(d)||1;v={x:d.x/n*impulse,y:d.y/n*impulse,z:d.z/n*impulse};}spawn(ids,rootShotId,v);}
  flushStatic();advance();
 }
 function destroyCell(id:number){const c=cells.get(id)!;removeCollider(id);c.hp=0;c.state='gone';c.loss=c.spec.hp;graph.remove([id]);const chunkId=c.chunkId;delete c.chunkId;if(chunkId){const chunk=chunks.get(chunkId);if(chunk){chunk.cells=chunk.cells.filter(n=>n!==id);if(!chunk.cells.length){if(chunk.body)world.removeRigidBody(chunk.body);chunks.delete(chunkId);queue=queue.filter(n=>n!==chunkId);}}}}
 function damage(id:number,value:number,eventId:string){const c=cells.get(id);if(!c||c.hp<=0||!Number.isFinite(value)||value<=0||processed.has(eventId))return 0;processed.add(eventId);const used=Math.min(c.hp,value);c.hp-=used;c.loss=Math.min(c.spec.hp,c.loss+used);if(c.hp<=1e-8)destroyCell(id);return used;}
 function forgetContacts(ids:readonly number[]){const changed=new Set(ids);for(const key of episodes.keys())if(key.split(':').map(Number).some(id=>changed.has(id)))episodes.delete(key);}
 function releaseBody(chunk:Chunk){for(const id of chunk.cells){const collider=colliders.get(id);if(collider)colliderIds.delete(collider.handle);colliders.delete(id);}if(chunk.body)world.removeRigidBody(chunk.body);delete chunk.body;for(const id of chunk.cells)addStatic(cells.get(id)!);}
 function wake(chunk:Chunk,rootShotId:string){
  if(chunk.status!=='rubble')return;
  chunk.status='queued';chunk.rootShotId=rootShotId;chunk.linvel=point(ZERO);chunk.angvel=point(ZERO);chunk.quiet=0;queue.push(chunk.id);forgetContacts(chunk.cells);
  for(const id of chunk.cells)cells.get(id)!.state='dynamic';
  emit({id:`${epoch}:wake:${++serial}:${chunk.id}`,kind:'detach',position:chunk.position,sourceId:chunk.id,rootShotId});
 }
 function checkRubbleSupport(rootShotId:string){
  const rubble=[...chunks.values()].filter(c=>c.status==='rubble');if(!rubble.length)return;
  const supported=new Set<string>(),dependencies=new Map<string,Set<string>>();
  const buckets=new Map<string,State[]>();const key=(x:number,y:number,z:number)=>`${x}:${y}:${z}`;
  for(const c of cells.values())if(c.state==='static'||c.state==='rubble'){const p=c.position,k=key(Math.floor(p.x/2),Math.floor(p.y/2),Math.floor(p.z/2));const list=buckets.get(k)??[];list.push(c);buckets.set(k,list);}
  for(const chunk of rubble){const below=new Set<string>();dependencies.set(chunk.id,below);for(const id of chunk.cells){const c=cells.get(id)!,collider=colliders.get(id)!;const bx=Math.floor(c.position.x/2),by=Math.floor(c.position.y/2),bz=Math.floor(c.position.z/2);for(let x=bx-1;x<=bx+1;x++)for(let y=by-1;y<=by+1;y++)for(let z=bz-1;z<=bz+1;z++)for(const other of buckets.get(key(x,y,z))??[]){if(other.spec.id===id||other.chunkId===chunk.id||other.position.y>=c.position.y-.1)continue;const contact=collider.contactCollider(colliders.get(other.spec.id)!, .08);if(!contact||Math.abs(contact.normal1.y)<.4)continue;if(other.state==='static')supported.add(chunk.id);else if(other.chunkId)below.add(other.chunkId);}}}
  let changed=true;while(changed){changed=false;for(const [id,below]of dependencies)if(!supported.has(id)&&[...below].some(id=>supported.has(id))){supported.add(id);changed=true;}}
  for(const chunk of rubble)if(!supported.has(chunk.id))wake(chunk,rootShotId);
 }
 function fracture(rootShotId:string){
  sync();for(const chunk of [...chunks.values()]){
   if(chunk.cells.length<2)continue;
   const pieces=createSupportGraph(chunk.cells.map(id=>({...copy(cells.get(id)!.spec),anchor:false}))).unsupported();if(pieces.length<=1)continue;
   const wasRubble=chunk.status==='rubble',velocity=point(chunk.linvel),angular=point(chunk.angvel);if(chunk.body)releaseBody(chunk);
   chunks.delete(chunk.id);queue=queue.filter(id=>id!==chunk.id);forgetContacts(chunk.cells);
   for(const piece of pieces){spawn(piece.cells,rootShotId,velocity,angular);if(wasRubble){const spawned=chunks.get(`piece-${serial}`)!;spawned.status='rubble';queue=queue.filter(id=>id!==spawned.id);for(const id of piece.cells)cells.get(id)!.state='rubble';}}
  }
 }
 function settle(chunk:Chunk){
  sync();releaseBody(chunk);chunk.status='rubble';chunk.linvel=point(ZERO);chunk.angvel=point(ZERO);
  for(const id of chunk.cells)cells.get(id)!.state='rubble';
  emit({id:`${epoch}:sleep:${chunk.id}:${tick}`,kind:'sleep',position:chunk.position,sourceId:chunk.id,rootShotId:chunk.rootShotId});
 }
 function singleStep(){
  tick++;
  for(const participant of participants)participant.beforeStep?.(world);
  const prior=new Map<number,Point>();
  for(const c of chunks.values())if(c.body)for(const id of c.cells){const collider=colliders.get(id)!;prior.set(id,point(c.body.velocityAtPoint(collider.translation())));}
  world.step(queueEvents);queriesDirty=false;
  // Copy every temporary native value before ending the callback; mutate the world only later.
  const collisions:CollisionRecord[]=[];
  queueEvents.drainCollisionEvents((first,second,started)=>{collisions.push({first,second,started});});
  const contacts:{a:number;b:number;impulse:number;normal:Point}[]=[];
  queueEvents.drainContactForceEvents(e=>{contacts.push({a:e.collider1(),b:e.collider2(),impulse:e.totalForceMagnitude()*DT,normal:point(e.maxForceDirection())});});
  sync();
// Logical cell-pair episodes survive harmless native static-box repacking.
  const touching=new Set<string>();
  const targetCells=(sourceId:number,sourceCollider:RAPIER.Collider,targetCollider:RAPIER.Collider):number[]=>{
   const targets=new Set<number>(),center=sourceCollider.translation();
   world.contactPair(sourceCollider,targetCollider,m=>{for(let i=0;i<m.numSolverContacts();i++){const p=m.solverContactPoint(i);if(!p)continue;const at={x:p.x+(center.x-p.x)*.02,y:p.y+(center.y-p.y)*.02,z:p.z+(center.z-p.z)*.02},targetId=resolveCollider(targetCollider.handle,at);if(targetId!==null&&targetId!==sourceId){targets.add(targetId);touching.add(pair(sourceId,targetId));}}});return [...targets];
  };
  for(const chunk of chunks.values())if(chunk.body)for(const id of chunk.cells){const collider=colliders.get(id)!;world.contactPairsWith(collider,other=>{targetCells(id,collider,other);});}
  for(const key of episodes.keys())if(!touching.has(key))episodes.delete(key);
  for(const key of touching)if(!episodes.has(key)){const n=(episodeCounts.get(key)??0)+1;episodeCounts.set(key,n);episodes.set(key,{n,credited:false});}
  const commands:{id:string;target:number;damage:number;sourceId:string;rootShotId:string;position:Point}[]=[];
  for(const contact of contacts){
   for(const [sourceHandle,targetHandle]of [[contact.a,contact.b],[contact.b,contact.a]]){
    const sourceId=colliderIds.get(sourceHandle);if(sourceId===undefined)continue;
    const source=cells.get(sourceId)!,chunk=source.chunkId?chunks.get(source.chunkId):undefined;if(!chunk?.body)continue;
    const sourceCollider=colliders.get(sourceId)!,targetCollider=world.getCollider(targetHandle);if(!targetCollider)continue;
    const targets=targetCells(sourceId,sourceCollider,targetCollider);
    for(const targetId of targets){const target=cells.get(targetId)!;if(target.state==='gone'||target.chunkId&&chunks.get(target.chunkId)?.status==='active')continue;
     const episode=episodes.get(pair(sourceId,targetId)),v=prior.get(sourceId);if(!episode||episode.credited||!v||contact.impulse/targets.length<MIN_IMPULSE)continue;
     const n=contact.normal,d={x:target.position.x-source.position.x,y:target.position.y-source.position.y,z:target.position.z-source.position.z};const sign=n.x*d.x+n.y*d.y+n.z*d.z>=0?1:-1;
     const targetV=prior.get(targetId)??ZERO,speed=((v.x-targetV.x)*n.x+(v.y-targetV.y)*n.y+(v.z-targetV.z)*n.z)*sign;
     if(speed<MIN_SPEED)continue;episode.credited=true;
     const mass=chunk.cells.reduce((sum,id)=>sum+MASS[cells.get(id)!.spec.material],0);
     commands.push({id:`${epoch}:impact:${chunk.id}:${targetId}:${sourceId}:${episode.n}`,target:targetId,damage:Math.min(40,.025*Math.min(12,mass)*speed*speed)/targets.length,sourceId:chunk.id,rootShotId:chunk.rootShotId,position:point(target.position)});
    }
   }
  }
  for(const command of commands){const used=damage(command.target,command.damage,command.id);if(used)emit({id:command.id,kind:'impact',position:command.position,sourceId:command.sourceId,targetId:command.target,damage:used,rootShotId:command.rootShotId});}
  if(commands.length){fracture(commands[0].rootShotId);detach(commands[0].rootShotId);checkRubbleSupport(commands[0].rootShotId);}
  for(const chunk of [...chunks.values()])if(chunk.body){
   // Explicit finite-map exit only: every oriented cell AABB is below min terrain Y minus 32.
   if(chunk.body.linvel().y<0&&chunk.cells.every(id=>{const c=cells.get(id)!;const q=c.rotation;const halfY=.5*(Math.abs(2*(q.x*q.y+q.z*q.w))+Math.abs(1-2*(q.x*q.x+q.z*q.z))+Math.abs(2*(q.y*q.z-q.x*q.w)));return c.position.y+halfY<retireBelowY;})){for(const id of [...chunk.cells])destroyCell(id);continue;}
// Genuine quiet wall/friction contact counts too; active/queued supports never finalize rubble.
   let support=false,queuedSupport=false;
   for(const id of chunk.cells){const collider=colliders.get(id)!;world.contactPairsWith(collider,other=>{const targetId=resolveCollider(other.handle,collider.translation());if(targetId===null||cells.get(targetId)?.chunkId===chunk.id)return;const target=cells.get(targetId)!;world.contactPair(collider,other,m=>{if(m.numSolverContacts()>0){if(target.state==='static'||target.state==='rubble')support=true;else if(target.chunkId&&chunks.get(target.chunkId)?.status==='queued')queuedSupport=true;}});});}
   chunk.quiet=(support||queuedSupport)&&length(chunk.body.linvel())<.2&&length(chunk.body.angvel())<.3?chunk.quiet+1:0;
   // Keep exact colliders, yield the slot, and let the older blocked piece move first.
   if(!support&&queuedSupport&&(chunk.quiet>=QUIET_TICKS||chunk.body.isSleeping())){sync();releaseBody(chunk);chunk.status='queued';chunk.quiet=0;queue.push(chunk.id);forgetContacts(chunk.cells);continue;}
   if(chunk.quiet>=QUIET_TICKS)chunk.body.sleep();
   if(chunk.body.isSleeping()){if(support)settle(chunk);else chunk.body.wakeUp();}
  }
  advance();
  const forces:ForceRecord[]=contacts.map(c=>({first:c.a,second:c.b,impulse:c.impulse,normal:point(c.normal)}));
  for(const participant of participants)participant.afterStep?.(world,copy(collisions),copy(forces));
 }
 function initial(){newWorld();for(const c of original){const state:State={spec:copy(c),hp:c.hp,loss:0,state:c.hp>0?'static':'gone',position:point(c.position),rotation:rotation(IDENTITY)};cells.set(c.id,state);if(c.hp>0)addStatic(state);}graph=createSupportGraph(original.filter(c=>c.hp>0));flushStatic();detach('initial');}
 function localTransforms(c:Chunk):LocalCell[]{const inv={x:-c.rotation.x,y:-c.rotation.y,z:-c.rotation.z,w:c.rotation.w};return c.cells.map(id=>{const collider=colliders.get(id)!,state=cells.get(id)!;return{id,position:point(c.body?collider.translationWrtParent()!:rotate({x:state.position.x-c.position.x,y:state.position.y-c.position.y,z:state.position.z-c.position.z},inv)),rotation:rotation(c.body?collider.rotationWrtParent()!:multiply(inv,state.rotation))};});}
 function save():Save{sync();return{schema:'structural-simulation/v1',fixtureId,fixtureSignature,maxActiveBodies,epoch,tick,accumulator,serial,cells:[...cells.values()].map(c=>({id:c.spec.id,hp:c.hp,loss:c.loss,state:c.state,position:point(c.position),rotation:rotation(c.rotation),...(c.chunkId?{chunkId:c.chunkId}:{})})),bodies:[...chunks.values()].map(c=>({transforms:localTransforms(c),id:c.id,cells:[...c.cells],rootShotId:c.rootShotId,status:c.status,position:point(c.position),rotation:rotation(c.rotation),linvel:point(c.linvel),angvel:point(c.angvel),quiet:c.quiet})),queue:[...queue],shots:[...shots],processed:[...processed],episodes:copy([...episodes]),episodeCounts:[...episodeCounts],research:amount(),events:copy(trace)};}
 function valid(input:unknown):input is Save{
  try{
   const s=input as Save;
   if(!s||s.schema!=='structural-simulation/v1'||s.fixtureId!==fixtureId||s.fixtureSignature!==fixtureSignature||s.maxActiveBodies!==maxActiveBodies||!Number.isSafeInteger(s.epoch)||s.epoch<1||s.epoch>=Number.MAX_SAFE_INTEGER-1||!Number.isSafeInteger(s.tick)||s.tick<0||s.tick>=Number.MAX_SAFE_INTEGER-1||!Number.isSafeInteger(s.serial)||s.serial<0||s.serial>=Number.MAX_SAFE_INTEGER-1||!Number.isFinite(s.accumulator)||s.accumulator<0||s.accumulator>=DT)return false;
   if(!Array.isArray(s.cells)||s.cells.length!==original.length||!Array.isArray(s.bodies)||!Array.isArray(s.queue)||!Array.isArray(s.events)||s.events.length>8192)return false;
   const seen=new Set<number>(),saved=new Map<number,CellSave>();let sum=0;
   for(const c of s.cells){const orig=originals.get(c.id);if(!orig||seen.has(c.id)||!Number.isFinite(c.hp)||c.hp<0||c.hp>orig.hp||!Number.isFinite(c.loss)||c.loss<0||c.loss>orig.hp||c.loss+1e-7<orig.hp-c.hp||!['static','dynamic','rubble','gone'].includes(c.state)||!finitePoint(c.position)||!finiteRotation(c.rotation))return false;if(c.state==='gone'&&c.hp!==0||c.state!=='gone'&&c.hp<=0||c.state==='dynamic'&&typeof c.chunkId!=='string'||(c.state==='static'||c.state==='gone')&&c.chunkId!==undefined||c.state==='rubble'&&typeof c.chunkId!=='string')return false;if(c.state==='static'&&(c.position.x!==orig.position.x||c.position.y!==orig.position.y||c.position.z!==orig.position.z||c.rotation.x!==0||c.rotation.y!==0||c.rotation.z!==0||Math.abs(c.rotation.w)!==1||Math.abs(c.loss-(orig.hp-c.hp))>1e-7))return false;if((c.state==='dynamic'||c.state==='rubble'||c.state==='gone'&&orig.hp>0)&&Math.abs(c.loss-orig.hp)>1e-7)return false;seen.add(c.id);saved.set(c.id,c);if(orig.role!=='terrain')sum+=c.loss;}
   if(s.research!== (totalHp===0?0:Math.min(200,Math.ceil(200*sum/totalHp))))return false;
   const bodies=new Set<string>(),members=new Set<number>();let active=0;
   for(const b of s.bodies){if(typeof b.id!=='string'||!/^piece-\d+$/.test(b.id)||Number(b.id.slice(6))>s.serial||bodies.has(b.id)||typeof b.rootShotId!=='string'||!b.rootShotId||!['active','queued','rubble'].includes(b.status)||!Array.isArray(b.cells)||!b.cells.length||!finitePoint(b.position)||!finiteRotation(b.rotation)||!finitePoint(b.linvel)||!finitePoint(b.angvel)||length(b.linvel)>1e4||length(b.angvel)>1e4||b.status==='rubble'&&(length(b.linvel)!==0||length(b.angvel)!==0)||!Array.isArray(b.transforms)||b.transforms.length!==b.cells.length||!Number.isSafeInteger(b.quiet)||b.quiet<0||b.quiet>QUIET_TICKS)return false;bodies.add(b.id);if(b.status==='active')active++;for(const id of b.cells){const c=saved.get(id);if(!c||c.state!==(b.status==='rubble'?'rubble':'dynamic')||c.chunkId!==b.id||members.has(id))return false;members.add(id);}
    const localIds=new Set<number>();for(const t of b.transforms){const c=saved.get(t.id);if(!c||!b.cells.includes(t.id)||localIds.has(t.id)||!finitePoint(t.position)||!finiteRotation(t.rotation))return false;localIds.add(t.id);const p=rotate(t.position,b.rotation),q=multiply(b.rotation,t.rotation);if(Math.hypot(p.x+b.position.x-c.position.x,p.y+b.position.y-c.position.y,p.z+b.position.z-c.position.z)>1e-3||Math.abs(Math.abs(q.x*c.rotation.x+q.y*c.rotation.y+q.z*c.rotation.z+q.w*c.rotation.w)-1)>1e-4)return false;}
    const first=saved.get(b.cells[0])!,origin=originals.get(first.id)!.position;for(const id of b.cells){const c=saved.get(id)!,o=originals.get(id)!.position,p=rotate({x:o.x-origin.x,y:o.y-origin.y,z:o.z-origin.z},first.rotation);if(Math.hypot(p.x+first.position.x-c.position.x,p.y+first.position.y-c.position.y,p.z+first.position.z-c.position.z)>1e-3)return false;}
   }
   if(active>maxActiveBodies||s.cells.some(c=>(c.state==='dynamic'||c.state==='rubble')&&!members.has(c.id)))return false;
   if(new Set(s.queue).size!==s.queue.length||s.queue.some(id=>!s.bodies.some(b=>b.id===id&&b.status==='queued'))||s.bodies.some(b=>b.status==='queued'&&!s.queue.includes(b.id))||s.queue.length&&active<maxActiveBodies)return false;
   for(const list of [s.shots,s.processed])if(!Array.isArray(list)||list.some(x=>typeof x!=='string'||!x)||new Set(list).size!==list.length)return false;
   const pairValid=(key:string)=>{if(typeof key!=='string')return false;const parts=key.split(':').map(Number);return parts.length===2&&parts[0]<parts[1]&&parts.every(n=>originals.has(n));};
   if(!Array.isArray(s.episodes)||!Array.isArray(s.episodeCounts)||new Set(s.episodes.map(x=>x[0])).size!==s.episodes.length||new Set(s.episodeCounts.map(x=>x[0])).size!==s.episodeCounts.length)return false;
   const counts=new Map(s.episodeCounts);for(const [key,n] of s.episodeCounts)if(!pairValid(key)||!Number.isSafeInteger(n)||n<1)return false;
   for(const [key,e] of s.episodes)if(!pairValid(key)||!e||!Number.isSafeInteger(e.n)||e.n<1||e.n!==counts.get(key)||typeof e.credited!=='boolean')return false;
   const eventIds=new Set<string>();for(const e of s.events){if(typeof e.id!=='string'||!e.id||eventIds.has(e.id)||!Number.isSafeInteger(e.epoch)||e.epoch<1||e.epoch>s.epoch||!Number.isSafeInteger(e.tick)||e.tick<0||e.tick>s.tick||!['detonation','detach','impact','sleep'].includes(e.kind)||!finitePoint(e.position)||typeof e.rootShotId!=='string'||!e.rootShotId||e.targetId!==undefined&&!originals.has(e.targetId)||e.damage!==undefined&&(!Number.isFinite(e.damage)||e.damage<0)||e.sourceId!==undefined&&typeof e.sourceId!=='string')return false;if(e.kind==='impact'&&(!s.processed.includes(e.id)||e.targetId===undefined||!e.damage))return false;eventIds.add(e.id);}
   return true;
  }catch{return false;}
 }
 initial();
 const host:StructuralPhysicsHost={
  get world(){return world;},get epoch(){return epoch;},
  register(participant){if(disposed)throw new Error('Cannot register with disposed physics host');participants.add(participant);participant.afterWorldReplace?.(world,epoch);return()=>{participants.delete(participant);};},
  advance(dt){simulation.step(dt);},
  cell(id){const c=cells.get(id);if(c)syncCell(c);return c?{...copy(c.spec),hp:c.hp,state:c.state,position:point(c.position),rotation:rotation(c.rotation)}:null;},
  colliderCell:resolveCollider
 };
 const simulation:StructuralSimulation & {physicsHost:StructuralPhysicsHost}={
  physicsHost:host,
  get epoch(){return epoch;},
  blast(command:BlastCommand){
   if(disposed||!command||command.epoch!==epoch||typeof command.id!=='string'||!command.id||shots.has(command.id)||!finitePoint(command.position)||!Number.isFinite(command.radius)||command.radius<=0||command.radius>1e6||!Number.isFinite(command.damage)||command.damage<0||command.damage>1e9||!Number.isFinite(command.impulse)||command.impulse<0||command.impulse>1e4)return false;
   shots.add(command.id);sync();emit({id:`${epoch}:shot:${command.id}`,kind:'detonation',position:command.position,rootShotId:command.id});
   const affected=[...cells.values()].filter(c=>c.state!=='gone'&&Math.hypot(c.position.x-command.position.x,c.position.y-command.position.y,c.position.z-command.position.z)<=command.radius);
   for(const c of affected){const distance=Math.hypot(c.position.x-command.position.x,c.position.y-command.position.y,c.position.z-command.position.z);damage(c.spec.id,command.damage*(1-.65*distance/command.radius),`${epoch}:blast:${command.id}:${c.spec.id}`);}
   fracture(command.id);
   const pushed=new Set<string>();for(const c of affected){if(c.state==='gone'||!c.chunkId||command.impulse<=0)continue;const chunk=chunks.get(c.chunkId)!;if(pushed.has(chunk.id))continue;pushed.add(chunk.id);if(chunk.status==='rubble')wake(chunk,command.id);const d={x:c.position.x-command.position.x,y:c.position.y-command.position.y,z:c.position.z-command.position.z},n=length(d)||1,v={x:d.x/n*command.impulse,y:(n===1&&length(d)===0?1:d.y/n)*command.impulse,z:d.z/n*command.impulse};if(chunk.body){const mass=chunk.body.mass();chunk.body.applyImpulseAtPoint({x:v.x*mass,y:v.y*mass,z:v.z*mass},c.position,true);}else{chunk.linvel.x+=v.x;chunk.linvel.y+=v.y;chunk.linvel.z+=v.z;}}
   detach(command.id,command.position,command.impulse);checkRubbleSupport(command.id);
   advance();return true;
  },
  step(dt:number){if(disposed||!Number.isFinite(dt)||dt<=0)return;accumulator+=Math.min(1,dt);while(accumulator+1e-10>=DT){accumulator=Math.max(0,accumulator-DT);if(pendingCount()||queriesDirty)singleStep();else{accumulator=0;break;}}},
  views(){sync();return [...cells.values()].map(c=>({...copy(c.spec),hp:c.hp,state:c.state,position:point(c.position),rotation:rotation(c.rotation)}));},
  events(){return copy(trace);},pending:pendingCount,research:amount,snapshot:save,
  restore(input:unknown){
   if(disposed||!valid(input))return false;const s=copy(input);
   // All input is validated before the first mutation. No event from the old world survives.
   for(const participant of participants)participant.beforeWorldReplace?.();
   queueEvents.free();world.free();cells.clear();chunks.clear();colliders.clear();colliderIds.clear();packedBoxes.clear();packedChunks.clear();dirtyStatic.clear();shots.clear();processed.clear();episodes.clear();episodeCounts.clear();newWorld();
   epoch=Math.max(epoch,s.epoch)+1;tick=s.tick;accumulator=s.accumulator;serial=s.serial;queue=[...s.queue];trace=copy(s.events);
   for(const c of s.cells){const state:State={...copy(c),spec:copy(originals.get(c.id)!)};cells.set(c.id,state);if(c.state!=='gone')addStatic(state);}
   graph=createSupportGraph([...cells.values()].filter(c=>c.state==='static').map(c=>({...copy(c.spec),hp:c.hp})));flushStatic();
   for(const b of s.bodies){const c:Chunk=copy(b);chunks.set(c.id,c);if(c.status==='active')activate(c,true,b.transforms);}
   for(const id of s.shots)shots.add(id);for(const id of s.processed)processed.add(id);for(const [key,value] of s.episodes)episodes.set(key,value);for(const [key,value] of s.episodeCounts)episodeCounts.set(key,value);for(const participant of participants)participant.afterWorldReplace?.(world,epoch);return true;
  },
  reset(){if(disposed)return;for(const participant of participants)participant.beforeWorldReplace?.();queueEvents.free();world.free();cells.clear();chunks.clear();colliders.clear();colliderIds.clear();packedBoxes.clear();packedChunks.clear();dirtyStatic.clear();queue=[];trace=[];shots.clear();processed.clear();episodes.clear();episodeCounts.clear();epoch++;tick=0;accumulator=0;serial=0;initial();for(const participant of participants)participant.afterWorldReplace?.(world,epoch);},
  dispose(){if(disposed)return;for(const participant of participants)participant.beforeWorldReplace?.();participants.clear();disposed=true;queueEvents.free();world.free();chunks.clear();queue=[];colliders.clear();colliderIds.clear();packedBoxes.clear();packedChunks.clear();dirtyStatic.clear();}
 };
 return simulation;
}
