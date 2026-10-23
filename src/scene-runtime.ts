import * as THREE from 'three';
import type { AimSurface, TrajectoryPreview } from './contracts';

/** Real ordnance can grow without a gameplay cap. Only cosmetic pools are fixed. */
export function createGrowingInstancePool(scene:THREE.Scene,geometry:THREE.BufferGeometry,material:THREE.Material,initialCapacity=16){
  const allocate=(capacity:number)=>{
    const mesh=new THREE.InstancedMesh(geometry,material,capacity);
    mesh.count=0;mesh.castShadow=true;mesh.frustumCulled=false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  };
  let mesh=allocate(Math.max(1,initialCapacity));scene.add(mesh);
  return {
    get mesh(){return mesh;},
    reserve(required:number){
      if(required<=mesh.instanceMatrix.count)return;
      const previous=mesh;
      mesh=allocate(Math.max(required,previous.instanceMatrix.count*2));
      mesh.count=previous.count;mesh.castShadow=previous.castShadow;mesh.receiveShadow=previous.receiveShadow;
      mesh.renderOrder=previous.renderOrder;
      mesh.instanceMatrix.array.set(previous.instanceMatrix.array.subarray(0,previous.count*16));
      if(previous.instanceColor){
        mesh.setColorAt(0,new THREE.Color());
        mesh.instanceColor!.array.set(previous.instanceColor.array.subarray(0,previous.count*3));
        mesh.instanceColor!.needsUpdate=true;
      }
      mesh.instanceMatrix.needsUpdate=true;
      scene.remove(previous);previous.dispose();scene.add(mesh);
    },
    dispose(){scene.remove(mesh);mesh.dispose();},
  };
}

/** A drawing of physics output, not a second trajectory simulator. */
export function createTrajectoryOverlay(scene:THREE.Scene){
  const material=new THREE.LineBasicMaterial({color:0xc1ffdf,transparent:true,opacity:.92,depthTest:false,depthWrite:false,fog:false});
  const line=new THREE.Line(new THREE.BufferGeometry(),material);
  line.name='physics-trajectory-preview';line.frustumCulled=false;line.renderOrder=18;line.visible=false;
  const endpoint=new THREE.Group();endpoint.name='physics-trajectory-endpoint';endpoint.visible=false;endpoint.renderOrder=19;
  const endpointMaterial=new THREE.MeshBasicMaterial({color:0xc1ffdf,transparent:true,opacity:.95,depthTest:false,depthWrite:false,fog:false});
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.36,.035,6,28),endpointMaterial);
  const dot=new THREE.Mesh(new THREE.SphereGeometry(.095,8,6),endpointMaterial);
  ring.renderOrder=dot.renderOrder=19;endpoint.add(ring,dot);scene.add(line,endpoint);
  return {
    line,endpoint,
    setPreview(preview:TrajectoryPreview|null){
      line.visible=!!preview&&preview.points.length>1;
      if(line.visible){
        const positions=new Float32Array(preview!.points.length*3);
        preview!.points.forEach((point,i)=>{positions[i*3]=point.x;positions[i*3+1]=point.y;positions[i*3+2]=point.z;});
        line.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
        line.geometry.setDrawRange(0,preview!.points.length);
      }
      const end=preview?.impact??preview?.points.at(-1);
      endpoint.visible=!!end;
      if(end)endpoint.position.set(end.x,end.y,end.z);
      endpointMaterial.color.setHex(preview?.impact?0xffd58b:0xc1ffdf);
    },
    faceCamera(rotation:THREE.Quaternion){endpoint.quaternion.copy(rotation);},
    dispose(){scene.remove(line,endpoint);line.geometry.dispose();material.dispose();ring.geometry.dispose();dot.geometry.dispose();endpointMaterial.dispose();},
  };
}

export const PULSE_LIFETIME=.65;
// Allow the main flash and 0.777-second sound to finish, not every decorative chip.
export const CORE_EFFECT_LIFETIME=.85;
type TimedEffect={age:number;life:number};

/** Age and remove in the same frame, so an expired chip is never still drawn. */
export function advanceEffectAges<T extends TimedEffect>(effects:readonly T[],delta:number):T[]{
  return effects.filter(effect=>{effect.age+=delta;return effect.age<effect.life;});
}

export function hasActiveVisualEffects(pulseAge:number,chips:readonly TimedEffect[]):boolean {
  return pulseAge<CORE_EFFECT_LIFETIME;
}

/** Ground remains a real target; voxel faces expire with their host voxel. */
export function copyLiveAimSurface(surface:AimSurface|null,voxels:readonly {id:number}[]):AimSurface|null {
  if(!surface||(surface.voxelId!==null&&!voxels.some(voxel=>voxel.id===surface.voxelId)))return null;
  return {...surface,position:{...surface.position},normal:{...surface.normal}};
}
export function clearedVisualEffects<T extends {age:number;life:number}>(_chips:T[],_pulseAge:number){return {chips:[] as T[],pulseAge:CORE_EFFECT_LIFETIME};}
export function effectFrameDeltas(elapsed:number,scale:number){const motion=Math.min(elapsed,.045)*scale;return {motion,age:elapsed*scale};}
