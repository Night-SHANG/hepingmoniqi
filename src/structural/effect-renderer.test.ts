import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {StructuralEffects} from './effect-renderer.js';import {EffectTimeline} from './effects.js';
test('flash is a real independently fading mesh, not an unused profile value',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene),t=new EffectTimeline();
 t.add({id:'blast',epoch:1,tool:'charge',position:{x:2,y:3,z:4}});renderer.update(t.frames());
 const flash=scene.getObjectByName('explosion-flash') as THREE.Mesh;assert.ok(flash);assert.equal(flash.visible,true);assert.ok((flash.material as THREE.MeshBasicMaterial).opacity>0);
 t.step(.15);renderer.update(t.frames());assert.equal(flash.visible,false);assert.ok(scene.getObjectByName('explosion-fire')!.visible);renderer.dispose();assert.equal(scene.children.length,0);
});
test('cosmetic budget retires old instances without touching timeline authority',()=>{
 const scene=new THREE.Scene(),renderer=new StructuralEffects(scene),t=new EffectTimeline();
 for(let i=0;i<60;i++){t.add({id:`blast${i}`,epoch:1,tool:'nova',position:{x:i,y:0,z:0}});renderer.update(t.frames());}
 assert.equal(t.frames().length,60);assert.equal(scene.children.length,48);renderer.dispose();
});
