import {test} from 'node:test';import assert from 'node:assert/strict';
import {createStructuralSimulation} from './simulation.js';import {createStructuralOrdnance} from './ordnance.js';
import type {Cell} from './types.js';
test('real shared detonation applies authoritative damage exactly once; chained stages settle before smoke',async()=>{
 const cells:Cell[]=[];let id=0;for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)cells.push({id:id++,objectId:'ground',role:'terrain',position:{x,y:-1,z},material:'soil',color:0x887755,hp:20,maxHp:20,anchor:true});
 const world=await createStructuralSimulation({id:'ordnance',cells});const effects:string[]=[];const p=await createStructuralOrdnance(world,e=>effects.push(e.id));
 try{
  assert.ok(p.attach({id:'echo',epoch:world.epoch,weapon:'echo',surface:{voxelId:40,position:{x:0,y:-.5,z:0},normal:{x:0,y:1,z:0}},power:1}));
  assert.equal(world.research(),0);assert.equal(p.detonateAttached().length,1);assert.ok(world.views().find(c=>c.id===40)!.hp<20);const initial=world.research();
  assert.equal(p.detonateAttached().length,0);assert.equal(world.research(),initial);assert.ok(world.pending()>0);
  p.step(1);assert.equal(effects.length,2);p.step(.5);assert.equal(effects.length,3);assert.equal(world.pending(),0);assert.equal(new Set(effects).size,3);
  world.reset();assert.equal(p.getProjectiles().length,0);assert.equal(world.research(),0);p.step(1);assert.equal(effects.length,3);
 }finally{p.dispose();world.dispose();}
});
