import type {AuthorityEnvelope} from './protocol';
import type {ChunkMesh} from './chunk-mesh';

export const DEFAULT_MESH_IN_FLIGHT_BYTES=16*1024*1024;
export const DEFAULT_MESH_INSTALL_BUDGET_MS=4;
export interface MeshPatchHeader extends AuthorityEnvelope {
 readonly key:string;
 readonly chunkRevision:number;
 /** Geometry journal version, distinct from the command authority revision. */
 readonly bindingRevision:number;
}
/** Zero faces means remove the complete previous chunk. Never a partial topology stream. */
export interface MeshPatch {readonly header:MeshPatchHeader;readonly mesh:ChunkMesh}
export type MeshTakeResult=
 |{status:'patch';patch:MeshPatch;transfer:ArrayBuffer[]}
 |{status:'empty'}
 |{status:'blocked';pendingDirty:number;inFlightBytes:number;availableBytes:number}
 |{status:'oversized';key:string;bindingRevision:number;outputBytes:number;maxInFlightBytes:number};
export interface MeshQueueOptions {envelope:AuthorityEnvelope;chunkKeys:Iterable<string>;maxInFlightBytes?:number}
export interface MeshQueueDiagnostics {
 epoch:number;registeredChunks:number;pendingDirty:number;inFlightPatches:number;inFlightBytes:number;availableBytes:number;maxInFlightBytes:number;
 oldestDirtyAgeMs:number;oldestInFlightAgeMs:number;releasedBytes:number;sentPatches:number;oversizedChunks:number;disposed:boolean;
}

type ChunkState={bindingRevision:number;chunkRevision:number};
type DirtyChunk={bindingRevision:number;since:number;outputBytes?:number};
type Flight={header:MeshPatchHeader;bytes:number;since:number};
function validEnvelope(e:AuthorityEnvelope):boolean {
 return !!e&&typeof e.worldId==='string'&&e.worldId.length>0&&typeof e.mapRecipeHash==='string'&&e.mapRecipeHash.length>0&&Number.isSafeInteger(e.epoch)&&e.epoch>=0&&Number.isSafeInteger(e.sequence)&&e.sequence>=0;
}
function copyEnvelope(e:AuthorityEnvelope):AuthorityEnvelope {
 if(!validEnvelope(e))throw new TypeError('Invalid authority envelope');
 return {worldId:e.worldId,epoch:e.epoch,sequence:e.sequence,mapRecipeHash:e.mapRecipeHash};
}
function sameWorld(a:AuthorityEnvelope,b:AuthorityEnvelope){return a.worldId===b.worldId&&a.epoch===b.epoch&&a.mapRecipeHash===b.mapRecipeHash;}
function registry(keys:Iterable<string>):Map<string,ChunkState> {
 const result=new Map<string,ChunkState>();
 for(const key of keys){const xyz=key.split(',').map(Number);if(xyz.length!==3||!xyz.every(Number.isSafeInteger)||xyz.join(',')!==key)throw new TypeError('Invalid registered chunk key');result.set(key,{bindingRevision:-1,chunkRevision:0});}
 return result;
}
function validRevision(value:number){return Number.isSafeInteger(value)&&value>=0;}
function validHeader(header:MeshPatchHeader){return validEnvelope(header)&&typeof header.key==='string'&&validRevision(header.bindingRevision)&&Number.isSafeInteger(header.chunkRevision)&&header.chunkRevision>0;}
function meshBytes(mesh:ChunkMesh,key:string):number {
 if(mesh.key!==key||!Number.isSafeInteger(mesh.faces)||mesh.faces<0||!(mesh.position instanceof Float32Array)||!(mesh.normal instanceof Int8Array)||!(mesh.color instanceof Float32Array))throw new TypeError('Invalid complete mesh replacement');
 const arrays=[mesh.position,mesh.normal,mesh.color],expected=mesh.faces*18;
 if(arrays.some(a=>a.length!==expected||!(a.buffer instanceof ArrayBuffer)||a.byteOffset!==0||a.byteLength!==a.buffer.byteLength)||new Set(arrays.map(a=>a.buffer)).size!==3)throw new TypeError('Mesh outputs must own separate complete buffers');
 const bytes=arrays.reduce((total,a)=>total+a.byteLength,0);
 if(mesh.stats.outputBytes!==bytes)throw new TypeError('Mesh output byte count does not match buffers');
 return bytes;
}

/** Worker-side credit ledger. Only complete mesh replacements may be coalesced.
 * Commands, gameplay events and damage never enter this queue. At most one
 * in-flight patch per actual chunk bounds even zero-byte deletion messages.
 * takeNext reserves credit before the caller transfers the returned buffers.
 * It retains only header/byte metadata, never transferred or waiting arrays.
 */
export class MeshCreditQueue {
 private envelope:AuthorityEnvelope;
 private chunks:Map<string,ChunkState>;
 private readonly dirty=new Map<string,DirtyChunk>();
 private readonly flights=new Map<string,Flight>();
 private readonly maxBytes:number;
 private bytes=0;
 private releasedBytes=0;
 private sentPatches=0;
 private disposed=false;
 constructor(options:MeshQueueOptions){
  this.envelope=copyEnvelope(options.envelope);this.chunks=registry(options.chunkKeys);this.maxBytes=options.maxInFlightBytes??DEFAULT_MESH_IN_FLIGHT_BYTES;
  if(!Number.isSafeInteger(this.maxBytes)||this.maxBytes<1)throw new RangeError('Mesh byte credit must be a positive safe integer');
 }
 private assertAlive(){if(this.disposed)throw new Error('Mesh queue has been disposed');}
 setEnvelope(envelope:AuthorityEnvelope):void {
  this.assertAlive();const next=copyEnvelope(envelope);
  if(!sameWorld(next,this.envelope)||next.sequence<this.envelope.sequence)throw new Error('Mesh envelope changed identity, epoch or regressed sequence; reset is required for a new epoch');
  this.envelope=next;
 }
 markDirty(key:string,bindingRevision:number,now=performance.now()):boolean {
  this.assertAlive();const state=this.chunks.get(key);if(!state)throw new Error('Cannot dirty an unregistered mesh chunk');
  if(!validRevision(bindingRevision)||!Number.isFinite(now))throw new TypeError('Invalid mesh dirty revision or time');
  if(bindingRevision<=state.bindingRevision)return false;
  state.bindingRevision=bindingRevision;
  this.dirty.set(key,{bindingRevision,since:this.dirty.get(key)?.since??now});return true;
 }
 takeNext(build:(key:string)=>ChunkMesh,now=performance.now()):MeshTakeResult {
  this.assertAlive();if(!Number.isFinite(now))throw new TypeError('Invalid mesh send time');
  if(!this.dirty.size)return {status:'empty'};
  const available=this.maxBytes-this.bytes;
  for(const [key,dirty] of this.dirty){
   if(this.flights.has(key))continue;
   const oversized=(outputBytes:number):MeshTakeResult=>({status:'oversized',key,bindingRevision:dirty.bindingRevision,outputBytes,maxInFlightBytes:this.maxBytes});
   if(dirty.outputBytes!==undefined&&dirty.outputBytes>this.maxBytes)return oversized(dirty.outputBytes);
   // Zero credit performs no rebuild. Unknown zero-byte deletions wait for an
   // ACK as well: they cannot starve an already-sent complete replacement.
   if(available===0||(dirty.outputBytes!==undefined&&dirty.outputBytes>available))continue;
   const mesh=build(key),bytes=meshBytes(mesh,key);dirty.outputBytes=bytes;
   if(bytes>this.maxBytes)return oversized(bytes);
   if(bytes>available)continue;
   const state=this.chunks.get(key)!;
   if(state.chunkRevision===Number.MAX_SAFE_INTEGER)throw new Error('Mesh chunk revision exhausted');
   const header:MeshPatchHeader={...this.envelope,key,chunkRevision:++state.chunkRevision,bindingRevision:dirty.bindingRevision};
   this.dirty.delete(key);this.flights.set(key,{header:{...header},bytes,since:now});this.bytes+=bytes;this.sentPatches++;
   return {status:'patch',patch:{header,mesh},transfer:[mesh.position.buffer,mesh.normal.buffer,mesh.color.buffer]};
  }
  return {status:'blocked',pendingDirty:this.dirty.size,inFlightBytes:this.bytes,availableBytes:available};
 }
 acknowledge(header:MeshPatchHeader):number {
  if(this.disposed||!validHeader(header)||!sameWorld(header,this.envelope))return 0;
  const flight=this.flights.get(header.key);
  if(!flight||flight.header.chunkRevision!==header.chunkRevision||flight.header.bindingRevision!==header.bindingRevision||flight.header.sequence!==header.sequence)return 0;
  this.flights.delete(header.key);this.bytes-=flight.bytes;this.releasedBytes+=flight.bytes;return flight.bytes;
 }
 reset(envelope:AuthorityEnvelope,chunkKeys:Iterable<string>):void {
  this.assertAlive();const next=copyEnvelope(envelope),chunks=registry(chunkKeys);
  if(next.epoch<=this.envelope.epoch)throw new Error('Mesh reset requires a strictly newer epoch');
  this.releasedBytes+=this.bytes;this.bytes=0;this.dirty.clear();this.flights.clear();this.chunks=chunks;this.envelope=next;
 }
 dispose():void {
  if(this.disposed)return;this.releasedBytes+=this.bytes;this.bytes=0;this.dirty.clear();this.flights.clear();this.chunks.clear();this.disposed=true;
 }
 diagnostics(now=performance.now()):MeshQueueDiagnostics {
  let oldestDirtyAgeMs=0,oldestInFlightAgeMs=0,oversizedChunks=0;
  for(const value of this.dirty.values()){oldestDirtyAgeMs=Math.max(oldestDirtyAgeMs,now-value.since);if((value.outputBytes??0)>this.maxBytes)oversizedChunks++;}
  for(const value of this.flights.values())oldestInFlightAgeMs=Math.max(oldestInFlightAgeMs,now-value.since);
  return {epoch:this.envelope.epoch,registeredChunks:this.chunks.size,pendingDirty:this.dirty.size,inFlightPatches:this.flights.size,inFlightBytes:this.bytes,availableBytes:this.maxBytes-this.bytes,maxInFlightBytes:this.maxBytes,oldestDirtyAgeMs,oldestInFlightAgeMs,releasedBytes:this.releasedBytes,sentPatches:this.sentPatches,oversizedChunks,disposed:this.disposed};
 }
}

/** The consumer calls installed only after successful installation/removal. */
export class MeshPatchRevisionGate {
 private envelope:AuthorityEnvelope;
 private chunks:Map<string,ChunkState>;
 private disposed=false;
 constructor(options:Pick<MeshQueueOptions,'envelope'|'chunkKeys'>){this.envelope=copyEnvelope(options.envelope);this.chunks=registry(options.chunkKeys);}
 canInstall(header:MeshPatchHeader):boolean {
  if(this.disposed||!validHeader(header)||!sameWorld(header,this.envelope))return false;
  const state=this.chunks.get(header.key);return !!state&&header.chunkRevision>state.chunkRevision&&header.bindingRevision>=state.bindingRevision;
 }
 installed(header:MeshPatchHeader):boolean {
  if(!this.canInstall(header))return false;
  this.chunks.set(header.key,{bindingRevision:header.bindingRevision,chunkRevision:header.chunkRevision});return true;
 }
 reset(envelope:AuthorityEnvelope,chunkKeys:Iterable<string>):void {
  if(this.disposed)throw new Error('Mesh revision gate has been disposed');
  const next=copyEnvelope(envelope),chunks=registry(chunkKeys);if(next.epoch<=this.envelope.epoch)throw new Error('Mesh gate reset requires a strictly newer epoch');
  this.envelope=next;this.chunks=chunks;
 }
 dispose():void {this.disposed=true;this.chunks.clear();}
}
