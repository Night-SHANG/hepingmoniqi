import test from 'node:test';
import assert from 'node:assert/strict';
import {compileScaleFixture} from './fixture.js';
import * as modelModule from './model.js';
import type {Cell,SceneFixture} from '../structural/types.js';
const cell=(id:number,x:number,y:number,z:number,patch:Partial<Cell>&{objective?:boolean}={}):Cell=>({id,objectId:'wall',position:{x,y,z},role:'building',material:'stone',color:0x888888,hp:10,maxHp:10,objective:true,...patch} as Cell);
const fixture=(cells:Cell[])=>compileScaleFixture({id:'tiny',cells});
const authority=(cells:Cell[])=>(new (modelModule as any).ScaleAuthority(fixture(cells)));
const shot=(m:any,id:string,sequence:number,position={x:0,y:0,z:0},radius=.1,damage=10)=>({id,epoch:m.epoch,sequence,position,radius,damage,impulse:1});
const ground=(id:number,x:number,z=0)=>cell(id,x,-1,z,{role:'terrain',material:'soil',objectId:'ground',objective:false});

test('small bomb opens one local cell hole without deleting the whole wall',()=>{
 const cells=[ground(100,0),ground(101,1),ground(102,2),ground(103,3)];let id=0;
 for(let x=0;x<4;x++)for(let y=0;y<4;y++)cells.push(cell(++id,x,y,0));
 const m=authority(cells),wall=m.fixture.regionForCell(6)!;
 const tx=m.blast(shot(m,'local',1,{x:1,y:1,z:0},.1,100));assert.equal(tx.accepted,true);
 assert.equal(m.region(wall.id).aliveCellCount,15);assert.equal(m.cellHp(m.fixture.source.ordinal(6)),0);
 assert.equal(m.region(wall.id).hp,150);assert.equal(m.stats().research,10);
 assert.equal(m.activeBoxes(wall.id).reduce((n:number,b:any)=>n+8*b.halfExtents.x*b.halfExtents.y*b.halfExtents.z,0),15);
});

test('ordered epoch commands reject duplicate and out-of-order damage without ledger mutation',()=>{
 const m=authority([ground(100,0),cell(1,0,0,0)]);const first=shot(m,'one',1,undefined,.1,3);
 assert.equal(m.blast(first).accepted,true);assert.equal(m.stats().research,3);
 assert.equal(m.blast(first).accepted,false);assert.equal(m.blast(shot(m,'skip',3)).accepted,false);
 assert.equal(m.blast({...shot(m,'stale',2),epoch:m.epoch-1}).accepted,false);assert.equal(m.stats().research,3);
 assert.equal(m.blast(shot(m,'two',2,undefined,.1,3)).accepted,true);assert.equal(m.stats().research,6);
});

test('terrain hole removes support and queues a stable connected falling group without rewarding transfer',()=>{
 const m=authority([ground(100,0),cell(1,0,0,0),cell(2,0,1,0)]),wall=m.fixture.regionForCell(1)!;
 const tx=m.blast(shot(m,'excavate',1,{x:0,y:-1,z:0},.1,100));assert.equal(tx.accepted,true);
 assert.equal(m.region(wall.id).state,'dynamic');assert.equal(m.stats().research,0);
 const groups=m.pendingDetachedGroups();assert.equal(groups.length,1);assert.deepEqual(groups[0].regionIds,[wall.id]);assert.deepEqual(m.pendingDetachedGroups(),groups);
 m.updateBodyPose(groups[0].id,{position:{x:4,y:2,z:0},rotation:{x:0,y:0,z:0,w:1}},'rubble');
 assert.equal(m.region(wall.id).state,'rubble');assert.equal(m.stats().research,0);
 m.acknowledgeDetachedGroup(groups[0].id);assert.equal(m.pendingDetachedGroups().length,0);
 const pose=m.region(wall.id).position;
 assert.equal(m.blast(shot(m,'rubble',2,{x:pose.x,y:pose.y-.5,z:pose.z},.1,5)).accepted,true);assert.equal(m.stats().research,5);
});

test('aggregate damage followed by fine expansion conserves weighted loss and never resurrects holes',()=>{
 const m=authority([ground(100,0),ground(101,1),cell(1,0,0,0),cell(2,1,0,0)]),r=m.fixture.regionForCell(1)!;
 assert.equal(m.applyImpact({id:'partial',epoch:m.epoch,targetRegionIds:[r.id],damage:5}).accepted,true);
 assert.equal(m.region(r.id).hp,10);assert.equal(m.stats().research,10);
 m.blast(shot(m,'hole',1,{x:0,y:0,z:0},.1,100));assert.equal(m.region(r.id).hp,5);assert.equal(m.stats().research,15);
 m.applyImpact({id:'more',epoch:m.epoch,targetRegionIds:[r.id],damage:1});assert.equal(m.region(r.id).hp,4);assert.equal(m.stats().research,16);
 assert.equal(m.cellHp(m.fixture.source.ordinal(1)),0);assert.equal(m.cellHp(m.fixture.source.ordinal(2)),4);
});

test('save restores hole, pose, queue and dedup ledger atomically while reset isolates epoch',()=>{
 const cells=[ground(100,0),cell(1,0,0,0),cell(2,0,1,0)],m=authority(cells);
 m.blast(shot(m,'dig',1,{x:0,y:-1,z:0},.1,100));const save=m.snapshot(),copy=authority(cells);
 assert.equal(copy.restore(save),true);assert.deepEqual(copy.snapshot(),save);
 const broken=structuredClone(save);broken.regions[0].hp=-5;assert.equal(copy.restore(broken),false);assert.deepEqual(copy.snapshot(),save);
 assert.equal(copy.blast(shot(copy,'dig',2)).accepted,false);
 const epoch=copy.epoch;copy.reset();assert.equal(copy.epoch,epoch+1);assert.equal(copy.stats().research,0);assert.equal(copy.pendingDetachedGroups().length,0);
 assert.equal(copy.blast({...shot(copy,'old',1),epoch}).accepted,false);
});

test('restore rejects a save from equal geometry with a different material recipe',()=>{
 const one=authority([ground(100,0),cell(1,0,0,0)]),other=authority([ground(100,0),cell(1,0,0,0,{material:'wood'})]);
 assert.equal(other.restore(one.snapshot()),false);
});

test('fractional local damage cannot leave zero surviving cells in a live region',()=>{
 const cells=[ground(100,0),cell(1,0,0,0,{hp:.1,maxHp:.1}),cell(2,1,0,0,{hp:.2,maxHp:.2})],m=authority(cells),r=m.fixture.regionForCell(1)!;
 m.blast(shot(m,'one',1,{x:0,y:0,z:0},.1,1));m.blast(shot(m,'two',2,{x:1,y:0,z:0},.1,1));
 assert.equal(m.region(r.id).state,'gone');assert.equal(m.region(r.id).hp,0);assert.equal(m.region(r.id).aliveCellCount,0);
});

test('pose update does not invalidate geometry while snapshot preserves it',()=>{
 const m=authority([ground(100,0),cell(1,0,0,0)]);m.blast(shot(m,'dig',1,{x:0,y:-1,z:0},.1,100));
 const group=m.pendingDetachedGroups()[0],revision=m.revision,geometry=m.geometryRevision;
 m.updateRegionPose(group.regionIds[0],{position:{x:2,y:1,z:0},rotation:{x:0,y:0,z:0,w:1}},'rubble');
 assert.equal(m.revision,revision);assert.equal(m.geometryRevision,geometry);assert.deepEqual(m.changesSince(revision).regions,[]);
 assert.deepEqual(m.snapshot().regions[m.fixture.regionForCell(1)!.index].position,{x:2,y:1,z:0});
});

test('large blast samples occupied boxes instead of every constituent cell',()=>{
 const cells:Cell[]=[];let id=0;
 for(let x=0;x<4;x++)for(let y=0;y<4;y++)for(let z=0;z<4;z++)cells.push(cell(++id,x,y,z));
 cells.push(ground(100,0));const m=authority(cells);
 const result=m.blast(shot(m,'regional',1,{x:0,y:0,z:0},9,1));
 assert.equal(result.accepted,true);assert.equal(m.stats().lastCandidateCells,0);assert.equal(m.stats().lastCandidateBoxes,2);
 assert.equal(m.region(m.fixture.regionForCell(1)!.id).hp,576);
});

test('malformed save cannot forget dedup IDs or collide a future detached-group identity',()=>{
 const cells=[ground(100,0),cell(1,0,0,0),cell(2,0,1,0,{material:'wood'})],m=authority(cells);
 m.blast(shot(m,'cut',1,{x:0,y:-1,z:0},.1,100));const saved=m.snapshot();
 const missingMember=structuredClone(saved);missingMember.groups[0].regionIds.pop();
 const badSerial=structuredClone(saved);badSerial.serial=0;
 const missingDedup=structuredClone(saved);missingDedup.processed=[];
 for(const corrupt of [missingMember,badSerial,missingDedup]){assert.equal(m.restore(corrupt),false);assert.deepEqual(m.snapshot(),saved);}
});

test('invalid static cell ordinals are safe misses and reset clears prior-epoch workload counters',()=>{
 const m=authority([ground(100,0),cell(1,0,0,0)]);
 for(const ordinal of [-1,.5,NaN,1000])assert.equal(m.isStaticCell(ordinal),false);
 m.blast(shot(m,'work',1,undefined,9,1));assert.ok(m.stats().lastCandidateBoxes>0);m.reset();
 assert.equal(m.stats().lastCandidateBoxes,0);assert.equal(m.stats().lastCandidateCells,0);assert.equal(m.stats().lastCandidateRegions,0);assert.equal(m.stats().lastSupportVisited,0);
});
