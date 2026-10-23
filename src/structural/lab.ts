import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createContactFixture} from './contact-fixture.js';
import {createStructuralFixture} from './fixtures.js';
import {createStructuralSimulation} from './simulation.js';
import {EffectTimeline,EFFECT_PROFILES,type EffectTool} from './effects.js';
import {StructuralEffects} from './effect-renderer.js';
const canvas=document.querySelector<HTMLCanvasElement>('#world')!;
const status=document.querySelector<HTMLDivElement>('#status')!;
const select=document.querySelector<HTMLSelectElement>('#tool')!;
const names={charge:'手榴弹',pulse:'火箭弹',shock:'遥控包',echo:'回声震荡器',split:'分裂球',phase:'穿行球',heavy:'街区冲击弹',nova:'城市核爆弹'};
for(const id of Object.keys(EFFECT_PROFILES) as EffectTool[]){const option=document.createElement('option');option.value=id;option.textContent=names[id];select.append(option);}
const contactFixture=new URLSearchParams(location.search).get('fixture')==='rubble';
const fixture=contactFixture?createContactFixture():createStructuralFixture('lab');
document.querySelector<HTMLElement>('#calibration')!.hidden=!contactFixture;
const sim=await createStructuralSimulation(fixture,{maxActiveBodies:24});
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x9aafb5);
scene.add(new THREE.HemisphereLight(0xfff2d7,0x546751,2));
const sun=new THREE.DirectionalLight(0xffe0af,3);sun.position.set(-20,35,22);scene.add(sun);
const bounds=new THREE.Box3();fixture.cells.forEach(c=>bounds.expandByPoint(new THREE.Vector3(c.position.x,c.position.y,c.position.z)));
const center=bounds.getCenter(new THREE.Vector3());const size=bounds.getSize(new THREE.Vector3()).length();
const camera=new THREE.PerspectiveCamera(42,1,.1,1000);camera.position.copy(center).add(new THREE.Vector3(size*.65,size*.55,size*.75));
const controls=new OrbitControls(camera,canvas);controls.target.copy(center);controls.enableDamping=true;controls.update();
const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(.98,.98,.98),new THREE.MeshLambertMaterial(),fixture.cells.length);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh);
const matrix=new THREE.Matrix4(),scale=new THREE.Vector3(1,1,1),p=new THREE.Vector3(),q=new THREE.Quaternion();
const timeline=new EffectTimeline();timeline.reset(sim.epoch);const effects=new StructuralEffects(scene);let paused=false,saved:unknown=null,seq=0,seen=new Set<string>();const shots=new Map<string,EffectTool>();
let latest=sim.views();
function renderState(){latest=sim.views();latest.forEach((v,i)=>{p.set(v.position.x,v.position.y,v.position.z);q.set(v.rotation.x,v.rotation.y,v.rotation.z,v.rotation.w);matrix.compose(p,q,v.state==='gone'?new THREE.Vector3(0,0,0):scale);mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,new THREE.Color(v.color));});mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();}
renderState();
const ray=new THREE.Raycaster();let down={x:0,y:0};canvas.addEventListener('pointerdown',e=>down={x:e.clientX,y:e.clientY});
canvas.addEventListener('pointerup',e=>{if(paused||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const r=canvas.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),camera);const h=ray.intersectObject(mesh)[0];if(!h||h.instanceId===undefined)return;const id=`lab:${++seq}`,tool=select.value as EffectTool;shots.set(id,tool);const precise=contactFixture&&document.querySelector<HTMLInputElement>('#precise')!.checked;sim.blast({id,epoch:sim.epoch,position:{x:h.point.x,y:h.point.y,z:h.point.z},radius:precise?.8:tool==='nova'?5:tool==='heavy'?3.5:1.8,damage:precise?100:12,impulse:precise?0:tool==='nova'?12:6});});
document.querySelector('#pause')!.addEventListener('click',()=>{paused=!paused;document.querySelector('#pause')!.textContent=paused?'继续':'暂停';});
function clearEffects(){timeline.reset(sim.epoch);effects.update([]);seen.clear();shots.clear();renderState();}
document.querySelector('#reset')!.addEventListener('click',()=>{sim.reset();clearEffects();});
document.querySelector('#save')!.addEventListener('click',()=>{saved=sim.snapshot();});
document.querySelector('#load')!.addEventListener('click',()=>{if(saved&&sim.restore(saved))clearEffects();});
let elapsed=0,last=performance.now();document.addEventListener('visibilitychange',()=>last=performance.now());
function frame(now:number){const dt=Math.min(1,(now-last)/1000)*(document.querySelector<HTMLInputElement>('#slow')!.checked?.05:1);last=now;if(!paused&&!document.hidden){sim.step(dt);timeline.step(dt);elapsed+=dt;}for(const e of sim.events()){if(seen.has(e.id))continue;seen.add(e.id);if(e.kind==='detonation'||e.kind==='impact')timeline.add({id:e.id,epoch:e.epoch,position:e.position,tool:shots.get(e.rootShotId)??'charge',scale:e.kind==='impact'?.4:1});}renderState();effects.update(timeline.frames());const w=canvas.clientWidth,h=canvas.clientHeight;if(canvas.width!==Math.round(w*renderer.getPixelRatio())||canvas.height!==Math.round(h*renderer.getPixelRatio())){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}controls.update();renderer.render(scene,camera);status.textContent=`实体 ${latest.filter(v=>v.state!=='gone').length} / ${latest.length}\n动态 ${latest.filter(v=>v.state==='dynamic').length} · 废墟 ${latest.filter(v=>v.state==='rubble').length}\n关键事件 ${sim.pending()} · 研究 ${sim.research()}\n纪元 ${sim.epoch} · 独立演出 ${timeline.frames().length}`;requestAnimationFrame(frame);}
Object.assign(window,{__structural:{snapshot:()=>sim.snapshot(),elapsed:()=>elapsed,effects:()=>timeline.frames(),research:()=>sim.research(),tick:()=>(sim.snapshot() as {tick:number}).tick,views:()=>sim.views(),events:()=>sim.events(),pending:()=>sim.pending(),epoch:()=>sim.epoch,project:(id:number)=>{const v=latest.find(c=>c.id===id);if(!v)return null;const p=new THREE.Vector3(v.position.x,v.position.y,v.position.z).project(camera);const r=canvas.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2(p.x,p.y),camera);const hit=ray.intersectObject(mesh)[0];return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2,visible:p.z>-1&&p.z<1&&hit?.instanceId!==undefined&&latest[hit.instanceId]?.id===id};}}});
requestAnimationFrame(frame);
