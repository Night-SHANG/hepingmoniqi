import {buildMaterialPatch} from '../material-slice/patch.js';
import {createAuthorityRuntime} from './authority-runtime.js';
import type {AuthorityCommand,AuthorityEnvelope,AuthorityMessage,AuthoritySummary} from './protocol.js';
import {configureCompactSupportAssetLoader} from '../compact/support/index.js';
import {loadCompactSupportAsset} from '../compact/support/assets.js';
import {createCompactSurfaceSource,type CompactSurfaceSource} from '../compact/surface-source.js';
import type {StructuralCompactQueries} from '../structural/types.js';
import {MeshCreditQueue,type MeshPatchHeader} from './mesh-credit-queue.js';
import {buildGreedyChunk} from '../regional-slice/greedy-chunk-mesh.js';
import {buildChunk} from './chunk-mesh.js';
const scope=globalThis as unknown as {postMessage:(message:unknown,transfer?:Transferable[])=>void;onmessage:((event:MessageEvent)=>void)|null};
configureCompactSupportAssetLoader(loadCompactSupportAsset);
const now=()=>performance.timeOrigin+performance.now();
let binding:StructuralCompactQueries|null=null,source:CompactSurfaceSource|null=null,queue:MeshCreditQueue|null=null,cursor:number|undefined,epoch=0,generation=0,lastSummary:AuthoritySummary|null=null,lastStats=0;
let meshMode:'baseline'|'greedy'|'material'='baseline';let statsInFlight=false,statsSequence=0;let lastOversized='';let registered=new Set<string>();let buildCount=0,buildMs=0,maxBuildMs=0;const size=32;
function committed(next:StructuralCompactQueries,_events:unknown,summary:AuthoritySummary){
 lastSummary=summary;const env:AuthorityEnvelope={worldId:summary.worldId,epoch:summary.epoch,sequence:summary.sequence,mapRecipeHash:summary.mapRecipeHash};
 if(binding!==next||epoch!==summary.epoch||generation!==next.source.generation){
  binding=next;source=createCompactSurfaceSource(next.source);epoch=summary.epoch;generation=next.source.generation;cursor=next.revision;
  const keys:string[]=[];next.fixture.forEachChunk(size,(x,y,z)=>keys.push(`${x},${y},${z}`));registered=new Set(keys);queue?.dispose();queue=new MeshCreditQueue({envelope:env,chunkKeys:keys});for(const key of keys)queue.markDirty(key,next.revision,now());
  scope.postMessage({kind:'mesh-reset',...env,keys,bounds:next.fixture.bounds,mapId:next.fixture.map,at:now()});return;
 }
 queue!.setEnvelope(env);const batch=next.changesSince(cursor);cursor=batch.revision;
 if(batch.reset){next.fixture.forEachChunk(size,(x,y,z)=>queue!.markDirty(`${x},${y},${z}`,batch.revision,now()));return;}
 for(const edit of batch.edits){if(!edit.topologyChanged&&!edit.appearanceChanged)continue;const {x,y,z}=edit.position,cx=Math.floor(x/size),cy=Math.floor(y/size),cz=Math.floor(z/size);const mark=(a:number,b:number,c:number)=>{const key=`${a},${b},${c}`;if(registered.has(key))queue!.markDirty(key,batch.revision,now());};mark(cx,cy,cz);
  if(edit.topologyChanged){if(x-cx*size===0)mark(cx-1,cy,cz);if(x-cx*size===size-1)mark(cx+1,cy,cz);if(y-cy*size===0)mark(cx,cy-1,cz);if(y-cy*size===size-1)mark(cx,cy+1,cz);if(z-cz*size===0)mark(cx,cy,cz-1);if(z-cz*size===size-1)mark(cx,cy,cz+1);}
 }
}
function emit(message:AuthorityMessage,transfer?:Transferable[]){if(message.kind==='summary')lastSummary=message.summary;scope.postMessage(message,transfer);}
const runtime=createAuthorityRuntime({now,emit,onCommitted:committed});
function meshPump(){if(!queue||!source)return;const start=now();let count=0;
 while(count<4&&now()-start<4){const out=queue.takeNext(key=>{const at=now(),result=(meshMode==='material'?buildMaterialPatch({...source!,materialOf:id=>binding!.source.materialOf(id)},key,size):(meshMode==='greedy'?buildGreedyChunk:buildChunk)(source!,key,size)),ms=now()-at;buildCount++;buildMs+=ms;maxBuildMs=Math.max(maxBuildMs,ms);return result;},now());if(out.status==='patch'){scope.postMessage({kind:'mesh-patch',...out.patch,at:now()},out.transfer);count++;}else{if(out.status==='oversized'){const key=`${epoch}:${out.key}:${out.bindingRevision}`;if(key!==lastOversized){lastOversized=key;scope.postMessage({kind:'mesh-fault',reason:'oversized-chunk',...out});}}break;}}
 if(!statsInFlight&&now()-lastStats>100){lastStats=now();statsInFlight=true;statsSequence++;scope.postMessage({kind:'mesh-stats',meshMode,epoch,statsSequence,at:now(),queue:queue.diagnostics(now()),buildCount,buildMs,maxBuildMs,authority:lastSummary?.authorityRevision??0,bindingRevision:lastSummary?.bindingRevision??0});}
}
const timer=setInterval(()=>{try{runtime.pump(now());meshPump();}catch(error){scope.postMessage({kind:'fatal',message:String(error)});clearInterval(timer);}},8);
scope.onmessage=event=>{const message=event.data;if(message.kind==='mesh-config'){if(binding)throw new Error('Mesh mode is immutable after initialization');meshMode=message.mode==='material'?'material':message.mode==='greedy'?'greedy':'baseline';return;}if(message.kind==='mesh-stats-ack'){if(message.statsSequence===statsSequence)statsInFlight=false;return;}if(message.kind==='mesh-ack'){queue?.acknowledge(message.header as MeshPatchHeader);return;}
 void runtime.handle(message as AuthorityCommand).then(ack=>{if(ack.status==='accepted'&&message.kind==='dispose'){queue?.dispose();queue=null;source=binding=null;cursor=undefined;scope.postMessage({kind:'mesh-disposed',epoch:ack.epoch});}}).catch(error=>scope.postMessage({kind:'fatal',message:String(error)}));};
