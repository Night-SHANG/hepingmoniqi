import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DamageResult, SceneApi, SceneOptions, ProjectileView, Vec3, Voxel, WeaponId } from './contracts';

type Block = { x:number; y:number; z:number; sx:number; sy:number; sz:number; color:number };
type Chip = { p:THREE.Vector3; v:THREE.Vector3; rotation:THREE.Vector3; spin:THREE.Vector3; size:number; age:number; life:number; color:number };

/** One actual, orbitable Three.js scene. All environmental decoration is non-interactive. */
export function createScene(container:HTMLElement, options:SceneOptions):SceneApi {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#adcbd9');
  scene.fog = new THREE.Fog('#adcbd9', 70, 165);
  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false, powerPreference:'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.setAttribute('aria-label', '可旋转的三维木屋试验场，点击庭院物体或地面选择目标，拖动旋转视角');
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
  const resetCamera = () => { camera.position.set(27, 23, 32); controls.target.set(0, 4.5, 0); controls.update(); };
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
  const landscapeMat = new THREE.MeshStandardMaterial({ roughness:1, metalness:0 });
  const voxelMat = new THREE.MeshStandardMaterial({ roughness:.88, metalness:.025 });
  const tmp = new THREE.Object3D();
  const color = new THREE.Color();
  const decorations:Block[] = [];
  const block = (x:number,y:number,z:number,sx:number,sy:number,sz:number,c:number) => decorations.push({x,y,z,sx,sy,sz,color:c});
  let seed = 18717;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed/4294967296; };
  const palette = (colors:number[]) => colors[Math.floor(rand()*colors.length)];

  // Broad meadow island, exposed stratified edge and a readable stepping-stone path.
  block(0,-1.25,0,53,2.2,43,0x726a44);
  block(0,-.35,0,53,.38,43,0x819548);
  for(let x=-26;x<27;x+=2) for(let z=-21;z<22;z+=2) {
    block(x,-.12+rand()*.08,z,2,.15,2,palette([0x849c4b,0x8da654,0x91a557,0x7e994b,0x98aa57]));
  }
  for(let z=7;z<22;z+=1.5) for(let j=0;j<3;j++) {
    block((j-1)*1.35 + Math.sin(z*.3)*.6,.07,z,1.18,.17,1.25,palette([0xb7af8f,0xc5bda0,0xa8a88c]));
  }
  // All trees, fences and yard props come from the authoritative destructible world.
  // Meadow wildflowers and small grass patches are batched, not individual meshes.
  for(let i=0;i<1250;i++) {
    const x=(rand()-.5)*50,z=(rand()-.5)*40;
    if(Math.abs(x)<9 && z>-7 && z<8 || Math.abs(x)<2.8 && z>5) continue;
    const h=.15+rand()*.4;
    block(x,h/2+.05,z,.11,h,.15,palette([0x6d8636,0x78943e,0x9eaf54]));
    if(rand()<.2) block(x,h+.07,z,.22,.17,.22,palette([0xeec85b,0xf1e4b0,0xc6d6a8,0xdac365]));
  }
  // Lake beyond the meadow, broken banks, block cliffs and a quieter distant skyline.
  const waterMaterial = new THREE.MeshStandardMaterial({color:0x4a9fb5,roughness:.28,metalness:.22});
  const water = new THREE.Mesh(new THREE.BoxGeometry(160,.2,100), waterMaterial);
  water.position.set(0,-1.3,-64); water.receiveShadow=true;scene.add(water);
  for(let i=0;i<130;i++) block((rand()-.5)*145,-1.17,-23-rand()*75,1+rand()*5,.035,.09+rand()*.14,palette([0x94ccd2,0x74bdc9,0xadd5d6]));
  for(let i=0;i<31;i++) {
    const x=-80+i*5.5, z=-56-rand()*23, height=5+rand()*15;
    block(x,height/2-1.5,z,6+rand()*5,height,12,palette([0x809c96,0x94aaa1,0x6f9290,0xa2b3a4]));
    block(x,height-.9,z,6.3,1.2,12.3,palette([0x87a76f,0x9bb782,0x7e9f74]));
    if(i%3===0) block(x,height+1,z,2,3,2,0x769a70);
  }
  for(let i=0;i<18;i++) {
    const x=-70+i*8, h=10+rand()*20;
    block(x,h/2-1,-95,10,h,12,palette([0x91b0b4,0xa2bfc1,0x83a6ad]));
  }
  // Clouds made from stepped white volumes sit well behind the action.
  for(let i=0;i<10;i++) {
    const x=-90+rand()*180,y=32+rand()*20,z=-65-rand()*40;
    block(x,y,z,8+rand()*13,1.8,3.5,0xe4eeee);
    block(x+1,y+1.5,z,5+rand()*5,2,3,0xf4f5e9);
  }
  const environmentalMesh = new THREE.InstancedMesh(box,landscapeMat,decorations.length);
  decorations.forEach((b,i)=>{
    tmp.position.set(b.x,b.y,b.z); tmp.rotation.set(0,0,0);tmp.scale.set(b.sx,b.sy,b.sz);tmp.updateMatrix();
    environmentalMesh.setMatrixAt(i,tmp.matrix);environmentalMesh.setColorAt(i,color.setHex(b.color));
  });
  environmentalMesh.castShadow=true; environmentalMesh.receiveShadow=true;environmentalMesh.computeBoundingSphere();scene.add(environmentalMesh);

  let live: readonly Voxel[]=[];
  let house:THREE.InstancedMesh|null=null;
  const MAX_DEBRIS=360;
  const debris = new THREE.InstancedMesh(box,voxelMat,MAX_DEBRIS);
  debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);debris.count=0;debris.castShadow=true;debris.frustumCulled=false;scene.add(debris);
  let chips:Chip[]=[];

  // Only physics supplies projectile transforms. This renderer never detonates or
  // advances their motion; trails are a bounded visual history of those transforms.
  const MAX_PROJECTILES=48, TRAIL_POINTS=12;
  const projectileGeometry=new THREE.IcosahedronGeometry(1,1);
  const projectileMaterial=new THREE.MeshStandardMaterial({roughness:.45,metalness:.3,emissive:0xffa23a,emissiveIntensity:.65});
  const projectileMesh=new THREE.InstancedMesh(projectileGeometry,projectileMaterial,MAX_PROJECTILES);
  projectileMesh.count=0;projectileMesh.castShadow=true;projectileMesh.frustumCulled=false;scene.add(projectileMesh);
  const trailMaterial=new THREE.MeshBasicMaterial({transparent:true,opacity:.72,depthWrite:false});
  const trailMesh=new THREE.InstancedMesh(box,trailMaterial,MAX_PROJECTILES*TRAIL_POINTS);
  trailMesh.count=0;trailMesh.frustumCulled=false;scene.add(trailMesh);
  const trails=new Map<string,THREE.Vector3[]>();
  const fuseBadges=new Map<string,{sprite:THREE.Sprite;canvas:HTMLCanvasElement;texture:THREE.CanvasTexture;label:string}>();
  const projectileColor=(weapon:WeaponId)=>weapon==='shock'?0x65ddff:weapon==='charge'?0xf6a040:0xffec9d;
  const releaseBadge=(id:string)=>{const badge=fuseBadges.get(id);if(!badge)return;scene.remove(badge.sprite);badge.texture.dispose();badge.sprite.material.dispose();fuseBadges.delete(id);};
  const updateProjectiles=(views:readonly ProjectileView[])=>{
    const visible=views.slice(0,MAX_PROJECTILES), ids=new Set(visible.map(v=>v.id));
    for(const id of trails.keys())if(!ids.has(id))trails.delete(id);
    for(const id of fuseBadges.keys())if(!ids.has(id))releaseBadge(id);
    let trailIndex=0;
    visible.forEach((p,i)=>{
      tmp.position.set(p.position.x,p.position.y,p.position.z);tmp.rotation.set(p.age*2,p.age*3,0);tmp.scale.setScalar(p.radius);tmp.updateMatrix();
      projectileMesh.setMatrixAt(i,tmp.matrix);projectileMesh.setColorAt(i,color.setHex(projectileColor(p.weapon)));
      const history=trails.get(p.id)??[];const current=new THREE.Vector3(p.position.x,p.position.y,p.position.z);
      if(!history.length || history[history.length-1].distanceToSquared(current)>.006){history.push(current);if(history.length>TRAIL_POINTS)history.shift();}
      trails.set(p.id,history);
      history.forEach((position,j)=>{tmp.position.copy(position);tmp.rotation.set(0,0,0);tmp.scale.setScalar(p.radius*.65*(j+1)/history.length);tmp.updateMatrix();trailMesh.setMatrixAt(trailIndex,tmp.matrix);trailMesh.setColorAt(trailIndex++,color.setHex(projectileColor(p.weapon)));});
      if(p.fuseRemaining!==null){
        let badge=fuseBadges.get(p.id);
        if(!badge){const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));sprite.scale.set(1.8,.9,1);scene.add(sprite);badge={sprite,canvas,texture,label:''};fuseBadges.set(p.id,badge);}
        badge.sprite.position.set(p.position.x,p.position.y+.9,p.position.z);
        const label=Math.max(0,p.fuseRemaining).toFixed(1)+'s';
        if(label!==badge.label){const ctx=badge.canvas.getContext('2d')!;ctx.clearRect(0,0,128,64);ctx.fillStyle='rgba(16,32,40,.9)';ctx.beginPath();ctx.roundRect(6,7,116,50,12);ctx.fill();ctx.fillStyle=p.fuseRemaining<1?'#ff9f64':'#ffdb9a';ctx.font='bold 34px sans-serif';ctx.textAlign='center';ctx.fillText(label,64,44);badge.texture.needsUpdate=true;badge.label=label;}
      }
    });
    projectileMesh.count=visible.length;trailMesh.count=trailIndex;projectileMesh.instanceMatrix.needsUpdate=true;trailMesh.instanceMatrix.needsUpdate=true;
    if(projectileMesh.instanceColor)projectileMesh.instanceColor.needsUpdate=true;if(trailMesh.instanceColor)trailMesh.instanceColor.needsUpdate=true;
  };

  const marker = new THREE.Group();
  const markerMaterial = new THREE.MeshBasicMaterial({color:0xffa33c,depthTest:false,transparent:true,opacity:.92});
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.48,.025,6,32),markerMaterial);
  marker.add(ring);
  const tickGeometry = new THREE.BoxGeometry(.24,.035,.025);
  for(let i=0;i<4;i++) { const tick=new THREE.Mesh(tickGeometry,markerMaterial);tick.position.set(Math.cos(i*Math.PI/2)*.57,Math.sin(i*Math.PI/2)*.57,0);tick.rotation.z=i*Math.PI/2;marker.add(tick); }
  marker.renderOrder=20;marker.children.forEach(c=>c.renderOrder=20);scene.add(marker);marker.visible=false;
  const pulseMaterial = new THREE.MeshBasicMaterial({color:0xffbf68,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});
  const pulse = new THREE.Mesh(new THREE.RingGeometry(.93,1,64),pulseMaterial);pulse.rotation.x=-Math.PI/2;scene.add(pulse);
  const flash = new THREE.PointLight(0xffa446,0,18,2);scene.add(flash);
  let pulseAge=10, timeScale=1, target:Vec3|null=null;
  const raycaster = new THREE.Raycaster();const pointer=new THREE.Vector2();
  let down:{x:number;y:number;time:number;id:number}|null=null;let dragged=false;
  const pointers=new Set<number>();
  const pointerDown=(e:PointerEvent)=> { pointers.add(e.pointerId);if(pointers.size>1){down=null;dragged=true;return;} if(e.button===0){down={x:e.clientX,y:e.clientY,time:performance.now(),id:e.pointerId};dragged=false;} };
  const pointerMove=(e:PointerEvent)=> { if(down && Math.hypot(e.clientX-down.x,e.clientY-down.y)>6)dragged=true; };
  const pointerUp=(e:PointerEvent)=> {
    pointers.delete(e.pointerId);
    const start=down;down=null;
    if(!start || start.id!==e.pointerId || dragged || performance.now()-start.time>420 || !house)return;
    const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    const hit=raycaster.intersectObject(house,false)[0];
    // Surface coordinates are never snapped back to an old voxel center. Empty roof
    // holes continue the same aim ray to the next live surface or stable ground.
    const ground = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0), new THREE.Vector3());
    const point = hit?.point ?? (ground && Math.abs(ground.x)<=27 && Math.abs(ground.z)<=22 ? ground : null);
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
    options.onFrame?.(elapsed*timeScale);
    const dt=Math.min(elapsed,.045)*timeScale;
    chips=chips.filter(c=>c.age<c.life);
    chips.forEach((c,i)=>{
      c.age+=dt;c.v.y-=12*dt;c.p.addScaledVector(c.v,dt);
      if(c.p.y<c.size*.5){c.p.y=c.size*.5;c.v.y=Math.abs(c.v.y)*.24;c.v.x*=.82;c.v.z*=.82;c.spin.multiplyScalar(.75);}
      c.rotation.addScaledVector(c.spin,dt);
      tmp.position.copy(c.p);tmp.rotation.set(c.rotation.x,c.rotation.y,c.rotation.z);
      const fade=Math.min(1,(c.life-c.age)*1.5);tmp.scale.setScalar(Math.max(.001,c.size*fade));tmp.updateMatrix();
      debris.setMatrixAt(i,tmp.matrix);debris.setColorAt(i,color.setHex(c.color));
    });
    debris.count=chips.length;if(chips.length){debris.instanceMatrix.needsUpdate=true;if(debris.instanceColor)debris.instanceColor.needsUpdate=true;}
    pulseAge+=dt;const active=pulseAge<.65; pulse.visible=active;
    if(active){pulse.scale.setScalar(1+pulseAge*16);pulseMaterial.opacity=(1-pulseAge/.65)*.7;}
    flash.intensity=Math.max(0,1-pulseAge/.28)*35;
    if(target){marker.position.set(target.x,target.y,target.z);marker.quaternion.copy(camera.quaternion);marker.position.addScaledVector(new THREE.Vector3().subVectors(camera.position,marker.position).normalize(),.65);}
    renderer.render(scene,camera);frame=requestAnimationFrame(animate);
  };
  frame=requestAnimationFrame(animate);options.onReady?.();
  return {
    setProjectiles:updateProjectiles,
    getLaunchOrigin(point){
      const direction=new THREE.Vector3(point.x,point.y,point.z).sub(camera.position).normalize();
      const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
      const up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
      // Keep the early gravity arc inside the viewport rather than above the camera.
      const distance=camera.position.distanceTo(new THREE.Vector3(point.x,point.y,point.z));
      const forward=Math.min(8,distance*.25), offset=forward/8;
      const origin=camera.position.clone().addScaledVector(direction,forward).addScaledVector(right,1.1*offset).addScaledVector(up,-2*offset);
      return {x:origin.x,y:origin.y,z:origin.z};
    },
    setVoxels(voxels){
      if(voxels.length>live.length){chips=[];debris.count=0;pulseAge=10;}
      live=voxels;
      if(house){scene.remove(house);house.dispose();}
      house=new THREE.InstancedMesh(box,voxelMat,Math.max(1,voxels.length));house.count=voxels.length;
      voxels.forEach((v,i)=>{tmp.position.set(v.position.x,v.position.y,v.position.z);tmp.rotation.set(0,0,0);tmp.scale.setScalar(.965);tmp.updateMatrix();house!.setMatrixAt(i,tmp.matrix);color.setHex(v.color);if(v.hp<v.maxHp)color.multiplyScalar(.6+.4*v.hp/v.maxHp);house!.setColorAt(i,color);});
      house.castShadow=true;house.receiveShadow=true;house.computeBoundingSphere();scene.add(house);
    },
    playDamage(result:DamageResult,point:Vec3,weapon:WeaponId){
      if(!result.accepted)return;
      const source=[...result.removed,...result.detached];
      const sampleStep=Math.max(1,Math.ceil(source.length/180));
      for(let i=0;i<source.length;i+=sampleStep){
        const v=source[i],p=new THREE.Vector3(v.position.x,v.position.y,v.position.z);
        const velocity=p.clone().sub(new THREE.Vector3(point.x,point.y,point.z)).normalize().multiplyScalar(3+rand()*7);
        velocity.y+=4+rand()*6;
        chips.push({p,v:velocity,rotation:new THREE.Vector3(rand(),rand(),rand()),spin:new THREE.Vector3(rand()*4-2,rand()*4-2,rand()*4-2),size:.35+rand()*.5,age:0,life:4+rand()*2,color:v.color});
      }
      chips=chips.slice(-MAX_DEBRIS);pulse.position.set(point.x,Math.max(.2,point.y-.25),point.z);pulseAge=0;
      pulseMaterial.color.setHex(weapon==='shock'?0x79deff:0xffbf68);flash.position.set(point.x,point.y+1,point.z);
    },
    setTarget(point){target=point;marker.visible=!!point;},
    setTimeScale(scale){timeScale=Number.isFinite(scale)?Math.max(0,Math.min(2,scale)):1;},resetCamera,
    dispose(){for(const id of [...fuseBadges.keys()])releaseBadge(id);projectileMaterial.dispose();trailMaterial.dispose();disposed=true;document.removeEventListener('visibilitychange',resetClock);cancelAnimationFrame(frame);observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointermove',pointerMove);renderer.domElement.removeEventListener('pointerup',pointerUp);renderer.domElement.removeEventListener('pointercancel',cancel);renderer.domElement.removeEventListener('pointerleave',cancel);scene.traverse(object=>{if(object instanceof THREE.Mesh){if(object.geometry!==box)object.geometry.dispose();if(object instanceof THREE.InstancedMesh)object.dispose();}});box.dispose();landscapeMat.dispose();voxelMat.dispose();waterMaterial.dispose();markerMaterial.dispose();pulseMaterial.dispose();renderer.dispose();renderer.domElement.remove();},
  };
}
