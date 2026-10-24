import * as THREE from 'three';
import {EFFECT_PROFILES, effectSmokeDuration, type EffectFrame, type EffectProfile} from './effects.js';
import type {Matter} from './types.js';

const EVENT_BUDGET = 48;
const TAU = Math.PI * 2;
const DUST:Record<Matter,number> = {
 soil:0x8e7759,road:0x686964,wood:0x8b7050,stone:0x77776f,
 roof:0x997059,glass:0x8e9e96,foliage:0x777853,metal:0x737673,
};
interface Seed {angle:number;radius:number;height:number;size:number;speed:number;spin:number;offset:number}
interface EffectInstance {
 root:THREE.Group;
 flash:THREE.Mesh<THREE.IcosahedronGeometry,THREE.MeshBasicMaterial>;
 fire:THREE.InstancedMesh<THREE.IcosahedronGeometry,THREE.MeshBasicMaterial>;
 smoke:THREE.InstancedMesh<THREE.IcosahedronGeometry,THREE.MeshLambertMaterial>;
 fragments:THREE.InstancedMesh<THREE.BoxGeometry,THREE.MeshLambertMaterial>;
 wave:THREE.InstancedMesh<THREE.IcosahedronGeometry,THREE.MeshLambertMaterial>;
 seeds:Seed[];
}
/** A stable event-local seed; replay/pause/frame-rate cannot change particle paths. */
function seedsFor(key:string,count:number):Seed[] {
 let state=2166136261;for(let i=0;i<key.length;i++)state=Math.imul(state^key.charCodeAt(i),16777619);
 const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
 return Array.from({length:count},(_,i)=>({angle:i*2.3999632297+random()*.65,radius:.4+random()*.6,height:random(),size:.65+random()*.7,speed:1.7+random()*2.7,spin:(random()-.5)*5,offset:random()}));
}
/**
 * Textureless, bounded cosmetics. One shared geometry per shape and one instanced
 * draw per layer/event, not a mesh/material per particle. Smoke is depth-writing
 * alpha-hashed volume, avoiding stacked transparent surfaces and sorting halos.
 */
export class StructuralEffects {
 private lobeGeometry = new THREE.IcosahedronGeometry(1,1);
 private flashGeometry = new THREE.IcosahedronGeometry(1,0);
 private fragmentGeometry = new THREE.BoxGeometry(1,1,1);
 private instances = new Map<string,EffectInstance>();
 private transform = new THREE.Object3D();
 private color = new THREE.Color();
 private dustColor = new THREE.Color();
 private hotColor = new THREE.Color();
 private burntColor = new THREE.Color(0x8d3219);
 private paleColor = new THREE.Color(0xffe3a0);
 private sootColor = new THREE.Color(0x575954);
 private disposed = false;
 private reducedMotion:boolean;
 constructor(private scene:THREE.Scene,options:{reducedMotion?:boolean}={}) { this.reducedMotion=options.reducedMotion??false; }
 setReducedMotion(value:boolean):void { this.reducedMotion=value; }
 render(frames:readonly EffectFrame[]):void { this.update(frames); }
 update(frames:readonly EffectFrame[]):void {
  if (this.disposed) return;
  // Collision dust must never evict the main blast or its still-visible plume.
  // Saturation changes presentation only; the timeline keeps every event.
  const primary=frames.filter(frame=>frame.kind!=='impact').slice(-EVENT_BUDGET);
  const impactSlots=EVENT_BUDGET-primary.length;
  const selected=[...(impactSlots?frames.filter(frame=>frame.kind==='impact').slice(-impactSlots):[]),...primary];
  const key=(f:EffectFrame)=>`${f.epoch}:${f.id}`;
  const wanted=new Set(selected.map(key));
  for(const [id,event] of this.instances)if(!wanted.has(id)){this.release(event);this.instances.delete(id);}
  for(const frame of selected){
   const id=key(frame);let event=this.instances.get(id);
   if(!event){event=this.create(frame);this.instances.set(id,event);this.scene.add(event.root);}
   this.updateEvent(event,frame);
  }
 }
 private create(frame:EffectFrame):EffectInstance {
  const p=EFFECT_PROFILES[frame.tool],impact=frame.kind==='impact';
  const root=new THREE.Group();root.name=`explosion:${frame.epoch}:${frame.id}`;
  root.position.set(frame.position.x,frame.position.y,frame.position.z);
  const flash=new THREE.Mesh(this.flashGeometry,new THREE.MeshBasicMaterial({color:0xffe7ba,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
  flash.name='explosion-flash';
  const fire=new THREE.InstancedMesh(this.lobeGeometry,new THREE.MeshBasicMaterial({color:0xffffff,alphaHash:true,depthWrite:true,toneMapped:false}),p.lobes);fire.name='explosion-fire';
  const smokeCount=impact?16:p.smokeLobes;
  const smoke=new THREE.InstancedMesh(this.lobeGeometry,new THREE.MeshLambertMaterial({color:0xffffff,alphaHash:true,depthWrite:true}),smokeCount);smoke.name='explosion-smoke';
  const fragments=new THREE.InstancedMesh(this.fragmentGeometry,new THREE.MeshLambertMaterial({color:0xffffff,alphaHash:true,depthWrite:true}),impact?10:p.fragments);fragments.name='explosion-fragments';
  const wave=new THREE.InstancedMesh(this.lobeGeometry,new THREE.MeshLambertMaterial({color:0xffffff,alphaHash:true,depthWrite:true}),frame.tool==='nova'?48:frame.tool==='echo'?30:22);wave.name='explosion-shockwave';
  for(const mesh of [fire,smoke,fragments,wave]){mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;}
  root.add(flash,fire,smoke,fragments,wave);
  return {root,flash,fire,smoke,fragments,wave,seeds:seedsFor(`${frame.epoch}:${frame.id}`,Math.max(smokeCount,p.fragments,p.lobes,30))};
 }
 private place(mesh:THREE.InstancedMesh,index:number,x:number,y:number,z:number,sx:number,sy:number,sz:number,spin=0,horizontal=false):void {
  this.transform.position.set(x,y,z);this.transform.rotation.set(horizontal?0:spin*.7,spin,horizontal?0:spin*.3);this.transform.scale.set(sx,sy,sz);this.transform.updateMatrix();mesh.setMatrixAt(index,this.transform.matrix);
 }
 private finish(mesh:THREE.InstancedMesh):void { mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true; }
 private updateEvent(event:EffectInstance,frame:EffectFrame):void {
  const p=EFFECT_PROFILES[frame.tool],impact=frame.kind==='impact',age=frame.age;
  const motion=this.reducedMotion?.48:1;
  // City-camera evidence requires a real cross-building fireball. Nova's hot
  // core is half its physical blast radius, not the tiny sqrt-radius puff used
  // by local tools. The layered smoke column is narrower than its dust front.
  const base=impact?(frame.scale??1)*(.55+.45*(frame.intensity??.5)):frame.scale===undefined?p.spread:frame.tool==='nova'?frame.scale*.5:Math.min(6,.65*Math.sqrt(frame.scale));
  const scale=base*motion;
  this.dustColor.setHex(frame.material?DUST[frame.material]:0x807260);
  this.hotColor.setHex(p.color);
  // The flash is world-space and short-lived, never a fullscreen white overlay.
  event.flash.visible=!impact&&!this.reducedMotion&&frame.flash>0;
  event.flash.scale.setScalar(base*(frame.tool==='nova'?.36+.32*frame.flash:.16+.22*frame.flash));event.flash.material.opacity=frame.flash*.6;
  event.fire.visible=!impact&&frame.fire>0;event.fire.material.opacity=Math.min(.96,frame.fire*2.1);
  for(let i=0;i<event.fire.count;i++){
   const s=event.seeds[i],progress=Math.min(1,age/p.fire),radius=scale*(.12+.85*progress)*s.radius;
   let x=Math.cos(s.angle)*radius,z=Math.sin(s.angle)*radius,y=scale*(.06+progress*(.6+s.height*.7));
   if(p.shape==='disk'){y*=.28;z*=1.1;}
   if(p.shape==='jet'||p.shape==='needle'){x*=.4;z*=.4;y*=1.7;}
   if(p.shape==='split'){const a=i%3*TAU/3;x+=Math.cos(a)*scale*.48;z+=Math.sin(a)*scale*.48;}
   if(p.shape==='mushroom')y+=scale*progress*.3;
   const size=scale*(.22+.34*progress)*s.size*(.45+.55*Math.sqrt(frame.fire));
   this.place(event.fire,i,x,y,z,size,size*(.8+s.height*.6),size,s.spin*age*.2);
   this.color.copy(this.hotColor).lerp(this.burntColor,Math.min(.88,progress*.85+s.offset*.16));
   if(i%4===0)this.color.lerp(this.paleColor,(1-progress)*.85);
   event.fire.setColorAt(i,this.color);
  }
  this.finish(event.fire);
  const smokeScale=!impact&&frame.tool==='nova'&&frame.scale!==undefined?frame.scale*.26*motion:scale;
  this.updateSmoke(event,frame,p,smokeScale,impact);
  this.updateFragments(event,frame,p,scale,impact);
  // A brief discontinuous front of dust puffs, never a luminous torus/cylinder.
  event.wave.visible=!impact&&!this.reducedMotion&&frame.ring>0;event.wave.material.opacity=frame.tool==='nova'?Math.sqrt(frame.ring)*.72:frame.ring*.42;
  const waveProgress=p.ring?Math.min(1,age/p.ring):1;
  for(let i=0;i<event.wave.count;i++){
   const s=event.seeds[i],angle=frame.tool==='nova'?Math.floor(i/4)/12*TAU+(s.offset-.5)*.12:i/event.wave.count*TAU+s.offset*.12;
   const ripple=p.shape==='ripple'?(i%3)*.08:0;
   const reach=frame.scale===undefined?scale*3.2:Math.min(128,frame.scale);
   const sector=frame.tool==='nova'?(1-(i%4)*.07)*(.85+s.offset*.15):.91+s.offset*.09;
   const radius=reach*(.08+waveProgress*(.84+ripple))*sector;
   const size=scale*(.09+s.size*.11)*(1-waveProgress*.4);
   this.place(event.wave,i,Math.cos(angle)*radius,.035+scale*s.height*.065,Math.sin(angle)*radius,size*1.6,size*.4,size*.8,s.angle,true);
   this.color.copy(this.dustColor).multiplyScalar(1.12+s.height*.3);event.wave.setColorAt(i,this.color);
  }
  this.finish(event.wave);
 }
 private updateSmoke(event:EffectInstance,frame:EffectFrame,p:EffectProfile,scale:number,impact:boolean):void {
  const age=frame.age,life=effectSmokeDuration(frame),progress=Math.min(1,age/life),growth=1-Math.exp(-age*2.4);
  // Reveal the upper gray plume after the hot core has established itself.
  // Early opaque smoke previously hid the actual fireball at the city camera.
  const rise=!impact&&frame.tool==='nova'?Math.max(0,Math.min(1,(age-.2))):1;
  event.smoke.material.opacity=(!impact&&frame.tool==='nova'?Math.min(.86,frame.smoke*1.45):Math.min(.94,frame.smoke*1.7))*rise;event.smoke.visible=event.smoke.material.opacity>.001;
  for(let i=0;i<event.smoke.count;i++){
   const s=event.seeds[i],dust=i%4===0||impact,roll=age*(.18+s.height*.12),angle=s.angle+roll;
   let radius=scale*(.2+growth*(dust?1.5:.85)+age*.15)*s.radius;
   let x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
   let y=scale*(.08+growth*(dust?.12:.45+s.height*.72)+age*(dust?.055:.26));
   let size=scale*(.12+growth*.28+age*.065)*s.size;
   if(!impact&&p.shape==='mushroom'&&!dust){
    if(i%3===0){x*=.28;z*=.28;y=scale*(.2+s.height*(.9+growth*1.25)+age*.12);size*=.76;}
    else{radius=scale*(.12+growth*1.02+age*.12)*s.radius;x=Math.cos(angle)*radius;z=Math.sin(angle)*radius;y=scale*(.35+growth*1.28+age*.23+s.height*.25);size*=1.12;}
   }else if(p.shape==='column'&&!dust){x*=.8;z*=.8;y*=1.5;}
   else if(p.shape==='jet'&&!dust){x=x*.55+scale*age*.18;z*=.6;y*=1.65;}
   else if(p.shape==='needle'&&!dust){x=x*.34+scale*age*.45;z*=.34;y*=1.9;size*=.7;}
   else if(p.shape==='disk'||p.shape==='ripple'){x*=1.25;z*=1.25;y*=.45;size*=.8;}
   else if(p.shape==='split'){const a=(i%3)*TAU/3;x+=Math.cos(a)*scale*.65*growth;z+=Math.sin(a)*scale*.65*growth;size*=.72;}
   if(!impact&&p.shape==='mushroom'&&!dust&&frame.scale!==undefined)y*=1+Math.min(.65,frame.scale/80);
   // Lobe turnover changes the silhouette without a uniform expanding sphere.
   x+=Math.sin(s.angle+age*.8)*scale*.06*growth;y+=Math.sin(s.angle*1.7+age*.7)*scale*.055*growth;
   const fadeScale=Math.max(.12,1-Math.max(0,progress-.72)*2.7);
   this.place(event.smoke,i,x,y,z,size*(1.1+s.offset*.4)*fadeScale,size*(dust?.5:.85+s.height*.35)*fadeScale,size*fadeScale,s.angle+age*.1);
   this.color.copy(this.dustColor).multiplyScalar(dust?.95+s.height*.3:.64+s.height*.3);
   if(!dust)this.color.lerp(this.sootColor,.22);
   event.smoke.setColorAt(i,this.color);
  }
  this.finish(event.smoke);
 }
 private updateFragments(event:EffectInstance,frame:EffectFrame,p:EffectProfile,scale:number,impact:boolean):void {
  const age=frame.age,life=impact?1.05:p.fragmentLife;
  event.fragments.visible=age<life;event.fragments.material.opacity=Math.min(1,Math.max(0,(life-age)*3));
  // Analytic linear drag + gravity keeps trajectories frame-partition independent.
  const drag=impact?2.6:1.7,travel=(1-Math.exp(-drag*age))/drag,gravity=7.4;
  for(let i=0;i<event.fragments.count;i++){
   const s=event.seeds[i],speed=s.speed*scale,vertical=(1.6+s.height*3)*scale*(p.shape==='disk'?.55:1);
   let x=Math.cos(s.angle)*speed*travel,z=Math.sin(s.angle)*speed*travel;
   const y=.06+vertical*travel-gravity/drag*(age-travel);
   if(p.shape==='jet'||p.shape==='needle'){x*=.5;z*=.5;}
   const size=scale*(impact?.035:.035+s.offset*.045)*Math.max(.1,1-age/life*.65);
   this.place(event.fragments,i,x,y,z,size*.7,size*(1.5+s.height*2),size*.75,s.angle+s.spin*age);
   this.color.copy(this.dustColor).multiplyScalar(.7+s.height*.5);
   if(!impact&&i%3===0&&age<.8)this.color.lerp(this.hotColor,Math.max(0,1-age/.8));
   event.fragments.setColorAt(i,this.color);
  }
  this.finish(event.fragments);
 }
 private release(event:EffectInstance):void {
  for(const mesh of [event.flash,event.fire,event.smoke,event.fragments,event.wave]){
   mesh.material.dispose();if(mesh instanceof THREE.InstancedMesh)mesh.dispose();
  }
  this.scene.remove(event.root);
 }
 clear():void { for(const event of this.instances.values())this.release(event);this.instances.clear(); }
 dispose():void {
  if(this.disposed)return;this.clear();this.lobeGeometry.dispose();this.flashGeometry.dispose();this.fragmentGeometry.dispose();this.disposed=true;
 }
}
