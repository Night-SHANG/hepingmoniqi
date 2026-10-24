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
test('simulation clock is partition independent and ignores paused or invalid steps',()=>{
 const a=new EffectTimeline(),b=new EffectTimeline();
 for(const t of [a,b])t.add({id:'same',epoch:1,tool:'nova',position:{x:0,y:0,z:0}});
 a.step(2.25);for(let i=0;i<9;i++)b.step(.25);
 assert.deepEqual(a.frames(),b.frames());
 const before=a.frames();for(const dt of [0,-1,NaN,Infinity])a.step(dt);assert.deepEqual(a.frames(),before);
});
test('only brief blast core is active work; dust impact and residual smoke are not',()=>{
 const t=new EffectTimeline();
 t.add({id:'impact',epoch:1,kind:'impact',material:'stone',intensity:.8,position:{x:0,y:0,z:0}});
 assert.equal(t.hasActiveCore(),false);
 assert.equal(t.frames()[0].flash,0);assert.equal(t.frames()[0].fire,0);
 t.add({id:'blast',epoch:1,tool:'nova',position:{x:1,y:2,z:3}});assert.equal(t.hasActiveCore(),true);
 t.step(1.2);assert.equal(t.hasActiveCore(),false);assert.ok(t.frames().some(f=>f.smoke>0));
 assert.equal(t.activeCount,2);t.clear();assert.equal(t.activeCount,0);
 t.add({id:'blast',epoch:1,tool:'nova',position:{x:0,y:0,z:0}});assert.equal(t.activeCount,0,'clearing presentation must not replay a seen event');
 t.reset(2);t.add({id:'blast',epoch:2,tool:'nova',position:{x:0,y:0,z:0}});assert.equal(t.activeCount,1);
});
test('late independent events retain their own age and cloned positions',()=>{
 const t=new EffectTimeline(),position={x:2,y:3,z:4};
 t.add({id:'first',epoch:1,tool:'charge',position});position.x=99;t.step(.5);
 t.add({id:'second',epoch:1,tool:'nova',position:{x:8,y:0,z:0}});
 const first=t.frames();assert.equal(first[0].position.x,2);assert.equal(first[0].age,.5);assert.equal(first[1].age,0);
 first[0].position.x=-55;first[0].age=99;assert.equal(t.frames()[0].age,.5);assert.equal(t.frames()[0].position.x,2);
 t.step(7);assert.equal(t.activeCount,0);
 t.add({id:'second',epoch:1,tool:'nova',position});assert.equal(t.activeCount,0,'expired events stay deduplicated for the epoch');
});
