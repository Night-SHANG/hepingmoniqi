// Deterministic little-endian typed table codec. No giant JSON object snapshot.
import type { IndexedStructure } from '../incremental-support/indexed-structure.ts';
import { fields,packPristineTables,recipeDigest,sha256,topologyDigest,validatePristine,consumeValidatedPristine,type Recipe,type CompiledManifest,type DecodedPristine,type IdentifiedLattice,type PristineTables } from './pristine-validation.ts';
export type {CompiledManifest,DecodedPristine,Recipe} from './pristine-validation.ts';
const MAGIC=0x50555343,FORMAT=1,MAX_BYTES=64*1024*1024,pad=(n:number)=>(n+3)&~3;
export function encodePristine(source:IdentifiedLattice,graph:IndexedStructure,recipe:Recipe):{bytes:Uint8Array;manifest:CompiledManifest}{
 const k=graph.chunks.length,n=source.count,e=graph.chunks.reduce((n,c)=>n+c.edges.size,0),objects=new Map<string,number>();
 const tables:PristineTables={chunk:graph.chunk.slice(),memberOffsets:new Uint32Array(k+1),members:new Uint32Array(n),objectIndex:new Uint32Array(k),roots:new Uint32Array(k),edgeOffsets:new Uint32Array(k+1),edgeDest:new Uint32Array(e),edgeFaces:new Uint32Array(e),objectIds:[]};let member=0,edge=0;
 for(let c=0;c<k;c++){
  const ch=graph.chunks[c];let group=objects.get(ch.objectId);if(group===undefined){group=objects.size;objects.set(ch.objectId,group);tables.objectIds.push(ch.objectId);}
  tables.objectIndex[c]=group;tables.roots[c]=ch.ground;tables.memberOffsets[c]=member;tables.edgeOffsets[c]=edge;
  if(member+ch.voxels.length>n)throw new Error('Not pristine members');tables.members.set(ch.voxels,member);member+=ch.voxels.length;
  for(const [to,faces]of ch.edges){tables.edgeDest[edge]=to;tables.edgeFaces[edge]=faces;edge++;}
 }
 tables.memberOffsets[k]=member;tables.edgeOffsets[k]=edge;if(member!==n)throw new Error('Only pristine graphs can be compiled');
 const packed=packPristineTables(tables),manifest:CompiledManifest={formatVersion:FORMAT,mapId:recipe.mapId,seed:recipe.seed,sourceChecksums:Object.fromEntries(Object.entries(recipe.sourceChecksums).sort(([a],[b])=>a.localeCompare(b))),recipeSha256:recipeDigest(recipe),topologySha256:topologyDigest(source),payloadSha256:sha256(packed.bytes),cellCount:n,chunkCount:k,edgeCount:e,objectCount:objects.size,objectBytes:packed.objectBytes,payloadBytes:packed.bytes.length};
 // Compiler obeys exactly the same semantic validation as runtime.
 consumeValidatedPristine(source,validatePristine(source,{manifest,tables}));
 const meta=new TextEncoder().encode(JSON.stringify(manifest)),bytes=new Uint8Array(16+pad(meta.length)+packed.bytes.length),header=new DataView(bytes.buffer);
 header.setUint32(0,MAGIC,true);header.setUint32(4,FORMAT,true);header.setUint32(8,meta.length,true);header.setUint32(12,packed.bytes.length,true);bytes.set(meta,16);bytes.set(packed.bytes,16+pad(meta.length));return {bytes,manifest};
}
export function decodePristine(input:Uint8Array,expected:CompiledManifest):DecodedPristine {
 if(!(input instanceof Uint8Array)||input.byteLength<16||input.byteLength>MAX_BYTES)throw new Error('Invalid/truncated compiled input');
 // Own the byte input: future caller mutations cannot change decoded views.
 const bytes=new Uint8Array(input),view=new DataView(bytes.buffer),metaLength=view.getUint32(8,true),payloadLength=view.getUint32(12,true),offset=16+pad(metaLength);
 if(view.getUint32(0,true)!==MAGIC||view.getUint32(4,true)!==FORMAT||metaLength>65536||offset+payloadLength!==bytes.length)throw new Error('Wrong version or binary lengths');
 let m:CompiledManifest;try{m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(16,16+metaLength)));}catch{throw new Error('Invalid manifest');}
 if(m.formatVersion!==FORMAT||recipeDigest(m)!==m.recipeSha256||recipeDigest(expected)!==expected.recipeSha256)throw new Error('Invalid recipe version');
 for(const key of ['formatVersion','mapId','seed','recipeSha256','topologySha256','payloadSha256','cellCount','chunkCount','edgeCount','objectCount','objectBytes','payloadBytes'] as const)if(m[key]!==expected[key])throw new Error(`Wrong expected ${key}`);
 if(!/^[a-f0-9]{64}$/.test(m.topologySha256)||!['cellCount','chunkCount','edgeCount','objectCount','objectBytes','payloadBytes'].every(k=>Number.isSafeInteger((m as any)[k])&&(m as any)[k]>=0))throw new Error('Invalid manifest counts');
 const n=m.cellCount,k=m.chunkCount,e=m.edgeCount,o=m.objectCount,counts=[n,k+1,n,k,k,k+1,e,e],required=counts.reduce((sum,c)=>sum+4*c,0)+4*(o+1)+pad(m.objectBytes);
 if(n>=2**31||k>n||o>k||m.payloadBytes!==payloadLength||required!==payloadLength||sha256(bytes.subarray(offset))!==m.payloadSha256)throw new Error('Invalid payload size or digest');
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
