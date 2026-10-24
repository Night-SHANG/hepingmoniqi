import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../domain.js';
import {createSupportGraph} from './support.js';
import {packStaticCells} from './static-packing.js';

const load=async()=>{
 const module=await import('./game-fixtures.js').catch(()=>null);
 assert.ok(module?.createGameFixture,'formal pure fixture factory must exist');return module;
};

test('formal courtyard retains every old gameplay cell on eight destructible soil layers',async()=>{
 const {createGameFixture,previewGameVoxels}=await load(),fixture=createGameFixture('courtyard'),old=createWorld().getVoxels();
 for(const v of old){const c=fixture.cells.find(c=>c.id===v.id)!;assert.ok(c);assert.deepEqual(c.position,v.position);assert.equal(c.hp,v.hp);assert.equal(c.color,v.color);assert.ok(!c.anchor);assert.equal(c.objective,v.group==='house');}
 const soil=fixture.cells.filter(c=>c.role==='terrain');assert.deepEqual([...new Set(soil.map(c=>c.position.y))].sort((a,b)=>a-b),[-8,-7,-6,-5,-4,-3,-2,-1]);
 assert.ok(soil.every(c=>Number.isFinite(c.hp)&&c.hp>0));assert.ok(soil.find(c=>c.position.y===-8)!.hp>soil.find(c=>c.position.y===-1)!.hp);
 assert.ok(fixture.cells.filter(c=>c.anchor).every(c=>c.role==='terrain'&&c.position.y===-8));
 assert.equal(createSupportGraph(fixture.cells).unsupported().length,0);
 assert.equal(new Set(fixture.cells.map(c=>`${c.position.x},${c.position.y},${c.position.z}`)).size,fixture.cells.length);
 const views=previewGameVoxels('courtyard');assert.equal(views.length,fixture.cells.length);assert.ok(views.every(v=>v.size?.x===1&&v.structuralState==='static'));
 assert.ok(packStaticCells(fixture.cells).length<fixture.cells.length/10,'deep soil stays compact');
});

for(const [map,count] of [['neighborhood',9],['city',36]] as const)test(`formal ${map} keeps warm ${count} buildings and real road/tree/bridge authority`,async()=>{
 const {createGameFixture}=await load(),fixture=createGameFixture(map);
 assert.equal(new Set(fixture.cells.filter(c=>c.role==='building').map(c=>c.objectId)).size,count);
 assert.ok(fixture.cells.some(c=>c.material==='roof'&&c.color===0xa94633));
 for(const role of ['road','tree','bridge','foundation'])assert.ok(fixture.cells.some(c=>c.role===role));
 assert.equal(createSupportGraph(fixture.cells).unsupported().length,0);
 assert.ok(fixture.cells.filter(c=>c.role==='terrain').every(c=>c.position.y>=-8&&c.position.y<=-1));
});

test('large-map incidental roads trees and footbridges remain destructible without extending the building objective',async()=>{
 const {createGameFixture}=await load(),fixture=createGameFixture('neighborhood');
 assert.ok(fixture.cells.filter(c=>c.role==='bridge').length>0);
 assert.ok(fixture.cells.filter(c=>c.role==='bridge'||c.role==='road'||c.role==='tree').every(c=>!c.objective));
 assert.ok(fixture.cells.filter(c=>c.role==='building'||c.role==='foundation').every(c=>c.objective));
});
