import assert from 'node:assert/strict';
import {test} from 'node:test';
import {_prepareDecode,type CompiledManifest} from '../compiled-support/pristine-core.ts';
import {recipeDigest,sha256} from '../compiled-support/pristine-validation.ts';

// Header-only repro: never call _finishDecode, so no large typed allocation occurs.
test('audit: malformed oversized objectBytes cannot wrap padding and admit huge decoded arrays',()=>{
 const recipe={mapId:'audit-bound',seed:11,sourceChecksums:{fixture:'a'.repeat(64)}};
 const n=2**27;
 const manifest:CompiledManifest={...recipe,formatVersion:1,recipeSha256:recipeDigest(recipe),topologySha256:'b'.repeat(64),payloadSha256:sha256(new Uint8Array()),cellCount:n,chunkCount:0,edgeCount:0,objectCount:0,objectBytes:2**32-(8*n+12),payloadBytes:0};
 const meta=new TextEncoder().encode(JSON.stringify(manifest)),offset=16+Math.ceil(meta.length/4)*4,bytes=new Uint8Array(offset),view=new DataView(bytes.buffer);
 view.setUint32(0,0x50555343,true);view.setUint32(4,1,true);view.setUint32(8,meta.length,true);view.setUint32(12,0,true);bytes.set(meta,16);
 assert.throws(()=>_prepareDecode(bytes,manifest),/count|size|length|capacity/i);
});
