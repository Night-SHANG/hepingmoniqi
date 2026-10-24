/** Native-only startup attribution. Run from the repository root:
 * node --import tsx --import ./scripts/register-compact-test-assets.mjs scripts/profile-compact-startup-phases.ts
 * This never starts a browser and never edits production code. Factory rounds
 * use production createStructuralGameWorld/createCompactSupport. A separately
 * labelled replay then times the exact runtime validation driver boundaries.
 */
import {performance} from 'node:perf_hooks';
import {readFile} from 'node:fs/promises';
import {Session} from 'node:inspector';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {createStructuralGameWorld} from '../src/structural/game-world.js';
import {createCompactGameFixture} from '../src/compact/fixture.js';
import type {CompactFixture} from '../src/compact/fixture.js';
import {CompactStaticColliders} from '../src/compact/static-colliders.js';
import {createCompactSupport} from '../src/compact/support/index.js';
import {CompactSupportLattice} from '../src/compact/support/lattice.js';
import {IndexedStructure} from '../src/compact/support/indexed-structure.js';
import {_topologyBytes,recipeDigestBrowser,sha256Browser} from '../src/compact/support/runtime.js';
import {_prepareDecode,_finishDecode,_preparePristine,_finishPristine,createPristineTokenFactory,writeTopology,MAX_COMPILED_BYTES,type CompiledManifest,type IdentifiedLattice} from '../src/compact/support/pristine-core.js';
import cityOracle from '../src/compact/support/city-cut-oracle.json';

type Metric={ms:number;calls:number};
const rounded=(n:number)=>Math.round(n*1000)/1000;
const result:any={scope:'Node native production compact city startup; no browser/render/network/FPS measurement',timingNotes:'Named phase timers can be nested: do not sum aggregate wrappers with their child phases. Replay includes separate proposal/parity/oracle work that is not production startup. CPU sample names reflect tsx transforms, not Vite browser cost.',factory:[],validationReplay:[]};
let metrics:Record<string,Metric>|undefined;
const add=(name:string,ms:number)=>{if(metrics){const m=metrics[name]??={ms:0,calls:0};m.ms+=ms;m.calls++;}};
const restores:Array<()=>void>=[];
function wrap(target:any,key:string,name:string){const original=target[key];target[key]=function(...args:any[]){const at=performance.now();try{return original.apply(this,args);}finally{add(name,performance.now()-at);}};restores.push(()=>target[key]=original);}
const time=<T>(name:string,fn:()=>T):T=>{const at=performance.now();try{return fn();}finally{add(name,performance.now()-at);}};
const timeAsync=async<T>(name:string,fn:()=>Promise<T>):Promise<T>=>{const at=performance.now();try{return await fn();}finally{add(name,performance.now()-at);}};
const report=()=>Object.fromEntries(Object.entries(metrics!).map(([name,m])=>[name,{ms:rounded(m.ms),calls:m.calls}]));

/** Measurement-only proposal. One canonical writeTopology pass into a bounded
 * geometrically growing byte buffer; only a small suffix reserve is overallocated
 * for the real city. It retains no topology objects or neighbor slots. */
function onePassTopology(source:IdentifiedLattice):Uint8Array<ArrayBuffer>{
 const minimum=20+28*source.count+9;
 if(!Number.isSafeInteger(source.count)||source.count<0||source.count>=2**31||minimum>MAX_COMPILED_BYTES)throw new Error('Topology byte capacity exceeded');
 let bytes=new Uint8Array(Math.min(MAX_COMPILED_BYTES,minimum+4096)),at=0;
 writeTopology(source,batch=>{
  const required=at+batch.length;if(required>MAX_COMPILED_BYTES)throw new Error('Topology byte capacity exceeded');
  if(required>bytes.length){const grown=new Uint8Array(Math.min(MAX_COMPILED_BYTES,Math.max(required,bytes.length*2)));grown.set(bytes);bytes=grown;}
  bytes.set(batch,at);at=required;
 });
 return bytes.subarray(0,at);
}

/** Measurement-only exact city fast path. Terrain is still implicit: two scalar
 * columns per x/z, not eight layers of per-cell state or neighbor tables. All
 * inferred column strides and contiguous structure IDs are proved against the
 * supplied fixture before use. A production variant needs generic fallback. */
class FastCityLattice extends CompactSupportLattice {
 private readonly sx:Int32Array;private readonly sy:Int32Array;private readonly sz:Int32Array;
 private readonly tops:Int32Array;private readonly strides:Int32Array;private readonly depth:number;
 private readonly firstStructureId:number;
 constructor(fixture:CompactFixture){
  super(fixture);if(fixture.map!=='city')throw new Error('City prototype only');
  const b=fixture.bounds;this.depth=b.maxZ-b.minZ+1;
  this.tops=new Int32Array((b.maxX-b.minX+1)*this.depth);this.strides=new Int32Array(this.tops.length);
  this.firstStructureId=super.id(this.groundCount);
  this.sx=new Int32Array(fixture.structureCount);this.sy=new Int32Array(fixture.structureCount);this.sz=new Int32Array(fixture.structureCount);
  for(let j=0;j<fixture.structureCount;j++){
   const id=super.id(this.groundCount+j);if(id!==this.firstStructureId+j)throw new Error('Noncontiguous city IDs');
   this.sx[j]=fixture.xOf(id);this.sy[j]=fixture.yOf(id);this.sz[j]=fixture.zOf(id);
  }
  for(let x=b.minX;x<=b.maxX;x++)for(let z=b.minZ;z<=b.maxZ;z++){
   const column=(x-b.minX)*this.depth+z-b.minZ,top=super.index(fixture.idAt(x,-1,z)!),stride=super.index(fixture.idAt(x,-2,z)!)-top;
   this.tops[column]=top;this.strides[column]=stride;
   for(let y=-1;y>=-8;y--)if(super.index(fixture.idAt(x,y,z)!)!==top+(-1-y)*stride)throw new Error('Nonlinear terrain column');
  }
 }
 override index(id:number):number{
  if(Number.isSafeInteger(id)&&id<0&&id>=-this.groundCount)return id+this.groundCount;
  const j=id-this.firstStructureId;return Number.isInteger(j)&&j>=0&&j<this.sx.length?this.groundCount+j:-1;
 }
 override position(i:number){
  if(i>=this.groundCount){const j=i-this.groundCount;return {x:this.sx[j],y:this.sy[j],z:this.sz[j]};}
  return super.position(i);
 }
 override anchor(i:number):boolean{
  if(i>=this.groundCount)return super.anchor(i);
  const id=i-this.groundCount;if(this.fixture.yOf(id)!==-8)return false;
  const b=this.fixture.bounds,x=this.fixture.xOf(id),z=this.fixture.zOf(id);return x===b.minX||x===b.maxX||z===b.minZ||z===b.maxZ;
 }
 private at(x:number,y:number,z:number):number{
  const b=this.fixture.bounds;if(x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ||y< -8||y>b.maxY)return -1;
  if(y<0){const col=(x-b.minX)*this.depth+z-b.minZ;return this.tops[col]+(-1-y)*this.strides[col];}
  const id=this.fixture.idAt(x,y,z);return id===null?-1:this.index(id);
 }
 override neighbours(i:number,fn:(neighbor:number,axis:number)=>void):void{
  let x:number,y:number,z:number;
  if(i>=this.groundCount){const j=i-this.groundCount;x=this.sx[j];y=this.sy[j];z=this.sz[j];}
  else{const id=i-this.groundCount;x=this.fixture.xOf(id);y=this.fixture.yOf(id);z=this.fixture.zOf(id);}
  let n=this.at(x-1,y,z);if(n>=0)fn(n,0);n=this.at(x+1,y,z);if(n>=0)fn(n,1);
  n=this.at(x,y-1,z);if(n>=0)fn(n,2);n=this.at(x,y+1,z);if(n>=0)fn(n,3);
  n=this.at(x,y,z-1);if(n>=0)fn(n,4);n=this.at(x,y,z+1);if(n>=0)fn(n,5);
 }
 extraBytes(){return this.sx.byteLength+this.sy.byteLength+this.sz.byteLength+this.tops.byteLength+this.strides.byteLength;}
}

function verifyTwentyCuts(fixture:CompactFixture,source:FastCityLattice,graph:IndexedStructure):void{
 const bounds=new Map<string,{minX:number;maxX:number;minZ:number;maxZ:number}>();
 for(let n=0;n<fixture.structureCount;n++){
  const id=fixture.idAtOrdinal(n)!,role=fixture.roleOf(id);if(role!=='building'&&role!=='foundation')continue;
  const name=fixture.objectIdOf(id)!,x=fixture.xOf(id),z=fixture.zOf(id),b=bounds.get(name);
  if(b){b.minX=Math.min(b.minX,x);b.maxX=Math.max(b.maxX,x);b.minZ=Math.min(b.minZ,z);b.maxZ=Math.max(b.maxZ,z);}else bounds.set(name,{minX:x,maxX:x,minZ:z,maxZ:z});
 }
 const locations=[...bounds.values()];assert.equal(locations.length,36);
 for(let i=0;i<20;i++){
  const b=locations[(i*7)%36],at={x:(b.minX+b.maxX)/2,y:i%4===3?-5:-1,z:(b.minZ+b.maxZ)/2},radius=5.5+(i%3)*1.2;
  const before=graph.diagnostics().liveMembers;graph.leave(fixture.idsInSphere(at,radius).map(id=>source.index(id)));
  assert.equal(before-graph.diagnostics().liveMembers,cityOracle.steps[i].removedCells,`cut ${i+1} count`);
  const pieces=graph.unsupported().map(piece=>{const cells=piece.voxels.map(i=>source.id(i)).sort((a,b)=>a-b);return {id:`unsupported-${cells[0]}`,cells};}).sort((a,b)=>a.cells[0]-b.cells[0]);
  const hash=createHash('sha256').update(JSON.stringify(pieces)).digest('hex');assert.equal(hash,cityOracle.steps[i].exactOrderedMembershipSha256,`cut ${i+1} ordered membership`);
 }
}

wrap(CompactStaticColliders.prototype,'pack','colliders.pack');
wrap(CompactStaticColliders.prototype,'add','colliders.add');
wrap(CompactStaticColliders.prototype,'flush','colliders.flush');
wrap(RAPIER.World.prototype,'createCollider','rapier.createCollider');
wrap(IndexedStructure,'fromPristine','support.hydrate');
wrap(IndexedStructure.prototype,'unsupported','support.initialUnsupported');

try{
 for(let round=0;round<2;round++){
  metrics={};let beforeSupport=0,afterSupport=0,fixture:any;
  const start=performance.now();
  const world=createStructuralGameWorld({free:true,compactSupportFactory:async store=>{
   beforeSupport=performance.now();fixture=store.fixture;
   // Managed fixtures are deliberately frozen. Collider pack/add and native
   // createCollider prototype timers remain separate; do not patch the source.
   const support=await timeAsync('support.productionTotal',()=>createCompactSupport(store));
   afterSupport=performance.now();return support;
  }});
  try{
   await world.loadMap('city',true);const end=performance.now(),binding=world.getRenderBinding()!;
   const entry={round,totalMs:rounded(end-start),beforeSupportMs:rounded(beforeSupport-start),afterSupportMs:rounded(end-afterSupport),phases:report(),authority:{count:binding.fixture.count,terrain:binding.fixture.terrainCount,structures:binding.fixture.structureCount,aggregate:binding.aggregate(),storage:binding.diagnostics()}};
   result.factory.push(entry);console.log(JSON.stringify({factory:entry}));
  }finally{metrics=undefined;world.suspend();}
 }

 if(!process.argv.includes('--factory-only'))for(let round=0;round<2;round++){
  metrics={};const at=performance.now();
  const fixture=time('fixture.create',()=>createCompactGameFixture('city'));
  const root=new URL('../src/compact/support/assets/',import.meta.url);
  const [artifactBytes,manifest]=await timeAsync('asset.read',()=>Promise.all([readFile(new URL('city-seed-11.bin',root)),readFile(new URL('city-seed-11.manifest.json',root),'utf8')]));
  const expectation:CompiledManifest=time('asset.manifestJSON',()=>JSON.parse(manifest));
  const source=time('support.lattice',()=>new CompactSupportLattice(fixture));
  const prepared=time('decode.prepareCopy',()=>_prepareDecode(artifactBytes,expectation));
  const decodeHashes=await timeAsync('decode.hashes',async()=>{
   const [recipe,expectedRecipe,payload]=await Promise.all([recipeDigestBrowser(prepared.manifest),recipeDigestBrowser(prepared.expected),sha256Browser(prepared.bytes.subarray(prepared.offset))]);
   return {recipe,expectedRecipe,payload};
  });
  const decoded=time('decode.finishTables',()=>_finishDecode(prepared,decodeHashes));
  const validation=time('validate.prepareCopyAndPack',()=>_preparePristine(source,decoded));
  const topology=time('validate.topologyEncode',()=>_topologyBytes(source));
  const onePass=time('proposal.topologyEncodeOnePass',()=>onePassTopology(source));
  if(Buffer.compare(topology,onePass)!==0)throw new Error('One-pass topology proposal changed canonical bytes');
  const hashes=await timeAsync('validate.hashes',async()=>{
   const [recipe,topologyHash,payload]=await Promise.all([recipeDigestBrowser(validation.manifest),sha256Browser(topology),sha256Browser(validation.packed.bytes)]);
   return {recipe,topology:topologyHash,payload};
  });
  const inspector=new Session();inspector.connect();
  const post=(method:string,params:object={})=>new Promise<any>((resolve,reject)=>inspector.post(method as any,params,(err,value)=>err?reject(err):resolve(value)));
  await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:1000});await post('Profiler.start');
  const token=time('validate.semanticGraph',()=>_finishPristine(validation,hashes));
  const {profile}=await post('Profiler.stop');inspector.disconnect();
  const next=time('hydrate.createResetTemplate',()=>createPristineTokenFactory(source,token));
  const fresh=time('hydrate.cloneResetTables',()=>next());
  const graph=time('hydrate.graph',()=>IndexedStructure.fromPristine(source,fresh));
  const unsupported=time('hydrate.initialUnsupported',()=>graph.unsupported());
  if(unsupported.length)throw new Error('Production pristine city unexpectedly unsupported');
  const fast=time('proposal.fastLatticeBuild',()=>new FastCityLattice(fixture));
  const fastTopology=time('proposal.fastTopologyOnePass',()=>onePassTopology(fast));
  assert.equal(Buffer.compare(topology,fastTopology),0,'Fast lattice changed canonical topology bytes');
  // Full neighbor parity independently proves every ordered adjacency, not just
  // hashes that do not themselves encode neighboring edges.
  time('proposal.verifyAllNeighborParity',()=>{for(let i=0;i<source.count;i++){
   const a:number[]=[],b:number[]=[];source.neighbours(i,(n,axis)=>a.push(n,axis));fast.neighbours(i,(n,axis)=>b.push(n,axis));assert.deepEqual(b,a);
  }});
  const fastPrepared=time('proposal.fastPrepareValidation',()=>_preparePristine(fast,decoded));
  const fastToken=time('proposal.fastSemanticGraph',()=>_finishPristine(fastPrepared,hashes));
  const fastGraph=time('proposal.fastHydrate',()=>IndexedStructure.fromPristine(fast,fastToken));
  time('proposal.verifyTwentyCutOracle',()=>verifyTwentyCuts(fixture,fast,fastGraph));
  const hitById=new Map<number,number>();for(let i=0;i<profile.samples.length;i++){const id=profile.samples[i];hitById.set(id,(hitById.get(id)??0)+(profile.timeDeltas[i]??1000));}
  const samples=profile.nodes.map((node:any)=>({name:node.callFrame.functionName||'(anonymous)',url:node.callFrame.url,line:node.callFrame.lineNumber+1,selfMs:rounded((hitById.get(node.id)??0)/1000)})).filter((n:any)=>n.selfMs>0).sort((a:any,b:any)=>b.selfMs-a.selfMs).slice(0,20);
  const entry={round,totalMs:rounded(performance.now()-at),artifactBytes:artifactBytes.length,topologyBytes:topology.byteLength,onePassExtraCapacity:onePass.buffer.byteLength-onePass.byteLength,fastLatticeExtraBytes:fast.extraBytes(),proposalVerification:{canonicalTopologyBytes:true,allOrderedNeighbors:true,twentyCutOracle:true},phases:report(),semanticCpuSamples:samples};
  result.validationReplay.push(entry);console.log(JSON.stringify({validationReplay:entry}));metrics=undefined;
 }
 console.log(JSON.stringify(result,null,2));
}finally{metrics=undefined;for(const restore of restores.reverse())restore();}
