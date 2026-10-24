import type {Cell, Point, Rotation, StructuralEvent, CellView} from '../structural/types.js';
/** Pure sparse validator. Omitted IDs are pristine; no full-city expansion or mutation. */
export interface SnapshotFixture {id:string;recipeId:string;count:number;totalHp:number;original(id:number):Cell|undefined;ordinal?(id:number):number}
interface CellSave {id:number;hp:number;loss:number;state:CellView['state'];position:Point;rotation:Rotation;chunkId?:string}
interface Episode {n:number;credited:boolean}
interface Save {schema:string;fixtureId:string;fixtureSignature:string;maxActiveBodies:number;epoch:number;tick:number;accumulator:number;serial:number;cells:CellSave[];bodies:any[];queue:string[];shots:string[];processed:string[];episodes:[string,Episode][];episodeCounts:[string,number][];research:number;events:StructuralEvent[]}
const DT=1/120, QUIET_TICKS=90;
const length=(p:Point)=>Math.hypot(p.x,p.y,p.z);
const point=(p:Point):Point=>({x:p.x,y:p.y,z:p.z});
const multiply=(a:Rotation,b:Rotation):Rotation=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
const rotate=(p:Point,q:Rotation):Point=>point(multiply(multiply(q,{...p,w:0}),{x:-q.x,y:-q.y,z:-q.z,w:q.w}));
const finitePoint=(p:any):p is Point=>!!p&&['x','y','z'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])&&Math.abs(p[k])<=1e9);
const finiteRotation=(q:any):q is Rotation=>finitePoint(q)&&typeof (q as Rotation).w==='number'&&Number.isFinite((q as Rotation).w)&&Math.abs(Math.hypot(q.x,q.y,q.z,(q as Rotation).w)-1)<1e-4;
export function validateCompactStructuralSnapshot(fixture:SnapshotFixture,input:unknown,options:{maxActiveBodies?:number}={}):boolean {
 const maxActiveBodies=options.maxActiveBodies??32;
 if(!Number.isSafeInteger(maxActiveBodies)||maxActiveBodies<1||maxActiveBodies>512)return false;
 const fixtureId=fixture.id,fixtureSignature='compact:'+fixture.recipeId,totalHp=fixture.totalHp;
 const originals={get:(id:number)=>fixture.original(id),has:(id:number)=>fixture.original(id)!==undefined};
  try{
   const s=input as Save;
   if(!s||s.schema!=='structural-simulation-compact/v1'||s.fixtureId!==fixtureId||s.fixtureSignature!==fixtureSignature||s.maxActiveBodies!==maxActiveBodies||!Number.isSafeInteger(s.epoch)||s.epoch<1||s.epoch>=Number.MAX_SAFE_INTEGER-1||!Number.isSafeInteger(s.tick)||s.tick<0||s.tick>=Number.MAX_SAFE_INTEGER-1||!Number.isSafeInteger(s.serial)||s.serial<0||s.serial>=Number.MAX_SAFE_INTEGER-1||!Number.isFinite(s.accumulator)||s.accumulator<0||s.accumulator>=DT)return false;
   if(!Array.isArray(s.cells)||s.cells.length>fixture.count||!Array.isArray(s.bodies)||!Array.isArray(s.queue)||!Array.isArray(s.events)||s.events.length>8192)return false;
   const seen=new Set<number>(),saved=new Map<number,CellSave>();let sum=0;
   for(const c of fixture.ordinal?[...s.cells].sort((a,b)=>fixture.ordinal!(a.id)-fixture.ordinal!(b.id)):s.cells){const orig=originals.get(c.id);if(!orig||seen.has(c.id)||!Number.isFinite(c.hp)||c.hp<0||c.hp>orig.hp||!Number.isFinite(c.loss)||c.loss<0||c.loss>orig.hp||c.loss+1e-7<orig.hp-c.hp||!['static','dynamic','rubble','gone'].includes(c.state)||!finitePoint(c.position)||!finiteRotation(c.rotation))return false;if(c.state==='gone'&&c.hp!==0||c.state!=='gone'&&c.hp<=0||c.state==='dynamic'&&typeof c.chunkId!=='string'||(c.state==='static'||c.state==='gone')&&c.chunkId!==undefined||c.state==='rubble'&&typeof c.chunkId!=='string')return false;if(c.state==='static'&&(c.position.x!==orig.position.x||c.position.y!==orig.position.y||c.position.z!==orig.position.z||c.rotation.x!==0||c.rotation.y!==0||c.rotation.z!==0||Math.abs(c.rotation.w)!==1||Math.abs(c.loss-(orig.hp-c.hp))>1e-7))return false;if((c.state==='dynamic'||c.state==='rubble'||c.state==='gone'&&orig.hp>0)&&Math.abs(c.loss-orig.hp)>1e-7)return false;seen.add(c.id);saved.set(c.id,c);if(orig.role!=='terrain')sum+=c.loss;}
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


/** Existing game schema-9 row encoding is unchanged. Only the runtime envelope
 * acquires an explicit compact identity; never expand omitted pristine cells. */
export function decodeGameSimulation(fixture:SnapshotFixture,input:unknown,options:{maxActiveBodies?:number}={}):Save|null {
 try{
  const s=input as Save&{changes:unknown[][]};
  if(!s||s.schema!=='structural-simulation/v1'||!Array.isArray(s.changes)||s.changes.length>fixture.count)return null;
  const seen=new Set<number>(),cells:CellSave[]=[];
  for(const row of s.changes){
   if(!Array.isArray(row)||(row.length!==4&&row.length!==12))return null;
   const [id,hp,loss,stateIndex]=row as number[],base=fixture.original(id);
   if(!base||seen.has(id)||!Number.isInteger(stateIndex)||stateIndex<0||stateIndex>3)return null;
   seen.add(id);const next:CellSave={id,hp,loss,state:(['static','dynamic','rubble','gone'] as const)[stateIndex],position:{...base.position},rotation:{x:0,y:0,z:0,w:1}};
   if(row.length===12){next.position={x:row[4] as number,y:row[5] as number,z:row[6] as number};next.rotation={x:row[7] as number,y:row[8] as number,z:row[9] as number,w:row[10] as number};if(row[11]!==null)next.chunkId=row[11] as string;}
   cells.push(next);
  }
  const {changes:_,...meta}=s;
  const candidate={...meta,schema:'structural-simulation-compact/v1',fixtureId:fixture.id,fixtureSignature:'compact:'+fixture.recipeId,cells};
  return validateCompactStructuralSnapshot(fixture,candidate,options)?structuredClone(candidate):null;
 }catch{return null;}
}
export function encodeGameSimulation(fixture:SnapshotFixture,input:Save){
 const {fixtureId:_,fixtureSignature:__,cells,...metadata}=input;
 const changes:unknown[][]=[];
 for(const c of cells){const base=fixture.original(c.id);if(!base)throw new Error('Unknown compact cell');
  if(c.state==='static'&&c.hp===base.hp&&c.loss===0)continue;
  const row:unknown[]=[c.id,c.hp,c.loss,['static','dynamic','rubble','gone'].indexOf(c.state)];
  if(c.chunkId!==undefined||c.position.x!==base.position.x||c.position.y!==base.position.y||c.position.z!==base.position.z||c.rotation.x||c.rotation.y||c.rotation.z||c.rotation.w!==1)row.push(c.position.x,c.position.y,c.position.z,c.rotation.x,c.rotation.y,c.rotation.z,c.rotation.w,c.chunkId??null);
  changes.push(row);
 }
 return structuredClone({...metadata,schema:'structural-simulation/v1',changes});
}
