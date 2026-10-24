/** Renderer-only audit: no native world, browser, simulation, or city workload.
 * node --import tsx scripts/profile-nova-surface-sync.ts --output=artifacts/nova-surface-sync/before.json
 * Historical browser observations are read, not rerun. Synthetic timings are not
 * browser/FPS numbers and are sensitive to concurrent worker CPU activity.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import * as THREE from 'three';
import {createCompactSurfaceRenderer} from '../src/compact/surface-renderer.js';
import type {CompactSurfaceSource,SurfaceEdit} from '../src/compact/surface-source.js';

const output=process.argv.find(s=>s.startsWith('--output='))?.slice(9)??'artifacts/nova-surface-sync/profile.json';
const round=(n:number)=>Math.round(n*1000)/1000;
function measure(run:()=>void,count=60){
 for(let i=0;i<10;i++)run();const samples=[];
 for(let i=0;i<count;i++){const start=performance.now();run();samples.push(performance.now()-start);}
 samples.sort((a,b)=>a-b);return {samples:count,p50Ms:round(samples[Math.floor(count*.5)]),p95Ms:round(samples[Math.floor(count*.95)]),maxMs:round(samples.at(-1)!),meanMs:round(samples.reduce((a,b)=>a+b,0)/count)};
}
const cityPath='artifacts/city-nova-ci-40070644703/results.json',city=JSON.parse(readFileSync(cityPath,'utf8'));
const observed=city.timings.filter((t:any)=>/^nova-/.test(t.label)).map((t:any)=>({label:t.label,samples:t.samples.map((s:any)=>({at:s.observedAt,authorityRevision:s.authorityRevision,authorityRevisionDelta:s.authorityRevisionDelta,surfaceRevision:s.surfaceRevision,surfaceRevisionDelta:s.surfaceRevisionDelta,pending:s.pending,chunks:s.surface.lastRebuild.chunks,colorChunks:s.surface.lastRebuild.colorChunks,lastRebuildMs:s.surface.lastRebuild.ms,movingCells:s.surface.movingCells}))}));
const actions=city.blasts.map((b:any)=>{const start=b.actionTiming.find((a:any)=>a.kind==='surface-sync-start'),end=b.actionTiming.find((a:any)=>a.kind==='surface-sync-end');return {index:b.index,syncWorldMs:round(end.at-start.at)};});
const authorityPath='artifacts/city-nova-authority/batched-sparse/report.json',authority=JSON.parse(readFileSync(authorityPath,'utf8'));
const authorityRevisions=authority.blasts.map((b:any)=>({blast:b.blast,before:b.before.revision,afterDamage:b.afterDamage.revision,afterSettlement:b.afterSettlement.revision,settlementSteps:b.settlement.steps,maxStepRevisionDelta:b.settlement.maxStepRevisionDelta}));

const side=64,position=(id:number)=>({x:Math.floor(id/(side*side)),y:Math.floor(id/side)%side,z:id%side});
let revision=0,historicalIds=0,queries=0;
const source:CompactSurfaceSource={bounds:{minX:0,maxX:63,minY:0,maxY:63,minZ:0,maxZ:63},staticIdAt(x,y,z){queries++;return x>=0&&x<side&&y>=0&&y<side&&z>=0&&z<side?(x*side+y)*side+z:null;},colorOf:()=>0x8899aa,hpOf:id=>id<historicalIds?9:10,maxHpOf:()=>10,forEachChunk(_size,visit){for(let x=0;x<2;x++)for(let y=0;y<2;y++)for(let z=0;z<2;z++)visit(x,y,z);}};
const world=new THREE.Scene(),box=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),renderer=createCompactSurfaceRenderer(world,box,material,{chunkSize:32});
const measurements=[];
try{
 renderer.bind(source);
 for(const count of [0,32768,138259]){
  const edits:SurfaceEdit[]=[];for(let id=historicalIds;id<count;id++)edits.push({id,revision:++revision,position:position(id),topologyChanged:false,appearanceChanged:true});historicalIds=count;
  renderer.applyEdits(edits);renderer.flush();assert.equal(renderer.getDiagnostics().changedRevisionEntries,count);
  const before=queries;let ledgerEnumerations=0,ledgerKeys=0;const keys=Map.prototype.keys;
  Map.prototype.keys=function(){if(this.size===count&&count>0&&this.has(0)){ledgerEnumerations++;ledgerKeys+=this.size;}return keys.call(this);};
  try{renderer.getDiagnostics();renderer.getDiagnostics();}finally{Map.prototype.keys=keys;}
  const twoDiagnostics=measure(()=>{renderer.getDiagnostics();renderer.getDiagnostics();});
  const noDirtyFlush=measure(()=>{renderer.flush();});assert.equal(queries,before,'diagnostic and idle paths must not query cells');
  renderer.applyEdits(edits);const replay=renderer.flush();assert.equal(replay.chunks,0);assert.equal(replay.colorChunks,0);assert.equal(queries,before);
  measurements.push({historicalIds:count,twoDiagnostics,ledgerEnumerationsForTwoCalls:ledgerEnumerations,ledgerKeysForTwoCalls:ledgerKeys,noDirtyFlush,sameRevisionReplay:{chunks:replay.chunks,colorChunks:replay.colorChunks,additionalCellQueries:queries-before}});
 }
}finally{renderer.dispose();box.dispose();material.dispose();}
const report={scope:'Synthetic 64^3 renderer-only preparation, no native simulation/browser/GPU. History cardinalities include actual observed city ledger size. Timings may overlap other workers.',sources:{cityPath,authorityPath},actions,observed,authorityRevisions,measurements};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({output,actions,measurements},null,2));
