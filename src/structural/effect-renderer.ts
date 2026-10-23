import * as THREE from 'three';
import {EFFECT_PROFILES, type EffectFrame} from './effects.js';
/** Shared low-poly geometry. All meshes are cosmetic and never enter the physics world. */
export class StructuralEffects {
 private geometry=new THREE.IcosahedronGeometry(1,0);
 private ring=new THREE.TorusGeometry(1,.035,4,32);
 private instances=new Map<string,{root:THREE.Group;core:THREE.Mesh[];smoke:THREE.Mesh[];wave:THREE.Mesh;flash:THREE.Mesh}>();
 constructor(private scene:THREE.Scene){}
 update(frames:EffectFrame[]){
  const selected=frames.slice(-48);const wanted=new Set(selected.map(f=>f.id));
  for(const [id,e] of this.instances)if(!wanted.has(id)){this.release(e);this.instances.delete(id);}
  // Cosmetic saturation only: authoritative events and damage remain untouched.
  for(const f of selected){
   const p=EFFECT_PROFILES[f.tool];let e=this.instances.get(f.id);
   if(!e){const root=new THREE.Group();root.position.set(f.position.x,f.position.y,f.position.z);
    const core=Array.from({length:p.lobes},()=>new THREE.Mesh(this.geometry,new THREE.MeshBasicMaterial({color:p.color,transparent:true,depthWrite:false})));
    const smoke=Array.from({length:6},()=>new THREE.Mesh(this.geometry,new THREE.MeshLambertMaterial({color:0x716d66,transparent:true,opacity:0,depthWrite:false})));
    const wave=new THREE.Mesh(this.ring,new THREE.MeshBasicMaterial({color:p.color,transparent:true,depthWrite:false}));wave.rotation.x=Math.PI/2;
    const flash=new THREE.Mesh(this.geometry,new THREE.MeshBasicMaterial({color:0xfff5df,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));flash.name='explosion-flash';core.forEach(m=>m.name='explosion-fire');
    root.add(flash,...core,...smoke,wave);this.scene.add(root);e={root,core,smoke,wave,flash};this.instances.set(f.id,e);
   }
   const scale=(f.scale??1)*p.spread;
   e.flash.visible=f.flash>0;e.flash.scale.setScalar(scale*(.6+.6*f.flash));(e.flash.material as THREE.MeshBasicMaterial).opacity=f.flash*.95;
   e.core.forEach((m,i)=>{const a=i*2.399;const r=(.2+f.age*.6)*scale;m.position.set(Math.cos(a)*r,Math.sin(i*1.7)*r*.6,Math.sin(a)*r);m.scale.setScalar(Math.max(.01,(.35+f.age*1.8)*scale));if(f.tool==='shock')m.scale.z*=.25;m.visible=f.fire>0;(m.material as THREE.MeshBasicMaterial).opacity=f.fire*.85;});
   e.smoke.forEach((m,i)=>{const a=i*2.399;const spread=scale*(.3+f.age*.45);m.position.set(Math.cos(a)*spread,.2+f.age*(.55+i*.07),Math.sin(a)*spread);m.scale.setScalar(scale*(.35+f.age*.22));(m.material as THREE.MeshLambertMaterial).opacity=f.smoke*.32;});
   e.wave.visible=f.ring>0;e.wave.position.y=.1;e.wave.scale.setScalar(Math.max(.01,scale*f.age*4));(e.wave.material as THREE.MeshBasicMaterial).opacity=f.ring*.65;
  }
 }
 private release(e:{root:THREE.Group}){e.root.traverse(o=>{if(o instanceof THREE.Mesh)(o.material as THREE.Material).dispose();});this.scene.remove(e.root);}
 dispose(){for(const e of this.instances.values())this.release(e);this.instances.clear();this.geometry.dispose();this.ring.dispose();}
}
