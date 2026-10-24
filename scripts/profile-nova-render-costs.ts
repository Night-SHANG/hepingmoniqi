/** Bounded CPU-only audit. No native simulation, browser, WebGL, or gameplay writes.
 * Run: node --import tsx scripts/profile-nova-render-costs.ts
 * Synthetic inputs measure current production functions, not actual city frame cost.
 */
import * as THREE from 'three';
import {EffectTimeline} from '../src/structural/effects';
import {StructuralEffects} from '../src/structural/effect-renderer';
import {createCompactSurfaceRenderer} from '../src/compact/surface-renderer';
import type {CompactSurfaceSource, SurfaceEdit} from '../src/compact/surface-source';

function measure(name:string, run:(i:number)=>void, count=100) {
 for(let i=0;i<20;i++)run(i);
 const times:number[]=[];
 for(let i=0;i<count;i++){const start=performance.now();run(i);times.push(performance.now()-start);}
 times.sort((a,b)=>a-b);
 return {name,samples:count,p50Ms:times[Math.floor(count*.5)],p95Ms:times[Math.floor(count*.95)],maxMs:times[count-1],meanMs:times.reduce((a,b)=>a+b,0)/count};
}
const effects=[];
for(const impactCount of [0,47,1023,8191]) {
 const scene=new THREE.Scene(), renderer=new StructuralEffects(scene), timeline=new EffectTimeline();
 timeline.add({id:'primary',epoch:1,kind:'detonation',tool:'nova',scale:48,position:{x:0,y:0,z:0}});
 for(let i=0;i<impactCount;i++)timeline.add({id:`impact:${i}`,epoch:1,kind:'impact',tool:'nova',scale:.4,position:{x:i%50,y:1,z:Math.floor(i/50)%50}});
 timeline.step(.5);
 const frames=timeline.frames();renderer.update(frames);
 const prepare=measure('two frames() clones plus diagnostic projection, matching scene frame shape',()=>{timeline.frames().map(f=>({id:f.id,kind:f.kind,tool:f.tool,age:f.age}));timeline.frames();});
 const update=measure('renderer.update(existing frozen-age frames)',()=>renderer.update(frames));
 const combined=measure('diagnostics clone + fresh frames + renderer update',()=>{timeline.frames().map(f=>({id:f.id,kind:f.kind,tool:f.tool,age:f.age}));renderer.update(timeline.frames());});
 let totalWrites=0,hiddenWrites=0;
 const original=THREE.InstancedMesh.prototype.setMatrixAt;
 THREE.InstancedMesh.prototype.setMatrixAt=function(index:number,matrix:THREE.Matrix4){totalWrites++;if(!this.visible)hiddenWrites++;original.call(this,index,matrix);};
 try {renderer.update(frames);} finally {THREE.InstancedMesh.prototype.setMatrixAt=original;}
 let visibleDraws=0,visibleTriangles=0,alphaHashDraws=0,transparentDraws=0;
 scene.traverse(object=>{if(!(object instanceof THREE.Mesh)||!object.visible)return;visibleDraws++;const count=object instanceof THREE.InstancedMesh?object.count:1;visibleTriangles+=(object.geometry.index?.count??object.geometry.getAttribute('position').count)/3*count;const material=object.material as THREE.Material;if(material.alphaHash)alphaHashDraws++;if(material.transparent)transparentDraws++;});
 effects.push({liveEvents:timeline.activeCount,renderedEvents:scene.children.length,totalMatrixWritesPerSameAgeFrame:totalWrites,hiddenLayerMatrixWrites:hiddenWrites,visibleDraws,visibleTriangles,alphaHashDraws,transparentDraws,prepare,update,combined});
 renderer.dispose();
}

// One complete, synthetic 32^3 static chunk, not a second game world.
const side=32,cellCount=side**3,gone=new Set<number>(),hp=new Map<number,number>();
const position=(id:number)=>({x:Math.floor(id/(side*side)),y:Math.floor(id/side)%side,z:id%side});
const source:CompactSurfaceSource={bounds:{minX:0,maxX:31,minY:0,maxY:31,minZ:0,maxZ:31},
 staticIdAt(x,y,z){if(x<0||x>=side||y<0||y>=side||z<0||z>=side)return null;const id=(x*side+y)*side+z;return gone.has(id)?null:id;},
 colorOf:()=>0x8899aa,hpOf:id=>hp.get(id)??10,maxHpOf:()=>10,forEachChunk(_size,visit){visit(0,0,0);}};
const scene=new THREE.Scene(),box=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial();
const surface=createCompactSurfaceRenderer(scene,box,material,{chunkSize:32});surface.bind(source);
const history=[];let revision=0,prior=0;
for(const n of [0,1024,16384,32768]) {
 const edits:SurfaceEdit[]=[];
 for(let id=prior;id<n;id++){hp.set(id,9);edits.push({id,revision:++revision,position:position(id),appearanceChanged:true,topologyChanged:false});}
 surface.applyEdits(edits);surface.flush();prior=n;
 history.push({historicalIds:n,diagnostics:measure('getDiagnostics twice, matching setCompactWorld',()=>{surface.getDiagnostics();surface.getDiagnostics();}),noDirtyFlush:measure('no-dirty flush only',()=>{surface.flush();})});
}
const center=(16*side+16)*side+16;
const topology=measure('one center-cell topology toggle, full chunk rebuild',()=>{if(gone.has(center))gone.delete(center);else gone.add(center);surface.applyEdits([{id:center,revision:++revision,position:position(center),topologyChanged:true,appearanceChanged:true}]);surface.flush();},40);
const topologyReport={...surface.getDiagnostics().lastRebuild};
const colors=measure('one-cell HP change, full chunk color refresh',()=>{hp.set(0,hp.get(0)===9?8:9);surface.applyEdits([{id:0,revision:++revision,position:position(0),topologyChanged:false,appearanceChanged:true}]);surface.flush();},40);
const colorsReport={...surface.getDiagnostics().lastRebuild};
surface.dispose();box.dispose();material.dispose();
console.log(JSON.stringify({scope:'CPU-only production render preparation; synthetic bounded inputs; no native world, browser, GPU, uploads, or actual city damage. Timings may overlap other workers. Not end-to-end nova timing.',effects,surface:{syntheticCells:cellCount,history,topology,topologyReport,colors,colorsReport}},null,2));
