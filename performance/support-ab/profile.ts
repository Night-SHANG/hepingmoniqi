import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { CompactTerrain } from '../terrain/compact-terrain.ts';
import { legacyLayoutColumns } from '../terrain/legacy-layout-columns.ts';
import { CompactSupport } from './compact-support.ts';
import { sparseStructureFixture } from './sparse-structure-fixture.ts';
import { createSupportGraph } from '../../src/structural/support.ts';
import type { Cell, Piece, Point } from '../../src/structural/types.ts';
const timed=<T>(fn:()=>T)=>{const at=performance.now(),value=fn();return {value,ms:performance.now()-at};};
const memory=()=>{global.gc?.();const {rss,heapUsed,arrayBuffers,external}=process.memoryUsage();return {rss,heapUsed,arrayBuffers,external};};
const delta=(before:ReturnType<typeof memory>,after:ReturnType<typeof memory>)=>Object.fromEntries(Object.keys(before).map(k=>[k,after[k as keyof typeof after]-before[k as keyof typeof before]]));
const summary=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {count:values.length,totalMs:values.reduce((a,b)=>a+b,0),medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1)};};
const config={map:'bounded-ab',minX:-12,maxX:12,minZ:-8,maxZ:8};
function small(){
 const terrain=new CompactTerrain(config),structures:Cell[]=[];
 for(let x=-5;x<=5;x++)for(let y=0;y<=6;y++)for(let z=-4;z<=4;z++)if(y===1||y===6||Math.abs(x)===5||Math.abs(z)===4)structures.push({id:1+structures.length,objectId:'ab-building',role:y===0?'foundation':'building',position:{x,y,z},material:y===0?'stone':'wood',color:1,hp:5,maxHp:5});
 const dense=[...terrain.staticCellsInBounds(config),...structures];
 const cuts=Array.from({length:20},(_,i)=>{const at=i===9?{x:0,y:0,z:0}:{x:(i%5-2)*3,y:i<10?-1:-5,z:(Math.floor(i/5)%2?1:-1)*3},radius=i===9?7.5:2.7;return dense.filter(c=>(c.position.x-at.x)**2+(c.position.y-at.y)**2+(c.position.z-at.z)**2<=radius*radius).map(c=>c.id);});
 function run(kind:'MIT'|'compact'){
   const build=timed(()=>kind==='MIT'?createSupportGraph(dense):new CompactSupport(structures,{terrain,bounds:config}));
   const initial=timed(()=>build.value.unsupported());assert.deepEqual(initial.value,[]);
   const members:Piece[][]=[],steps=cuts.map((ids,i)=>{const remove=timed(()=>build.value.remove(ids)),query=timed(()=>build.value.unsupported());members.push(query.value);return {step:i+1,requestedIds:ids.length,removeMs:remove.ms,supportMs:query.ms,pieces:query.value.length,disconnectedIds:query.value.reduce((n,p)=>n+p.cells.length,0)};});
   return {kind,buildMs:build.ms,initialSupportMs:initial.ms,steps,removalSummary:summary(steps.map(s=>s.removeMs)),supportSummary:summary(steps.map(s=>s.supportMs)),members};
 }
 const reference=run('MIT'),compact=run('compact');assert.deepEqual(compact.members,reference.members);assert.ok(compact.members.some(p=>p.length>0),'A/B must include nonempty disconnected outputs');
 const {members:_,...a}=reference,{members:__,...b}=compact;
 return {scope:'bounded exact A/B against current MIT-derived createSupportGraph',timingMethod:'Single process, sequential MIT then compact, no warm-up; indicative isolated stage timings, not a statistically controlled speedup claim',cells:dense.length,terrainCells:terrain.cellCount,structureCells:structures.length,identicalExactOrderedMembersAfterEveryCut:true,reference:a,compact:b};
}
function city(){
 const baseline=memory();const descriptor=timed(()=>{const layout=legacyLayoutColumns('city');const {minX,maxX,minZ,maxZ}=layout.config;return {terrain:new CompactTerrain(layout.config),bounds:{minX,maxX,minZ,maxZ},legacyColumns:layout.originalColumns};});
 const descriptorMemory=memory(),source=timed(()=>sparseStructureFixture('city')),sourceMemory=memory();
 const structures=source.value.cells,buildings=new Map<string,{minX:number;maxX:number;minZ:number;maxZ:number}>();
 for(const c of structures)if(c.role==='foundation'||c.role==='building'){
  const p=c.position,old=buildings.get(c.objectId);if(old){old.minX=Math.min(old.minX,p.x);old.maxX=Math.max(old.maxX,p.x);old.minZ=Math.min(old.minZ,p.z);old.maxZ=Math.max(old.maxZ,p.z);}else buildings.set(c.objectId,{minX:p.x,maxX:p.x,minZ:p.z,maxZ:p.z});
 }
 assert.equal(buildings.size,36);assert.equal(structures.length,53113);assert.equal(descriptor.value.terrain.cellCount,401800);
 // Crash loudly if any pristine Cell materialization sneaks into the measured path.
 descriptor.value.terrain.cell=()=>{throw new Error('City benchmark must not materialize any ground Cell');};
 const build=timed(()=>new CompactSupport(structures,descriptor.value)),afterBuild=memory();
 const initial=timed(()=>build.value.unsupported());assert.deepEqual(initial.value,[]);
 const locations=[...buildings.values()],steps=[];
 for(let i=0;i<20;i++){
  const b=locations[(i*7)%36],at:Point={x:(b.minX+b.maxX)/2,y:i%4===3?-5:-1,z:(b.minZ+b.maxZ)/2},radius=5.5+(i%3)*1.2;
  const remove=timed(()=>build.value.removeSphere(at,radius));
  const query=timed(()=>build.value.unsupported());
  const detachedIds=query.value.flatMap(p=>p.cells);
  // These are reported static-disconnected members, not promoted/moving bodies.
  steps.push({step:i+1,at,radius,removedCells:remove.value,removeMs:remove.ms,supportMs:query.ms,pieces:query.value.length,disconnectedCells:detachedIds.length,minimumMemberIds:query.value.map(p=>p.cells[0]),exactOrderedMembershipSha256:createHash('sha256').update(JSON.stringify(query.value)).digest('hex')});
 }
 const afterCuts=memory(),diagnostics=build.value.diagnostics();
 assert.equal(diagnostics.allocations.groundCellObjects,0);assert.equal(diagnostics.allocations.neighborObjects,0);
 return {scope:'isolated static full-city topology only; no Rapier world, rendering, browser, startup or frame-rate claim',node:process.version,platform:process.platform,buildings:buildings.size,legacyColumns:descriptor.value.legacyColumns,
  coverage:{terrainCells:401800,structureCells:53113,totalCells:454913,initialUnsupported:initial.value.length,allStructuresExactlyMatchProduction:'verified in compact-support.test.ts; production source is not invoked in this benchmark'},
  timings:{descriptorSetupMs:descriptor.ms,sparseStructureGenerationMs:source.ms,supportBuildMs:build.ms,initialSupportMs:initial.ms,removals:summary(steps.map(s=>s.removeMs)),supportQueries:summary(steps.map(s=>s.supportMs))},
  memory:{gcAvailable:typeof global.gc==='function',baseline,descriptorMemory,sourceMemory,afterBuild,afterCuts,descriptorDelta:delta(baseline,descriptorMemory),sparseStructureDelta:delta(descriptorMemory,sourceMemory),supportBuildDelta:delta(sourceMemory,afterBuild),note:'Requested --expose-gc; process snapshots after global.gc when available, not exact JS allocation counts, not peak RSS. Sparse Cell specs remain held in the benchmark. Map and object overhead are excluded from exact typed-buffer accounting.'},
  sourceAllocations:{...source.value.allocations,note:'Logical representation counts, not total JS/V8 allocations; duplicate column writes, local building Maps and temporary position records are not individually instrumented.'},diagnostics,steps,
  caveats:['Full-city MIT graph is deliberately not generated here; equivalence is exact on bounded tests and 20-cut bounded A/B, with identical full-city initial content coverage.','Typed flood scans O(total indexed capacity), plus sorting returned member IDs; it is not a hierarchical incremental optimization.','Cuts are occupancy spheres, not gameplay HP/impulse/chain-impact evaluation. Unsupported cells remain in static graph until explicit departure; this run only queries them.','No whole-city metadata array, render Entries, neighbor arrays, native bodies or native colliders are constructed.','JS Maps retain two entries per structure cell. Terrain descriptor and source generator still have column-scale/transient allocations, reported separately.']};
}
console.log(JSON.stringify(process.argv[2]==='small'?small():city(),null,2));
