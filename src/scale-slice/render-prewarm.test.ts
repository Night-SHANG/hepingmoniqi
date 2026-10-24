import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {StructuralEffects} from '../structural/effect-renderer.js';
import type {EffectFrame} from '../structural/effects.js';

const load=async()=>{
 const api=await import('./render-prewarm.js').catch(()=>null);
 assert.ok(api?.prewarmScaleRenderPrograms,'scale render prewarm implementation must exist');
 return api;
};
const frame:EffectFrame={id:'reference',epoch:1,position:{x:0,y:0,z:0},tool:'nova',kind:'detonation',age:.1,flash:.5,fire:1,smoke:1,ring:1,scale:1};
function meshes(root:THREE.Object3D){const result:THREE.Mesh[]=[];root.traverse(o=>{if(o instanceof THREE.Mesh)result.push(o);});return result;}
function shaderFor(material:THREE.Material){
 const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}} as Parameters<THREE.Material['onBeforeCompile']>[0];
 material.onBeforeCompile(shader,{} as THREE.WebGLRenderer);return shader;
}
function signature(mesh:THREE.Mesh){
 const m=mesh.material as THREE.MeshStandardMaterial;
 return {name:mesh.name,geometry:mesh.geometry.type,attributes:Object.keys(mesh.geometry.attributes).sort(),type:m.type,customKey:m.customProgramCacheKey(),vertexColors:m.vertexColors,transparent:m.transparent,alphaHash:m.alphaHash,depthWrite:m.depthWrite,blending:m.blending,toneMapped:m.toneMapped,side:m.side,instanced:mesh instanceof THREE.InstancedMesh,instanceColor:mesh instanceof THREE.InstancedMesh&&mesh.instanceColor!==null};
}
function resources(root:THREE.Object3D){
 const materials=new Set<THREE.Material>(),geometries=new Set<THREE.BufferGeometry>(),instances=new Set<THREE.InstancedMesh>(),textures=new Set<THREE.Texture>();
 for(const mesh of meshes(root)){
  geometries.add(mesh.geometry);if(mesh instanceof THREE.InstancedMesh)instances.add(mesh);
  for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
   materials.add(m);for(const uniform of Object.values(shaderFor(m).uniforms))if(uniform.value instanceof THREE.Texture)textures.add(uniform.value);
  }
 }
 return {materials,geometries,instances,textures};
}
function watchResources(root:THREE.Object3D){
 const all=resources(root),counts=new Map<object,number>();
 const watch=(r:object,subscribe:(listener:()=>void)=>void)=>{counts.set(r,0);subscribe(()=>counts.set(r,counts.get(r)!+1));};
 for(const r of all.materials)watch(r,listener=>r.addEventListener('dispose',listener));
 for(const r of all.geometries)watch(r,listener=>r.addEventListener('dispose',listener));
 for(const r of all.instances)watch(r,listener=>r.addEventListener('dispose',listener));
 for(const r of all.textures)watch(r,listener=>r.addEventListener('dispose',listener));
 return {all,counts};
}

test('prewarm awaits detached compileAsync with real world lighting, without rendering or mutating the world',async()=>{
 const {prewarmScaleRenderPrograms}=await load();
 const world=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),light=new THREE.DirectionalLight();world.add(light);world.userData.authority={revision:7};
 const children=world.children.slice(),before=JSON.stringify(world.userData);let warm:THREE.Object3D|undefined,resolve!:()=>void,settled=false,calls=0;
 const renderer={compileAsync:async(root:THREE.Object3D,actualCamera:THREE.Camera,target?:THREE.Scene|null)=>{
  calls++;warm=root;assert.notStrictEqual(root,world);assert.equal(root.parent,null);assert.strictEqual(actualCamera,camera);assert.strictEqual(target,world);assert.ok(meshes(root).length>0);
  await new Promise<void>(r=>{resolve=r;});return root;
 },render(){assert.fail('prewarming must not issue a draw');}};
 const pending=prewarmScaleRenderPrograms(renderer,world,camera).then(handle=>{settled=true;return handle;});
 assert.equal(calls,1);assert.ok(warm);await Promise.resolve();assert.equal(settled,false);assert.deepEqual(world.children,children);assert.equal(JSON.stringify(world.userData),before);
 resolve();const handle=await pending;assert.ok(Number.isFinite(handle.compileMs)&&handle.compileMs>=0);assert.equal(settled,true);assert.equal(warm.parent,null);assert.deepEqual(world.children,children);assert.equal(JSON.stringify(world.userData),before);handle.dispose();
});

test('prewarm uses exact StructuralEffects variants, pristine/damaged cell shaders, and owned dynamic/projectile clones',async()=>{
 const {prewarmScaleRenderPrograms}=await load(),world=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
 const rubbleMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.93}),projectileMaterial=new THREE.MeshStandardMaterial({color:0xffce58,roughness:.71});
 let warm!:THREE.Object3D;
 const handle=await prewarmScaleRenderPrograms({compileAsync:async root=>{warm=root;return root;}},world,camera,{rubbleMaterial,projectileMaterial});
 const actual=meshes(warm),reference=new THREE.Scene(),fx=new StructuralEffects(reference);fx.update([frame]);
 assert.deepEqual(actual.filter(m=>m.name.startsWith('explosion-')).map(signature),meshes(reference).map(signature));
 const cells=actual.filter(m=>(m.material as THREE.Material).name==='isolated-cell-palette-standard');assert.equal(cells.length,2);
 assert.deepEqual(cells.map(m=>(m.material as THREE.Material).customProgramCacheKey()).sort(),['isolated-cell-palette-v1-hp','isolated-cell-palette-v1-pristine']);
 for(const mesh of cells){const m=mesh.material as THREE.Material,s=shaderFor(m);assert.match(s.fragmentShader,/readCellColor/);assert.equal(Boolean(s.uniforms.uCellShade),m.customProgramCacheKey().endsWith('-hp'));}
 const rubble=actual.filter(m=>m.name.startsWith('prewarm-rubble'));assert.equal(rubble.length,2);assert.deepEqual(rubble.map(m=>m instanceof THREE.InstancedMesh&&!!m.instanceColor).sort(),[false,true]);
 for(const mesh of rubble){assert.ok(mesh instanceof THREE.InstancedMesh);assert.notStrictEqual(mesh.material,rubbleMaterial);assert.equal((mesh.material as THREE.MeshStandardMaterial).roughness,.93);assert.equal((mesh.material as THREE.Material).vertexColors,true);}
 assert.notStrictEqual(rubble[0].material,rubble[1].material,'compileAsync must wait for both variants instead of only one shared material currentProgram');
 const projectile=actual.find(m=>m.name==='prewarm-projectile')!;assert.ok(projectile);assert.notStrictEqual(projectile.material,projectileMaterial);assert.equal((projectile.material as THREE.MeshStandardMaterial).roughness,.71);assert.equal((projectile.material as THREE.MeshStandardMaterial).color.getHex(),0xffce58);
 handle.dispose();fx.dispose();rubbleMaterial.dispose();projectileMaterial.dispose();
});

test('owned material/program references remain alive until explicit idempotent disposal; caller resources survive',async()=>{
 const {prewarmScaleRenderPrograms}=await load(),world=new THREE.Scene(),camera=new THREE.PerspectiveCamera();let warm!:THREE.Object3D,watch!:ReturnType<typeof watchResources>;
 const rubbleMaterial=new THREE.MeshStandardMaterial({vertexColors:true}),projectileMaterial=new THREE.MeshStandardMaterial();let callerDisposals=0;
 rubbleMaterial.addEventListener('dispose',()=>callerDisposals++);projectileMaterial.addEventListener('dispose',()=>callerDisposals++);
 const handle=await prewarmScaleRenderPrograms({compileAsync:async root=>{warm=root;watch=watchResources(root);return root;}},world,camera,{rubbleMaterial,projectileMaterial});
 assert.ok(watch.all.materials.size>=8);assert.equal(watch.all.textures.size,5);assert.ok([...watch.counts.values()].every(n=>n===0));
 assert.equal(handle.resources.materials,watch.all.materials.size);assert.equal(handle.resources.geometries,watch.all.geometries.size);assert.equal(handle.resources.textures,5);
 // Real event retirement must not dispose this independent cache pin.
 const effects=new StructuralEffects(world);effects.update([frame]);effects.update([]);effects.dispose();assert.ok([...watch.counts.values()].every(n=>n===0));
 handle.dispose();handle.dispose();assert.ok([...watch.counts.values()].every(n=>n===1));assert.equal(warm.children.length,0);assert.equal(callerDisposals,0);assert.equal(world.children.length,0);
});

test('failed async compilation releases every owned resource and preserves the original failure',async()=>{
 const {prewarmScaleRenderPrograms}=await load(),world=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),failure=new Error('compile failed');let warm!:THREE.Object3D,watch!:ReturnType<typeof watchResources>;
 await assert.rejects(prewarmScaleRenderPrograms({compileAsync:async root=>{warm=root;watch=watchResources(root);throw failure;}},world,camera),error=>error===failure);
 assert.ok([...watch.counts.values()].every(n=>n===1));assert.equal(warm.children.length,0);assert.equal(world.children.length,0);
});

test('synchronous compiler failure also releases all owned resources',async()=>{
 const {prewarmScaleRenderPrograms}=await load(),failure=new Error('context unavailable');let watch!:ReturnType<typeof watchResources>;
 await assert.rejects(prewarmScaleRenderPrograms({compileAsync:root=>{watch=watchResources(root);throw failure;}},new THREE.Scene(),new THREE.PerspectiveCamera()),error=>error===failure);
 assert.ok([...watch.counts.values()].every(n=>n===1));
});

test('cloned caller materials preserve custom shader hooks and program keys without owning caller textures',async()=>{
 const {prewarmScaleRenderPrograms}=await load(),rubbleMaterial=new THREE.MeshStandardMaterial({vertexColors:true}),projectileMaterial=new THREE.MeshStandardMaterial(),texture=new THREE.Texture();
 rubbleMaterial.customProgramCacheKey=()=> 'caller-rubble';projectileMaterial.customProgramCacheKey=()=> 'caller-projectile';
 const hook:THREE.Material['onBeforeCompile']=shader=>{shader.uniforms.uCallerTexture={value:texture};};rubbleMaterial.onBeforeCompile=hook;projectileMaterial.onBeforeCompile=hook;
 let warm!:THREE.Object3D,textureDisposals=0;texture.addEventListener('dispose',()=>textureDisposals++);
 const handle=await prewarmScaleRenderPrograms({compileAsync:async root=>{warm=root;return root;}},new THREE.Scene(),new THREE.PerspectiveCamera(),{rubbleMaterial,projectileMaterial});
 for(const mesh of meshes(warm).filter(m=>m.name.startsWith('prewarm-rubble')||m.name==='prewarm-projectile')){
  const material=mesh.material as THREE.Material;assert.strictEqual(material.onBeforeCompile,hook);assert.equal(material.customProgramCacheKey(),mesh.name==='prewarm-projectile'?'caller-projectile':'caller-rubble');assert.strictEqual(shaderFor(material).uniforms.uCallerTexture.value,texture);
 }
 handle.dispose();assert.equal(textureDisposals,0);texture.dispose();rubbleMaterial.dispose();projectileMaterial.dispose();
});

test('optional renderer program introspection finishes deferred first-use work after async compilation without a draw',async()=>{
 const {prewarmScaleRenderPrograms}=await load(),order:string[]=[];
 const program={getUniforms(){order.push('uniforms');return {};},getAttributes(){order.push('attributes');return {};}};
 const renderer={info:{programs:[program]},compileAsync:async(root:THREE.Object3D)=>{order.push('compile');await Promise.resolve();order.push('ready');return root;},render(){assert.fail('introspection must not draw');}};
 const handle=await prewarmScaleRenderPrograms(renderer,new THREE.Scene(),new THREE.PerspectiveCamera());
 assert.deepEqual(order,['compile','ready','uniforms','attributes']);assert.equal(handle.programsPrepared,1);assert.ok(Number.isFinite(handle.forceReadyMs)&&handle.forceReadyMs>=0);handle.dispose();
});

test('a failed deferred first-use query releases warm resources and reports failure, not a ready handle',async()=>{
 const {prewarmScaleRenderPrograms}=await load(),failure=new Error('uniform introspection failed');let watch!:ReturnType<typeof watchResources>;
 const renderer={info:{programs:[{getUniforms(){throw failure;},getAttributes(){assert.fail('must stop after failure');}}]},compileAsync:async(root:THREE.Object3D)=>{watch=watchResources(root);return root;}};
 await assert.rejects(prewarmScaleRenderPrograms(renderer,new THREE.Scene(),new THREE.PerspectiveCamera()),error=>error===failure);assert.ok([...watch.counts.values()].every(n=>n===1));
});

test('compiler adapters without a program list report no forced programs rather than inventing readiness evidence',async()=>{
 const {prewarmScaleRenderPrograms}=await load();
 for(const info of [undefined,{programs:null}]){
  const handle=await prewarmScaleRenderPrograms({compileAsync:async root=>root,info},new THREE.Scene(),new THREE.PerspectiveCamera());assert.equal(handle.programsPrepared,0);assert.ok(Number.isFinite(handle.forceReadyMs)&&handle.forceReadyMs>=0);handle.dispose();
 }
});
