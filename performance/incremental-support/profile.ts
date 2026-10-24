import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { CompactStructures } from '../structure-store/compact-structures.ts';
import { CompactTerrain } from '../terrain/compact-terrain.ts';
import { legacyLayoutColumns } from '../terrain/legacy-layout-columns.ts';
import { sparseStructureFixture } from '../support-ab/sparse-structure-fixture.ts';
import { CompactIncrementalSupport } from './incremental-support.ts';
import { CompactSupport } from '../support-ab/compact-support.ts';
import type { Point } from '../../src/structural/types.ts';
const timed=<T>(fn:()=>T)=>{const at=performance.now(),value=fn();return {value,ms:performance.now()-at};};
const memory=()=>{global.gc?.();const {rss,heapUsed,arrayBuffers,external}=process.memoryUsage();return {rss,heapUsed,arrayBuffers,external};};
const delta=(before:ReturnType<typeof memory>,after:ReturnType<typeof memory>)=>Object.fromEntries(Object.keys(before).map(k=>[k,after[k as keyof typeof after]-before[k as keyof typeof before]]));
const summary=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {count:values.length,totalMs:values.reduce((a,b)=>a+b,0),medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1)};};
const kind=process.argv[2]??'incremental';
const baseline=memory(),descriptor=timed(()=>{const layout=legacyLayoutColumns('city');return {terrain:new CompactTerrain(layout.config),bounds:{minX:layout.config.minX,maxX:layout.config.maxX,minZ:layout.config.minZ,maxZ:layout.config.maxZ},objectId:'game:city:geology'};});
const descriptorMemory=memory();
// This helper keeps all temporary source Cells and generator records in one stack
// frame. The benchmark returns only the compact typed store and 36 cut locations.
function source(){
 const fixture=sparseStructureFixture('city'),buildings=new Map<string,{minX:number;maxX:number;minZ:number;maxZ:number}>();
 assert.equal(fixture.cells.length,53113);
 for(const c of fixture.cells)if(c.role==='foundation'||c.role==='building'){
  const p=c.position,b=buildings.get(c.objectId);if(b){b.minX=Math.min(b.minX,p.x);b.maxX=Math.max(b.maxX,p.x);b.minZ=Math.min(b.minZ,p.z);b.maxZ=Math.max(b.maxZ,p.z);}else buildings.set(c.objectId,{minX:p.x,maxX:p.x,minZ:p.z,maxZ:p.z});
 }
 const compact=kind==='oracle'?undefined:timed(()=>new CompactStructures(fixture.cells));
 return {store:compact?.value,storeMs:compact?.ms??0,locations:[...buildings.values()],sourceAllocations:fixture.allocations,oracleCells:kind==='oracle'?fixture.cells:undefined};
}
const sourceResult=timed(source),sourceMemory=memory();
assert.equal(sourceResult.value.locations.length,36);assert.equal(descriptor.value.terrain.cellCount,401800);
descriptor.value.terrain.cell=()=>{throw new Error('No terrain Cell materialization permitted in city profile');};
if(sourceResult.value.store)sourceResult.value.store.cell=()=>{throw new Error('No structure CellView materialization permitted in incremental city profile');};
const build=timed(()=>kind==='oracle'?new CompactSupport(sourceResult.value.oracleCells!,descriptor.value):new CompactIncrementalSupport(sourceResult.value.store!,descriptor.value));
sourceResult.value.oracleCells=undefined;const afterBuild=memory();
const initial=timed(()=>build.value.unsupported());assert.deepEqual(initial.value,[]);
const oldOracle=JSON.parse(readFileSync(new URL('../support-ab/city-result-1.json',import.meta.url),'utf8'));
const steps=[];
for(let i=0;i<20;i++){
 const b=sourceResult.value.locations[(i*7)%36],at:Point={x:(b.minX+b.maxX)/2,y:i%4===3?-5:-1,z:(b.minZ+b.maxZ)/2},radius=5.5+(i%3)*1.2;
 const removal=timed(()=>build.value.removeSphere(at,radius)),query=timed(()=>build.value.unsupported());
 const hash=createHash('sha256').update(JSON.stringify(query.value)).digest('hex');
 assert.equal(hash,oldOracle.steps[i].exactOrderedMembershipSha256,`Exact city ordered members must match independent oracle at step ${i+1}`);
 assert.equal(removal.value,oldOracle.steps[i].removedCells);
 steps.push({step:i+1,at,radius,removedCells:removal.value,removeMs:removal.ms,supportMs:query.ms,pieces:query.value.length,disconnectedCells:query.value.reduce((n,p)=>n+p.cells.length,0),exactOrderedMembershipSha256:hash});
}
const afterCuts=memory();
console.log(JSON.stringify({scope:'Isolated unchanged samecity topology, no Rapier/browser/render/gameplay performance claim',kind,node:process.version,platform:process.platform,
 coverage:{terrainCells:401800,structureCells:53113,totalCells:454913,buildings:36,initialUnsupported:0},exactOrderedCityOutputsMatchOracleAfterEveryCut:true,
 timings:{descriptorSetupMs:descriptor.ms,structureSourceAndStoreMs:sourceResult.ms,storePackingMs:sourceResult.value.storeMs,supportBuildMs:build.ms,initialSupportMs:initial.ms,removals:summary(steps.map(s=>s.removeMs)),supportQueries:summary(steps.map(s=>s.supportMs))},
 memory:{gcAvailable:typeof global.gc==='function',baseline,descriptorMemory,sourceMemory,afterBuild,afterCuts,descriptorDelta:delta(baseline,descriptorMemory),sourceDelta:delta(descriptorMemory,sourceMemory),supportDelta:delta(sourceMemory,afterBuild),combinedRetainedDelta:delta(baseline,afterCuts),note:'Source Cell specs are released before afterBuild GC in both modes. Incremental packs full compact structure state, oracle retains its topology-only snapshot instead. No ground Cell calls permitted. Post-GC process values, not peak RSS or exact allocations; delta from sourceMemory includes release of oracle specs.'},
 diagnostics:build.value.diagnostics(),sourceAllocations:sourceResult.value.sourceAllocations,steps},null,2));
