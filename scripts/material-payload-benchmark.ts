/** Isolated CPU payload accounting and expanded occupied-face verification.
 * Safe small default: node --expose-gc --import tsx scripts/material-payload-benchmark.ts
 * Intact city: append --intact-only
 * Actual nova (one coordinated native world):
 * node --import tsx --import ./scripts/register-compact-test-assets.mjs scripts/material-payload-benchmark.ts --actual-nova
 * No GPU/upload/FPS, support settlement or complete gameplay equivalence claim.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createCompactGameFixture} from '../src/compact/fixture.js';
import {CompactAuthorityStore} from '../src/compact/store.js';
import {createCompactSurfaceSource} from '../src/compact/surface-source.js';
import {buildChunk,type ChunkMesh} from '../src/worker-slice/chunk-mesh.js';
import {buildMaterialGreedyChunk,type MaterialSurfaceSource} from '../src/material-slice/geometry.js';
import {buildCellColorData,sampleCellColor,CELL_COLOR_FLOAT32_TOLERANCE,type CellColorData} from '../src/material-slice/cell-colors.js';
import type {StructuralCompactQueries} from '../src/structural/types.js';

const size=32;
const round=(n:number)=>Math.round(n*1000)/1000;
function expanded(mesh:ChunkMesh,source?:MaterialSurfaceSource){
 const keys=new Set<string>(),stride=mesh.index?4:6;
 for(let face=0;face<mesh.faces;face++){
  const start=face*stride*3,n=Array.from(mesh.normal.slice(start,start+3)),axis=n.findIndex(x=>x!==0),t=[0,1,2].filter(a=>a!==axis),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity],materials=new Set<string|undefined>();
  for(let v=0;v<stride;v++)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],mesh.position[start+v*3+a]);hi[a]=Math.max(hi[a],mesh.position[start+v*3+a]);}
  for(let u=lo[t[0]]+.5;u<hi[t[0]];u++)for(let v=lo[t[1]]+.5;v<hi[t[1]];v++){
   const p=[0,0,0];p[axis]=lo[axis];p[t[0]]=u;p[t[1]]=v;const key=[...p,...n].join(',');assert.ok(!keys.has(key),'Overlapping emitted unit faces');keys.add(key);
   if(source){const owner=p.map((value,a)=>value-n[a]*.5),id=source.staticIdAt(...owner as [number,number,number]);assert.notEqual(id,null,'Every face must have an occupied authority cell');materials.add(source.materialOf(id!));}
  }
  if(source)assert.equal(materials.size,1,'A greedy quad must not cross material boundaries');
 }
 return [...keys].sort();
}
function verifyColors(oracle:ChunkMesh,data:CellColorData){
 let samples=0,mismatchedSamples=0,maxAbsoluteChannelError=0;
 for(let face=0;face<oracle.faces;face++){
  const start=face*18,n=Array.from(oracle.normal.slice(start,start+3)),axis=n.findIndex(x=>x!==0),t=[0,1,2].filter(a=>a!==axis),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let v=0;v<6;v++)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],oracle.position[start+v*3+a]);hi[a]=Math.max(hi[a],oracle.position[start+v*3+a]);}
  for(const [du,dv] of [[0,0],[.19,.31],[-.23,-.17]]){
   const p=lo.map((v,a)=>(v+hi[a])/2);p[t[0]]+=du;p[t[1]]+=dv;
   const actual=sampleCellColor(data,{x:p[0],y:p[1],z:p[2]},{x:n[0],y:n[1],z:n[2]});assert.notEqual(actual,null,'Every occupied face probe must resolve a color');
   let mismatch=false;for(let a=0;a<3;a++){const error=Math.abs(actual![a]-oracle.color[start+a]);maxAbsoluteChannelError=Math.max(maxAbsoluteChannelError,error);if(error!==0)mismatch=true;assert.ok(error<=CELL_COLOR_FLOAT32_TOLERANCE,`Cell channel error ${error} exceeds ${CELL_COLOR_FLOAT32_TOLERANCE}`);}
   samples++;if(mismatch)mismatchedSamples++;
  }
 }
 return {samples,mismatchedSamples,maxAbsoluteChannelError};
}

/** The actual transferable typed-array byte total, not a geometry-only estimate.
 * Palette row padding, interior air indices and optional HP shade are included.
 * JSON/object metadata and JS scratch allocations are outside this byte metric.
 * Empty geometry is a mesh deletion and deliberately carries no color payload.
 */
export function measureMaterialPayload(source:MaterialSurfaceSource,label:string,verify=true){
 const gcAvailable=typeof globalThis.gc==='function',retained:unknown[]=[];
 const memorySnapshot=()=>{if(gcAvailable)globalThis.gc!();const {rss,heapUsed,heapTotal,external,arrayBuffers}=process.memoryUsage();return {rss,heapUsed,heapTotal,external,arrayBuffers};};
 const before=memorySnapshot();
 const chunks:Record<string,unknown>[]=[],totals={chunks:0,nonemptyChunks:0,unitFaces:0,quads:0,baselineVertices:0,indexedVertices:0,indexElements:0,baselineBytes:0,geometryBytes:0,indexTextureBytes:0,paletteTextureBytes:0,shadeTextureBytes:0,totalTextureBytes:0,totalPayloadBytes:0,occupiedTexels:0,airTexels:0,shadedChunks:0,baselineBuildMs:0,geometryBuildMs:0,colorDataBuildMs:0,largestTotalChunkBytes:0,largestGeometryTypedScratchBytes:0},colors={samples:0,mismatchedSamples:0,maxAbsoluteChannelError:0},hash=createHash('sha256');
 source.forEachChunk(size,(x,y,z)=>{
  const key=`${x},${y},${z}`;let start=performance.now();const baseline=buildChunk(source,key,size),baselineMs=performance.now()-start;
  start=performance.now();const geometry=buildMaterialGreedyChunk(source,key,size),geometryMs=performance.now()-start;
  start=performance.now();const data=geometry.faces?buildCellColorData(source,key,size):null,colorDataMs=performance.now()-start;
  assert.equal(geometry.unitFaces,baseline.faces,`${label}/${key}: occupied boundary area`);assert.deepEqual(geometry.bounds,baseline.bounds);
  const geometryArrays=[geometry.position,geometry.normal,geometry.color,geometry.index],textureArrays=data?[data.paletteIndex,data.palette,...(data.shade?[data.shade]:[])]:[],allArrays=[...geometryArrays,...textureArrays];
  for(const array of allArrays){assert.equal(array.byteOffset,0);assert.equal(array.byteLength,array.buffer.byteLength);}assert.equal(new Set(allArrays.map(array=>array.buffer)).size,allArrays.length);
  const geometryBytes=geometryArrays.reduce((sum,array)=>sum+array.byteLength,0),textureBytes=textureArrays.reduce((sum,array)=>sum+array.byteLength,0),totalPayloadBytes=geometryBytes+textureBytes;
  assert.equal(geometryBytes,geometry.stats.outputBytes);if(data)assert.equal(textureBytes,data.stats.totalTextureBytes);retained.push(geometry,data);
  if(verify){const expected=expanded(baseline),actual=expanded(geometry,source);assert.deepEqual(actual,expected,`${label}/${key}: exact expanded occupied unit faces`);hash.update(key);hash.update(JSON.stringify(actual));if(data){const checked=verifyColors(baseline,data);colors.samples+=checked.samples;colors.mismatchedSamples+=checked.mismatchedSamples;colors.maxAbsoluteChannelError=Math.max(colors.maxAbsoluteChannelError,checked.maxAbsoluteChannelError);}}
  const row={key,unitFaces:baseline.faces,quads:geometry.faces,baselineBytes:baseline.stats.outputBytes,geometryBytes,indexTextureBytes:data?.paletteIndex.byteLength??0,paletteTextureBytes:data?.palette.byteLength??0,shadeTextureBytes:data?.shade?.byteLength??0,totalTextureBytes:textureBytes,totalPayloadBytes,occupiedTexels:data?.stats.occupiedCells??0,airTexels:data?.stats.airTexels??0,colorDataOrigin:data?.origin??null,colorDataDimensions:data?.dimensions??null,baselineBuildMs:round(baselineMs),geometryBuildMs:round(geometryMs),colorDataBuildMs:round(colorDataMs),geometryTypedScratchBytes:geometry.stats.temporaryBytes};chunks.push(row);
  totals.chunks++;if(geometry.faces)totals.nonemptyChunks++;if(data?.shade)totals.shadedChunks++;
  totals.unitFaces+=baseline.faces;totals.quads+=geometry.faces;totals.baselineVertices+=baseline.position.length/3;totals.indexedVertices+=geometry.position.length/3;totals.indexElements+=geometry.index.length;
  totals.baselineBytes+=row.baselineBytes;totals.geometryBytes+=geometryBytes;totals.indexTextureBytes+=row.indexTextureBytes;totals.paletteTextureBytes+=row.paletteTextureBytes;totals.shadeTextureBytes+=row.shadeTextureBytes;totals.totalTextureBytes+=textureBytes;totals.totalPayloadBytes+=totalPayloadBytes;totals.occupiedTexels+=row.occupiedTexels;totals.airTexels+=row.airTexels;
  totals.baselineBuildMs+=baselineMs;totals.geometryBuildMs+=geometryMs;totals.colorDataBuildMs+=colorDataMs;totals.largestTotalChunkBytes=Math.max(totals.largestTotalChunkBytes,totalPayloadBytes);totals.largestGeometryTypedScratchBytes=Math.max(totals.largestGeometryTypedScratchBytes,geometry.stats.temporaryBytes);
 });
 const afterBuildRetained=memorySnapshot();retained.length=0;const afterRelease=memorySnapshot();
 const memory={gcAvailable,gcInvoked:gcAvailable,sampleKind:gcAvailable?'explicit-gc-endpoints':'uncollected-endpoints',retainedPayloadArrayBytes:totals.totalPayloadBytes,before,afterBuildRetained,afterRelease,retainedDeltas:{heapUsed:afterBuildRetained.heapUsed-before.heapUsed,arrayBuffers:afterBuildRetained.arrayBuffers-before.arrayBuffers,external:afterBuildRetained.external-before.external,rss:afterBuildRetained.rss-before.rss},description:'Node process endpoints. All built current geometry and cell-data payloads are retained for the middle sample, then released. With no exposed GC these are NOT retained-heap measurements. Includes report rows and surrounding authority/runtime overhead; not GPU memory, bounded worker credit occupancy or update bandwidth.'};
 return {label,memory,totals:{...totals,baselineBuildMs:round(totals.baselineBuildMs),geometryBuildMs:round(totals.geometryBuildMs),colorDataBuildMs:round(totals.colorDataBuildMs),combinedBuildMs:round(totals.geometryBuildMs+totals.colorDataBuildMs),totalByteReductionPercent:totals.baselineBytes?round(100*(1-totals.totalPayloadBytes/totals.baselineBytes)):0,quadReductionPercent:totals.unitFaces?round(100*(1-totals.quads/totals.unitFaces)):0},exactExpandedOccupiedFaceParity:verify,materialBoundaryParity:verify,expandedOccupiedFaceSha256:verify?hash.digest('hex'):null,cpuColorVerification:verify?{...colors,tolerance:CELL_COLOR_FLOAT32_TOLERANCE,exactFinalFloat32Colors:colors.mismatchedSamples===0,description:'Three probes per exposed unit face, original object-space coordinates. This is CPU lookup/formula evidence, not rendered pixel evidence.'}:null,chunks};
}
function scalars(binding:StructuralCompactQueries){
 const fixture=binding.fixture,rows=new Float64Array(fixture.count*5),materials=createHash('sha256');
 for(let ordinal=0;ordinal<fixture.count;ordinal++){const id=fixture.idAtOrdinal(ordinal)!,offset=ordinal*5;rows[offset]=id;rows[offset+1]=binding.source.hpOf(id);rows[offset+2]=binding.source.maxHpOf(id);rows[offset+3]=binding.source.colorOf(id);rows[offset+4]=binding.source.staticIdAt(fixture.xOf(id),fixture.yOf(id),fixture.zOf(id))??Infinity;materials.update(JSON.stringify(binding.source.materialOf(id))??'null');materials.update('\n');}
 return {scalarSha256:createHash('sha256').update(new Uint8Array(rows.buffer)).digest('hex'),materialSha256:materials.digest('hex')};
}
async function main(){
 const actualNova=process.argv.includes('--actual-nova'),intact=process.argv.includes('--intact-only');assert.ok(!(actualNova&&intact),'Choose intact-only or actual-nova, not both');
 const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9)??`artifacts/material-slice/${actualNova?'actual-nova':intact?'intact-city':'fixture'}-payload.json`;
 const report:Record<string,unknown>={schema:'material-cell-payload/v1',status:'running',startedAt:new Date().toISOString(),scope:'CPU geometry plus all palette/index/HP shade typed-array payload bytes. Geometry alone is NOT color-equivalent. No browser pixels, GPU upload, FPS, support-settlement or full gameplay-equivalence verdict. Single-pass build timings may share CPU with other work.',configuration:{chunkSize:size,indexType:'Uint32Array',mergeKey:'actual source.materialOf(id) plus face normal and plane',allTexturePaddingIncluded:true,emptyGeometryHasNoColorPayload:true,byteMetric:'Owned transferable typed arrays; excludes JSON/object metadata and JS scratch allocations.'}};
 const save=()=>{mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2));};
 if(actualNova){
  const {createStructuralGameWorld}=await import('../src/structural/game-world.js'),{TOOLS}=await import('../src/content-catalog.js'),world=createStructuralGameWorld({free:true});
  report.configuration={...(report.configuration as object),map:'city',target:{x:0,y:3,z:0},weapon:'nova',power:1,radius:TOOLS.nova.radius,strength:TOOLS.nova.strength,nativeWorlds:1};
  try{
   let start=performance.now();assert.equal(await world.loadMap('city',true),true);report.initializeMs=round(performance.now()-start);
   const initial=world.getRenderBinding()!;report.initial={revision:initial.revision,aggregate:initial.aggregate(),nativeBodies:world.physicsHost!.world.bodies.len(),nativeColliders:world.physicsHost!.world.colliders.len()};
   start=performance.now();const damage=world.damage({id:'material-cell-central-nova-1',epoch:world.epoch,target:{x:0,y:3,z:0},weapon:'nova',power:1,reward:false},{details:false});report.damageMs=round(performance.now()-start);assert.equal(damage.accepted,true);
   const binding=world.getRenderBinding()!;report.damage={accepted:damage.accepted,newlyDestroyed:damage.newlyDestroyed,researchEarned:damage.researchEarned,destruction:damage.destruction};report.afterDamage={revision:binding.revision,aggregate:binding.aggregate(),pending:world.pending(),nativeBodies:world.physicsHost!.world.bodies.len(),nativeColliders:world.physicsHost!.world.colliders.len()};
   report.beforeMeshing={...scalars(binding),revision:binding.revision,aggregate:binding.aggregate()};save();console.log(JSON.stringify({phase:'actual-nova-damaged',damage:report.damage,damageMs:report.damageMs}));
   const source:MaterialSurfaceSource={...createCompactSurfaceSource(binding.source),materialOf:id=>binding.source.materialOf(id)},measured=measureMaterialPayload(source,'actual-central-nova-immediate');report.measurement=measured;
   report.afterMeshing={...scalars(binding),revision:binding.revision,aggregate:binding.aggregate()};assert.deepEqual(report.afterMeshing,report.beforeMeshing,'Payload construction must not mutate HP, colors, materials, occupancy, revisions or aggregates');report.authorityScalarNonMutationVerified=true;report.status='complete';save();console.log(JSON.stringify({output,...measured.totals,colorVerification:measured.cpuColorVerification}));
  }catch(error){report.status='failed';report.error=String(error);save();throw error;}
  finally{world.suspend();report.nativeWorldDisposed=world.physicsHost===null;assert.equal(report.nativeWorldDisposed,true);report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({phase:'disposed',nativeWorldDisposed:report.nativeWorldDisposed}));}
 }else if(intact){
  const start=performance.now(),fixture=createCompactGameFixture('city'),store=new CompactAuthorityStore(fixture),source:MaterialSurfaceSource={...createCompactSurfaceSource(store),materialOf:id=>store.materialOf(id)};
  report.fixture={count:fixture.count,structureCount:fixture.structureCount,terrainCount:fixture.terrainCount,bounds:fixture.bounds,recipeSha256:createHash('sha256').update(fixture.recipeId).digest('hex'),fixtureBuildMs:round(performance.now()-start)};
  const measured=measureMaterialPayload(source,'intact-city');report.measurement=measured;assert.equal(store.diagnostics().mutableStates,0);report.authorityMutableStates=0;report.status='complete';report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({output,...measured.totals,colorVerification:measured.cpuColorVerification}));
 }else{
  const cells=Array.from({length:1024},(_,i)=>({x:i%32,y:0,z:Math.floor(i/32),color:[0x6d4229,0x8b9650,0xa8b4b8][i%3],hp:i%7===0?3.125:10})),source:MaterialSurfaceSource={bounds:{minX:0,maxX:31,minY:0,maxY:0,minZ:0,maxZ:31},staticIdAt:(x,y,z)=>y===0&&x>=0&&x<32&&z>=0&&z<32?z*32+x:null,colorOf:id=>cells[id].color,hpOf:id=>cells[id].hp,maxHpOf:()=>10,materialOf:()=>'concrete',forEachChunk:(_size,visit)=>visit(0,0,0)};
  const measured=measureMaterialPayload(source,'mixed-appearance-material-slab');report.measurement=measured;report.status='complete';report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({output,...measured.totals,colorVerification:measured.cpuColorVerification}));
 }
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)await main();
