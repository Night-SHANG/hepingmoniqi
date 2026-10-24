// Node's native Web Crypto measurement. NOT a browser, game or rendering benchmark.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import {CompactLattice} from '../incremental-support/incremental-support.ts';
import {IndexedStructure} from '../incremental-support/indexed-structure.ts';
import {recipeDigest} from '../compiled-support/pristine-validation.ts';
import {_topologyBytes,sha256Browser,decodePristineBrowser,validatePristineBrowser,type CompiledManifest} from './runtime.ts';
import {applyCityCut,orderedUnsupported} from './cut-sequence.ts';
import {citySource,browserRecipe,timed} from './source.ts';
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
const memory=(gc=true)=>{if(gc)global.gc?.();const {rss,heapUsed,arrayBuffers,external}=process.memoryUsage();return {rss,heapUsed,arrayBuffers,external};};
const delta=(a:ReturnType<typeof memory>,b:ReturnType<typeof memory>)=>Object.fromEntries(Object.keys(a).map(k=>[k,b[k as keyof typeof b]-a[k as keyof typeof a]]));
const timedAsync=async<T>(fn:()=>Promise<T>)=>{const at=performance.now(),value=await fn();return {value,ms:performance.now()-at};};
const summarize=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {count:values.length,totalMs:values.reduce((a,b)=>a+b,0),medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1)};};
async function main(){
 const baseline=memory(),prepared=timed(citySource),s=prepared.value,lattice=timed(()=>new CompactLattice(s.store,s.input)),source=lattice.value,afterSource=memory();
 const manifest=JSON.parse(readFileSync(new URL('./city-seed-11.manifest.json',import.meta.url),'utf8')) as CompiledManifest;
 assert.equal(recipeDigest(browserRecipe()),manifest.recipeSha256,'Reject stale browser artifact source recipe');
 const oldOracle=JSON.parse(readFileSync(new URL('../support-ab/city-result-1.json',import.meta.url),'utf8'));
 async function measureValidationAndCuts(){
  const io=timed(()=>new Uint8Array(readFileSync(new URL('./city-seed-11.bin',import.meta.url)))),beforeDecode=memory(),decoded=await timedAsync(()=>decodePristineBrowser(io.value,manifest)),afterDecode=memory();
  const validated=await timedAsync(()=>validatePristineBrowser(source,decoded.value)),afterValidation=memory(),hydrated=timed(()=>IndexedStructure.fromPristine(source,validated.value)),afterHydrationWithDecodedBuffers=memory(),graph=hydrated.value;
  const initial=timed(()=>graph.unsupported());assert.deepEqual(initial.value,[]);const steps=[];
  for(let i=0;i<20;i++){
   const removal=timed(()=>applyCityCut(source,graph,s.locations,i));
   const query=timed(()=>orderedUnsupported(source,graph)),hash=createHash('sha256').update(JSON.stringify(query.value)).digest('hex');
   assert.equal(hash,oldOracle.steps[i].exactOrderedMembershipSha256,`ordered members at step ${i+1}`);assert.equal(removal.value,oldOracle.steps[i].removedCells);
   steps.push({step:i+1,removedCells:removal.value,removeMs:removal.ms,queryMs:query.ms,pieces:query.value.length,exactOrderedMembershipSha256:hash});
  }
  return {timings:{ioMs:io.ms,decodeMs:decoded.ms,validateMs:validated.ms,hydrateMs:hydrated.ms,decodeValidateHydrateMs:decoded.ms+validated.ms+hydrated.ms,withIoMs:io.ms+decoded.ms+validated.ms+hydrated.ms,initialQueryMs:initial.ms,removal:summarize(steps.map(s=>s.removeMs)),queries:summarize(steps.map(s=>s.queryMs))},memory:{beforeDecode,afterDecode,afterValidation,afterHydrationWithDecodedBuffers,decodeRetainedDelta:delta(beforeDecode,afterDecode),validationRetainedDelta:delta(afterDecode,afterValidation)},diagnostics:graph.diagnostics(),steps};
 }
 const round=await measureValidationAndCuts(),afterRoundRelease=memory();
 async function measureTopology(){
  const before=memory(),encoded=timed(()=>_topologyBytes(source)),withOwnedTopology=memory(),hash=await timedAsync(()=>sha256Browser(encoded.value)),afterDigest=memory();assert.equal(hash.value,manifest.topologySha256);
  return {topologyBytes:encoded.value.byteLength,encodingTwoPassMs:encoded.ms,digestWithPublicOwnershipCopyMs:hash.ms,before,withOwnedTopology,afterDigest,ownedTopologyRetainedDelta:delta(before,withOwnedTopology)};
 }
 const topology=await measureTopology(),afterTopologyRelease=memory();
 console.log(JSON.stringify({kind:'node-native-webcrypto-fresh-process',scope:'Isolated compact source, native Web Crypto and graph only. No real browser, GPU, Rapier, frame latency or whole-game claim.',node:process.version,coverage:{terrainCells:s.input.terrain.cellCount,structureCells:s.store.cellCount,totalCells:source.count,buildings:s.locations.length},recipeSha256:manifest.recipeSha256,artifactBytes:readFileSync(new URL('./city-seed-11.bin',import.meta.url)).byteLength,exact20CutOracleHashes:true,timings:{sourceMs:prepared.ms,latticeMs:lattice.ms,...round.timings},memory:{gcAvailable:typeof global.gc==='function',baseline,afterSource,...round.memory,afterRoundRelease,afterTopologyRelease,note:'GC snapshots are retained memory, not peak. afterHydrationWithDecodedBuffers intentionally retains input/decoded buffers plus hydrated graph. Web Crypto may make additional native copies; snapshots do not establish browser peak. arrayBuffers is included in external: do not sum them.'},topologyBufferMeasurement:topology,diagnostics:round.diagnostics,steps:round.steps},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
