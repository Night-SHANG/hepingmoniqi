// Isolated Node proof. SHA-256 uses node:crypto; a browser port is not verified.
// No Cell objects, full-city JSON or algorithm duplication. MIT notice: ./LICENSE.
import { createHash } from 'node:crypto';
import type { IndexedLattice } from '../incremental-support/indexed-structure.ts';
export interface IdentifiedLattice extends IndexedLattice { id(index:number):number }
export interface PristineTables {
 chunk:Int32Array;memberOffsets:Uint32Array;members:Uint32Array;objectIndex:Uint32Array;
 roots:Uint32Array;edgeOffsets:Uint32Array;edgeDest:Uint32Array;edgeFaces:Uint32Array;objectIds:string[];
}
export const fields=['chunk','memberOffsets','members','objectIndex','roots','edgeOffsets','edgeDest','edgeFaces'] as const;
export function packPristineTables(t:PristineTables):{bytes:Uint8Array;objectBytes:number}{
 const strings=t.objectIds.map(s=>new TextEncoder().encode(s)),objectBytes=strings.reduce((n,s)=>n+s.length,0),size=fields.reduce((n,f)=>n+t[f].byteLength,0)+4*(strings.length+1)+((objectBytes+3)&~3);
 const bytes=new Uint8Array(size),view=new DataView(bytes.buffer);let at=0;
 for(const name of fields)for(const value of t[name]){view.setUint32(at,value,true);at+=4;}
 let offset=0;view.setUint32(at,0,true);at+=4;for(const s of strings){offset+=s.length;view.setUint32(at,offset,true);at+=4;}
 for(const s of strings){bytes.set(s,at);at+=s.length;}return {bytes,objectBytes};
}

export interface Recipe {mapId:string;seed:number;sourceChecksums:Record<string,string>}
export interface CompiledManifest extends Recipe {
 formatVersion:number;recipeSha256:string;topologySha256:string;payloadSha256:string;
 cellCount:number;chunkCount:number;edgeCount:number;objectCount:number;objectBytes:number;payloadBytes:number;
}
export interface DecodedPristine {manifest:CompiledManifest;tables:PristineTables}
export interface ValidatedPristine {readonly validated:true}
const tokens=new WeakMap<object,{source:IndexedLattice;tables:PristineTables}>();
export const sha256=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export function recipeDigest(recipe:Recipe):string {
 if(typeof recipe.mapId!=='string'||!recipe.mapId||!Number.isInteger(recipe.seed)||recipe.seed<0||recipe.seed>0xffffffff||!recipe.sourceChecksums||Array.isArray(recipe.sourceChecksums))throw new Error('Invalid map recipe');
 const checksums=Object.entries(recipe.sourceChecksums).sort(([a],[b])=>a.localeCompare(b));
 if(!checksums.length||checksums.some(([name,hash])=>!name||!/^[a-f0-9]{64}$/.test(hash)))throw new Error('Invalid source checksums');
 return sha256(JSON.stringify(['pristine-support-recipe-v1',recipe.mapId,recipe.seed,checksums]));
}
/** Stable streamed binary topology identity, including logical IDs. Only a 64 KiB
 * numeric batch and tiny string intern tables survive a single loop iteration. */
export function topologyDigest(source:IdentifiedLattice):string {
 if(!Number.isInteger(source.count)||source.count<0||source.count>=2**31)throw new Error('Invalid source count');
 const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(65520),groups=new Map<string,number>(),materials=new Map<string,number>();let used=0;
 const intern=(map:Map<string,number>,value:string)=>{if(typeof value!=='string')throw new Error('Invalid topology string');let n=map.get(value);if(n===undefined){n=map.size;map.set(value,n);}return n;};
 hash.update('pristine-topology-v1\0');
 for(let i=0;i<source.count;i++){
  const p=source.position(i),id=source.id(i),anchor=source.anchor(i),values=[id,p.x,p.y,p.z,intern(groups,source.objectId(i)),intern(materials,source.material(i)),anchor?1:0];
  if(values.some(n=>!Number.isInteger(n)||n< -2147483648||n>2147483647)||typeof anchor!=='boolean')throw new Error('Invalid topology value');
  if(used+28>buffer.length){hash.update(buffer.subarray(0,used));used=0;}
  for(const value of values){buffer.writeInt32LE(value,used);used+=4;}
 }
 hash.update(buffer.subarray(0,used));hash.update(JSON.stringify([source.count,[...groups.keys()],[...materials.keys()]]));return hash.digest('hex');
}
function copy(t:PristineTables):PristineTables {
 if(!(t.chunk instanceof Int32Array)||!['memberOffsets','members','objectIndex','roots','edgeOffsets','edgeDest','edgeFaces'].every(k=>(t as unknown as Record<string,unknown>)[k] instanceof Uint32Array)||!Array.isArray(t.objectIds)||t.objectIds.some(o=>typeof o!=='string'))throw new Error('Invalid table types');
 return {chunk:t.chunk.slice(),memberOffsets:t.memberOffsets.slice(),members:t.members.slice(),objectIndex:t.objectIndex.slice(),roots:t.roots.slice(),edgeOffsets:t.edgeOffsets.slice(),edgeDest:t.edgeDest.slice(),edgeFaces:t.edgeFaces.slice(),objectIds:[...t.objectIds]};
}
export function validatePristine(source:IdentifiedLattice,decoded:DecodedPristine):ValidatedPristine {
 const m=decoded.manifest;
 if(m.formatVersion!==1||recipeDigest(m)!==m.recipeSha256||topologyDigest(source)!==m.topologySha256)throw new Error('Topology or recipe mismatch');
 // Own arrays before validation, preventing caller mutation between check and hydration.
 const t=copy(decoded.tables),n=source.count,k=t.roots.length,e=t.edgeDest.length;
 if(n!==m.cellCount||k!==m.chunkCount||e!==m.edgeCount||t.objectIds.length!==m.objectCount||t.chunk.length!==n||t.members.length!==n||t.memberOffsets.length!==k+1||t.objectIndex.length!==k||t.edgeOffsets.length!==k+1||t.edgeFaces.length!==e||t.memberOffsets[0]!==0||t.memberOffsets[k]!==n||t.edgeOffsets[0]!==0||t.edgeOffsets[k]!==e||new Set(t.objectIds).size!==t.objectIds.length)throw new Error('Invalid table counts');
 const packed=packPristineTables(t);if(packed.bytes.length!==m.payloadBytes||packed.objectBytes!==m.objectBytes||sha256(packed.bytes)!==m.payloadSha256)throw new Error('Validated table payload digest mismatch');
 const seen=new Uint8Array(n),actualEdges:Array<Map<number,number>>=Array.from({length:k},()=>new Map());
 for(let c=0;c<k;c++){
  const start=t.memberOffsets[c],end=t.memberOffsets[c+1],from=t.edgeOffsets[c],to=t.edgeOffsets[c+1];
  if(start>=end||end>n||from>to||to>e||t.objectIndex[c]>=t.objectIds.length)throw new Error('Invalid chunk offset or object index');
  let roots=0;
  for(let j=start;j<end;j++){
   const i=t.members[j];if(i>=n||seen[i]||t.chunk[i]!==c)throw new Error('Duplicate/missing member or bad chunk index');
   if(source.objectId(i)!==t.objectIds[t.objectIndex[c]])throw new Error('Wrong chunk object');seen[i]=1;if(source.anchor(i))roots++;
  }
  if(roots!==t.roots[c])throw new Error('Invalid root count');
  const destinations=new Set<number>();
  for(let j=from;j<to;j++){const d=t.edgeDest[j];if(d>=k||d===c||!t.edgeFaces[j]||destinations.has(d))throw new Error('Invalid edge index or faces');destinations.add(d);}
 }
 if(seen.some(n=>n!==1))throw new Error('Missing member');
 // Recompute actual reciprocal face counts. This detects even reciprocal but false
 // edge weights; ordering remains exactly the original table/Map insertion order.
 for(let i=0;i<n;i++)source.neighbours(i,(u,axis)=>{
  if(!Number.isInteger(u)||u<0||u>=n||!Number.isInteger(axis)||axis<0||axis>5)throw new Error('Invalid source neighbor');
  if(axis%2===0)return;const a=t.chunk[i],b=t.chunk[u];if(a===b)return;
  actualEdges[a].set(b,(actualEdges[a].get(b)??0)+1);actualEdges[b].set(a,(actualEdges[b].get(a)??0)+1);
 });
 for(let c=0;c<k;c++){
  if(actualEdges[c].size!==t.edgeOffsets[c+1]-t.edgeOffsets[c])throw new Error('Missing/extra reciprocal edge');
  for(let j=t.edgeOffsets[c];j<t.edgeOffsets[c+1];j++)if(actualEdges[c].get(t.edgeDest[j])!==t.edgeFaces[j])throw new Error('Invalid reciprocal geometric edge');
 }
 // Original chunks are connected same-material parts. Validate this, rather than
 // treating arbitrary memberships as a valid pristine seeded partition.
 seen.fill(0);
 for(let c=0;c<k;c++){
  const start=t.members[t.memberOffsets[c]],material=source.material(start),queue=[start];seen[start]=1;
  for(let q=0;q<queue.length;q++)source.neighbours(queue[q],u=>{if(t.chunk[u]===c&&!seen[u]){if(source.material(u)!==material)throw new Error('Mixed material chunk');seen[u]=1;queue.push(u);}});
  if(queue.length!==t.memberOffsets[c+1]-t.memberOffsets[c])throw new Error('Disconnected chunk members');
 }
 const token=Object.freeze({validated:true as const});tokens.set(token,{source,tables:t});return token;
}
/** The only route to internal mutable hydration tables. Tokens are source-bound,
 * single-use, unforgeable, and never expose tables before being consumed. */
export function consumeValidatedPristine(source:IndexedLattice,token:ValidatedPristine):PristineTables {
 const found=tokens.get(token);if(!found||found.source!==source)throw new Error('Invalid, reused or wrong-source pristine token');tokens.delete(token);return found.tables;
}
