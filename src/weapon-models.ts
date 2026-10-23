import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {TOOLS} from './content-catalog';
import type { ProjectileView, Vec3, WeaponId } from './contracts';
export const WEAPON_MODEL_KEYS = ['charge','pulse','shock','echo','split','split-child','phase','heavy','nova'] as const;
export type WeaponModelKey = typeof WEAPON_MODEL_KEYS[number];
const MODEL_BY_WEAPON:Record<WeaponId,WeaponModelKey>={charge:'charge',pulse:'pulse',shock:'shock',echo:'echo',split:'split',phase:'phase',heavy:'heavy',nova:'nova'};
export function projectileModelKey(p:Pick<ProjectileView,'weapon'|'stage'>):WeaponModelKey {
 return p.weapon==='split'&&p.stage==='child'?'split-child':MODEL_BY_WEAPON[p.weapon];
}
function unsupportedWeapon(weapon:never):never {throw new Error(`Unsupported weapon: ${weapon}`);}
/** Original stylized geometry, normalized to roughly one collider radius. */
export function createWeaponGeometry(weapon:WeaponId,stage:ProjectileView['stage']='parent'):THREE.BufferGeometry {
 const parts:THREE.BufferGeometry[]=[];
 function part(g:THREE.BufferGeometry,c:number,x=0,y=0,z=0){if(weapon==='phase'&&g.index){const indexed=g;g=g.toNonIndexed();indexed.dispose();}g.translate(x,y,z);const rgb=new THREE.Color(c);const colors=new Float32Array(g.getAttribute('position').count*3);for(let i=0;i<colors.length;i+=3){colors[i]=rgb.r;colors[i+1]=rgb.g;colors[i+2]=rgb.b;}g.setAttribute('color',new THREE.BufferAttribute(colors,3));parts.push(g);}
 if(weapon==='charge'){
  part(new THREE.CylinderGeometry(.57,.52,1.12,8),0x567349);
  for(const y of [-.37,0,.37])part(new THREE.CylinderGeometry(.60,.60,.07,8),0x293b31,0,y);
  part(new THREE.CylinderGeometry(.29,.29,.23,8),0xc8b785,0,.67);
  part(new THREE.BoxGeometry(.18,.80,.15),0xbcc8c7,.48,.52);
 }else if(weapon==='pulse'){
  part(new THREE.CylinderGeometry(.48,.48,1.25,10),0xffeed0,0,-.05);
  part(new THREE.ConeGeometry(.48,.48,10),0xf25e27,0,.815);
  part(new THREE.CylinderGeometry(.49,.49,.15,10),0xffe4ab,0,-.72);
  for(let i=0;i<4;i++){const fin=new THREE.BoxGeometry(.10,.48,.78);fin.translate(0,-.55,.31);fin.rotateY(i*Math.PI/2);part(fin,0xf5bd65);}
 }else if(weapon==='shock'){
  part(new THREE.BoxGeometry(1.45,.95,.37),0xffd174);
  part(new THREE.BoxGeometry(1.30,.78,.08),0xe8ad48,0,0,.225);
  for(const x of [-.43,.43])part(new THREE.BoxGeometry(.16,1.02,.48),0x343e3c,x);
  part(new THREE.BoxGeometry(.44,.28,.10),0x28373d,0,.16,.30);
  part(new THREE.BoxGeometry(.12,.10,.03),0x9eff9a,.1,.16,.365);
 }else if(weapon==='echo'){
  // Contact face is -Z, three outward-facing cyan emitters are +Z.
  part(new THREE.BoxGeometry(.88,1.20,.30),0x233746,0,-.05,-.12);
  for(const x of [-.25,.25])part(new THREE.BoxGeometry(.13,1.30,.38),0x8c9caa,x,-.03,-.10);
  for(let i=0;i<3;i++){
   const a=Math.PI/2+i*Math.PI*2/3,x=Math.cos(a)*.49,y=Math.sin(a)*.49;
   const housing=new THREE.CylinderGeometry(.35,.35,.30,8);housing.rotateX(Math.PI/2);part(housing,0x647f94,x,y,.05);
   const face=new THREE.CylinderGeometry(.28,.28,.035,16);face.rotateX(Math.PI/2);part(face,0x085275,x,y,.22);
   part(new THREE.TorusGeometry(.24,.045,6,20),0x65edff,x,y,.255);
   part(new THREE.TorusGeometry(.12,.025,6,16),0x20cfff,x,y,.26);
  }
 }else if(weapon==='phase'){
  // A faceted core and three broken halos read as a passage tool, not a recolored ball.
  const core=new THREE.OctahedronGeometry(.58);core.scale(.72,1.35,.72);part(core,0xb9ffff);
  for(const [index,y] of [-.48,0,.48].entries()){
   for(let i=0;i<3;i++){
    const ring=new THREE.TorusGeometry(index===1?.83:.65,.075,4,10,Math.PI*.48);
    ring.rotateZ(i*Math.PI*2/3+index*.3);ring.rotateX(Math.PI/2);part(ring,index===1?0x12c7d9:0x3a728d,0,y);
   }
  }
  part(new THREE.ConeGeometry(.24,.38,4),0x0e526e,0,.82);
 }else if(weapon==='heavy'){
  // Fictional chunky impact pod: dark chassis, orange armor, no real mechanism.
  part(new THREE.CylinderGeometry(.69,.69,1.20,8),0x29363e);
  part(new THREE.CylinderGeometry(.58,.67,.38,8),0xea7936,0,.77);
  part(new THREE.CylinderGeometry(.59,.59,.18,8),0x6e432d,0,-.68);
  for(let i=0;i<4;i++){
   const plate=new THREE.BoxGeometry(.82,1.0,.16);plate.translate(0,0,.61);plate.rotateY(i*Math.PI/2);part(plate,0xcd5e29);
   const stripe=new THREE.BoxGeometry(.50,.12,.18);stripe.translate(0,.22,.64);stripe.rotateY(i*Math.PI/2);part(stripe,0xffc16e);
  }
  part(new THREE.CylinderGeometry(.28,.28,.07,8),0xffd595,0,.995);
 }else if(weapon==='nova'){
  // White-gold capsule and two broad golden halos are intentionally fantastical.
  part(new THREE.CylinderGeometry(.43,.43,1.30,12),0xf4f1dc);
  const top=new THREE.SphereGeometry(.43,12,8);top.scale(1,.65,1);part(top,0xfff8de,0,.65);
  const bottom=new THREE.SphereGeometry(.43,12,8);bottom.scale(1,.65,1);part(bottom,0xc4d5dc,0,-.65);
  for(const y of [-.43,.43]){const ring=new THREE.TorusGeometry(.74,.09,6,24);ring.rotateX(Math.PI/2);part(ring,0xdba54a,0,y);}
  for(let i=0;i<4;i++){const fin=new THREE.BoxGeometry(.09,1.25,.11);fin.translate(0,0,.47);fin.rotateY(i*Math.PI/2);part(fin,0xd7a047);}
  part(new THREE.CylinderGeometry(.22,.22,.10,10),0xffd786,0,.96);
 }else if(weapon==='split'){
  if(stage==='child'){
   part(new THREE.SphereGeometry(.77,12,8),0x1c7192);
   // Three amber raised panels identify the small physical child from every orbit.
   for(let i=0;i<3;i++){
    const a=i*Math.PI*2/3;
    const panel=new THREE.BoxGeometry(.20,.78,.12);panel.translate(0,0,.73);panel.rotateY(a);part(panel,0xffd36d);
   }
   part(new THREE.CylinderGeometry(.21,.21,.16,6),0xcaf4ff,0,.75);
  }else{
   part(new THREE.SphereGeometry(.61,12,8),0x073b76);
   for(let i=0;i<3;i++){
    const a=Math.PI/2+i*Math.PI*2/3,x=Math.cos(a),y=Math.sin(a);
    part(new THREE.SphereGeometry(.42,8,6),0x168edf,x*.33,y*.33,0);
    part(new THREE.BoxGeometry(.26,.26,.32),0xff9e30,x*.75,y*.75,.04);
    part(new THREE.BoxGeometry(.13,.13,.09),0xffd478,x*.75,y*.75,.245);
   }
   part(new THREE.TorusGeometry(.45,.065,4,12),0x56baff,0,0,.43);
  }
 }else unsupportedWeapon(weapon);
 const merged=mergeGeometries(parts);for(const p of parts)p.dispose();
 // Preserve existing approved models; new assemblies fit the actual spherical collider.
 if(weapon==='echo'||weapon==='split'||weapon==='phase'||weapon==='heavy'||weapon==='nova'){
  const positions=merged.getAttribute('position');let radius=0;
  for(let i=0;i<positions.count;i++)radius=Math.max(radius,Math.hypot(positions.getX(i),positions.getY(i),positions.getZ(i)));
  merged.scale(1/radius,1/radius,1/radius);
 }
 return merged;
}
export function projectileOrientation(p:ProjectileView,previous=new THREE.Quaternion()):THREE.Quaternion {
 const frontFacing=p.weapon==='shock'||p.weapon==='echo';
 const attached=p.state==='attached'||p.stage==='emitter';
 if(!attached&&(p.weapon==='charge'||p.weapon==='split'||(frontFacing&&p.state==='flying'))&&p.rotation)return new THREE.Quaternion(p.rotation.x,p.rotation.y,p.rotation.z,p.rotation.w).normalize();
 const v=attached||frontFacing?p.normal:p.velocity;
 if(!v||![v.x,v.y,v.z].every(Number.isFinite)||v.x*v.x+v.y*v.y+v.z*v.z<1e-10)return previous.clone();
 return new THREE.Quaternion().setFromUnitVectors(frontFacing?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0),new THREE.Vector3(v.x,v.y,v.z).normalize());
}

/** Status annotation is deliberately a HUD overlay. The physical model keeps depth testing. */
export const ATTACHED_ANNOTATION = Object.freeze({depthTest:false,depthWrite:false,renderOrder:30});
export function attachedAnnotationPosition(position:Vec3,cameraRotation:THREE.Quaternion):THREE.Vector3 {
 return new THREE.Vector3(1.8,1.25,0).applyQuaternion(cameraRotation).add(new THREE.Vector3(position.x,position.y,position.z));
}

/** Each passage hit owns its own finite cue, even when several contacts share a frame. */
export function createPhaseHitVisual(position:Vec3){
 const object=new THREE.Group();object.position.set(position.x,position.y,position.z);
 const geometry=new THREE.RingGeometry(.9,1,40);
 const material=new THREE.MeshBasicMaterial({color:0x71f4f2,transparent:true,opacity:.85,depthWrite:false,side:THREE.DoubleSide});
 for(const rotation of [0,Math.PI/2]){const ring=new THREE.Mesh(geometry,material);ring.rotation.x=rotation;object.add(ring);}
 let age=0;
 const advance=(delta:number)=>{
  if(Number.isFinite(delta)&&delta>0)age+=delta;
  const progress=Math.min(1,age/.55);object.scale.setScalar(TOOLS.phase.radius*(.15+.85*progress));
  material.opacity=.85*(1-progress);object.visible=age<.55;return object.visible;
 };
 advance(0);
 return {object,advance,dispose(){object.removeFromParent();geometry.dispose();material.dispose();}};
}


export const STRONG_BLAST_LIFETIME=Object.freeze({heavy:1.10,nova:1.65});
/** A finite, event-local game cue. It never removes voxels or changes damage radius. */
export function createStrongBlastVisual(position:Vec3,weapon:'heavy'|'nova',reducedMotion=false,power=1){
 const object=new THREE.Group();object.name=`${weapon}-blast`;object.position.set(position.x,position.y,position.z);
 const radius=TOOLS[weapon].radius*Math.sqrt(Number.isFinite(power)&&power>0?Math.min(3,power):1),duration=STRONG_BLAST_LIFETIME[weapon],tint=weapon==='nova'?0xffce77:0xff9850;
 const ringGeometry=new THREE.RingGeometry(.965,1,72),domeGeometry=new THREE.SphereGeometry(1,32,16,0,Math.PI*2,0,Math.PI/2);
 const ringMaterial=new THREE.MeshBasicMaterial({color:tint,transparent:true,opacity:.75,depthWrite:false,side:THREE.DoubleSide});
 const domeMaterial=new THREE.MeshBasicMaterial({color:tint,transparent:true,opacity:.12,depthWrite:false,side:THREE.DoubleSide});
 const ring=new THREE.Mesh(ringGeometry,ringMaterial);ring.name='blast-wave';ring.rotation.x=-Math.PI/2;object.add(ring);
 const dome=new THREE.Mesh(domeGeometry,domeMaterial);dome.name='blast-dome';object.add(dome);
 const light=new THREE.PointLight(weapon==='nova'?0xffebbd:0xffa45d,0,radius*2,2);light.position.y=.8;object.add(light);
 let age=0,disposed=false;
 const advance=(delta:number)=>{
  if(Number.isFinite(delta)&&delta>0)age+=delta;
  const progress=Math.min(1,age/duration),size=reducedMotion?radius:radius*(.04+.96*(1-(1-progress)**2));
  object.scale.setScalar(size);object.visible=age<duration;
  ringMaterial.opacity=(reducedMotion?.28:.75)*(1-progress);
  domeMaterial.opacity=.12*(1-progress);dome.visible=!reducedMotion;
  light.intensity=reducedMotion?0:Math.max(0,1-age/.24)*(weapon==='nova'?65:42);
  return object.visible;
 };
 advance(0);
 return {object,duration,advance,get flashIntensity(){return light.intensity;},setReducedMotion(reduced:boolean){reducedMotion=reduced;advance(0);},dispose(){if(disposed)return;disposed=true;object.removeFromParent();ringGeometry.dispose();domeGeometry.dispose();ringMaterial.dispose();domeMaterial.dispose();}};
}
