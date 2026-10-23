import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ProjectileView, Vec3, WeaponId } from './contracts';
export const WEAPON_MODEL_KEYS = ['charge','pulse','shock','echo','split','split-child'] as const;
export type WeaponModelKey = typeof WEAPON_MODEL_KEYS[number];
const MODEL_BY_WEAPON:Record<WeaponId,WeaponModelKey>={charge:'charge',pulse:'pulse',shock:'shock',echo:'echo',split:'split'};
export function projectileModelKey(p:Pick<ProjectileView,'weapon'|'stage'>):WeaponModelKey {
 return p.weapon==='split'&&p.stage==='child'?'split-child':MODEL_BY_WEAPON[p.weapon];
}
function unsupportedWeapon(weapon:never):never {throw new Error(`Unsupported weapon: ${weapon}`);}
/** Original stylized geometry, normalized to roughly one collider radius. */
export function createWeaponGeometry(weapon:WeaponId,stage:ProjectileView['stage']='parent'):THREE.BufferGeometry {
 const parts:THREE.BufferGeometry[]=[];
 function part(g:THREE.BufferGeometry,c:number,x=0,y=0,z=0){g.translate(x,y,z);const rgb=new THREE.Color(c);const colors=new Float32Array(g.getAttribute('position').count*3);for(let i=0;i<colors.length;i+=3){colors[i]=rgb.r;colors[i+1]=rgb.g;colors[i+2]=rgb.b;}g.setAttribute('color',new THREE.BufferAttribute(colors,3));parts.push(g);}
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
 if(weapon==='echo'||weapon==='split'){
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
