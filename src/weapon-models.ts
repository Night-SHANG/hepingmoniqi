import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ProjectileView, WeaponId } from './contracts';
/** Original stylized geometry, normalized to roughly one collider radius. */
export function createWeaponGeometry(weapon:WeaponId):THREE.BufferGeometry {
 const parts:THREE.BufferGeometry[]=[];
 function part(g:THREE.BufferGeometry,c:number,x=0,y=0,z=0){g.translate(x,y,z);const rgb=new THREE.Color(c);const colors=new Float32Array(g.getAttribute('position').count*3);for(let i=0;i<colors.length;i+=3){colors[i]=rgb.r;colors[i+1]=rgb.g;colors[i+2]=rgb.b;}g.setAttribute('color',new THREE.BufferAttribute(colors,3));parts.push(g);}
 if(weapon==='charge'){
  part(new THREE.CylinderGeometry(.57,.52,1.12,8),0x567349);
  for(const y of [-.37,0,.37])part(new THREE.CylinderGeometry(.60,.60,.07,8),0x293b31,0,y);
  part(new THREE.CylinderGeometry(.29,.29,.23,8),0xc8b785,0,.67);
  part(new THREE.BoxGeometry(.18,.80,.15),0xbcc8c7,.48,.52);
 }else if(weapon==='pulse'){
  part(new THREE.CylinderGeometry(.32,.32,1.25,10),0xe1dcc8,0,-.05);
  part(new THREE.ConeGeometry(.32,.48,10),0xe76e3c,0,.815);
  part(new THREE.CylinderGeometry(.34,.34,.15,10),0x48565c,0,-.72);
  for(let i=0;i<4;i++){const fin=new THREE.BoxGeometry(.08,.48,.68);fin.translate(0,-.55,.26);fin.rotateY(i*Math.PI/2);part(fin,0x536e76);}
 }else{
  part(new THREE.BoxGeometry(1.45,.95,.37),0xb2a277);
  part(new THREE.BoxGeometry(1.30,.78,.08),0x667352,0,0,.225);
  for(const x of [-.43,.43])part(new THREE.BoxGeometry(.16,1.02,.48),0x343e3c,x);
  part(new THREE.BoxGeometry(.44,.28,.10),0x28373d,0,.16,.30);
  part(new THREE.BoxGeometry(.12,.10,.03),0x9eff9a,.1,.16,.365);
 }
 const merged=mergeGeometries(parts);for(const p of parts)p.dispose();return merged;
}
export function projectileOrientation(p:ProjectileView,previous=new THREE.Quaternion()):THREE.Quaternion {
 if(p.weapon==='charge'&&p.rotation)return new THREE.Quaternion(p.rotation.x,p.rotation.y,p.rotation.z,p.rotation.w).normalize();
 const v=p.weapon==='shock'?p.normal:p.velocity;
 if(!v||![v.x,v.y,v.z].every(Number.isFinite)||v.x*v.x+v.y*v.y+v.z*v.z<1e-10)return previous.clone();
 return new THREE.Quaternion().setFromUnitVectors(p.weapon==='shock'?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0),new THREE.Vector3(v.x,v.y,v.z).normalize());
}
