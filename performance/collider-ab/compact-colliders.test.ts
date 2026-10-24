import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {CompactGroundColliders} from './compact-colliders.ts';
import {CompactTerrain,type TerrainConfig} from '../terrain/compact-terrain.ts';
import {packStaticCells} from '../../src/structural/static-packing.ts';
import type {Cell,Point} from '../../src/structural/types.ts';
const cfg:TerrainConfig={map:'collider-ab',minX:-9,maxX:9,minZ:-5,maxZ:5};
const identity={x:0,y:0,z:0,w:1};
before(async()=>{await RAPIER.init();});
function setup(config=cfg){const world=new RAPIER.World({x:0,y:-18,z:0}),terrain=new CompactTerrain(config);return {world,terrain,ground:new CompactGroundColliders(world,terrain,config)};}
function ray(world:RAPIER.World,x:number,z:number,originY=2){return world.castRay(new RAPIER.Ray({x,y:originY,z},{x:0,y:-1,z:0}),30,true);}
function cut(ground:CompactGroundColliders,x:number,z:number,from=-1,to=-8){for(let y=from;y>=to;y--)ground.damageAt({x,y,z},100);ground.flush();ground.world.step();}
function hitY(world:RAPIER.World,x:number,z:number){const hit=ray(world,x,z);return hit===null?null:2-hit.timeOfImpact;}

test('pristine clipped chunks allocate no terrain Cell objects and have finite collision faces',()=>{
 const {world,terrain,ground}=setup();try{world.step();assert.equal(world.colliders.len(),8);assert.equal(hitY(world,0,0),-.5);assert.equal(hitY(world,-9,-5),-.5);assert.equal(hitY(world,10,0),null);assert.equal(hitY(world,0,6),null);
 assert.equal(ground.diagnostics().temporaryCells,0);assert.equal(ground.diagnostics().retainedCellIds,0);assert.equal(terrain.diagnostics().mutableBytes,0);
 for(const r of ground.regions()){assert.ok(!('cellIds' in r));assert.ok(r.min.x>=-9&&r.max.x<=9&&r.min.z>=-5&&r.max.z<=5);assert.equal(r.min.y,-8);assert.equal(r.max.y,-1);}
 }finally{world.free();}
});

test('first-layer cut reveals next floor; full eight-layer hole has no ray or support-shape collision',()=>{
 const {world,terrain,ground}=setup();try{world.step();cut(ground,0,0,-1,-1);assert.equal(hitY(world,0,0),-1.5);
 const floor=world.castShape({x:0,y:1,z:0},identity,{x:0,y:-1,z:0},new RAPIER.Ball(.2),0,30,true);assert.ok(floor);assert.ok(Math.abs(floor.time_of_impact-2.3)<1e-4);
 cut(ground,0,0,-2,-8);assert.equal(hitY(world,0,0),null);assert.equal(world.castShape({x:0,y:1,z:0},identity,{x:0,y:-1,z:0},new RAPIER.Ball(.2),0,30,true),null);
 assert.equal(hitY(world,1,0),-.5);assert.equal(terrain.changes().length,8);assert.ok(ground.diagnostics().peakTemporaryCells<=512);assert.equal(ground.diagnostics().retainedCellIds,0);
 }finally{world.free();}
});

test('negative and positive chunk-boundary edits remove both sides without rebuilding untouched regions',()=>{
 const {world,terrain,ground}=setup();try{world.step();const untouched=ray(world,9,-4)!.collider.handle;
 for(const x of [-9,-8,-1,0,7,8])cut(ground,x,0);
 for(const x of [-9,-8,-1,0,7,8])assert.equal(hitY(world,x,0),null,`missing boundary column ${x}`);
 for(const x of [-7,-2,1,6,9])assert.equal(hitY(world,x,0),-.5);
 assert.equal(ray(world,9,-4)!.collider.handle,untouched);assert.equal(terrain.changes().length,48);assert.equal(ground.diagnostics().dirtyChunks,0);
 }finally{world.free();}
});

test('hit identity comes from actual point and live occupancy, including a removed outer-root cell',()=>{
 const {world,terrain,ground}=setup();try{world.step();const hit=ray(world,0,0)!,point={x:0,y:-.5,z:0};assert.equal(ground.resolve(hit.collider.handle,point),terrain.idAt(0,-1,0));
 ground.damageAt({x:0,y:-1,z:0},100);assert.equal(ground.resolve(hit.collider.handle,point),null,'stale geometry cannot return a removed cell');ground.flush();world.step();const next=ray(world,0,0)!;assert.equal(ground.resolve(next.collider.handle,{x:0,y:2-next.timeOfImpact,z:0}),terrain.idAt(0,-2,0));
 const root=terrain.idAt(-9,-8,-5)!;assert.equal(terrain.cell(root)!.anchor,true);ground.damageAt({x:-9,y:-8,z:-5},100);ground.flush();world.step();assert.equal(terrain.cell(root)!.state,'gone');assert.equal(terrain.changes().find(c=>c.id===root)!.state,'gone');
 const upward=world.castRay(new RAPIER.Ray({x:-9,y:-10,z:-5},{x:0,y:1,z:0}),20,true)!;assert.equal(upward.timeOfImpact,2.5);assert.equal(ground.resolve(upward.collider.handle,{x:-9,y:-7.5,z:-5}),terrain.idAt(-9,-7,-5));
 }finally{world.free();}
});

test('compact collision equals independently populated dense packer on all bounded column rays after mixed cuts',()=>{
 const config={map:'dense-oracle',minX:-3,maxX:9,minZ:-2,maxZ:2}, compact=setup(config), denseWorld=new RAPIER.World({x:0,y:-18,z:0});
 try{const cells:Cell[]=[];let id=1;for(let x=-3;x<=9;x++)for(let y=-8;y<=-1;y++)for(let z=-2;z<=2;z++){
  const gone=(x===0&&z===0)||(x===7&&y>=-3&&z===1)||(x===8&&y<=-5&&z===1)||(x===-3&&y===-8);
  if(gone)compact.ground.damageAt({x,y,z},100);else cells.push({id:id++,objectId:'oracle',role:'terrain',position:{x,y,z},material:'soil',hp:3,maxHp:3,color:0});
 }
 compact.ground.flush();for(const b of packStaticCells(cells))denseWorld.createCollider(RAPIER.ColliderDesc.cuboid(b.half.x,b.half.y,b.half.z).setTranslation(b.center.x,b.center.y,b.center.z));compact.world.step();denseWorld.step();
 let checked=0;for(let x=-4;x<=10;x++)for(let z=-3;z<=3;z++)for(const dx of [-.4,0,.4]){assert.equal(hitY(compact.world,x+dx,z),hitY(denseWorld,x+dx,z));checked++;}
 assert.equal(checked,315);assert.equal(compact.world.colliders.len(),denseWorld.colliders.len());
 // Exterior side probes and per-cell interior probes also cover buried cavities.
 for(let y=-8;y<=-1;y++)for(let z=-2;z<=2;z++){const r=new RAPIER.Ray({x:12,y,z},{x:-1,y:0,z:0});assert.equal(compact.world.castRay(r,30,true)?.timeOfImpact,denseWorld.castRay(r,30,true)?.timeOfImpact);}
 let interior=0;for(let x=-3;x<=9;x++)for(let y=-8;y<=-1;y++)for(let z=-2;z<=2;z++){const r=new RAPIER.Ray({x,y,z},{x:1,y:0,z:0});assert.equal(compact.world.castRay(r,30,true)?.timeOfImpact,denseWorld.castRay(r,30,true)?.timeOfImpact);interior++;}assert.equal(interior,520);
 }finally{compact.world.free();denseWorld.free();}
});

test('second CCD projectile passes the existing eight-layer hole while an adjacent projectile lands on real soil',()=>{
 const {world,ground}=setup();try{world.timestep=1/120;world.integrationParameters.maxCcdSubsteps=4;cut(ground,0,0);
 const projectile=(x:number)=>{const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,3,0).setLinvel(0,-25,0).setCcdEnabled(true));world.createCollider(RAPIER.ColliderDesc.ball(.15).setRestitution(0),b);return b;};
 for(let shot=0;shot<2;shot++){const ball=projectile(0);for(let i=0;i<80;i++)world.step();assert.ok(ball.translation().y < -12,`shot ${shot+1} cannot stop on a hidden floor`);world.removeRigidBody(ball);}
 const neighbor=projectile(1);for(let i=0;i<120;i++)world.step();assert.ok(Math.abs(neighbor.translation().y-(-.35))<.04);assert.equal(hitY(world,0,0),null);
 }finally{world.free();}
});

test('HP-only damage does not repack; moved soil vacates its original chunk without inventing a pose collider',()=>{
 const {world,terrain,ground}=setup();try{world.step();const hit=ray(world,0,0)!;ground.damageAt({x:0,y:-1,z:0},.125);ground.flush();assert.equal(ground.diagnostics().repackedChunks,0);assert.equal(ray(world,0,0)!.collider.handle,hit.collider.handle);
 const id=terrain.idAt(0,-1,0)!;terrain.promote(id,'moved',{x:50,y:4,z:50},identity,'dynamic');ground.markDirty({x:0,y:-1,z:0});ground.flush();world.step();assert.equal(hitY(world,0,0),-1.5);assert.equal(hitY(world,50,50),null);assert.equal(terrain.cell(id)!.state,'dynamic');assert.equal(terrain.cell(id)!.hp,3.075);assert.equal(ground.diagnostics().repackedChunks,1);
 }finally{world.free();}
});

test('preedited construction rejects rather than filling holes from a false pristine assumption',()=>{
 const world=new RAPIER.World({x:0,y:-18,z:0}),terrain=new CompactTerrain(cfg);try{terrain.damage(terrain.idAt(0,-1,0)!,100);assert.throws(()=>new CompactGroundColliders(world,terrain,cfg),/requires pristine construction/);assert.equal(world.colliders.len(),0);}finally{world.free();}
});
