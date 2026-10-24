import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameFixture} from '../structural/game-fixtures.js';
import type {MapId} from '../contracts.js';

const load=async()=>{const m=await import('./fixture.js').catch(()=>null);assert.ok(m?.createCompactGameFixture,'compact fixture factory must exist');return m;};

for(const map of ['courtyard','warehouse','bridge','tower','cantilever','neighborhood','city'] as MapId[])test(`${map}: compact recipe preserves every source ordinal and complete gameplay metadata`,async()=>{
 const {createCompactGameFixture}=await load(),compact=createCompactGameFixture(map),dense=createGameFixture(map);
 assert.equal(compact.count,dense.cells.length);if(map==='city')assert.equal(compact.count,454913);
 for(let ordinal=0;ordinal<dense.cells.length;ordinal++){
  const expected=dense.cells[ordinal];assert.equal(compact.idAtOrdinal(ordinal),expected.id);assert.equal(compact.ordinal(expected.id),ordinal);
  assert.deepEqual(compact.original(expected.id),expected);assert.equal(compact.idAt(expected.position.x,expected.position.y,expected.position.z),expected.id);
 }
 assert.ok(compact.recipeId.length<150);assert.equal(compact.diagnostics().retainedCellObjects,0);
 assert.equal(compact.diagnostics().terrainCellObjects,0);assert.equal(compact.objectiveCount,dense.cells.filter(c=>c.objective).length);
 assert.equal(compact.totalHp,dense.cells.reduce((n,c)=>n+(c.role==='terrain'?0:c.hp),0));
});

test('bounded queries preserve source order rather than numeric ID order and include exact spherical edges',async()=>{
 const {createCompactGameFixture}=await load(),fixture=createCompactGameFixture('city'),dense=createGameFixture('city');
 const center={x:-102,y:0,z:-46},radius=3;
 assert.deepEqual(fixture.idsInSphere(center,radius),dense.cells.filter(c=>Math.hypot(c.position.x-center.x,c.position.y-center.y,c.position.z-center.z)<=radius).map(c=>c.id));
 const key='-13,-1,-6';assert.deepEqual(fixture.idsInChunk(key),dense.cells.filter(c=>`${Math.floor(c.position.x/8)},${Math.floor(c.position.y/8)},${Math.floor(c.position.z/8)}`===key).map(c=>c.id));
 assert.equal(fixture.original(999999999),undefined);assert.equal(fixture.ordinal(999999999),-1);
 const chunks:string[]=[];fixture.forEachChunk(8,(x,y,z)=>chunks.push(`${x},${y},${z}`));
 assert.deepEqual(new Set(chunks),new Set(dense.cells.map(c=>`${Math.floor(c.position.x/8)},${Math.floor(c.position.y/8)},${Math.floor(c.position.z/8)}`)));
});

test('dense adapter retains arbitrary safe integer IDs, fractional coordinates, extra metadata and source ownership',async()=>{
 const {createDenseFixture}=await load();const source={id:'generic',cells:[{id:2**40,objectId:'first',role:'building' as const,position:{x:.25,y:1,z:2},material:'stone' as const,color:8,hp:.6,maxHp:.6,metadata:{tags:['original']}},{id:-7,objectId:'second',role:'terrain' as const,position:{x:1.25,y:1,z:2},material:'soil' as const,color:7,hp:3.2,maxHp:3.2,anchor:false}]};
 const fixture=createDenseFixture(source);source.cells[0].position.x=99;source.cells[0].metadata!.tags.push('source');
 assert.equal(fixture.ordinal(2**40),0);assert.equal(fixture.idAt(.25,1,2),2**40);assert.equal(fixture.original(2**40)!.position.x,.25);
 assert.deepEqual((fixture.original(2**40) as any).metadata.tags,['original']);assert.deepEqual(fixture.idsInSphere({x:1,y:1,z:2},1),[2**40,-7]);
 const original=fixture.original(2**40)!;original.position.x=99;assert.equal(fixture.original(2**40)!.position.x,.25);
});

test('dense chunk membership includes fractional centers up to the next chunk boundary',async()=>{
 const {createDenseFixture}=await load();const make=(id:number,x:number)=>({id,objectId:'fractional',role:'building' as const,position:{x,y:0,z:0},material:'stone' as const,color:1,hp:1,maxHp:1});
 const fixture=createDenseFixture({id:'fractional-chunks',cells:[make(1,7.75),make(2,8),make(3,-.25),make(4,-8)]});
 assert.deepEqual(fixture.idsInChunk('0,0,0'),[1]);assert.deepEqual(fixture.idsInChunk('-1,0,0'),[3,4]);
});
