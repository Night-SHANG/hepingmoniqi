import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildSurface} from './surface.js';
import {sparseStructureFixture} from '../support-ab/sparse-structure-fixture.js';
import {previewGameVoxels} from '../../src/structural/game-fixtures.js';
import {createVoxelInstanceRenderer} from '../../src/voxel-renderer.js';
import {WORLD_BOUNDS} from '../../src/world-layout.js';
const canvas=document.querySelector<HTMLCanvasElement>('#world')!,status=document.querySelector('#status')!;
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);const scene=new THREE.Scene();scene.background=new THREE.Color(0x9aafb5);
scene.add(new THREE.HemisphereLight(0xd3edff,0x6e6637,2.2));const sun=new THREE.DirectionalLight(0xffe1aa,3.6);sun.position.set(-22,38,15);scene.add(sun);
const camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,.8,1600);camera.position.set(250,205,285);const controls=new OrbitControls(camera,canvas);controls.target.set(0,18,0);controls.update();
const box=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial({roughness:.88,metalness:.025}),surfaceMaterial=new THREE.MeshStandardMaterial({roughness:.88,metalness:.025,vertexColors:true});
let disposeCurrent=()=>{},active=false,generation=0;const records:unknown[]=[],longTasks:unknown[]=[];try{new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({entryTypes:['longtask']});}catch{}
function clear(){generation++;disposeCurrent();disposeCurrent=()=>{};active=false;renderer.render(scene,camera);}
function render(){controls.update();renderer.render(scene,camera);requestAnimationFrame(render);}requestAnimationFrame(render);
async function load(mode:'old'|'compact',inputAt:number){
 const start=performance.now();clear();const token=generation;let details:unknown;
 if(mode==='old'){const voxels=previewGameVoxels('city'),r=createVoxelInstanceRenderer(scene,box,material);r.set(voxels);disposeCurrent=()=>r.dispose();details=r.getDiagnostics();}
 else {const cells=sparseStructureFixture('city').cells.filter(c=>c.role!=='terrain');const s=buildSurface({...WORLD_BOUNDS.city,depth:8},cells,(x,y,z)=>y===-1?[0x8b9650,0x9aa45a,0x778448][Math.abs(x*7+z*11)%3]:[0x775238,0x8b6240,0x9a7048][Math.abs(x*73+y*31+z*17)%3],false);const geometry=new THREE.BufferGeometry(),rgb=new Float32Array(s.positions.length),color=new THREE.Color();for(let i=0;i<s.colors.length;i++){color.setHex(s.colors[i]);for(let v=0;v<6;v++)rgb.set([color.r,color.g,color.b],i*18+v*3);}geometry.setAttribute('position',new THREE.BufferAttribute(s.positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(s.normals,3));geometry.setAttribute('color',new THREE.BufferAttribute(rgb,3));geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,surfaceMaterial);scene.add(mesh);disposeCurrent=()=>{scene.remove(mesh);geometry.dispose();};details={...s.stats,gpuBufferEstimate:s.positions.byteLength+s.normals.byteLength+rgb.byteLength};}
 const cpuReady=performance.now();renderer.render(scene,camera);const renderSubmitted=performance.now();await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));if(token!==generation)return;const record={mode,inputDispatchDelayMs:start-inputAt,cpuBuildMs:cpuReady-start,firstRenderSubmitMs:renderSubmitted-start,postRenderFrameOpportunityMs:performance.now()-inputAt,details,draw:{...renderer.info.render},longTasks:longTasks.slice(-12),note:'Frame opportunity is after two rAF callbacks, not measured compositor/GPU presentation or gameplay performance'};records.push(record);status.textContent=JSON.stringify(record,null,2);active=true;
}
document.querySelector('#old')!.addEventListener('click',event=>void load('old',event.timeStamp));document.querySelector('#compact')!.addEventListener('click',event=>void load('compact',event.timeStamp));document.querySelector('#clear')!.addEventListener('click',clear);
Object.assign(window,{__previewAB:{records:()=>structuredClone(records),active:()=>active,stats:()=>({...renderer.info.memory}),longTasks:()=>structuredClone(longTasks)}});
