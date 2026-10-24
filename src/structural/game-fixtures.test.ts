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

for(const map of ['neighborhood','city'] as const)test(`${map}: formal ground continuously covers the complete playable bounds at every finite depth`,async()=>{
 const {createGameFixture,GAME_SOIL_HP}=await load();const {WORLD_BOUNDS}=await import('../world-layout.js');const {createStructuralFixture}=await import('./fixtures.js');
 const {halfX,halfZ}=WORLD_BOUNDS[map],width=halfX*2+1,depth=halfZ*2+1,mask=new Uint8Array(width*depth),fixture=createGameFixture(map);
 let terrainCount=0;
 for(const c of fixture.cells)if(c.role==='terrain'){
  const {x,y,z}=c.position;assert.ok(Number.isInteger(x)&&Number.isInteger(z)&&Math.abs(x)<=halfX&&Math.abs(z)<=halfZ&&y>=-8&&y<=-1);
  const index=(x+halfX)*depth+(z+halfZ),bit=1<<(-y-1);assert.equal(mask[index]&bit,0,'No duplicate geological cells');mask[index]|=bit;terrainCount++;
  assert.ok(Number.isFinite(c.hp)&&c.hp===GAME_SOIL_HP[-y-1]);
  assert.equal(c.anchor===true,y===-8&&(Math.abs(x)===halfX||Math.abs(z)===halfZ),'Only actual finite outer roots may remain anchored');
 }
 const missing=mask.findIndex(value=>value!==255);
 assert.equal(missing,-1,`Missing complete soil column at x=${Math.floor(missing/depth)-halfX}, z=${missing%depth-halfZ}`);
 assert.equal(terrainCount,width*depth*8);
 // Existing source cells and all eight prior soil-layer IDs remain stable.
 const oldColumns=new Map<string,{x:number;z:number}>();for(const c of createStructuralFixture(map).cells)if(c.role==='terrain')oldColumns.set(`${c.position.x},${c.position.z}`,{x:c.position.x,z:c.position.z});
 const byId=new Map(fixture.cells.map(c=>[c.id,c]));let id=-1;
 for(let layer=1;layer<=8;layer++)for(const p of oldColumns.values())assert.deepEqual(byId.get(id--)!.position,{...p,y:-layer});
 assert.equal(new Set(fixture.cells.filter(c=>c.role==='building').map(c=>c.objectId)).size,map==='city'?36:9);
});

test('former empty neighborhood land has real removable collision and restores its crater without phantom support',async()=>{
 const {createGameFixture}=await load();const {createStructuralSimulation}=await import('./simulation.js');const {default:RAPIER}=await import('@dimforge/rapier3d-compat');
 const large=createGameFixture('neighborhood'),added=large.cells.filter(c=>c.role==='terrain'&&c.position.x>=43&&c.position.x<=48&&c.position.z>=31&&c.position.z<=36);
 assert.equal(added.length,6*6*8,'Previously empty in-bounds land must be backed by geological cells');
 // Use actual generated cells in a finite cropped fixture to isolate geometry
 // correctness without allocating two full large-map worlds in the test suite.
 const cells=added.map(c=>({...c,anchor:c.position.y===-8&&(c.position.x===43||c.position.x===48||c.position.z===31||c.position.z===36)}));
 const simulation=await createStructuralSimulation({id:'formal-continuous-terrain-regression',cells});
 try{
  const target={x:45,y:-1,z:33},ray=()=>simulation.physicsHost.world.castRay(new RAPIER.Ray({x:45,y:2,z:33},{x:0,y:-1,z:0}),20,true)?.timeOfImpact;
  simulation.step(1/120);assert.equal(ray(),2.5);
  assert.ok(simulation.blast({id:'new-ground-crater',epoch:simulation.epoch,position:target,radius:2.6,damage:8,impulse:0}));simulation.step(1/120);
  assert.ok(ray()!>2.5&&ray()!<10,'The real collider must reveal a deeper destructible crater floor');const saved=simulation.snapshot(),expected=simulation.views();
  simulation.reset();simulation.step(1/120);assert.equal(ray(),2.5);assert.ok(simulation.restore(saved));assert.deepEqual(simulation.views(),expected);simulation.step(1/120);assert.ok(ray()!>2.5);
  const middle=cells.filter(c=>c.position.x===45&&c.position.z===33);
  for(const c of middle)assert.ok(simulation.blast({id:`full-cut-${c.id}`,epoch:simulation.epoch,position:c.position,radius:.2,damage:100,impulse:0}));simulation.step(1/120);
  assert.equal(ray(),undefined,'No decorative or invisible floor may seal a full-depth authoritative hole');
 }finally{simulation.dispose();}
});

for(const [map,total] of [['neighborhood',50016],['city',184681]] as const)test(`${map}: legacy fixture reproduces the old finite plots solely for strict save validation`,async()=>{
 const module=await load();assert.equal(typeof module.createLegacyGameFixture,'function');
 const old=module.createLegacyGameFixture(map),current=module.createGameFixture(map);const {createStructuralFixture}=await import('./fixtures.js');
 assert.equal(old.cells.length,total);assert.equal(old.id,current.id);
 const columns=new Map<string,{x:number;z:number}>();for(const c of createStructuralFixture(map).cells)if(c.role==='terrain')columns.set(`${c.position.x},${c.position.z}`,{x:c.position.x,z:c.position.z});
 const points=[...columns.values()],xs=points.map(p=>p.x),zs=points.map(p=>p.z),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
 const expected=old.cells.filter(c=>c.role!=='terrain');assert.deepEqual(expected,current.cells.filter(c=>c.role!=='terrain'));let id=-1;
 for(let depth=1;depth<=8;depth++)for(const {x,z} of points){const hp=module.GAME_SOIL_HP[depth-1],y=-depth;
  const color=depth===1?[0x8b9650,0x9aa45a,0x778448][Math.abs(x*7+z*11)%3]:[0x775238,0x8b6240,0x9a7048][Math.abs(x*73+y*31+z*17)%3];
  expected.push({id:id--,objectId:`game:${map}:geology`,role:'terrain',position:{x,y,z},material:'soil',color,hp,maxHp:hp,objective:false,...(depth===8&&(x===minX||x===maxX||z===minZ||z===maxZ)?{anchor:true}:{})});
 }
 assert.equal(JSON.stringify(old.cells),JSON.stringify(expected),'Historical fixture signature must match exact original serialization');
 assert.ok(old.cells.filter(c=>c.anchor).some(c=>!current.cells.find(n=>n.id===c.id)?.anchor),'Old inner plot boundary roots must not leak into production geometry');
});
