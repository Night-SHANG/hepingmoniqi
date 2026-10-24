// Shared crypto-free format and invariant core. MIT notice: ./LICENSE.
// Underscored exports are internal platform-driver plumbing, not public APIs.
// Public platform validators compute actual hashes themselves before finalizing.
import type { IndexedLattice } from '../incremental-support/indexed-structure.ts';
export interface IdentifiedLattice extends IndexedLattice { id(index:number):number }
export interface PristineTables {
 chunk:Int32Array;memberOffsets:Uint32Array;members:Uint32Array;objectIndex:Uint32Array;
 roots:Uint32Array;edgeOffsets:Uint32Array;edgeDest:Uint32Array;edgeFaces:Uint32Array;objectIds:string[];
}
export const MAX_COMPILED_BYTES=64*1024*1024;
export function align4(n:number):number {if(!Number.isSafeInteger(n)||n<0||n>MAX_COMPILED_BYTES)throw new Error('Invalid byte capacity');return Math.ceil(n/4)*4;}
export const fields=['chunk','memberOffsets','members','objectIndex','roots','edgeOffsets','edgeDest','edgeFaces'] as const;
export function packPristineTables(t:PristineTables):{bytes:Uint8Array;objectBytes:number}{
 checkTableTypes(t);
 const strings=t.objectIds.map(s=>new TextEncoder().encode(s)),objectBytes=strings.reduce((n,s)=>n+s.length,0),size=fields.reduce((n,f)=>n+t[f].byteLength,0)+4*(strings.length+1)+align4(objectBytes);
 if(!Number.isSafeInteger(size)||size>MAX_COMPILED_BYTES)throw new Error('Table byte capacity exceeded');
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
export function recipeText(recipe:Recipe):string {
 if(typeof recipe.mapId!=='string'||!recipe.mapId||!Number.isInteger(recipe.seed)||recipe.seed<0||recipe.seed>0xffffffff||!recipe.sourceChecksums||Array.isArray(recipe.sourceChecksums))throw new Error('Invalid map recipe');
 const checksums=Object.entries(recipe.sourceChecksums).sort(([a],[b])=>a<b?-1:a>b?1:0);
 if(!checksums.length||checksums.some(([name,hash])=>!name||!/^[a-f0-9]{64}$/.test(hash)))throw new Error('Invalid source checksums');
 return JSON.stringify(['pristine-support-recipe-v1',recipe.mapId,recipe.seed,checksums]);
}

export function cloneManifest(m:CompiledManifest):CompiledManifest {
 recipeText(m);return {...m,sourceChecksums:{...m.sourceChecksums}};
}
/** Stream the exact v1 canonical topology. A sink must consume/copy each reused
 * 65520-byte batch synchronously. No per-cell object serialization is retained. */
export function writeTopology(source:IdentifiedLattice,sink:(bytes:Uint8Array)=>void):void {
 if(!Number.isInteger(source.count)||source.count<0||source.count>=2**31)throw new Error('Invalid source count');
 const buffer=new Uint8Array(65520),view=new DataView(buffer.buffer),groups=new Map<string,number>(),materials=new Map<string,number>();let used=0;
 const intern=(map:Map<string,number>,value:string)=>{if(typeof value!=='string')throw new Error('Invalid topology string');let n=map.get(value);if(n===undefined){n=map.size;map.set(value,n);}return n;};
 sink(new TextEncoder().encode('pristine-topology-v1\0'));
 for(let i=0;i<source.count;i++){
  const p=source.position(i),id=source.id(i),anchor=source.anchor(i),values=[id,p.x,p.y,p.z,intern(groups,source.objectId(i)),intern(materials,source.material(i)),anchor?1:0];
  if(values.some(n=>!Number.isInteger(n)||n< -2147483648||n>2147483647)||typeof anchor!=='boolean')throw new Error('Invalid topology value');
  if(used+28>buffer.length){sink(buffer.subarray(0,used));used=0;}
  for(const value of values){view.setInt32(used,value,true);used+=4;}
 }
 sink(buffer.subarray(0,used));sink(new TextEncoder().encode(JSON.stringify([source.count,[...groups.keys()],[...materials.keys()]])));
}
function checkTableTypes(t:PristineTables):void {
 if(!(t.chunk instanceof Int32Array)||!['memberOffsets','members','objectIndex','roots','edgeOffsets','edgeDest','edgeFaces'].every(k=>(t as unknown as Record<string,unknown>)[k] instanceof Uint32Array)||!Array.isArray(t.objectIds)||t.objectIds.some(o=>typeof o!=='string'))throw new Error('Invalid table types');
 const minimumBytes=fields.reduce((sum,key)=>sum+t[key].byteLength,0)+4*(t.objectIds.length+1)+t.objectIds.reduce((sum,s)=>sum+s.length,0);
 if(!Number.isSafeInteger(minimumBytes)||minimumBytes>MAX_COMPILED_BYTES)throw new Error('Table byte capacity exceeded');
}
function copyTables(t:PristineTables):PristineTables {
 checkTableTypes(t);
 return {chunk:new Int32Array(t.chunk),memberOffsets:new Uint32Array(t.memberOffsets),members:new Uint32Array(t.members),objectIndex:new Uint32Array(t.objectIndex),roots:new Uint32Array(t.roots),edgeOffsets:new Uint32Array(t.edgeOffsets),edgeDest:new Uint32Array(t.edgeDest),edgeFaces:new Uint32Array(t.edgeFaces),objectIds:[...t.objectIds]};
}

export interface PreparedValidation {source:IdentifiedLattice;manifest:CompiledManifest;tables:PristineTables;packed:ReturnType<typeof packPristineTables>}
/** Take ownership BEFORE any asynchronous platform hash. */
export function _preparePristine(source:IdentifiedLattice,decoded:DecodedPristine):PreparedValidation {
 const m=cloneManifest(decoded.manifest),n=source.count;
 if(m.formatVersion!==1||!Number.isInteger(n)||n<0||n>=2**31)throw new Error('Invalid format or source count');
 if(!Number.isSafeInteger(m.payloadBytes)||m.payloadBytes<0||m.payloadBytes>MAX_COMPILED_BYTES||!Number.isSafeInteger(m.objectBytes)||m.objectBytes<0||m.objectBytes>MAX_COMPILED_BYTES)throw new Error('Invalid manifest byte capacity');
 const t=decoded.tables;checkTableTypes(t);const k=t.roots.length,e=t.edgeDest.length;
 if(n!==m.cellCount||k!==m.chunkCount||e!==m.edgeCount||t.objectIds.length!==m.objectCount||t.chunk.length!==n||t.members.length!==n||t.memberOffsets.length!==k+1||t.objectIndex.length!==k||t.edgeOffsets.length!==k+1||t.edgeFaces.length!==e||t.memberOffsets[0]!==0||t.memberOffsets[k]!==n||t.edgeOffsets[0]!==0||t.edgeOffsets[k]!==e||new Set(t.objectIds).size!==t.objectIds.length)throw new Error('Invalid table counts');
 const owned=copyTables(t),packed=packPristineTables(owned);if(packed.bytes.length!==m.payloadBytes||packed.objectBytes!==m.objectBytes)throw new Error('Validated table payload size mismatch');
 return {source,manifest:m,tables:owned,packed};
}
/** Internal hash-driver boundary. Not an unchecked token mint: validates all
 * supplied actual hashes and the complete owned semantic graph before minting.
 * It does not defend against hostile code replacing same-realm hash drivers. */
export function _finishPristine(prepared:PreparedValidation,actual:{recipe:string;topology:string;payload:string}):ValidatedPristine {
 const {source,manifest:m,tables:t}=prepared,n=source.count,k=t.roots.length,e=t.edgeDest.length;
 if(actual.recipe!==m.recipeSha256||actual.topology!==m.topologySha256)throw new Error('Topology or recipe mismatch');
 if(actual.payload!==m.payloadSha256)throw new Error('Validated table payload digest mismatch');
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

const MAGIC=0x50555343,FORMAT=1,MAX_BYTES=MAX_COMPILED_BYTES,pad=align4;
export interface PreparedDecode {bytes:Uint8Array;view:DataView;manifest:CompiledManifest;expected:CompiledManifest;offset:number;counts:number[]}
export function _prepareDecode(input:Uint8Array|ArrayBuffer,expectation:CompiledManifest):PreparedDecode {
 const expected=cloneManifest(expectation);
 const range=input instanceof ArrayBuffer?new Uint8Array(input):input;
 if(!(range instanceof Uint8Array)||range.byteLength<16||range.byteLength>MAX_BYTES)throw new Error('Invalid/truncated compiled input');
 // Own the byte input: future caller mutations cannot change decoded views.
 const bytes=new Uint8Array(range),view=new DataView(bytes.buffer),metaLength=view.getUint32(8,true),payloadLength=view.getUint32(12,true),offset=16+pad(metaLength);
 if(view.getUint32(0,true)!==MAGIC||view.getUint32(4,true)!==FORMAT||metaLength>65536||offset+payloadLength!==bytes.length)throw new Error('Wrong version or binary lengths');
 let m:CompiledManifest;try{m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(16,16+metaLength)));}catch{throw new Error('Invalid manifest');}
 if(m.formatVersion!==FORMAT)throw new Error('Invalid recipe version');
 recipeText(m);recipeText(expected);
 for(const key of ['formatVersion','mapId','seed','recipeSha256','topologySha256','payloadSha256','cellCount','chunkCount','edgeCount','objectCount','objectBytes','payloadBytes'] as const)if(m[key]!==expected[key])throw new Error(`Wrong expected ${key}`);
 if(!/^[a-f0-9]{64}$/.test(m.topologySha256)||!['cellCount','chunkCount','edgeCount','objectCount','objectBytes','payloadBytes'].every(k=>Number.isSafeInteger((m as any)[k])&&(m as any)[k]>=0))throw new Error('Invalid manifest counts');
 const n=m.cellCount,k=m.chunkCount,e=m.edgeCount,o=m.objectCount,counts=[n,k+1,n,k,k,k+1,e,e],required=counts.reduce((sum,c)=>sum+4*c,0)+4*(o+1)+pad(m.objectBytes);
 if(counts.some(c=>!Number.isSafeInteger(c)||c<0||c>MAX_BYTES/4)||o+1>MAX_BYTES/4||m.objectBytes>MAX_BYTES||m.payloadBytes>MAX_BYTES||!Number.isSafeInteger(required)||required>MAX_BYTES||n>=2**31||k>n||o>k||m.payloadBytes!==payloadLength||required!==payloadLength)throw new Error('Invalid payload size or digest');
 return {bytes,view,manifest:m,expected,offset,counts};
}
export function _finishDecode(prepared:PreparedDecode,actual:{recipe:string;expectedRecipe:string;payload:string}):DecodedPristine {
 const {bytes,view,manifest:m,expected,offset,counts}=prepared,o=m.objectCount,metaLength=view.getUint32(8,true);
 if(actual.recipe!==m.recipeSha256||actual.expectedRecipe!==expected.recipeSha256)throw new Error('Invalid recipe version');
 if(actual.payload!==m.payloadSha256)throw new Error('Invalid payload digest');
 let at=offset;const raw:Partial<PristineTables>={};
 for(let f=0;f<fields.length;f++){
  const a=f===0?new Int32Array(counts[f]):new Uint32Array(counts[f]);for(let i=0;i<a.length;i++){a[i]=view.getUint32(at,true);at+=4;}(raw as any)[fields[f]]=a;
 }
 const objectOffsets=new Uint32Array(o+1);for(let i=0;i<objectOffsets.length;i++){objectOffsets[i]=view.getUint32(at,true);at+=4;}
 if(objectOffsets[0]!==0||objectOffsets[o]!==m.objectBytes)throw new Error('Invalid object offsets');
 const objectIds:string[]=[];
 for(let i=0;i<o;i++){if(objectOffsets[i]>objectOffsets[i+1]||objectOffsets[i+1]>m.objectBytes)throw new Error('Invalid object offset');objectIds.push(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(at+objectOffsets[i],at+objectOffsets[i+1])));}
 for(let i=16+metaLength;i<offset;i++)if(bytes[i])throw new Error('Noncanonical metadata padding');
 for(let i=at+m.objectBytes;i<bytes.length;i++)if(bytes[i])throw new Error('Noncanonical payload padding');
 return {manifest:m,tables:{...raw,objectIds} as PristineTables};
}
