import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScaleFixture} from './fixture.js';
import {ScaleAuthority} from './model.js';
import type {Cell,Point,SceneFixture} from '../structural/types.js';

// Independent acceptance tests for the new approximate regional semantics.
// No exact legacy per-voxel damage equation or legacy reward total is assumed.
// The oracles below inspect actual occupied volume, identity and loss, not VFX.
const p=(x:number,y:number,z:number):Point=>({x,y,z});
const cell=(id:number,x:number,y:number,z:number,patch:Partial<Cell>&{objective?:boolean}={}):Cell=>({
 id,objectId:'qa-wall',role:'building',position:p(x,y,z),material:'stone',
 color:0x8899aa,hp:100,maxHp:100,objective:true,...patch,
} as Cell);
const soil=(id:number,x:number,y:number,z:number,hp=1000):Cell=>cell(id,x,y,z,{objectId:'qa-soil',role:'terrain',material:'soil',hp,maxHp:hp,objective:false});
const volume=(boxes:readonly {halfExtents:Point}[])=>boxes.reduce((sum,b)=>sum+8*b.halfExtents.x*b.halfExtents.y*b.halfExtents.z,0);
const contains=(b:{center:Point;halfExtents:Point},point:Point)=>
 (['x','y','z'] as const).every(a=>Math.abs(b.center[a]-point[a])<b.halfExtents[a]-1e-8);
const fixtureOf=(id:string,cells:Cell[])=>compileScaleFixture({id,cells} as SceneFixture);
const regionIdAt=(fixture:ReturnType<typeof compileScaleFixture>,ordinal:number)=>fixture.regions[fixture.regionIndexByOrdinal[ordinal]].id;
function equalAuthorityWithPoseTolerance(actual:ReturnType<ScaleAuthority['snapshot']>,expected:ReturnType<ScaleAuthority['snapshot']>){
 assert.equal(actual.regions.length,expected.regions.length);
 for(let i=0;i<actual.regions.length;i++)for(const field of ['position','rotation'] as const){
  const a=actual.regions[i][field],b=expected.regions[i][field];
  for(const axis of Object.keys(b) as (keyof typeof b)[])assert.ok(Math.abs(a[axis]-b[axis])<1e-6,`region ${i} ${field}.${axis}: ${a[axis]} vs ${b[axis]} must survive native reconstruction within 1e-6 world units`);
 }
 const withoutPose=(snapshot:typeof actual)=>({...snapshot,regions:snapshot.regions.map(({position,rotation,...row})=>row)});
 assert.deepEqual(withoutPose(actual),withoutPose(expected),'non-pose authority, masks, identity and credited loss remain exact');
}

const shot=(model:ScaleAuthority,id:string,sequence:number,position:Point,radius:number,damage:number)=>model.blast({id,epoch:model.epoch,sequence,position,radius,damage,impulse:0});

function plateFixture(){
 const cells:Cell[]=[];let id=1;
 for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++)cells.push(soil(id++,x,-1,z));
 for(let x=-2;x<=2;x++)for(let y=0;y<=2;y++)cells.push(cell(id++,x,y,0));
 return {cells,fixture:fixtureOf('independent-wall-hole',cells)};
}

test('independent occupied-volume oracle preserves windows, mixed-material boundaries and noncontiguous IDs',()=>{
 const ids=[2**40+1,-(2**40)-7,9001,42,43,44];
 const cells=[cell(ids[0],0,0,0),cell(ids[1],1,0,0),cell(ids[2],0,1,0),
  cell(ids[3],3,0,0,{material:'wood'}),cell(ids[4],4,0,0,{objectId:'other-object'}),
  cell(ids[5],4,1,0,{objectId:'other-object',role:'foundation'})];
 const fixture=fixtureOf('independent-occupied-shape',cells),boxes=fixture.regions.flatMap(r=>r.boxes);
 assert.equal(fixture.cellCount,cells.length);
 assert.equal(volume(boxes),cells.length,'collider boxes cannot turn a sparse region into its filled AABB');
 for(let x=-1;x<=5;x++)for(let y=-1;y<=2;y++)for(let z=-1;z<=1;z++){
  const point=p(x,y,z),wanted=cells.some(c=>c.position.x===x&&c.position.y===y&&c.position.z===z);
  assert.equal(boxes.filter(b=>contains(b,point)).length,wanted?1:0,`occupied coverage at ${x}/${y}/${z}`);
 }
 for(const region of fixture.regions){
  const members=cells.filter((_,i)=>fixture.regionIndexByOrdinal[i]===region.index);
  for(const key of ['material','objectId','role'] as const)assert.equal(new Set(members.map(c=>c[key])).size,1,`${key} boundary must survive compilation`);
 }
 const reversed=fixtureOf('independent-occupied-shape',cells.slice().reverse());
 assert.deepEqual(reversed.regions.map(r=>r.id),fixture.regions.map(r=>r.id),'region identity cannot depend on source enumeration');
});

test('a precise local wall cut changes the live occupied mask without erasing neighboring wall volume',()=>{
 const {cells,fixture}=plateFixture(),model=new ScaleAuthority(fixture),at=cells.findIndex(c=>c.position.x===0&&c.position.y===1&&c.position.z===0),id=regionIdAt(fixture,at);
 const before=model.activeBoxes(id);assert.ok(before.some(b=>contains(b,p(0,1,0))));
 const result=shot(model,'local-wall-cut',1,p(0,1,0),.2,1e6);assert.equal(result.accepted,true);
 assert.equal(model.cellHp(at),0,'actual authority, not a particle, loses the cut cell');
 assert.equal(model.activeBoxes(id).some(b=>contains(b,p(0,1,0))),false);
 const neighbor=cells.findIndex(c=>c.position.x===1&&c.position.y===1&&c.position.z===0);
 assert.equal(model.cellHp(neighbor),100,'precision mask must not erase the adjacent wall cell');
 assert.ok(model.activeBoxes(regionIdAt(fixture,neighbor)).some(b=>contains(b,p(1,1,0))));
 assert.equal(fixture.cellCount,cells.length,'the immutable city recipe is not rewritten to make destruction cheap');
});

test('all eight soil layers can be removed locally, while the adjacent full-depth column remains physical',()=>{
 const cells:Cell[]=[];let id=1;
 for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)for(let y=-8;y<=-1;y++)cells.push(soil(id++,x,y,z));
 const fixture=fixtureOf('independent-eight-layer-hole',cells),model=new ScaleAuthority(fixture);
 for(let layer=1;layer<=8;layer++)assert.equal(shot(model,`layer-${layer}`,layer,p(0,-layer,0),.2,1e6).accepted,true);
 for(let layer=1;layer<=8;layer++){
  const gone=cells.findIndex(c=>c.position.x===0&&c.position.y===-layer&&c.position.z===0);
  const next=cells.findIndex(c=>c.position.x===1&&c.position.y===-layer&&c.position.z===0);
  assert.equal(model.cellHp(gone),0);assert.equal(model.cellHp(next),1000);
  assert.equal(model.activeBoxes(regionIdAt(fixture,gone)).some(b=>contains(b,p(0,-layer,0))),false);
  assert.ok(model.activeBoxes(regionIdAt(fixture,next)).some(b=>contains(b,p(1,-layer,0))));
 }
});

test('attack IDs, strict sequence and reset epoch protect HP, masks and credited loss atomically',()=>{
 const {fixture}=plateFixture(),model=new ScaleAuthority(fixture),ids=fixture.regions.map(r=>r.id);
 const first={id:'once',epoch:model.epoch,sequence:1,position:p(0,1,0),radius:.2,damage:5,impulse:0};
 assert.equal(model.blast(first).accepted,true);const after=model.snapshot();
 for(const invalid of [first,{...first,sequence:2},{...first,id:'skipped',sequence:3},{...first,id:'stale',epoch:model.epoch-1,sequence:2}]){
  assert.equal(model.blast(invalid).accepted,false);assert.deepEqual(model.snapshot(),after,'a rejected command cannot change sequence, loss, geometry or support');
 }
 assert.equal(model.blast({...first,id:'next',sequence:2}).accepted,true);
 const oldEpoch=model.epoch;model.reset();assert.equal(model.epoch,oldEpoch+1);
 assert.deepEqual(fixture.regions.map(r=>r.id),ids);const pristine=model.snapshot();
 assert.equal(model.blast({...first,id:'after-reset',sequence:1}).accepted,false);assert.deepEqual(model.snapshot(),pristine);
 assert.equal(model.blast({...first,epoch:model.epoch,sequence:1}).accepted,true,'reset clears epoch-local command IDs, not immutable region identities');
});

test('regional objective loss is conserved across damage, save/restore, repeat attacks and reset',()=>{
 const {fixture}=plateFixture(),model=new ScaleAuthority(fixture),initialWeight=fixture.regions.reduce((sum,r)=>sum+r.objectiveWeight,0);
 assert.ok(initialWeight>0);let earned=0;
 for(let sequence=1;sequence<=4;sequence++){
  const result=shot(model,`damage-${sequence}`,sequence,p(0,1,0),16,sequence===4?1e6:5);
  assert.equal(result.accepted,true);assert.ok(result.researchDelta>=0);earned+=result.researchDelta;
 }
 assert.ok(earned>0);const saved=model.snapshot(),restored=new ScaleAuthority(fixture);
 assert.equal(restored.restore(saved),true);assert.deepEqual(restored.snapshot(),saved,'full masks, group identity, pose, sequence and earned loss must survive restoration');
 const repeat=shot(restored,'fresh-id-not-fresh-material',5,p(0,1,0),16,1e6);
 assert.equal(repeat.accepted,true);assert.equal(repeat.researchDelta,0,'a new command ID never makes already-counted material valuable again');
 const recorded=fixture.regions.reduce((sum,r)=>sum+restored.region(r.id)!.loss,0);
 assert.ok(recorded>=0&&recorded<=initialWeight+1e-7,`recorded loss ${recorded} must stay within original objective weight ${initialWeight}`);
 restored.reset();assert.ok(fixture.regions.every(r=>restored.region(r.id)!.loss===0));
 const pristine=restored.snapshot();assert.equal(restored.restore({...saved,schema:'not-scale-authority'}),false);assert.deepEqual(restored.snapshot(),pristine,'restore rejection must be atomic');
});

import {createScaleDynamics} from './dynamics.js';
const advance=(d:Awaited<ReturnType<typeof createScaleDynamics>>,steps:number)=>{for(let i=0;i<steps;i++)d.step(1/120);};

test('a second real projectile crosses a new wall cut while adjacent surviving wall still collides',async()=>{
 const {fixture}=plateFixture(),model=new ScaleAuthority(fixture),d=await createScaleDynamics(model);
 try{
  assert.equal(shot(model,'physical-wall-cut',1,p(0,1,0),.2,1e6).accepted,true);d.sync();
  d.launchProjectile({id:'through-new-hole',position:p(0,1,-3),velocity:p(0,0,8),radius:.15,gravityScale:0});
  advance(d,120);
  assert.ok(d.projectile('through-new-hole')!.position.z>3,'new projectile must cross missing authority/collider volume, not only a visual hole');
  assert.equal(d.drainProjectileContacts().length,0);
  d.launchProjectile({id:'neighbor-wall',position:p(1,1,-3),velocity:p(0,0,8),radius:.15,gravityScale:0});
  advance(d,120);
  assert.ok(d.drainProjectileContacts().length>0,'the adjacent surviving wall still needs its real collider');
 }finally{d.dispose();}
});

test('a new physical projectile traverses a locally excavated eight-layer terrain hole, with no hidden plane',async()=>{
 const cells:Cell[]=[];let id=1;
 for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)for(let y=-8;y<=-1;y++)cells.push(soil(id++,x,y,z));
 const model=new ScaleAuthority(fixtureOf('independent-physical-eight-layers',cells)),d=await createScaleDynamics(model);
 try{
  for(let layer=1;layer<=8;layer++){assert.equal(shot(model,`physical-layer-${layer}`,layer,p(0,-layer,0),.2,1e6).accepted,true);d.sync();}
  d.launchProjectile({id:'through-ground',position:p(0,2,0),velocity:p(0,-10,0),radius:.15,gravityScale:0});
  advance(d,150);
  assert.ok(d.projectile('through-ground')!.position.y< -9,'an authority hole must extend through every terrain layer');
  assert.equal(d.drainProjectileContacts().length,0,'hidden substrate must not absorb the new projectile');
  d.launchProjectile({id:'remaining-ground',position:p(1,2,0),velocity:p(0,-10,0),radius:.15,gravityScale:0});
  advance(d,90);assert.ok(d.drainProjectileContacts().length>0);
 }finally{d.dispose();}
});

function connectedFallFixture(){
 const cells:Cell[]=[];let id=100;
 for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)cells.push(soil(id++,x,-4,z));
 for(let y=-3;y<=0;y++)cells.push(soil(id++,-2,y,0));
 cells.push(soil(id++,-1,0,0),soil(1,0,0,0,1));
 cells.push(cell(2,0,1,0,{objectId:'qa-falling-foundation',role:'foundation',hp:1000,maxHp:1000}));
 cells.push(cell(3,0,2,0,{objectId:'qa-falling-building',hp:1000,maxHp:1000}),cell(4,0,3,0,{objectId:'qa-falling-building',hp:1000,maxHp:1000}));
 cells.push(cell(11,0,-3,0,{objectId:'qa-independent-receiver',role:'foundation',hp:1000,maxHp:1000}));
 return fixtureOf('independent-connected-ground-foundation-fall',cells);
}

test('ground loss releases a connected foundation, physical descent injures an independent receiver and saved rubble stays real',async()=>{
 const fixture=connectedFallFixture(),model=new ScaleAuthority(fixture),d=await createScaleDynamics(model);
 const foundationId=fixture.regionForCell(2)!.id,beamId=fixture.regionForCell(3)!.id,receiverId=fixture.regionForCell(11)!.id;
 try{
  assert.equal(model.region(foundationId)!.state,'static');assert.equal(model.region(beamId)!.state,'static');
  const initialFoundation=model.region(foundationId)!,initialBeam=model.region(beamId)!,initialReceiver=model.region(receiverId)!;
  const cut=shot(model,'cut-real-soil-bridge',1,p(0,0,0),.2,1e6);assert.equal(cut.accepted,true);assert.equal(cut.researchDelta,0,'support transfer itself does not earn damage credit');
  assert.equal(model.region(foundationId)!.state,'dynamic');assert.equal(model.region(beamId)!.state,'dynamic');
  const pending=model.pendingDetachedGroups();assert.equal(pending.length,1);
  assert.ok(pending[0].regionIds.includes(foundationId)&&pending[0].regionIds.includes(beamId),'the real connected falling group includes the unsupported foundation');
  d.sync();assert.equal(model.pendingDetachedGroups().length,0);assert.ok(d.stats().bodyCount>0);
  advance(d,30);assert.ok(model.region(foundationId)!.position.y<initialFoundation.position.y,'Rapier must actually move the assembly under gravity');
  for(let i=0;i<4800&&[foundationId,beamId].some(id=>model.region(id)!.state==='dynamic');i++)d.step(1/120);
  assert.ok(model.region(receiverId)!.hp<initialReceiver.hp,'separate grounded receiver must lose actual durability through contact');
  const rubble=[model.region(foundationId)!,model.region(beamId)!].filter(r=>r.hp>0);
  assert.ok(rubble.length>0,'the connected coarse assembly cannot disappear to satisfy settlement');
  assert.ok(rubble.every(r=>r.state==='rubble'));
  assert.ok(rubble.some(r=>r.position.y<initialBeam.position.y));
  const stable=model.snapshot();advance(d,240);assert.deepEqual(model.snapshot(),stable,'resting rubble neither creeps authority nor farms objective reward');
  const saved=d.snapshot(),copyModel=new ScaleAuthority(fixture),copy=await createScaleDynamics(copyModel);
  try{
   assert.equal(copy.restore(saved),true);equalAuthorityWithPoseTolerance(copyModel.snapshot(),model.snapshot());
   const restoredBefore=copyModel.snapshot();advance(copy,240);equalAuthorityWithPoseTolerance(copyModel.snapshot(),restoredBefore);assert.equal(copyModel.stats().dynamicRegions,0,'restored sleeping rubble remains naturally settled');
   const target=rubble[0],before=copyModel.region(target.id)!,sequence=2;
   const rehit=shot(copyModel,'rehit-persistent-rubble',sequence,before.position,8,1);
   assert.equal(rehit.accepted,true);copy.sync();assert.ok(copyModel.region(target.id)!.hp<before.hp,'rubble remains damageable at its current world position');
   const priorEpoch=copyModel.epoch;copy.reset();assert.equal(copyModel.epoch,priorEpoch+1);
   const reset=copyModel.snapshot();assert.equal(copyModel.applyImpact({id:'stale-contact',epoch:priorEpoch,targetRegionIds:[target.id],damage:100}).accepted,false);assert.deepEqual(copyModel.snapshot(),reset);
  }finally{copy.dispose();}
 }finally{d.dispose();}
});

test('malformed physics snapshots cannot silently drop important bodies or partially replace live state',async()=>{
 const fixture=connectedFallFixture(),model=new ScaleAuthority(fixture),d=await createScaleDynamics(model);
 try{
  assert.equal(shot(model,'snapshot-cut',1,p(0,0,0),.2,1e6).accepted,true);d.sync();advance(d,5);
  const saved=d.snapshot();assert.ok(saved.bodies.length>0);assert.ok(saved.bodies[0].regionIds.length>=2);
  const missing=structuredClone(saved);missing.bodies=[];
  const wrongEpoch=structuredClone(saved);wrongEpoch.epoch++;
  const invalidCounter=structuredClone(saved);invalidCounter.aggregatedGroups=-1;
  const duplicateId=structuredClone(saved),body=duplicateId.bodies[0];
  duplicateId.bodies=[{...body,regionIds:body.regionIds.slice(0,1)},{...structuredClone(body),regionIds:body.regionIds.slice(1)}];
  const duplicateProjectiles=structuredClone(saved),projectile={command:{id:'duplicate-projectile',position:p(0,5,0),velocity:p(0,0,1),radius:.1},position:p(0,5,0),velocity:p(0,0,1)};
  duplicateProjectiles.projectiles=[projectile,structuredClone(projectile)];
  const invalidNative=structuredClone(saved);invalidNative.nativeBase64='not valid base64!';
  const missingBinding=structuredClone(saved);missingBinding.bindings=missingBinding.bindings.slice(1);
  const duplicateCollider=structuredClone(saved);duplicateCollider.bindings[1].colliderHandles[0]=duplicateCollider.bindings[0].colliderHandles[0];
  for(const [name,corrupt] of [['missing body membership',missing],['mismatched epoch',wrongEpoch],['negative counter',invalidCounter],['duplicate body ID',duplicateId],['duplicate projectile ID',duplicateProjectiles],['invalid native payload',invalidNative],['missing native binding',missingBinding],['duplicate native collider handle',duplicateCollider]] as const){
   const before=d.snapshot();assert.equal(d.restore(corrupt),false,`${name} must reject rather than losing geometry or throwing after mutation`);
   assert.deepEqual(d.snapshot(),before,`${name} rejection must preserve the existing complete world`);
  }
 }finally{d.dispose();}
});

import {createScalePresentation} from './presentation.js';

test('camera promotion, hysteresis and save/reset change only representation, never HP, masks, identity or rewards',()=>{
 const {fixture}=plateFixture(),model=new ScaleAuthority(fixture),presentation=createScalePresentation(model,{nearDistance:10,farDistance:15});
 const id=fixture.regionForCell(fixture.source.idAt(0,1,0)!)!.id,original=model.region(id)!;
 const near={...original.position},band={...near,x:near.x+12},far={...near,x:near.x+100};
 assert.equal(presentation.region(id,far)!.detail,'coarse');assert.equal(presentation.region(id,band)!.detail,'coarse');
 assert.equal(presentation.region(id,near)!.detail,'fine');assert.equal(presentation.region(id,band)!.detail,'fine','hysteresis does not thrash inside the transition band');
 const beforeCut=model.snapshot();for(let i=0;i<20;i++)presentation.frame(i%2?near:far);
 assert.deepEqual(model.snapshot(),beforeCut);
 assert.equal(shot(model,'camera-mask-cut',1,p(0,1,0),.2,1e6).accepted,true);
 const damaged=model.snapshot(),remaining=model.region(id)!.aliveCellCount;
 for(const camera of [near,band,far,band,near]){
  const r=presentation.region(id,camera)!;
  assert.equal(r.regionId,id);assert.equal(r.occupiedCellCount,remaining);assert.equal(volume(r.boxes),remaining);
  assert.equal(r.boxes.some(b=>contains({center:b.position,halfExtents:b.halfExtents},p(0,1,0))),false,'no pristine geometry can reappear when returning to near detail');
  if(r.detail==='fine'){assert.equal(r.boxes.length,remaining);assert.ok(r.boxes.every(b=>b.halfExtents.x===.5&&b.halfExtents.y===.5&&b.halfExtents.z===.5));}
 }
 assert.deepEqual(model.snapshot(),damaged,'camera changes cannot award damage or mutate the save');
 const restored=new ScaleAuthority(fixture);assert.equal(restored.restore(damaged),true);
 const copy=createScalePresentation(restored,{nearDistance:10,farDistance:15});assert.deepEqual(copy.region(id,near),presentation.region(id,near));
 model.reset();assert.equal(presentation.region(id,near)!.occupiedCellCount,original.aliveCellCount,'reset invalidates old fine-mask cache by epoch');
 assert.ok(presentation.region(id,near)!.boxes.some(b=>contains({center:b.position,halfExtents:b.halfExtents},p(0,1,0))));
 assert.equal(presentation.stats().cachedFineBoxes,original.aliveCellCount);
});

test('important-body saturation preserves all region memberships, poses and occupied volume, then reaches natural rubble',async()=>{
 const cells:Cell[]=[];let id=100;const weakIds:number[]=[],fallIds:number[]=[];
 for(let tower=0;tower<7;tower++){
  const x=tower*12;
  for(let dx=-4;dx<=4;dx++)for(let z=-2;z<=2;z++)cells.push(soil(id++,x+dx,-4,z));
  for(let y=-3;y<=0;y++)cells.push(soil(id++,x-2,y,0));
  cells.push(soil(id++,x-1,0,0));weakIds.push(id);cells.push(soil(id++,x,0,0,1));
  fallIds.push(id);cells.push(cell(id++,x,1,0,{objectId:`qa-saturated-${tower}`,role:'foundation',hp:1000,maxHp:1000}));
  fallIds.push(id);cells.push(cell(id++,x,2,0,{objectId:`qa-saturated-${tower}`,hp:1000,maxHp:1000}));
 }
 const fixture=fixtureOf('independent-saturation',cells),model=new ScaleAuthority(fixture),d=await createScaleDynamics(model,{maxBodies:2});
 const regionIds=[...new Set(fallIds.map(id=>fixture.regionForCell(id)!.id))].sort();
 try{
  for(let tower=0;tower<7;tower++){
   const current=model.regionViews().filter(r=>r.state==='dynamic'),at=fixture.source.originalPosition(weakIds[tower])!;
   assert.equal(shot(model,`saturation-cut-${tower}`,tower+1,at,.2,1e6).accepted,true);d.sync();
   for(const old of current){const now=model.region(old.id)!;for(const axis of ['x','y','z'] as const)assert.ok(Math.abs(now.position[axis]-old.position[axis])<1e-5,'aggregation cannot teleport already-falling regions');}
   assert.ok(d.stats().bodyCount<=2);assert.equal(d.stats().pendingGroups,0);assert.equal(d.stats().oldestPendingTicks,0);
   advance(d,5);
  }
  const snapshot=d.snapshot(),assigned=snapshot.bodies.flatMap(b=>b.regionIds).sort();
  assert.deepEqual(assigned,regionIds,'body budget never drops or duplicates an important regional identity');
  assert.equal(new Set(assigned).size,assigned.length);assert.ok(d.stats().aggregatedGroups>=5);
  assert.equal(regionIds.reduce((sum,id)=>sum+volume(model.activeBoxes(id)),0),fallIds.length,'all occupied compound shape volume remains represented');
  for(let i=0;i<4800&&model.stats().dynamicRegions>0;i++)d.step(1/120);
  assert.equal(model.stats().dynamicRegions,0,'finite natural progress is required, not just a zero admission queue');
  assert.equal(d.stats().escapedRegions,0,'supported-ground saturation cannot pass by deleting fallen bodies');
  assert.ok(regionIds.every(id=>model.region(id)!.state==='rubble'&&model.region(id)!.hp>0));
  const finalIds=d.snapshot().bodies.flatMap(b=>b.regionIds).sort();assert.deepEqual(finalIds,regionIds);
  const before=model.snapshot();advance(d,120);assert.deepEqual(model.snapshot(),before);
 }finally{d.dispose();}
});
