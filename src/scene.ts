import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DamageResult, SceneApi, SceneOptions, Vec3, Voxel, WeaponId } from './contracts';

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
  renderer.domElement.setAttribute('aria-label', '可旋转的三维木屋试验场，点击木屋选择目标，拖动旋转视角');
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
  // Split front fence opens onto the path; the side fence frames rather than occludes the cottage.
  const fence = (x:number,z:number,alongX:boolean,length:number) => {
    for(let i=0;i<=length;i+=3) {
      const px=x+(alongX?i:0), pz=z+(alongX?0:i);
      block(px,1.15,pz,.55,2.5,.55,0x917049);
      block(px,2.43,pz,.68,.2,.68,0xb89963);
      if(i<length) for(const y of [.9,1.85]) block(px+(alongX?1.5:0),y,pz+(alongX?0:1.5),alongX?3:.22,.25,alongX?.22:3,0xa98450);
    }
  };
  fence(-22,17,true,18); fence(5,17,true,18); fence(-22,-16,false,33); fence(23,-16,false,33); fence(-22,-16,true,45);
  // Dense voxel foliage, readable trunks and layered crowns, with deterministic color variation.
  const tree = (x:number,z:number,s:number) => {
    for(let y=.5;y<6*s;y+=.75) block(x,y,z,1.25*s,.78,1.2*s,palette([0x796043,0x8e6a45,0x9c754b]));
    for(let level=0;level<4;level++) {
      const radius=(level===0?2.6:level===1?3.3:level===2?2.8:1.7)*s;
      for(let a=-radius;a<=radius;a+=1.1*s) for(let b=-radius;b<=radius;b+=1.1*s) {
        if(a*a+b*b>radius*radius || rand()<.09)continue;
        block(x+a,5.3*s+level*1.13*s+rand()*.25,z+b,1.22*s,1.25*s,1.22*s,palette([0x547436,0x688b37,0x7e9b42,0x94ad4c,0x6c913e]));
      }
    }
  };
  tree(-16,6,1.35); tree(-17,-10,1.5); tree(16,-12,1.2); tree(21,3,.85); tree(-23,-18,.85);
  // Meadow wildflowers and small grass patches are batched, not individual meshes.
  for(let i=0;i<1250;i++) {
    const x=(rand()-.5)*50,z=(rand()-.5)*40;
    if(Math.abs(x)<9 && z>-7 && z<8 || Math.abs(x)<2.8 && z>5) continue;
    const h=.15+rand()*.4;
    block(x,h/2+.05,z,.11,h,.15,palette([0x6d8636,0x78943e,0x9eaf54]));
    if(rand()<.2) block(x,h+.07,z,.22,.17,.22,palette([0xeec85b,0xf1e4b0,0xc6d6a8,0xdac365]));
  }
  // Garden beds, log pile and workbench add environmental storytelling.
  for(const bx of [-11,11]) {
    block(bx,.35,9,3.5,.6,2.5,0x564a30);
    for(const z of [7.7,10.3]) block(bx,.6,z,3.9,.8,.25,0xa27c49);
    for(const x of [bx-1.9,bx+1.9]) block(x,.6,9,.25,.8,2.6,0xb18a56);
    for(let i=0;i<12;i++) block(bx-1.4+(i%4)*.9,1+rand()*.25,8.2+Math.floor(i/4)*.75,.55,.6,.55,palette([0x6f9343,0x88a54b,0xa9b955]));
  }
  for(let i=0;i<15;i++) block(-11+(i%5)*.6,.3+Math.floor(i/5)*.55,-5,.52,.5,2.1,palette([0x956f43,0xaf8a54,0x826044]));
  block(13,1.8,4,4,.35,2,0xb18e5b);
  for(const x of [11.5,14.5]) for(const z of [3.3,4.7]) block(x,.85,z,.25,1.8,.25,0x7d6341);
  for(const [x,z] of [[-12,2],[11,-3],[12,-3]]) {
    block(x,.65,z,1.2,1.3,1.2,0x936b41);
    for(const y of [.16,1.12]) block(x,y,z,1.3,.15,1.3,0xb9935a);
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
    if(hit?.instanceId!==undefined && live[hit.instanceId]) options.onAim({...live[hit.instanceId].position});
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
  const animate=(now:number)=>{
    if(disposed)return;
    const dt=Math.min((now-last)/1000,.045)*timeScale;last=now;controls.update();
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
    dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointermove',pointerMove);renderer.domElement.removeEventListener('pointerup',pointerUp);renderer.domElement.removeEventListener('pointercancel',cancel);renderer.domElement.removeEventListener('pointerleave',cancel);scene.traverse(object=>{if(object instanceof THREE.Mesh){if(object.geometry!==box)object.geometry.dispose();if(object instanceof THREE.InstancedMesh)object.dispose();}});box.dispose();landscapeMat.dispose();voxelMat.dispose();waterMaterial.dispose();markerMaterial.dispose();pulseMaterial.dispose();renderer.dispose();renderer.domElement.remove();},
  };
}
