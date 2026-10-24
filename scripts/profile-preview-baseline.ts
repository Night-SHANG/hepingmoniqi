/** Renderer-only baseline. No DOM, WebGL context, browser, Rapier, or game world.
 * Run: node --expose-gc --import tsx scripts/profile-preview-baseline.ts
 * Output: artifacts/performance-baseline/*.json (one fresh process per sample).
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {cpus, platform, arch} from 'node:os';
import {dirname, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import type {MapId, Voxel} from '../src/contracts.js';
import {createGameFixture, gameCellVoxel, previewGameVoxels, type GameFixture} from '../src/structural/game-fixtures.js';
import {createVoxelInstanceRenderer} from '../src/voxel-renderer.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output=resolve(root, 'artifacts/performance-baseline');
const mib=(bytes:number)=>Math.round(bytes/1048576*100)/100;
const memory=()=>{const m=process.memoryUsage();return {heapUsedMiB:mib(m.heapUsed),heapTotalMiB:mib(m.heapTotal),rssMiB:mib(m.rss),arrayBuffersMiB:mib(m.arrayBuffers),externalMiB:mib(m.external),peakRssMiB:Math.round(process.resourceUsage().maxRSS/1024*100)/100};};
const timed=<T>(fn:()=>T)=>{const before=memory(),start=performance.now(),value=fn(),ms=performance.now()-start;return {value,measurement:{ms,before,after:memory()}};};
const sourceFiles=['src/main.ts','src/structural/game-fixtures.ts','src/structural/fixtures.ts','src/voxel-renderer.ts','src/scene-runtime.ts','src/scene.ts'];
const sources=()=>Object.fromEntries(sourceFiles.map(path=>[path,createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')]));
const metadata=()=>({generatedAt:new Date().toISOString(),node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,cpuCount:cpus().length,sourceSha256:sources(),includesRapier:false,includesWebGL:false,includesBrowser:false,measurementBoundary:'Native Node CPU fixture generation, voxel copy, Three instance/index preparation only. Excludes module startup, DOM, environment geometry, event dispatch, WebGL upload, GPU/shadows, browser paint, browser GC, and authoritative simulation. Native milliseconds are NOT browser interaction timings.'});

/** Independent dense occupancy check, deliberately outside all measured stages. */
function topology(voxels:readonly Voxel[],renderer:ReturnType<typeof createVoxelInstanceRenderer>){
 let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
 for(const v of voxels){const p=v.position;assert.ok(Number.isSafeInteger(p.x)&&Number.isSafeInteger(p.y)&&Number.isSafeInteger(p.z));assert.deepEqual(v.size,{x:1,y:1,z:1});minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);minZ=Math.min(minZ,p.z);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);maxZ=Math.max(maxZ,p.z);}
 const nx=maxX-minX+3,ny=maxY-minY+3,nz=maxZ-minZ+3,grid=new Uint8Array(nx*ny*nz),positions=new Map<number,number>(),ids=new Set<number>();
 const index=(x:number,y:number,z:number)=>(x-minX+1)+(y-minY+1)*nx+(z-minZ+1)*nx*ny;
 let duplicatePositions=0,duplicateIds=0;
 for(const v of voxels){const i=index(v.position.x,v.position.y,v.position.z);if(grid[i])duplicatePositions++;grid[i]=1;positions.set(i,v.id);if(ids.has(v.id))duplicateIds++;ids.add(v.id);}
 const offsets=[1,-1,nx,-nx,nx*ny,-nx*ny],faceNames=['+x','-x','+y','-y','+z','-z'],facesByDirection=Object.fromEntries(faceNames.map(n=>[n,0])),surfaceIds=new Set<number>();
 const roleCounts:Record<string,{total:number;surface:number;exposedFaces:number}>={};
 for(const v of voxels){const i=index(v.position.x,v.position.y,v.position.z),role=v.role??'unspecified';const r=roleCounts[role]??={total:0,surface:0,exposedFaces:0};r.total++;let faces=0;for(let d=0;d<6;d++)if(!grid[i+offsets[d]]){faces++;facesByDirection[faceNames[d]]++;}r.exposedFaces+=faces;if(faces){r.surface++;surfaceIds.add(v.id);}}
 const actualIds=new Set<number>();for(let i=0;i<renderer.mesh.count;i++)actualIds.add(renderer.getVoxel(i)!.id);
 const extra=[...actualIds].filter(id=>!surfaceIds.has(id)),missing=[...surfaceIds].filter(id=>!actualIds.has(id));
 const exposedFaces=Object.values(facesByDirection).reduce((a,b)=>a+b,0),surfaceCells=surfaceIds.size;
 return {cells:voxels.length,uniqueIds:ids.size,uniquePositions:positions.size,duplicateIds,duplicatePositions,surfaceCells,interiorCells:voxels.length-surfaceCells,exposedFaces,facesByDirection,roleCounts,bounds:{minX,minY,minZ,maxX,maxY,maxZ},denseOccupancyBytes:grid.byteLength,rendererSurfaceMatches:extra.length===0&&missing.length===0,rendererExtraCells:extra.length,rendererMissingCells:missing.length,extraIdsSample:extra.slice(0,10),missingIdsSample:missing.slice(0,10),currentSurfaceCubeTriangles:renderer.mesh.count*12,exposedFaceTriangles:exposedFaces*2,compactCentersRgbIdsBytes:surfaceCells*(3*4+3*1+4),currentInstanceMatrixColorBytes:renderer.mesh.instanceMatrix.array.byteLength+(renderer.mesh.instanceColor?.array.byteLength??0)};
}

function renderHarness(){const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial({roughness:.88,metalness:.025}),renderer=createVoxelInstanceRenderer(scene,geometry,material);return {scene,geometry,material,renderer,dispose(){renderer.dispose();geometry.dispose();material.dispose();}};}

function sample(mode:string){
 const baseline=memory(),h=renderHarness();
 const stages:unknown[]=[];
 let voxels:readonly Voxel[]=[];
 if(mode==='breakdown-city'){
  let fixture:GameFixture|undefined;
  const generated=timed(()=>{fixture=createGameFixture('city');});
  const mapped=timed(()=>{voxels=fixture!.cells.map(c=>gameCellVoxel(c));});
  stages.push({stage:'fixture',...generated.measurement,cells:fixture!.cells.length},{stage:'voxel-copy',...mapped.measurement,cells:voxels.length});
  fixture=undefined;
  const rendered=timed(()=>h.renderer.set(voxels));
  stages.push({stage:'render-index',...rendered.measurement,diagnostics:h.renderer.getDiagnostics()});
 }else{
  const maps:MapId[]=mode==='fresh-courtyard'?['courtyard']:mode.startsWith('switch')?['city','courtyard','city']:['city'];
  for(const [i,map] of maps.entries()){
   const generated=timed(()=>{voxels=previewGameVoxels(map);});
   const rendered=timed(()=>h.renderer.set(voxels));
   const stage:any={stage:`${i+1}:${map}`,generation:generated.measurement,renderIndex:rendered.measurement,cpuPathMs:generated.measurement.ms+rendered.measurement.ms,cells:voxels.length,diagnostics:h.renderer.getDiagnostics()};
   if(mode==='switch-lifecycle'){
    globalThis.gc?.();stage.retainedAfterExplicitGc=memory();
    stage.topology=topology(voxels,h.renderer);
    globalThis.gc?.();
   }
   stages.push(stage);
   // Same selected card / loadout changes do not invoke this path in main.ts:112.
  }
 }
 const beforeAnalysis=memory(),analysis=topology(voxels,h.renderer);
 const stillSameSnapshot=voxels;
 const idle=timed(()=>h.renderer.set(stillSameSnapshot));
 const sameSnapshot={...idle.measurement,diagnostics:h.renderer.getDiagnostics(),note:'Diagnostic only: main setup does NOT call set every frame. Mutable preview data makes an explicit repeated renderer.set scan every cell.'};
 voxels=[];
 const clear=timed(()=>h.renderer.set(voxels)),clearDiagnostics=h.renderer.getDiagnostics();
 // stillSameSnapshot is intentionally held until this function returns. Disposal
 // heap measurements here would misrepresent release, so perform in lifecycle().
 h.dispose();
 return {...metadata(),mode,forcedGcBetweenMapSwitches:mode==='switch-lifecycle',baseline,stages,beforeAnalysis,topology:analysis,sameSnapshot,clear:{...clear.measurement,diagnostics:clearDiagnostics,note:'Empty set clears authority entries but growing pool retains its high-water capacity. Not a claim that UI home navigation calls clear.'},afterDisposeWithDiagnosticSnapshotStillHeld:memory()};
}

function lifecycle(){
 globalThis.gc?.();const baseline=memory();
 let h:ReturnType<typeof renderHarness>|undefined=renderHarness();
 let voxels:readonly Voxel[]|undefined=previewGameVoxels('city');h.renderer.set(voxels);globalThis.gc?.();const cityRetained=memory();
 voxels=previewGameVoxels('courtyard');h.renderer.set(voxels);globalThis.gc?.();const courtyardRetained=memory(),courtyardDiagnostics=h.renderer.getDiagnostics();
 voxels=undefined;h.renderer.set([]);globalThis.gc?.();const emptyRetained=memory(),emptyDiagnostics=h.renderer.getDiagnostics();
 h.dispose();h=undefined;globalThis.gc?.();const disposedReleased=memory();
 return {...metadata(),mode:'lifecycle',note:'Explicit GC is diagnostic only, not representative user timing. No synthetic city reference retained after switching.',baseline,cityRetained,courtyardRetained,courtyardDiagnostics,emptyRetained,emptyDiagnostics,disposedReleased};
}

const mode=process.argv[2];
if(mode?.startsWith('--sample=')){
 const chosen=mode.slice('--sample='.length),result=chosen==='lifecycle'?lifecycle():sample(chosen);
 console.log(JSON.stringify(result,null,2));
}else{
 mkdirSync(output,{recursive:true});
 const modes=['fresh-city','fresh-city','fresh-city','fresh-courtyard','breakdown-city','switch-natural','switch-lifecycle','lifecycle'];
 const results:any[]=[];
 for(const [i,chosen] of modes.entries()){
  const child=spawnSync(process.execPath,['--expose-gc','--import','tsx',fileURLToPath(import.meta.url),`--sample=${chosen}`],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
  if(child.status!==0)throw new Error(`${chosen}: ${child.stderr||child.stdout}`);
  const data=JSON.parse(child.stdout),name=`${String(i+1).padStart(2,'0')}-${chosen}.json`;writeFileSync(resolve(output,name),JSON.stringify(data,null,2)+'\n');results.push({file:name,...data});
  console.log(JSON.stringify({file:name,stages:data.stages?.map((s:any)=>({stage:s.stage,cpuPathMs:s.cpuPathMs,ms:s.ms,generationMs:s.generation?.ms,renderIndexMs:s.renderIndex?.ms,cells:s.cells,visible:s.diagnostics?.visible,heapMiB:s.renderIndex?.after.heapUsedMiB??s.after?.heapUsedMiB})),topology:data.topology,baseline:data.baseline,disposedReleased:data.disposedReleased}));
 }
 const fresh=results.filter(r=>r.mode==='fresh-city').map(r=>r.stages[0]),sorted=(values:number[])=>[...values].sort((a,b)=>a-b),median=(values:number[])=>sorted(values)[Math.floor(values.length/2)];
 const summary={...metadata(),samples:results.map(r=>r.file),freshCity:{samples:fresh.length,generationMsMedian:median(fresh.map(s=>s.generation.ms)),renderIndexMsMedian:median(fresh.map(s=>s.renderIndex.ms)),cpuPathMsMedian:median(fresh.map(s=>s.cpuPathMs)),cpuPathMsRange:[Math.min(...fresh.map(s=>s.cpuPathMs)),Math.max(...fresh.map(s=>s.cpuPathMs))],heapAfterIndexMiB: fresh.map(s=>s.renderIndex.after.heapUsedMiB),rssAfterIndexMiB:fresh.map(s=>s.renderIndex.after.rssMiB)},topology:results[0].topology};
 writeFileSync(resolve(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({summary},null,2));
}
