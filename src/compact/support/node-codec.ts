// Deterministic little-endian typed table codec. No giant JSON object snapshot.
import {_prepareDecode,_finishDecode,align4} from './pristine-core.js';
import type { IndexedStructure } from './indexed-structure.js';
import { fields,packPristineTables,recipeDigest,sha256,topologyDigest,validatePristine,consumeValidatedPristine,type Recipe,type CompiledManifest,type DecodedPristine,type IdentifiedLattice,type PristineTables } from './node-validation.js';
export type {CompiledManifest,DecodedPristine,Recipe} from './node-validation.js';
const MAGIC=0x50555343,FORMAT=1,MAX_BYTES=64*1024*1024,pad=align4;
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
 const packed=packPristineTables(tables),manifest:CompiledManifest={formatVersion:FORMAT,mapId:recipe.mapId,seed:recipe.seed,sourceChecksums:Object.fromEntries(Object.entries(recipe.sourceChecksums).sort(([a],[b])=>a<b?-1:a>b?1:0)),recipeSha256:recipeDigest(recipe),topologySha256:topologyDigest(source),payloadSha256:sha256(packed.bytes),cellCount:n,chunkCount:k,edgeCount:e,objectCount:objects.size,objectBytes:packed.objectBytes,payloadBytes:packed.bytes.length};
 // Compiler obeys exactly the same semantic validation as runtime.
 consumeValidatedPristine(source,validatePristine(source,{manifest,tables}));
 const meta=new TextEncoder().encode(JSON.stringify(manifest)),size=16+pad(meta.length)+packed.bytes.length;if(meta.length>65536||size>MAX_BYTES)throw new Error('Compiled metadata or byte capacity exceeded');const bytes=new Uint8Array(size),header=new DataView(bytes.buffer);
 header.setUint32(0,MAGIC,true);header.setUint32(4,FORMAT,true);header.setUint32(8,meta.length,true);header.setUint32(12,packed.bytes.length,true);bytes.set(meta,16);bytes.set(packed.bytes,16+pad(meta.length));return {bytes,manifest};
}
export function decodePristine(input:Uint8Array,expected:CompiledManifest):DecodedPristine {
 const prepared=_prepareDecode(input,expected);
 return _finishDecode(prepared,{recipe:recipeDigest(prepared.manifest),expectedRecipe:recipeDigest(prepared.expected),payload:sha256(prepared.bytes.subarray(prepared.offset))});
}
