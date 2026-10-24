import {packScaleBoxes} from './fixture.js';
import type {ScaleFixture,ScaleBox,ScaleRegion} from './fixture.js';
import type {Point,Rotation} from '../structural/types.js';

export type ScaleRegionState='static'|'dynamic'|'rubble'|'gone';
export interface ScalePose {position:Point;rotation:Rotation}
export interface ScaleRegionView extends ScalePose {
 id:string;index:number;material:ScaleRegion['material'];role:ScaleRegion['role'];objectId:string;center:Point;bounds:ScaleRegion['bounds'];
 cellCount:number;aliveCellCount:number;hp:number;maxHp:number;objectiveWeight:number;loss:number;state:ScaleRegionState;groupId?:string;revision:number;
}
export interface ScaleGroup {id:string;epoch:number;regionIds:string[];originalCenter:Point;rootShotId:string}
export interface ScaleBlast {id:string;epoch:number;sequence:number;position:Point;radius:number;damage:number;impulse:number}
export interface ScaleImpact {id:string;epoch:number;targetRegionIds:string[];damage:number;rootShotId?:string}
export interface ScaleTransaction {accepted:boolean;reason?:string;changedRegionIds:string[];detachedGroups:ScaleGroup[];researchDelta:number;revision:number}
interface Row extends ScalePose {hp:number;state:ScaleRegionState;mask?:Float64Array;groupId?:string;revision:number;boxes?:readonly ScaleBox[];alive:number}
interface SavedRow extends ScalePose {hp:number;state:ScaleRegionState;mask?:number[];groupId?:string;revision:number}
export interface ScaleSnapshot {schema:'scale-authority/v1';fixtureSignature:string;epoch:number;revision:number;geometryRevision:number;lastSequence:number;serial:number;research:number;processed:string[];regions:SavedRow[];groups:ScaleGroup[];pendingGroupIds:string[]}
const identity=():Rotation=>({x:0,y:0,z:0,w:1});
const finitePoint=(p:Point)=>!!p&&[p.x,p.y,p.z].every(Number.isFinite);
const finiteRotation=(q:Rotation)=>finitePoint(q)&&Number.isFinite(q.w)&&Math.abs(Math.hypot(q.x,q.y,q.z,q.w)-1)<1e-5;
const rotate=(p:Point,q:Rotation):Point=>{
 const tx=2*(q.y*p.z-q.z*p.y),ty=2*(q.z*p.x-q.x*p.z),tz=2*(q.x*p.y-q.y*p.x);
 return {x:p.x+q.w*tx+q.y*tz-q.z*ty,y:p.y+q.w*ty+q.z*tx-q.x*tz,z:p.z+q.w*tz+q.x*ty-q.y*tx};
};

/** One authoritative durability ledger. Fine masks are bounded by the immutable
 * inventory (<=64 cells/structure region, <=32/terrain region), never by camera.
 * Large-blast loss is intentionally regional, not legacy per-cell equivalence.
 * Support is regional too: masks remove exact inter-region contact pairs, but
 * disconnected surviving lobes inside one initial region remain one rigid and
 * support unit. This is not post-cut voxel-exact fracture connectivity. */
export class ScaleAuthority {
 private rows:Row[]=[];private byId=new Map<string,number>();private processed=new Set<string>();private groups=new Map<string,ScaleGroup>();private pending=new Set<string>();
 private contactIndices:number[][];private anchorOrdinals:number[][];private version=0;private geometryVersion=0;private resetVersion=0;private sequence=0;private serial=0;private researchValue=0;private generation:number;
 private lastSupportVisited=0;private lastCandidateRegions=0;private lastCandidateCells=0;private lastCandidateBoxes=0;
 constructor(readonly fixture:ScaleFixture,options:{epoch?:number}={}){
  this.generation=options.epoch??1;if(!Number.isSafeInteger(this.generation)||this.generation<0)throw new Error('Invalid scale epoch');
  this.contactIndices=fixture.regions.map(()=>[]);this.anchorOrdinals=fixture.regions.map(()=>[]);
  fixture.regions.forEach(r=>{this.byId.set(r.id,r.index);for(const i of r.cellOrdinals)if(fixture.anchors[i])this.anchorOrdinals[r.index].push(i);});
  fixture.contacts.forEach((c,i)=>{this.contactIndices[c.a].push(i);this.contactIndices[c.b].push(i);});this.initialize();
 }
 get epoch(){return this.generation;}get revision(){return this.version;}get geometryRevision(){return this.geometryVersion;}
 private initialize(){this.rows=this.fixture.regions.map(r=>{
  const ratio=r.initialHp/r.maxHp;let mask:Float64Array|undefined;
  if([...r.cellOrdinals].some(i=>Math.abs(this.fixture.initialHp[i]-this.fixture.maxHp[i]*ratio)>1e-9))mask=Float64Array.from(r.cellOrdinals,i=>this.fixture.initialHp[i]);
  return {hp:r.initialHp,state:r.initialHp>0?'static':'gone',position:{...r.center},rotation:identity(),revision:this.version,mask,alive:mask?[...mask].filter(hp=>hp>0).length:r.initialHp>0?r.cellOrdinals.length:0};
 });}
 private index(id:string|number){return typeof id==='number'&&Number.isInteger(id)&&id>=0&&id<this.rows.length?id:typeof id==='string'?this.byId.get(id):undefined;}
 private view(index:number):ScaleRegionView {const r=this.fixture.regions[index],row=this.rows[index];return {id:r.id,index,material:r.material,role:r.role,objectId:r.objectId,center:{...r.center},bounds:{...r.bounds},cellCount:r.cellOrdinals.length,aliveCellCount:row.alive,hp:row.hp,maxHp:r.maxHp,objectiveWeight:r.objectiveWeight,loss:this.loss(index),state:row.state,position:{...row.position},rotation:{...row.rotation},...(row.groupId?{groupId:row.groupId}:{}),revision:row.revision};}
 region(id:string|number):ScaleRegionView|undefined {const i=this.index(id);return i===undefined?undefined:this.view(i);}
 regionViews():ScaleRegionView[]{return this.rows.map((_,i)=>this.view(i));}
 changesSince(cursor:number){const reset=!Number.isInteger(cursor)||cursor<this.resetVersion||cursor>this.version;const regions=this.rows.flatMap((row,i)=>reset||row.revision>cursor?[this.view(i)]:[]);return {revision:this.version,reset,regions,regionIds:regions.map(r=>r.id)};}
 cellHp(ordinal:number):number {if(!Number.isInteger(ordinal)||ordinal<0||ordinal>=this.fixture.cellCount)return 0;const i=this.fixture.regionIndexByOrdinal[ordinal],row=this.rows[i];return row.mask?.[this.fixture.localIndexByOrdinal[ordinal]]??(row.hp/this.fixture.regions[i].maxHp*this.fixture.maxHp[ordinal]);}
 isStaticCell(ordinal:number):boolean {return Number.isInteger(ordinal)&&ordinal>=0&&ordinal<this.fixture.cellCount&&this.rows[this.fixture.regionIndexByOrdinal[ordinal]].state==='static'&&this.cellHp(ordinal)>0;}
 activeBoxes(id:string|number):readonly ScaleBox[]{const i=this.index(id);if(i===undefined)return [];const r=this.fixture.regions[i],row=this.rows[i];if(row.hp<=0)return [];if(!row.mask)return r.boxes;if(!row.boxes)row.boxes=packScaleBoxes([...r.cellOrdinals].filter(o=>this.cellHp(o)>0),this.fixture);return row.boxes;}
 private loss(i:number){const r=this.fixture.regions[i];return Math.max(0,r.initialHp-this.rows[i].hp)*(r.objectiveWeight/r.maxHp);}
 private worldCell(i:number,ordinal:number):Point {const r=this.fixture.regions[i],row=this.rows[i];if(row.state==='static')return {x:this.fixture.x[ordinal],y:this.fixture.y[ordinal],z:this.fixture.z[ordinal]};const p=rotate({x:this.fixture.x[ordinal]-r.center.x,y:this.fixture.y[ordinal]-r.center.y,z:this.fixture.z[ordinal]-r.center.z},row.rotation);return {x:p.x+row.position.x,y:p.y+row.position.y,z:p.z+row.position.z};}
 private reject(reason:string):ScaleTransaction{return {accepted:false,reason,changedRegionIds:[],detachedGroups:[],researchDelta:0,revision:this.version};}
 private validateEvent(id:string,epoch:number){return typeof id==='string'&&id.length>0&&id.length<=512&&epoch===this.epoch&&!this.processed.has(id);}
 private ensureMask(i:number){const row=this.rows[i],r=this.fixture.regions[i];return row.mask??=Float64Array.from(r.cellOrdinals,o=>this.fixture.maxHp[o]*row.hp/r.maxHp);}
 private finishDamage(i:number,previous:number,changed:Set<number>){const row=this.rows[i];row.hp=row.mask?row.mask.reduce((sum,hp)=>sum+hp,0):Math.max(0,row.hp);if(previous===row.hp)return false;
  const beforeAlive=row.alive;row.alive=row.mask?[...row.mask].filter(hp=>hp>0).length:row.hp>0?this.fixture.regions[i].cellOrdinals.length:0;if(row.hp===0)row.state='gone';if(row.alive!==beforeAlive)row.boxes=undefined;
  this.researchValue+=(previous-row.hp)*(this.fixture.regions[i].objectiveWeight/this.fixture.regions[i].maxHp);changed.add(i);return beforeAlive!==row.alive;
 }
 private aggregateDamage(i:number,damage:number,changed:Set<number>){const row=this.rows[i],previous=row.hp;if(previous<=0)return false;
  const next=Math.max(0,previous-damage*row.alive),factor=next/previous;if(row.mask)for(let j=0;j<row.mask.length;j++)row.mask[j]*=factor;row.hp=next;return this.finishDamage(i,previous,changed);
 }
 blast(command:ScaleBlast):ScaleTransaction {
  if(!command||!this.validateEvent(command.id,command.epoch))return this.reject('epoch-or-duplicate');
  if(command.sequence!==this.sequence+1)return this.reject('sequence');
  if(!finitePoint(command.position)||!Number.isFinite(command.radius)||command.radius<0||!Number.isFinite(command.damage)||command.damage<0||!Number.isFinite(command.impulse)||command.impulse<0)return this.reject('invalid-command');
  this.processed.add(command.id);this.sequence=command.sequence;const changed=new Set<number>(),before=this.researchValue;let topology=false;this.lastCandidateRegions=0;this.lastCandidateCells=0;this.lastCandidateBoxes=0;
  for(let i=0;i<this.rows.length;i++){
   const row=this.rows[i],r=this.fixture.regions[i];if(row.hp<=0)continue;
   const extent=Math.hypot(Math.max(r.center.x-r.bounds.minX,r.bounds.maxX-r.center.x),Math.max(r.center.y-r.bounds.minY,r.bounds.maxY-r.center.y),Math.max(r.center.z-r.bounds.minZ,r.bounds.maxZ-r.center.z));
   if(Math.hypot(row.position.x-command.position.x,row.position.y-command.position.y,row.position.z-command.position.z)>command.radius+extent)continue;this.lastCandidateRegions++;
   if(command.radius<=8){let mask:Float64Array|undefined;const previous=row.hp;
    for(let j=0;j<r.cellOrdinals.length;j++){const o=r.cellOrdinals[j];if(this.cellHp(o)<=0)continue;this.lastCandidateCells++;const p=this.worldCell(i,o),distance=Math.hypot(p.x-command.position.x,p.y-command.position.y,p.z-command.position.z);if(distance>command.radius)continue;
     const amount=command.damage*(command.radius===0?1:1-distance/command.radius);if(amount<=0)continue;mask??=this.ensureMask(i);const loss=Math.min(mask[j],amount);mask[j]-=loss;row.hp-=loss;
    }
    topology=this.finishDamage(i,previous,changed)||topology;
   }else{
    // Inverse rigid pose once, then nearest occupied lattice center per exact
    // box. The large-attack hot path does not visit constituent cell positions.
    const q=row.rotation,local=rotate({x:command.position.x-row.position.x,y:command.position.y-row.position.y,z:command.position.z-row.position.z},{x:-q.x,y:-q.y,z:-q.z,w:q.w});local.x+=r.center.x;local.y+=r.center.y;local.z+=r.center.z;
    let nearest=Infinity;for(const box of this.activeBoxes(i)){this.lastCandidateBoxes++;const near=(v:number,c:number,h:number)=>Math.max(c-h+.5,Math.min(c+h-.5,Math.round(v)));nearest=Math.min(nearest,Math.hypot(local.x-near(local.x,box.center.x,box.halfExtents.x),local.y-near(local.y,box.center.y,box.halfExtents.y),local.z-near(local.z,box.center.z,box.halfExtents.z)));}
    if(nearest<command.radius)topology=this.aggregateDamage(i,command.damage*(1-nearest/command.radius),changed)||topology;
   }
  }
  return this.commit(command.id,changed,before,topology);
 }
 applyImpact(command:ScaleImpact):ScaleTransaction {
  if(!command||!this.validateEvent(command.id,command.epoch))return this.reject('epoch-or-duplicate');
  if(!Array.isArray(command.targetRegionIds)||!Number.isFinite(command.damage)||command.damage<0||command.targetRegionIds.some(id=>this.index(id)===undefined))return this.reject('invalid-impact');
  this.processed.add(command.id);const changed=new Set<number>(),before=this.researchValue;let topology=false;
  for(const id of new Set(command.targetRegionIds))topology=this.aggregateDamage(this.index(id)!,command.damage,changed)||topology;
  return this.commit(command.rootShotId??command.id,changed,before,topology);
 }
 private commit(rootShotId:string,changed:Set<number>,before:number,topology:boolean):ScaleTransaction {
  const detachedGroups=topology?this.releaseUnsupported(rootShotId,changed):[];
  this.version++;if(changed.size)this.geometryVersion++;for(const i of changed)this.rows[i].revision=this.version;
  this.researchValue=Math.min(this.fixture.objectiveWeight,Math.max(0,this.researchValue));
  return {accepted:true,changedRegionIds:[...changed].sort((a,b)=>a-b).map(i=>this.fixture.regions[i].id),detachedGroups:structuredClone(detachedGroups),researchDelta:this.researchValue-before,revision:this.version};
 }
 private contactAlive(index:number){const contact=this.fixture.contacts[index],a=this.rows[contact.a],b=this.rows[contact.b];if(a.state!=='static'||b.state!=='static'||a.hp<=0||b.hp<=0)return false;if(!a.mask&&!b.mask)return true;for(let j=0;j<contact.pairs.length;j+=2)if(this.cellHp(contact.pairs[j])>0&&this.cellHp(contact.pairs[j+1])>0)return true;return false;}
 private releaseUnsupported(rootShotId:string,changed:Set<number>):ScaleGroup[]{
  const n=this.rows.length,visited=new Uint8Array(n),queue=new Uint32Array(n);let head=0,tail=0;this.lastSupportVisited=0;
  for(let i=0;i<n;i++)if(this.rows[i].state==='static'&&this.anchorOrdinals[i].some(o=>this.cellHp(o)>0)){visited[i]=1;queue[tail++]=i;}
  const visitNeighbors=(i:number,visit:(j:number)=>void)=>{for(const edge of this.contactIndices[i]){const contact=this.fixture.contacts[edge],j=contact.a===i?contact.b:contact.a;if(!visited[j]&&this.contactAlive(edge)){visited[j]=1;visit(j);}}};
  while(head<tail){const i=queue[head++];this.lastSupportVisited++;visitNeighbors(i,j=>{queue[tail++]=j;});}
  const detached:ScaleGroup[]=[];
  for(let i=0;i<n;i++){
   if(visited[i]||this.rows[i].state!=='static')continue;visited[i]=1;const component=[i];
   for(let cursor=0;cursor<component.length;cursor++)visitNeighbors(component[cursor],j=>component.push(j));
   let x=0,y=0,z=0,mass=0;for(const j of component){const r=this.fixture.regions[j],weight=this.rows[j].alive;x+=r.center.x*weight;y+=r.center.y*weight;z+=r.center.z*weight;mass+=weight;}
   const group:ScaleGroup={id:`group:${this.epoch}:${++this.serial}`,epoch:this.epoch,regionIds:component.sort((a,b)=>a-b).map(j=>this.fixture.regions[j].id),originalCenter:{x:x/mass,y:y/mass,z:z/mass},rootShotId};
   for(const j of component){this.rows[j].state='dynamic';this.rows[j].groupId=group.id;changed.add(j);}this.groups.set(group.id,group);this.pending.add(group.id);detached.push(group);
  }
  return detached;
 }
 pendingDetachedGroups():ScaleGroup[]{return [...this.pending].map(id=>structuredClone(this.groups.get(id)!));}
 acknowledgeDetachedGroup(id:string):boolean{return this.pending.delete(id);}
 takeUnsupportedGroups():ScaleGroup[]{const groups=this.pendingDetachedGroups();this.pending.clear();return groups;}
 updateRegionPose(id:string,pose:ScalePose,status:'dynamic'|'rubble'):boolean {
  const i=this.index(id);if(i===undefined||!finitePoint(pose?.position)||!finiteRotation(pose?.rotation)||!['dynamic','rubble'].includes(status))return false;const row=this.rows[i];if(row.state==='gone'||row.state==='static')return false;
  row.position={...pose.position};row.rotation={...pose.rotation};row.state=status;return true;
 }
 updateBodyPose(id:string,pose:ScalePose,status:'dynamic'|'rubble'):boolean {const group=this.groups.get(id);if(!group||!finitePoint(pose?.position)||!finiteRotation(pose?.rotation)||!['dynamic','rubble'].includes(status))return false;
  for(const regionId of group.regionIds){const i=this.index(regionId)!,center=this.fixture.regions[i].center,offset=rotate({x:center.x-group.originalCenter.x,y:center.y-group.originalCenter.y,z:center.z-group.originalCenter.z},pose.rotation);this.updateRegionPose(regionId,{position:{x:pose.position.x+offset.x,y:pose.position.y+offset.y,z:pose.position.z+offset.z},rotation:pose.rotation},status);}return true;
 }
 stats(){let staticRegions=0,dynamicRegions=0,rubbleRegions=0,goneRegions=0,aliveCells=0,maskRegions=0,maskedCells=0;for(const r of this.rows){if(r.state==='static')staticRegions++;else if(r.state==='dynamic')dynamicRegions++;else if(r.state==='rubble')rubbleRegions++;else goneRegions++;aliveCells+=r.alive;if(r.mask){maskRegions++;maskedCells+=r.mask.length;}}
  return {epoch:this.epoch,revision:this.revision,geometryRevision:this.geometryRevision,regionCount:this.rows.length,staticRegions,dynamicRegions,rubbleRegions,goneRegions,aliveCells,maskRegions,maskedCells,research:this.researchValue,objectiveWeight:this.fixture.objectiveWeight,pendingGroups:this.pending.size,lastSequence:this.sequence,processedEvents:this.processed.size,lastSupportVisited:this.lastSupportVisited,lastCandidateRegions:this.lastCandidateRegions,lastCandidateCells:this.lastCandidateCells,lastCandidateBoxes:this.lastCandidateBoxes};}
 snapshot():ScaleSnapshot {return {schema:'scale-authority/v1',fixtureSignature:this.fixture.signature,epoch:this.epoch,revision:this.version,geometryRevision:this.geometryVersion,lastSequence:this.sequence,serial:this.serial,research:this.researchValue,processed:[...this.processed],regions:this.rows.map(r=>({hp:r.hp,state:r.state,position:{...r.position},rotation:{...r.rotation},revision:r.revision,...(r.mask?{mask:[...r.mask]}:{}),...(r.groupId?{groupId:r.groupId}:{})})),groups:structuredClone([...this.groups.values()]),pendingGroupIds:[...this.pending]};}
 restore(input:unknown):boolean {
  try{
   const s=input as ScaleSnapshot;if(!s||s.schema!=='scale-authority/v1'||s.fixtureSignature!==this.fixture.signature||!Array.isArray(s.regions)||s.regions.length!==this.rows.length||![s.epoch,s.revision,s.geometryRevision,s.lastSequence,s.serial].every(v=>Number.isSafeInteger(v)&&v>=0)||s.geometryRevision>s.revision||!Number.isFinite(s.research)||s.research<0||s.research>this.fixture.objectiveWeight||!Array.isArray(s.processed)||s.processed.some(id=>typeof id!=='string'||!id)||new Set(s.processed).size!==s.processed.length||!Array.isArray(s.groups)||!Array.isArray(s.pendingGroupIds))return false;
   let loss=0;const rows:Row[]=[];
   for(let i=0;i<s.regions.length;i++){const r=s.regions[i],spec=this.fixture.regions[i];if(!r||!Number.isFinite(r.hp)||r.hp<0||r.hp>spec.initialHp+1e-7||!['static','dynamic','rubble','gone'].includes(r.state)||!finitePoint(r.position)||!finiteRotation(r.rotation)||!Number.isSafeInteger(r.revision)||r.revision<0||r.revision>s.revision||(r.state==='gone')!==(r.hp===0))return false;
    let mask:Float64Array|undefined;if(r.mask!==undefined){if(!Array.isArray(r.mask)||r.mask.length!==spec.cellOrdinals.length||r.mask.some((hp,j)=>!Number.isFinite(hp)||hp<0||hp>this.fixture.maxHp[spec.cellOrdinals[j]]+1e-7)||Math.abs(r.mask.reduce((a,b)=>a+b,0)-r.hp)>1e-6)return false;mask=Float64Array.from(r.mask);}
    if(r.state==='static'&&(r.groupId!==undefined||r.position.x!==spec.center.x||r.position.y!==spec.center.y||r.position.z!==spec.center.z||r.rotation.x!==0||r.rotation.y!==0||r.rotation.z!==0||r.rotation.w!==1))return false;
    if((r.state==='dynamic'||r.state==='rubble')&&typeof r.groupId!=='string')return false;
    rows.push({hp:r.hp,state:r.state,position:{...r.position},rotation:{...r.rotation},revision:r.revision,mask,groupId:r.groupId,alive:mask?[...mask].filter(hp=>hp>0).length:r.hp>0?spec.cellOrdinals.length:0});loss+=(spec.initialHp-r.hp)*spec.objectiveWeight/spec.maxHp;
   }
   if(Math.abs(loss-s.research)>1e-6||s.processed.length<s.lastSequence||s.processed.length>s.revision||s.serial!==s.groups.length)return false;
   const groups=new Map<string,ScaleGroup>();for(const group of s.groups){if(!group||typeof group.id!=='string'||groups.has(group.id)||group.epoch!==s.epoch||typeof group.rootShotId!=='string'||!finitePoint(group.originalCenter)||!Array.isArray(group.regionIds)||!group.regionIds.length||new Set(group.regionIds).size!==group.regionIds.length||group.regionIds.some(id=>this.index(id)===undefined||rows[this.index(id)!].groupId!==group.id))return false;groups.set(group.id,structuredClone(group));}
   for(let i=0;i<rows.length;i++){const row=rows[i];if(row.groupId!==undefined&&(!groups.has(row.groupId)||!groups.get(row.groupId)!.regionIds.includes(this.fixture.regions[i].id)))return false;}
   for(let serial=1;serial<=s.serial;serial++)if(!groups.has(`group:${s.epoch}:${serial}`))return false;
   if(new Set(s.pendingGroupIds).size!==s.pendingGroupIds.length||s.pendingGroupIds.some(id=>!groups.has(id)))return false;
   this.rows=rows;this.groups=groups;this.pending=new Set(s.pendingGroupIds);this.processed=new Set(s.processed);this.generation=s.epoch;this.version=s.revision;this.geometryVersion=s.geometryRevision;this.sequence=s.lastSequence;this.serial=s.serial;this.researchValue=s.research;this.resetVersion=s.revision;return true;
  }catch{return false;}
 }
 reset():void {this.generation++;this.version++;this.geometryVersion++;this.resetVersion=this.version;this.sequence=0;this.serial=0;this.researchValue=0;this.lastSupportVisited=0;this.lastCandidateRegions=0;this.lastCandidateCells=0;this.lastCandidateBoxes=0;this.processed.clear();this.groups.clear();this.pending.clear();this.initialize();}
}
