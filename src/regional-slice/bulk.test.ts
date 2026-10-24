import test from 'node:test';
import assert from 'node:assert/strict';

const load=async()=>{
 const name='./bulk.js';const module=await import(name).catch(()=>null);
 assert.ok(module?.classifyBulkTile,'regional bulk classifier must exist');
 return module as typeof import('./bulk.js');
};
const summary={bounds:{minX:0,maxX:7,minY:0,maxY:7,minZ:0,maxZ:7},count:512,materialCount:1,allStatic:true,pristine:true,maxHp:2};
const blast={id:'one',epoch:1,center:{x:0,y:0,z:0},radius:48,damage:20};

test('fully killed homogeneous 8³ tile qualifies by farthest cell-center damage, not center damage',async()=>{
 const {classifyBulkTile}=await load();
 const c=classifyBulkTile(summary,blast);
 assert.equal(c.kind,'full-gone');assert.equal(c.maximumDistance,Math.hypot(7,7,7));
 assert.equal(c.minimumDamage,20*(1-.65*Math.hypot(7,7,7)/48));
 assert.equal(classifyBulkTile({...summary,maxHp:19},blast).kind,'not-killable');
});
test('geometric sphere boundary, mixed material and previously modified HP force scalar fallback',async()=>{
 const {classifyBulkTile}=await load();
 assert.equal(classifyBulkTile(summary,{...blast,radius:8}).kind,'boundary');
 assert.equal(classifyBulkTile({...summary,materialCount:2},blast).kind,'mixed');
 assert.equal(classifyBulkTile({...summary,pristine:false},blast).kind,'partial');
 assert.equal(classifyBulkTile({...summary,allStatic:false},blast).kind,'partial');
 assert.equal(classifyBulkTile({...summary,bounds:{minX:56,maxX:63,minY:0,maxY:7,minZ:0,maxZ:7}},blast).kind,'outside');
});
test('actual intact eight-layer geology cannot be bulk-killed by peak damage twenty',async()=>{
 const {classifyBulkTile}=await load();
 assert.equal(classifyBulkTile({...summary,bounds:{minX:0,maxX:7,minY:-8,maxY:-1,minZ:0,maxZ:7},maxHp:58},{...blast,center:{x:0,y:3,z:0}}).kind,'not-killable');
});

import {createDenseFixture,type CompactCell} from '../compact/fixture.js';
import {CompactAuthorityStore} from '../compact/store.js';
const cube=(offset=0):CompactCell[]=>Array.from({length:512},(_,i)=>({id:1000+i+offset*10000,objectId:'box',role:'building',position:{x:offset+(i%8),y:Math.floor(i/64),z:Math.floor(i/8)%8},material:'wood',color:0xff0000,hp:2,maxHp:2,objective:true}));
const smallFixture=()=>createDenseFixture({id:'box',cells:cube()});
const storeLoad=async()=>{const api=await load();assert.ok(api.RegionalBulkStore,'regional bulk store must exist');return api;};

test('a genuine tile override kills 512 cells without per-cell writes or original queries during the edit',async()=>{
 const {RegionalBulkStore}=await storeLoad(),fixture=smallFixture(),store=new RegionalBulkStore(fixture);
 const original=fixture.original.bind(fixture);fixture.original=()=>{throw new Error('bulk edit must not read individual cells');};
 const r=store.blast(blast);fixture.original=original;
 assert.equal(r.accepted,true);assert.equal(r.bulkTiles,1);assert.equal(r.bulkCells,512);assert.equal(r.scalarCellsVisited,0);assert.equal(r.scalarDamageCalls,0);assert.equal(r.overrideWrites,1);assert.equal(r.perCellBulkWrites,0);
 assert.equal(store.snapshot().rows.length,0);assert.equal(store.snapshot().goneTiles.length,1);
 for(const c of cube())assert.deepEqual(store.read(c.id),{id:c.id,hp:0,loss:2,state:'gone'});
 const a=store.aggregate();assert.equal(a.gone,512);assert.equal(a.static,0);assert.equal(a.loss,1024);assert.equal(a.objectiveDeparted,512);assert.equal(a.rewardedLoss,512);assert.equal(a.structuralResearch,200);assert.equal(a.creditedResearch,200);assert.equal(a.research,200);
});

test('partial HP, mixed material and boundary cells use the exact scalar operation, including epsilon death',async()=>{
 const {RegionalBulkStore}=await storeLoad();
 const cells:CompactCell[]=[
  {...cube()[0],id:1,hp:30,maxHp:30},
  {...cube()[0],id:2,position:{x:1,y:0,z:0},material:'stone',hp:19.72916666666667+5e-9,maxHp:30},
  {...cube()[0],id:3,position:{x:48,y:0,z:0},hp:8,maxHp:8},
  {...cube()[0],id:4,position:{x:49,y:0,z:0},hp:2,maxHp:2},
 ];
 const fixture=createDenseFixture({id:'boundary',cells}),store=new RegionalBulkStore(fixture);const r=store.blast(blast);
 assert.equal(r.bulkTiles,0);assert.equal(r.scalarDamageCalls,3);assert.equal(store.read(1)!.hp,10);assert.equal(store.read(2)!.hp,0);assert.equal(store.read(2)!.loss,cells[1].hp);assert.equal(store.read(3)!.hp,1);assert.equal(store.read(4)!.hp,2);
});

test('already-gone and moving members are excluded, and prior damage prevents a uniform override',async()=>{
 const {RegionalBulkStore}=await storeLoad();const fixture=smallFixture();
 const store=new RegionalBulkStore(fixture,[{id:1000,hp:0,loss:2,state:'gone'},{id:1001,hp:2,loss:2,state:'dynamic'},{id:1002,hp:2,loss:2,state:'rubble'},{id:1003,hp:1,loss:1,state:'static'}]);
 const r=store.blast(blast);assert.equal(r.bulkTiles,0);assert.equal(r.scalarDamageCalls,509);assert.equal(store.read(1001)!.state,'dynamic');assert.equal(store.read(1002)!.state,'rubble');assert.equal(store.read(1000)!.loss,2);assert.equal(store.aggregate().rewardedLoss,508.5);
 const before=store.aggregate();const repeated=store.blast({...blast,id:'second'});assert.equal(repeated.scalarDamageCalls,0);assert.deepEqual(store.aggregate(),before);
});

test('suppressed partial damage is not retroactively rewarded by a later kill or duplicate shot',async()=>{
 const {RegionalBulkStore}=await storeLoad();const fixture=createDenseFixture({id:'one-cell',cells:[{...cube()[0],hp:40,maxHp:40}]});const store=new RegionalBulkStore(fixture);
 assert.equal(store.blast({...blast,reward:false}).accepted,true);assert.equal(store.aggregate().rewardedLoss,0);assert.equal(store.blast(blast).accepted,false);
 store.blast({...blast,id:'two'});assert.equal(store.aggregate().rewardedLoss,.5);assert.equal(store.aggregate().research,100);assert.equal(store.aggregate().structuralResearch,200);
 assert.equal(store.blast({...blast,id:'stale',epoch:0}).accepted,false);
});

test('snapshot restore preserves sparse uniform overrides, stable IDs and reward idempotence; reset clears them',async()=>{
 const {RegionalBulkStore}=await storeLoad();const fixture=smallFixture(),a=new RegionalBulkStore(fixture);a.blast(blast);const saved=a.snapshot(),b=new RegionalBulkStore(fixture);
 assert.equal(b.restore(saved),true);assert.deepEqual(b.aggregate(),a.aggregate());assert.deepEqual(b.read(1008),a.read(1008));assert.equal(b.blast(blast).accepted,false);
 saved.goneTiles.length=0;assert.equal(b.read(1008)!.state,'gone','restore owns the snapshot');
 const wrong={...b.snapshot(),fixtureId:'not-the-same'};assert.equal(b.restore(wrong),false);assert.equal(b.read(1008)!.state,'gone');
 b.reset();assert.equal(b.epoch,2);assert.equal(b.read(1008)!.hp,2);assert.equal(b.aggregate().research,0);assert.equal(b.blast(blast).accepted,false);assert.equal(b.blast({...blast,epoch:2}).accepted,true);
});

test('same-storage scalar control disables true overrides without changing the resulting HP or counters',async()=>{
 const {RegionalBulkStore}=await storeLoad(),fixture=smallFixture(),bulk=new RegionalBulkStore(fixture),scalar=new RegionalBulkStore(fixture);
 bulk.blast(blast);const r=scalar.blast(blast,{forceScalar:true});assert.equal(r.bulkTiles,0);assert.equal(r.scalarDamageCalls,512);assert.equal(scalar.snapshot().rows.length,512);assert.deepEqual(scalar.aggregate(),bulk.aggregate());
 for(const c of cube())assert.deepEqual(scalar.read(c.id),bulk.read(c.id));
});

import {ScalarBulkOracle} from './bulk-oracle.js';
test('independent compact-store oracle matches every HP/state/loss and objective/reward field across ordered shots',async()=>{
 const {RegionalBulkStore}=await storeLoad();let seed=311;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const source=[...cube(-8),...cube(8)].map((c,i)=>({...c,id:i%2?-90000-i:5000+i,material:(i%3?'stone':'wood') as 'stone'|'wood',hp:2+Math.floor(rnd()*20),maxHp:32,objective:i%5!==0,role:(i%7?'building':'terrain') as 'building'|'terrain'}));
 const fixture=createDenseFixture({id:'seeded',cells:source}),rows:import('./bulk.js').BulkRow[]=[{id:source[0].id,hp:0,loss:source[0].hp,state:'gone'},{id:source[2].id,hp:source[2].hp,loss:source[2].hp,state:'dynamic'}];
 const regional=new RegionalBulkStore(fixture,rows),oracle=new ScalarBulkOracle(fixture,rows);
 for(let i=0;i<5;i++){
  const command={id:`sequence-${i}`,epoch:1,center:{x:-10+i*5,y:2,z:2},radius:8+i,damage:3+i*2,reward:i!==1};regional.blast(command);oracle.blast(command);
  for(const c of source)assert.deepEqual(regional.read(c.id),oracle.read(c.id));
  const a=regional.aggregate(),b=oracle.aggregate();for(const key of Object.keys(b) as (keyof typeof b)[])assert.ok(Math.abs(a[key]-b[key])<=1e-8,`${key}: ${a[key]} != ${b[key]}`);
  for(const key of ['structuralResearch','creditedResearch','research','objectiveDeparted'] as const)assert.equal(a[key],b[key]);
 }
});
