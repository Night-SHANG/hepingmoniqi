import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EffectTimeline, EFFECT_PROFILES} from './effects.js';
test('all eight tools have distinct authored profiles and independent event instances',()=>{
 assert.equal(Object.keys(EFFECT_PROFILES).length,8);
 assert.equal(new Set(Object.values(EFFECT_PROFILES).map(p=>JSON.stringify(p))).size,8);
 const t=new EffectTimeline();
 t.add({id:'a',epoch:1,position:{x:0,y:0,z:0},tool:'charge'});
 t.add({id:'b',epoch:1,position:{x:5,y:0,z:0},tool:'nova'});
 assert.equal(t.frames().length,2);
 t.add({id:'a',epoch:1,position:{x:0,y:0,z:0},tool:'charge'});
 assert.equal(t.frames().length,2);
 t.step(0);assert.equal(t.frames()[0].age,0);
 t.step(.5);assert.equal(t.frames().length,2);
 assert.equal(t.frames()[0].age,.5);
 t.reset(2);assert.equal(t.frames().length,0);
 t.add({id:'old',epoch:1,position:{x:0,y:0,z:0},tool:'nova'});
 assert.equal(t.frames().length,0);
});
test('smoke tails expire independently and never expose a simulation pending-work gate',()=>{
 const t=new EffectTimeline();t.add({id:'x',epoch:1,position:{x:0,y:0,z:0},tool:'nova'});
 t.step(1);assert.ok(t.frames()[0].smoke>0);assert.equal(t.frames()[0].flash,0);
 for(let i=0;i<6;i++)t.step(1);assert.equal(t.frames().length,0);
});
