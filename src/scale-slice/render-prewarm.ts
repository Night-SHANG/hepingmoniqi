import * as THREE from 'three';
import {buildCellColorData} from '../material-slice/cell-colors.js';
import {createCellColorMaterial,type CellColorMaterial} from '../material-slice/material.js';
import {StructuralEffects} from '../structural/effect-renderer.js';

export interface ScaleRenderPrewarm {
 /** Owned CPU/Three resources, not unique GPU program or draw-call counts. */
 readonly resources:Readonly<{meshes:number;materials:number;geometries:number;textures:number}>;
 /** Wall time spent awaiting compileAsync, not measured GPU execution time. */
 readonly compileMs:number;
 /** Synchronous uniform/attribute initialization time; separate from compilation. */
 readonly forceReadyMs:number;
 /** Renderer cache entries introspected, including already-ready shared ones. */
 readonly programsPrepared:number;
 /** Release cache pins only at renderer teardown, not between shots/resets. */
 dispose():void;
}
interface PrewarmRenderer extends Pick<THREE.WebGLRenderer,'compileAsync'> {
 /** Optional for CPU-only compiler adapters; present on Three 0.180 renderer. */
 readonly info?:{readonly programs:readonly {getUniforms():unknown;getAttributes():unknown}[]|null};
}
export interface ScaleRenderPrewarmOptions {
 /** Cloned, never modified/disposed. Defaults match the scale-slice renderer. */
 rubbleMaterial?:THREE.MeshStandardMaterial;
 projectileMaterial?:THREE.MeshStandardMaterial;
}

function cloneMaterial(source:THREE.MeshStandardMaterial|undefined,defaults:THREE.MeshStandardMaterialParameters):THREE.MeshStandardMaterial {
 if(!source)return new THREE.MeshStandardMaterial(defaults);
 const material=source.clone();
 // Material.copy does not copy custom shader hooks/cache keys. Keep them while
 // leaving any caller-owned textures referenced by the clone undisposed.
 material.onBeforeCompile=source.onBeforeCompile;material.customProgramCacheKey=source.customProgramCacheKey;
 return material;
}

/**
 * Compile exact scale-slice shader variants without drawing anything, adding
 * objects to the live world, or invoking its damage/physics/effect timeline.
 *
 * Three 0.180 releases a material's program references on material.dispose()
 * (WebGLRenderer.releaseMaterialProgramReferences). WebGLPrograms.releaseProgram
 * destroys the GPU program when usedTimes reaches zero. Retaining these owned
 * materials therefore keeps matching cache keys alive across VFX retirement.
 *
 * Call with the live lighting/environment and normal renderer output settings
 * configured, before interactive measurement. compileAsync's targetScene argument
 * supplies those settings without cloning or moving lights. Rewarm if shader-
 * defining lighting/environment/output settings change. This does not upload
 * future meshes/textures or prove absence of all first-draw GPU stalls. Three
 * 0.180 marks isReady immediately without KHR_parallel_shader_compile; accessing
 * its retained programs' uniforms/attributes below also forces deferred link
 * introspection before this helper resolves, without a draw.
 */
export async function prewarmScaleRenderPrograms(
 renderer:PrewarmRenderer,
 targetScene:THREE.Scene,
 camera:THREE.Camera,
 options:ScaleRenderPrewarmOptions={},
):Promise<ScaleRenderPrewarm> {
 const warmScene=new THREE.Scene();warmScene.name='scale-render-program-prewarm';
 const effects=new StructuralEffects(warmScene),cells:CellColorMaterial[]=[];
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),instances:THREE.InstancedMesh[]=[];
 let disposed=false;
 const dispose=()=>{
  if(disposed)return;disposed=true;
  effects.dispose();for(const cell of cells)cell.dispose();
  for(const instance of instances)instance.dispose();
  for(const material of materials)material.dispose();
  for(const geometry of geometries)geometry.dispose();
  warmScene.clear();
 };
 try {
  // Use the actual VFX factory rather than a second hand-maintained material
  // recipe. update() attaches instance colors even to currently hidden layers;
  // Three.compile traverses all meshes, and no render() is ever issued here.
  effects.update([{id:'shader-prewarm',epoch:0,position:{x:0,y:0,z:0},tool:'nova',kind:'detonation',age:.1,flash:.5,fire:1,smoke:1,ring:1,scale:1}]);
  const box=new THREE.BoxGeometry(1,1,1);geometries.add(box);
  for(const damaged of [false,true]){
   // A private one-cell presentation sample, not a world/authority mutation.
   const data=buildCellColorData({bounds:{minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0},staticIdAt:()=>0,colorOf:()=>0xffffff,hpOf:()=>damaged?.5:1,maxHpOf:()=>1,forEachChunk:()=>{}},'0,0,0',1);
   const cell=createCellColorMaterial(data);cells.push(cell);
   const mesh=new THREE.Mesh(box,cell.material);mesh.name=damaged?'prewarm-cell-damaged':'prewarm-cell-pristine';warmScene.add(mesh);
  }
  for(const colored of [false,true]){
   // Distinct material objects are deliberate: compileAsync checks only each
   // material's currentProgram, so sharing one across two variants could leave
   // an earlier program unwaited. Both instancing-color states exist at runtime.
   const material=cloneMaterial(options.rubbleMaterial,{vertexColors:true,roughness:1});materials.add(material);
   const mesh=new THREE.InstancedMesh(box,material,1);instances.push(mesh);mesh.name=colored?'prewarm-rubble-colored':'prewarm-rubble-uncolored';
   if(colored)mesh.setColorAt(0,new THREE.Color(0xffffff));warmScene.add(mesh);
  }
  const projectileMaterial=cloneMaterial(options.projectileMaterial,{color:0xffce58});materials.add(projectileMaterial);
  const sphere=new THREE.SphereGeometry(1,12,8);geometries.add(sphere);
  const projectile=new THREE.Mesh(sphere,projectileMaterial);projectile.name='prewarm-projectile';warmScene.add(projectile);
  let meshCount=0;const allMaterials=new Set<THREE.Material>(),allGeometries=new Set<THREE.BufferGeometry>();
  warmScene.traverse(object=>{
   if(!(object instanceof THREE.Mesh))return;meshCount++;allGeometries.add(object.geometry);
   for(const material of Array.isArray(object.material)?object.material:[object.material])allMaterials.add(material);
  });
  const resources=Object.freeze({meshes:meshCount,materials:allMaterials.size,geometries:allGeometries.size,textures:cells.reduce((n,cell)=>n+(cell.textures.shade?3:2),0)});
  const compileStarted=performance.now();
  await renderer.compileAsync(warmScene,camera,targetScene);
  const compileMs=performance.now()-compileStarted;
  const forceReadyStarted=performance.now();let programsPrepared=0;
  // Version-pinned Three 0.180 WebGLProgram.getUniforms/getAttributes invoke
  // onFirstUse (LINK_STATUS/log checks + uniform/attribute location queries),
  // which compileAsync alone leaves lazy. Existing entries return cached data.
  // Snapshot the public info list; do not mutate caches or release live programs.
  for(const program of [...(renderer.info?.programs??[])]){
   program.getUniforms();program.getAttributes();programsPrepared++;
  }
  const forceReadyMs=performance.now()-forceReadyStarted;
  // Keep the detached scene and its materials reachable through this disposer.
  // Disposing immediately after compile would undo the cache-retention purpose.
  return {resources,compileMs,forceReadyMs,programsPrepared,dispose};
 } catch(error) {
  dispose();throw error;
 }
}
