import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ATTACHED_ANNOTATION, attachedAnnotationPosition, createWeaponGeometry, projectileOrientation, projectileModelKey, WEAPON_MODEL_KEYS, type WeaponModelKey } from './weapon-models';
import { effectFrameDeltas, createGrowingInstancePool, createTrajectoryOverlay, copyLiveAimSurface } from './scene-runtime';
import { createEnvironmentRenderer, getEnvironmentSpec } from './scene-environments';
import {createSceneEffectChannel} from './scene-effects';
import type { AimSurface, DamageResult, MapId, SceneApi, SceneOptions, ProjectileView, Vec3, Voxel, WeaponId } from './contracts';

export { createVoxelInstanceRenderer } from './voxel-renderer';
import { createVoxelInstanceRenderer } from './voxel-renderer';

/** Preserve the established camera-relative launch while staying inside physics' radial guard. */
export function getSceneLaunchOrigin(camera:THREE.PerspectiveCamera,point:Vec3):Vec3 {
 const destination=new THREE.Vector3(point.x,point.y,point.z),direction=destination.clone().sub(camera.position).normalize();
 const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
 const distance=camera.position.distanceTo(destination),forward=Math.min(8,distance*.25),offset=forward/8;
 const origin=camera.position.clone().addScaledVector(direction,forward).addScaledVector(right,1.1*offset).addScaledVector(up,-2*offset);
 const radius=280;
 if(Math.hypot(origin.x,origin.z)>radius){
  const delta=origin.clone().sub(destination),a=delta.x*delta.x+delta.z*delta.z,b=2*(point.x*delta.x+point.z*delta.z),c=point.x*point.x+point.z*point.z-radius*radius;
  if(a>0&&c<0){const t=Math.max(0,Math.min(1,(-b+Math.sqrt(b*b-4*a*c))/(2*a)));origin.copy(destination).addScaledVector(delta,t);}
  else{const scale=radius/Math.hypot(origin.x,origin.z);origin.x*=scale;origin.z*=scale;}
 }
 return {x:origin.x,y:origin.y,z:origin.z};
}

/** One orbitable scene: authority supplies every in-map surface and debris transform. */
export function createScene(container:HTMLElement, options:SceneOptions):SceneApi {
  const scene = new THREE.Scene();
  let mapId:MapId='courtyard',environmentSpec=getEnvironmentSpec(mapId);
  let reducedMotion=false;
  const motionPreference=typeof window.matchMedia==='function'?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
  const motionReduced=()=>reducedMotion||!!motionPreference?.matches;
  scene.background = new THREE.Color('#adcbd9');
  scene.fog = new THREE.Fog('#adcbd9', 70, 165);
  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false, powerPreference:'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.setAttribute('aria-label', '可旋转的三维试验场，点击可破坏建筑、物体或地面选择目标，拖动旋转视角');
  renderer.domElement.style.touchAction = 'none';
  container.append(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(42, 1, .2, 250);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .075;
  controls.minDistance = 19;
  controls.maxDistance = 72;
  controls.maxPolarAngle = Math.PI * .47;
  controls.minPolarAngle = .18;
  controls.target.set(0, 4.5, 0);
  const resetCamera = () => { camera.position.set(...environmentSpec.camera.position); controls.target.set(...environmentSpec.camera.target); controls.update(); };
  resetCamera();
  const hemisphere = new THREE.HemisphereLight(0xd3edff, 0x6e6637, 2.2);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffe1aa, 3.6);
  sun.position.set(-22, 38, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048,2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -33;
  sun.shadow.camera.right = sun.shadow.camera.top = 33;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 100;
  sun.shadow.normalBias = .035;
  sun.shadow.bias = -.00015;
  scene.add(sun);
  scene.add(new THREE.DirectionalLight(0xb4d7ff,.5));

  const box = new THREE.BoxGeometry(1,1,1);
  const voxelMat = new THREE.MeshStandardMaterial({ roughness:.88, metalness:.025 });
  const tmp = new THREE.Object3D();
  const color = new THREE.Color();
  let environment=createEnvironmentRenderer(scene,box,mapId,{authoritative:true});
  const applyMapEnvironment=(next:MapId)=>{
    environment.dispose();environment=createEnvironmentRenderer(scene,box,next,{authoritative:true});mapId=next;environmentSpec=environment.spec;
    scene.background=new THREE.Color(environmentSpec.sky);scene.fog=new THREE.Fog(environmentSpec.sky,...environmentSpec.fog);
    const preset=environmentSpec.camera;camera.near=preset.near;camera.far=preset.far;camera.updateProjectionMatrix();
    controls.minDistance=preset.minDistance;controls.maxDistance=preset.maxDistance;
    const extent=environmentSpec.shadowExtent;sun.shadow.camera.left=sun.shadow.camera.bottom=-extent;sun.shadow.camera.right=sun.shadow.camera.top=extent;
    sun.shadow.camera.far=Math.max(100,extent*5);sun.shadow.camera.updateProjectionMatrix();
    const factor=extent/33;sun.position.set(-22*factor,38*factor,15*factor);sun.shadow.normalBias=.035*Math.min(2,factor);sun.shadow.needsUpdate=true;
    resetCamera();
  };

  let live: readonly Voxel[]=[];
  const voxelRenderer=createVoxelInstanceRenderer(scene,box,voxelMat);
  let house=voxelRenderer.mesh;
  // Only physics supplies projectile transforms. This renderer never detonates or
  // advances their motion; trails are a bounded visual history of those transforms.
  const MAX_COSMETIC_PROJECTILES=64, TRAIL_POINTS=12;
  const projectileMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.58,metalness:.25});
  const projectileMeshes=new Map<WeaponModelKey,ReturnType<typeof createGrowingInstancePool>>();
  for(const key of WEAPON_MODEL_KEYS){const geometry=key==='split-child'?createWeaponGeometry('split','child'):createWeaponGeometry(key);projectileMeshes.set(key,createGrowingInstancePool(scene,geometry,projectileMaterial));}
  // Thin authored silhouette shell only, never a hit proxy or depth-disabled model.
  const outlineMaterial=new THREE.MeshBasicMaterial({color:0x102832,side:THREE.BackSide});
  const outlines=new Map<WeaponModelKey,ReturnType<typeof createGrowingInstancePool>>();
  for(const [weapon,body] of projectileMeshes){const pool=createGrowingInstancePool(scene,body.mesh.geometry,outlineMaterial);pool.mesh.castShadow=false;outlines.set(weapon,pool);}
  const leaderMaterial=new THREE.LineBasicMaterial({color:0xb4ffd4,transparent:true,opacity:.9,depthWrite:ATTACHED_ANNOTATION.depthWrite,depthTest:ATTACHED_ANNOTATION.depthTest});
  const orientations=new Map<string,THREE.Quaternion>();
  const flameMaterial=new THREE.MeshBasicMaterial({color:0xffb94f,transparent:true,opacity:.9,depthWrite:false});
  const flameGeometry=new THREE.ConeGeometry(.22,.85,6);flameGeometry.rotateZ(Math.PI);flameGeometry.translate(0,-1.18,0);
  const flameMesh=new THREE.InstancedMesh(flameGeometry,flameMaterial,MAX_COSMETIC_PROJECTILES);flameMesh.count=0;flameMesh.frustumCulled=false;scene.add(flameMesh);
  const trailMaterial=new THREE.MeshBasicMaterial({transparent:true,opacity:.72,depthWrite:false});
  const trailMesh=new THREE.InstancedMesh(box,trailMaterial,MAX_COSMETIC_PROJECTILES*TRAIL_POINTS);
  trailMesh.count=0;trailMesh.frustumCulled=false;scene.add(trailMesh);
  const trails=new Map<string,THREE.Vector3[]>();
  const fuseBadges=new Map<string,{sprite:THREE.Sprite;canvas:HTMLCanvasElement;texture:THREE.CanvasTexture;label:string;leader?:THREE.Line}>();
  const releaseBadge=(id:string)=>{const badge=fuseBadges.get(id);if(!badge)return;scene.remove(badge.sprite);if(badge.leader){scene.remove(badge.leader);badge.leader.geometry.dispose();}badge.texture.dispose();badge.sprite.material.dispose();fuseBadges.delete(id);};
  const updateProjectiles=(views:readonly ProjectileView[])=>{
    const ids=new Set(views.map(v=>v.id));
    const trailIds=new Set(views.filter(v=>v.weapon==='pulse'&&v.state!=='attached').slice(0,MAX_COSMETIC_PROJECTILES).map(v=>v.id));
    for(const id of trails.keys())if(!trailIds.has(id))trails.delete(id);
    for(const id of orientations.keys())if(!ids.has(id))orientations.delete(id);
    for(const [weapon,pool] of projectileMeshes){const count=views.filter(v=>projectileModelKey(v)===weapon).length;pool.reserve(count);pool.mesh.count=0;const outline=outlines.get(weapon)!;outline.reserve(count);outline.mesh.count=0;}flameMesh.count=0;
    for(const id of fuseBadges.keys())if(!ids.has(id))releaseBadge(id);
    let trailIndex=0;
    views.forEach(p=>{
      tmp.position.set(p.position.x,p.position.y,p.position.z);tmp.quaternion.copy(projectileOrientation(p,orientations.get(p.id)));orientations.set(p.id,tmp.quaternion.clone());tmp.scale.setScalar(p.radius);tmp.updateMatrix();
      const projectile=projectileMeshes.get(projectileModelKey(p))!.mesh;projectile.setMatrixAt(projectile.count++,tmp.matrix);
      const outline=outlines.get(projectileModelKey(p))!.mesh;tmp.scale.setScalar(p.radius*1.045);tmp.updateMatrix();outline.setMatrixAt(outline.count++,tmp.matrix);tmp.scale.setScalar(p.radius);tmp.updateMatrix();
      if(trailIds.has(p.id)){
        flameMesh.setMatrixAt(flameMesh.count++,tmp.matrix);
        const history=trails.get(p.id)??[];const current=new THREE.Vector3(p.position.x,p.position.y,p.position.z);
        if(!history.length || history[history.length-1].distanceToSquared(current)>.006){history.push(current);if(history.length>TRAIL_POINTS)history.shift();}
        trails.set(p.id,history);
        history.forEach((position,j)=>{tmp.position.copy(position);tmp.rotation.set(0,0,0);tmp.scale.setScalar(p.radius*.50*(j+1)/history.length);tmp.updateMatrix();trailMesh.setMatrixAt(trailIndex,tmp.matrix);trailMesh.setColorAt(trailIndex++,color.setHex(0xc6c5ba));});
      }
      if(p.fuseRemaining!==null || p.state==='attached'){
        let badge=fuseBadges.get(p.id);
        if(!badge){const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));sprite.scale.set(1.8,.9,1);scene.add(sprite);badge={sprite,canvas,texture,label:''};fuseBadges.set(p.id,badge);}
        badge.sprite.position.set(p.position.x,p.position.y+.9,p.position.z);
        const attached=p.state==='attached'||p.stage==='emitter';
        const emitting=p.weapon==='echo'&&p.stage==='emitter';
        const label=emitting?'↻ '+Math.max(0,p.fuseRemaining??0).toFixed(1)+'s':attached?'attached-icon':Math.max(0,p.fuseRemaining!).toFixed(1)+'s';
        if(attached){
          badge.sprite.scale.set(2.6,.72,1);
          badge.sprite.position.copy(attachedAnnotationPosition(p.position,camera.quaternion));badge.sprite.material.depthTest=ATTACHED_ANNOTATION.depthTest;badge.sprite.material.depthWrite=ATTACHED_ANNOTATION.depthWrite;badge.sprite.renderOrder=ATTACHED_ANNOTATION.renderOrder;
          if(!badge.leader){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(6),3));badge.leader=new THREE.Line(geometry,leaderMaterial);badge.leader.frustumCulled=false;badge.leader.renderOrder=ATTACHED_ANNOTATION.renderOrder-1;scene.add(badge.leader);}
          const positions=badge.leader.geometry.getAttribute('position');positions.setXYZ(0,p.position.x,p.position.y,p.position.z);positions.setXYZ(1,badge.sprite.position.x,badge.sprite.position.y-.3,badge.sprite.position.z);positions.needsUpdate=true;
        }
        if(label!==badge.label){const ctx=badge.canvas.getContext('2d')!;ctx.clearRect(0,0,128,64);ctx.fillStyle='rgba(16,32,40,.9)';ctx.beginPath();ctx.roundRect(6,7,116,50,12);ctx.fill();ctx.fillStyle=attached?'#b4ffd4':p.fuseRemaining!<1?'#ff9f64':'#ffdb9a';ctx.font=attached?'bold 27px sans-serif':'bold 34px sans-serif';ctx.textAlign='center';if(attached&&!emitting){ctx.strokeStyle='#b4ffd4';ctx.lineWidth=6;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(47,33);ctx.lineTo(59,44);ctx.lineTo(82,21);ctx.stroke();}else{ctx.fillText(label,64,44);}badge.texture.needsUpdate=true;badge.label=label;}
      }else releaseBadge(p.id);
    });
    for(const pool of projectileMeshes.values())pool.mesh.instanceMatrix.needsUpdate=true;for(const pool of outlines.values())pool.mesh.instanceMatrix.needsUpdate=true;
    flameMesh.instanceMatrix.needsUpdate=true;trailMesh.count=trailIndex;trailMesh.instanceMatrix.needsUpdate=true;
    if(trailMesh.instanceColor)trailMesh.instanceColor.needsUpdate=true;
  };

  const marker = new THREE.Group();
  const markerMaterial = new THREE.MeshBasicMaterial({color:0xffa33c,depthTest:false,transparent:true,opacity:.92});
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.48,.025,6,32),markerMaterial);
  marker.add(ring);
  const tickGeometry = new THREE.BoxGeometry(.24,.035,.025);
  for(let i=0;i<4;i++) { const tick=new THREE.Mesh(tickGeometry,markerMaterial);tick.position.set(Math.cos(i*Math.PI/2)*.57,Math.sin(i*Math.PI/2)*.57,0);tick.rotation.z=i*Math.PI/2;marker.add(tick); }
  marker.renderOrder=20;marker.children.forEach(c=>c.renderOrder=20);scene.add(marker);marker.visible=false;
  const trajectory=createTrajectoryOverlay(scene);
  const effects=createSceneEffectChannel(scene);
  let timeScale=1,target:Vec3|null=null,damageSequence=0;
  const updateReducedEffects=()=>effects.setReducedMotion(motionReduced());
  motionPreference?.addEventListener('change',updateReducedEffects);updateReducedEffects();
  const raycaster = new THREE.Raycaster();const pointer=new THREE.Vector2();
  let down:{x:number;y:number;time:number;id:number}|null=null;let dragged=false;
  const pointers=new Set<number>();
  let aimSurface:AimSurface|null=null;
  const pointerDown=(e:PointerEvent)=> { pointers.add(e.pointerId);if(pointers.size>1){down=null;dragged=true;return;} if(e.button===0){down={x:e.clientX,y:e.clientY,time:performance.now(),id:e.pointerId};dragged=false;} };
  const pointerMove=(e:PointerEvent)=> { if(down && Math.hypot(e.clientX-down.x,e.clientY-down.y)>6)dragged=true; };
  const pointerUp=(e:PointerEvent)=> {
    pointers.delete(e.pointerId);
    const start=down;down=null;
    if(!start || start.id!==e.pointerId || dragged || performance.now()-start.time>420)return;
    const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    const hit=house?raycaster.intersectObject(house,false)[0]:undefined;
    // No invisible y=0 plane can cover a crater. Clicks continue through holes
    // to the next actual authority surface, including rotated falling rubble.
    const point=hit?.point??null;
    aimSurface=null;
    const voxel=hit?.instanceId===undefined?undefined:voxelRenderer.getVoxel(hit.instanceId);
    if(hit?.instanceId!==undefined&&hit.face&&voxel){
      const matrix=new THREE.Matrix4();house.getMatrixAt(hit.instanceId,matrix);matrix.premultiply(house.matrixWorld);
      const normal=hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix)).normalize();
      aimSurface={position:{x:hit.point.x,y:hit.point.y,z:hit.point.z},normal:{x:normal.x,y:normal.y,z:normal.z},voxelId:voxel.id};
    }
    if(point) options.onAim({x:point.x,y:point.y,z:point.z});
  };
  const cancel=(e:PointerEvent)=>{pointers.delete(e.pointerId);down=null;dragged=true;};
  renderer.domElement.addEventListener('pointerdown',pointerDown);
  renderer.domElement.addEventListener('pointermove',pointerMove);
  renderer.domElement.addEventListener('pointerup',pointerUp);
  renderer.domElement.addEventListener('pointercancel',cancel);
  renderer.domElement.addEventListener('pointerleave',cancel);
  const resize=()=>{const w=Math.max(1,container.clientWidth),h=Math.max(1,container.clientHeight);renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  let frame=0,disposed=false,last=performance.now();
  const resetClock=()=>{last=performance.now();};
  document.addEventListener('visibilitychange',resetClock);
  const animate=(now:number)=>{
    if(disposed)return;
    const elapsed=document.hidden?0:Math.max(0,Math.min((now-last)/1000,1));
    last=now;controls.update();
    // Physics owns bounded fixed substeps; cosmetic effects keep their small step.
    const {age:effectAge}=effectFrameDeltas(elapsed,timeScale);
    effects.step(effectAge);
    // New detonations begin at age zero, after old effects advance, before draw.
    options.onFrame?.(elapsed*timeScale);
    effects.render();
    if(target){marker.position.set(target.x,target.y,target.z);marker.quaternion.copy(camera.quaternion);marker.position.addScaledVector(new THREE.Vector3().subVectors(camera.position,marker.position).normalize(),.65);}
    trajectory.faceCamera(camera.quaternion);
    renderer.render(scene,camera);frame=requestAnimationFrame(animate);
  };
  frame=requestAnimationFrame(animate);options.onReady?.();
  return {
    setMap(next){if(next===mapId)return;effects.clear();aimSurface=null;target=null;marker.visible=false;trajectory.setPreview(null);applyMapEnvironment(next);},
    setReducedMotion(value){reducedMotion=!!value;updateReducedEffects();},
    getDiagnostics(){return {mapId,camera:{position:{x:camera.position.x,y:camera.position.y,z:camera.position.z},target:{x:controls.target.x,y:controls.target.y,z:controls.target.z},fov:camera.fov,near:camera.near,far:camera.far},groundBounds:{...environmentSpec.bounds},renderedVoxelCount:house.count,voxelRender:voxelRenderer.getDiagnostics(),effects:effects.getDiagnostics()};},
    projectPoint(point){camera.updateMatrixWorld();const p=new THREE.Vector3(point.x,point.y,point.z).project(camera);return {x:(p.x+1)*.5*container.clientWidth,y:(1-p.y)*.5*container.clientHeight,visible:Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.z>=-1&&p.z<=1&&Math.abs(p.x)<=1&&Math.abs(p.y)<=1};},
    setProjectiles:updateProjectiles,
    setTrajectory:trajectory.setPreview,
    clearEffects(){effects.clear();},
    hasActiveEffects(){return !disposed&&effects.hasActiveCore();},
    playStructuralEvent(event){effects.add(event);},
    getRenderedProjectileCount(){return [...projectileMeshes.values()].reduce((count,pool)=>count+pool.mesh.count,0);},
    getAimSurface(){return copyLiveAimSurface(aimSurface,live);},
    getLaunchOrigin(point){return getSceneLaunchOrigin(camera,point);},
    setVoxels(voxels){live=voxels;voxelRenderer.set(voxels);house=voxelRenderer.mesh;},
    playDamage(result:DamageResult,point:Vec3,weapon:WeaponId,power=1){
      if(!result.accepted)return;
      // Legacy call path only: detached cells remain live authoritative geometry,
      // never sampled, replaced with fake chips, aged out, or globally pulsed.
      effects.add({id:`legacy-damage:${++damageSequence}`,epoch:effects.getDiagnostics().epoch??1,position:point,kind:'detonation',tool:weapon,scale:Math.sqrt(Math.max(.01,power))});
    },
    setTarget(point){if(!point)aimSurface=null;target=point;marker.visible=!!point;},
    setTimeScale(scale){timeScale=Number.isFinite(scale)?Math.max(0,Math.min(2,scale)):1;},resetCamera,
    dispose(){effects.dispose();environment.dispose();voxelRenderer.dispose();motionPreference?.removeEventListener('change',updateReducedEffects);trajectory.dispose();for(const id of [...fuseBadges.keys()])releaseBadge(id);projectileMaterial.dispose();trailMaterial.dispose();flameMaterial.dispose();outlineMaterial.dispose();leaderMaterial.dispose();disposed=true;document.removeEventListener('visibilitychange',resetClock);cancelAnimationFrame(frame);observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointermove',pointerMove);renderer.domElement.removeEventListener('pointerup',pointerUp);renderer.domElement.removeEventListener('pointercancel',cancel);renderer.domElement.removeEventListener('pointerleave',cancel);const geometries=new Set<THREE.BufferGeometry>();scene.traverse(object=>{if(object instanceof THREE.Mesh){geometries.add(object.geometry);if(object instanceof THREE.InstancedMesh)object.dispose();}});geometries.add(box);for(const geometry of geometries)geometry.dispose();voxelMat.dispose();markerMaterial.dispose();renderer.dispose();renderer.domElement.remove();},
  };
}
