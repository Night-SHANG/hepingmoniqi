import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

test('scene effect channel preserves concurrent actual-tool events and ignores duplicate/stale events',async()=>{
 const api=await import('./scene-effects').catch(()=>null);assert.ok(api,'scene needs independent effect channel');
 const scene=new THREE.Scene(),channel=api.createSceneEffectChannel(scene);
 const base={epoch:4,position:{x:1,y:2,z:3},kind:'detonation'};
 channel.add({...base,id:'first',tool:'nova',scale:48});channel.add({...base,id:'second',tool:'charge',position:{x:12,y:3,z:4}});channel.add({...base,id:'first',tool:'pulse'});
 channel.render();assert.deepEqual(channel.getDiagnostics().events.map(e=>[e.id,e.tool]),[['first','nova'],['second','charge']]);
 channel.add({...base,id:'old',epoch:3});assert.equal(channel.getDiagnostics().active,2);
 channel.add({...base,id:'fresh',epoch:5,tool:'phase'});assert.equal(channel.getDiagnostics().active,1);channel.dispose();assert.equal(scene.children.length,0);
});

test('secondary impact and detachment stay dust-only and smoke never holds settlement',async()=>{
 const api=await import('./scene-effects').catch(()=>null);assert.ok(api);
 const scene=new THREE.Scene(),channel=api.createSceneEffectChannel(scene),base={epoch:1,position:{x:0,y:1,z:0}};
 channel.add({...base,id:'hit',kind:'impact',material:'wood'});channel.add({...base,id:'fall',kind:'detach'});channel.render();assert.equal(channel.hasActiveCore(),false);
 assert.ok(channel.getDiagnostics().events.every(e=>e.kind==='impact'));
 const fire:THREE.Object3D[]=[];scene.traverse(o=>{if(o.name==='explosion-fire')fire.push(o);});assert.ok(fire.every(o=>!o.visible));
 channel.add({...base,id:'blast',kind:'detonation',tool:'nova'});assert.equal(channel.hasActiveCore(),true);
 channel.step(.9);assert.equal(channel.hasActiveCore(),false);assert.ok(channel.getDiagnostics().active>0);
 channel.clear();assert.equal(scene.children.length,0);channel.add({...base,id:'blast',kind:'detonation'});assert.equal(channel.getDiagnostics().active,0,'clear must not replay same authority event');channel.dispose();
});

test('explicit scene reset permits a different world epoch without reviving old visuals',async()=>{
 const {createSceneEffectChannel}=await import('./scene-effects'),scene=new THREE.Scene(),channel=createSceneEffectChannel(scene),event={id:'first',epoch:8,position:{x:0,y:0,z:0},kind:'detonation'};
 channel.add(event);channel.render();channel.reset();assert.equal(scene.children.length,0);
 channel.add({...event,epoch:1});assert.equal(channel.getDiagnostics().active,1);assert.equal(channel.getDiagnostics().epoch,1);channel.dispose();
});
