import type * as THREE from 'three';
import {EffectTimeline,type EffectInput} from './structural/effects';
import {StructuralEffects} from './structural/effect-renderer';
export type SceneEffectEvent=Omit<EffectInput,'kind'>&{kind:string};

/** Formal scene bridge: one authoritative event identity, one independent visual. */
export function createSceneEffectChannel(scene:THREE.Scene){
 const timeline=new EffectTimeline(),renderer=new StructuralEffects(scene);let epoch:number|null=null;
 return {
  add(event:SceneEffectEvent){
   if(!Number.isFinite(event.epoch)||epoch!==null&&event.epoch<epoch)return;
   if(event.kind!=='detonation'&&event.kind!=='impact'&&event.kind!=='detach')return;
   if(epoch!==event.epoch){epoch=event.epoch;timeline.reset(epoch);renderer.clear();}
   timeline.add({...event,kind:event.kind==='detonation'?'detonation':'impact'});
  },
  step(dt:number){timeline.step(dt);},
  render(){renderer.update(timeline.frames());},
  clear(){timeline.clear();renderer.clear();},
  reset(){epoch=null;timeline.reset(1);renderer.clear();},
  setReducedMotion(value:boolean){renderer.setReducedMotion(value);},
  hasActiveCore(){return timeline.hasActiveCore();},
  getDiagnostics(){return {epoch,active:timeline.activeCount,events:timeline.frames().map(f=>({id:f.id,kind:f.kind,tool:f.tool,age:f.age}))};},
  dispose(){timeline.clear();renderer.dispose();},
 };
}
