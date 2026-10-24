import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CompactIncrementalSupport} from '../incremental-support/incremental-support.ts';
import {IndexedStructure} from '../incremental-support/indexed-structure.ts';
import {decodePristine,type CompiledManifest} from './codec.ts';
import {validatePristine,recipeDigest} from './pristine-validation.ts';
import {citySource,currentRecipe,timed} from './source.ts';
const memory=()=>{global.gc?.();const {rss,heapUsed,arrayBuffers,external}=process.memoryUsage();return {rss,heapUsed,arrayBuffers,external};};
const delta=(before:ReturnType<typeof memory>,after:ReturnType<typeof memory>)=>Object.fromEntries(Object.keys(before).map(k=>[k,after[k as keyof typeof after]-before[k as keyof typeof before]]));
const summary=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {count:values.length,totalMs:values.reduce((a,b)=>a+b,0),medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1)};};
const kind=process.argv[2]??'compiled-cold',baseline=memory(),prepared=timed(citySource),s=prepared.value,afterSource=memory(),manifest=JSON.parse(readFileSync(new URL('./city-seed-11.manifest.json',import.meta.url),'utf8')) as CompiledManifest;
assert.equal(recipeDigest(currentRecipe()),manifest.recipeSha256,'Reject stale compiled asset source recipe');
const oldOracle=JSON.parse(readFileSync(new URL('../support-ab/city-result-1.json',import.meta.url),'utf8'));
function build(){
 let ioMs=0,decodeMs=0,validateMs=0,hydrateMs=0;
 const total=timed(()=>{
  if(kind==='uncached')return new CompactIncrementalSupport(s.store,s.input,manifest.seed);
  const io=timed(()=>new Uint8Array(readFileSync(new URL('./city-seed-11.bin',import.meta.url))));ioMs=io.ms;
  const decoded=timed(()=>decodePristine(io.value,manifest));decodeMs=decoded.ms;
  return new CompactIncrementalSupport(s.store,s.input,manifest.seed,source=>{
   const validated=timed(()=>validatePristine(source,decoded.value));validateMs=validated.ms;
   const hydrated=timed(()=>IndexedStructure.fromPristine(source,validated.value));hydrateMs=hydrated.ms;return hydrated.value;
  });
 });return {graph:total.value,timings:{totalMs:total.ms,ioMs,decodeMs,validateMs,hydrateMs}};
}
let warmupMs:number|undefined;
function warmup(){return build().timings.totalMs;}
if(kind==='compiled-warm'){warmupMs=warmup();memory();}
function measureRound(){
let graph:CompactIncrementalSupport|null=null;
const measured=build();graph=measured.graph;measured.graph=null as unknown as CompactIncrementalSupport;const afterBuild=memory(),initial=timed(()=>graph!.unsupported());assert.deepEqual(initial.value,[]);const steps=[];
for(let i=0;i<20;i++){
 const b=s.locations[(i*7)%36],at={x:(b.minX+b.maxX)/2,y:i%4===3?-5:-1,z:(b.minZ+b.maxZ)/2},radius=5.5+(i%3)*1.2;
 const removal:{value:number;ms:number}=timed(()=>graph!.removeSphere(at,radius)),query:{value:ReturnType<CompactIncrementalSupport['unsupported']>;ms:number}=timed(()=>graph!.unsupported()),hash:string=createHash('sha256').update(JSON.stringify(query.value)).digest('hex');
 assert.equal(hash,oldOracle.steps[i].exactOrderedMembershipSha256,`ordered members at step ${i+1}`);assert.equal(removal.value,oldOracle.steps[i].removedCells);
 steps.push({step:i+1,removedCells:removal.value,removeMs:removal.ms,queryMs:query.ms,pieces:query.value.length,disconnectedCells:query.value.reduce((n,p)=>n+p.cells.length,0),exactOrderedMembershipSha256:hash});
}
const afterCuts=memory(),diagnostics=graph.diagnostics();return {afterBuild,afterCuts,initialMs:initial.ms,diagnostics,steps,timings:measured.timings};
}
const round=measureRound(),afterRelease=memory();
const {afterBuild,afterCuts,diagnostics,steps}=round;
console.log(JSON.stringify({kind,scope:'Isolated fixed samecity topology, no Rapier/browser/render/gameplay latency claim',node:process.version,coverage:{terrainCells:s.input.terrain.cellCount,structureCells:s.store.cellCount,totalCells:s.input.terrain.cellCount+s.store.cellCount,buildings:s.locations.length},artifactBytes:16+Math.ceil(new TextEncoder().encode(JSON.stringify(manifest)).length/4)*4+manifest.payloadBytes,recipeSha256:manifest.recipeSha256,
 timings:{sourceAndCompactStoreMs:prepared.ms,packingMs:s.packingMs,warmupMs,support:round.timings,initialQueryMs:round.initialMs,removal:summary(steps.map(s=>s.removeMs)),queries:summary(steps.map(s=>s.queryMs))},exact20CutOracleHashes:true,
 memory:{gcAvailable:typeof global.gc==='function',baseline,afterSource,afterBuild,afterCuts,afterRelease,supportDelta:delta(afterSource,afterBuild),combinedRetainedDelta:delta(baseline,afterCuts),releasedGraphDelta:delta(afterCuts,afterRelease),note:'Post-GC retained memory, not peak memory. Decoded buffers are released before afterBuild. Runtime graph includes mutable JS member arrays/edge Maps; no Cell objects or full-city JSON. Release runs after the entire graph-owning function returns, retaining compact source stores for comparison. RSS is allocator-dependent; arrayBuffers also counted within external, do not sum.'},cacheNote:kind==='compiled-cold'?'Fresh-process first asset read, OS filesystem cache NOT flushed':kind==='compiled-warm'?'Second load and hydration after discarding first graph in the same process':'Original seeded partition path, no cache',diagnostics,steps},null,2));
