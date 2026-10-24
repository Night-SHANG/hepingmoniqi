import assert from 'node:assert/strict';
import {test} from 'node:test';
import {webcrypto} from 'node:crypto';
import * as browser from './runtime.js';
import {encodePristine,decodePristine} from './node-codec.js';
import {sha256,recipeDigest,topologyDigest,packPristineTables,type IdentifiedLattice} from './node-validation.js';
import {IndexedStructure} from './indexed-structure.js';
// Node's native Web Crypto only. This test is NOT browser runtime evidence.
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
const api=browser as any;
const recipe={mapId:'bounded-browser',seed:11,sourceChecksums:{fixture:'a'.repeat(64)}};
function source():IdentifiedLattice {
 const count=19*3*5,position=(i:number)=>({x:Math.floor(i/15)-9,y:Math.floor(i%15/5),z:i%5-2});
 return {count,id:i=>1000+2*i,position,objectId:i=>position(i).x<0?'左':'right',material:i=>{const p=position(i);return (p.x+p.y+p.z)%3?'wood':'stone';},anchor:i=>{const p=position(i);return p.x===-9&&p.y===0;},neighbours(i,fn){const p=position(i);for(const [axis,[dx,dy,dz]] of [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]].entries()){const x=p.x+dx,y=p.y+dy,z=p.z+dz;if(x>=-9&&x<=9&&y>=0&&y<3&&z>=-2&&z<=2)fn((x+9)*15+y*5+z+2,axis);}}};
}
const snapshot=(s:IndexedStructure)=>({chunk:[...s.chunk],chunks:s.chunks.map(c=>({objectId:c.objectId,voxels:c.voxels,ground:c.ground,edges:[...c.edges]}))});
function fixture(){const s=source(),oracle=new IndexedStructure(s,recipe.seed),encoded=encodePristine(s,oracle,recipe);return {s,oracle,encoded};}
test('native Web Crypto matches independently generated Node recipe, payload and topology digests',async()=>{
 assert.equal(typeof api.sha256Browser,'function','native async digest API missing');
 const p=fixture();assert.equal(await api.sha256Browser('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 assert.equal(await api.sha256Browser(p.encoded.bytes),sha256(p.encoded.bytes));assert.equal(await api.recipeDigestBrowser(recipe),recipeDigest(recipe));assert.equal(await api.topologyDigestBrowser(p.s),topologyDigest(p.s));
});
test('browser async validation preserves exact original seeded partition and all subsequent cuts',async()=>{
 assert.equal(typeof api.decodePristineBrowser,'function','async decoder missing');
 const p=fixture(),decoded=await api.decodePristineBrowser(p.encoded.bytes,p.encoded.manifest),token=await api.validatePristineBrowser(p.s,decoded),graph=IndexedStructure.fromPristine(p.s,token);
 assert.deepEqual(snapshot(graph),snapshot(p.oracle));
 for(let x=-9;x<=9;x+=2){const cut=[];for(let i=0;i<p.s.count;i++)if(p.s.position(i).x===x)cut.push(i);p.oracle.leave(cut);graph.leave([...cut,...cut]);assert.deepEqual(snapshot(graph),snapshot(p.oracle));assert.deepEqual(graph.unsupported(),p.oracle.unsupported());}
});
test('offset Uint8Array and ArrayBuffer inputs are owned before the first async digest',async()=>{
 assert.equal(typeof api.decodePristineBrowser,'function');
 for(const buffer of [false,true]){const p=fixture(),container=new Uint8Array(p.encoded.bytes.length+32);container.fill(123);container.set(p.encoded.bytes,16);const input=buffer?container.buffer.slice(16,-16):container.subarray(16,-16),pending=api.decodePristineBrowser(input,p.encoded.manifest);new Uint8Array(buffer?input:container.buffer).fill(0);const decoded=await pending;const tokenPromise=api.validatePristineBrowser(p.s,decoded);decoded.tables.members.fill(0);decoded.tables.chunk.fill(-1);decoded.manifest.payloadSha256='f'.repeat(64);const token=await tokenPromise;assert.deepEqual(snapshot(IndexedStructure.fromPristine(p.s,token)),snapshot(p.oracle));}
});
test('wrong manifest, corrupt bytes, truncation and trailing input fail closed',async()=>{
 assert.equal(typeof api.decodePristineBrowser,'function');const p=fixture(),b=p.encoded.bytes;
 for(const input of [b.slice(0,12),b.slice(0,-1),new Uint8Array([...b,0])])await assert.rejects(api.decodePristineBrowser(input,p.encoded.manifest));
 for(const change of [{mapId:'wrong'},{seed:12},{formatVersion:2},{recipeSha256:'f'.repeat(64)},{topologySha256:'e'.repeat(64)},{payloadSha256:'d'.repeat(64)}])await assert.rejects(api.decodePristineBrowser(b,{...p.encoded.manifest,...change}));
 for(const at of [0,4,8,12,b.length-1]){const changed=b.slice();changed[at]^=255;await assert.rejects(api.decodePristineBrowser(changed,p.encoded.manifest));}
});
test('rehashing malformed typed tables cannot bypass semantic geometry checks',async()=>{
 assert.equal(typeof api.validatePristineBrowser,'function');const p=fixture(),base=decodePristine(p.encoded.bytes,p.encoded.manifest);
 const changes=[(t:any)=>t.members[0]=t.members[1],(t:any)=>t.members[0]=p.s.count,(t:any)=>t.chunk[0]=-1,(t:any)=>t.memberOffsets[1]=0,(t:any)=>t.roots[0]++,(t:any)=>t.objectIndex[0]=t.objectIds.length,(t:any)=>t.objectIds[0]='wrong',(t:any)=>t.edgeDest[0]=t.roots.length,(t:any)=>t.edgeFaces[0]++,(t:any)=>t.members=Array.from(t.members)];
 for(const change of changes){const d=structuredClone(base);change(d.tables);if(ArrayBuffer.isView(d.tables.members)){const packed=packPristineTables(d.tables);d.manifest={...d.manifest,payloadSha256:sha256(packed.bytes),payloadBytes:packed.bytes.length,objectBytes:packed.objectBytes};}await assert.rejects(api.validatePristineBrowser(p.s,d));}
});
test('hydration tokens are source-bound, single-use and reject arbitrary plain objects',async()=>{
 assert.equal(typeof api.validatePristineBrowser,'function');const p=fixture(),decoded=await api.decodePristineBrowser(p.encoded.bytes,p.encoded.manifest),token=await api.validatePristineBrowser(p.s,decoded);
 assert.throws(()=>IndexedStructure.fromPristine(p.s,{} as any));assert.throws(()=>IndexedStructure.fromPristine(source(),token));assert.deepEqual(snapshot(IndexedStructure.fromPristine(p.s,token)),snapshot(p.oracle));assert.throws(()=>IndexedStructure.fromPristine(p.s,token));
});
test('topology count and capacity reject before source access; native buffer use has an explicit cap',async()=>{
 assert.equal(typeof api.topologyDigestBrowser,'function');const touched=()=>{throw new Error('source must not be read');};
 for(const count of [-1,1.5,2**31])await assert.rejects(api.topologyDigestBrowser({count,id:touched,position:touched,material:touched,objectId:touched,anchor:touched,neighbours:touched}),/count|capacity/i);
 await assert.rejects(api.topologyDigestBrowser({...source(),position:touched},{maxTopologyBytes:32}),/capacity/i);
});
test('async decoder snapshots the expected manifest before awaiting hashes',async()=>{
 assert.equal(typeof api.decodePristineBrowser,'function');const p=fixture(),expected=structuredClone(p.encoded.manifest),pending=api.decodePristineBrowser(p.encoded.bytes,expected);expected.mapId='mutation after decode started';expected.sourceChecksums.fixture='f'.repeat(64);const decoded=await pending;assert.equal(decoded.manifest.mapId,recipe.mapId);assert.equal(decoded.manifest.sourceChecksums.fixture,recipe.sourceChecksums.fixture);
});
test('topology identity still binds every original field, including non-ASCII object strings',async()=>{
 assert.equal(typeof api.validatePristineBrowser,'function');const p=fixture(),decoded=decodePristine(p.encoded.bytes,p.encoded.manifest);
 for(const key of ['id','position','objectId','material','anchor']){const altered:any={...p.s};altered[key]=(i:number)=>i===0?(key==='id'?77:key==='position'?{x:999,y:0,z:0}:key==='anchor'?!p.s.anchor(i):'changed'):(p.s as any)[key](i);await assert.rejects(api.validatePristineBrowser(altered,decoded),/topology/i);}
});
test('empty source retains exact empty hydration and native topology digest',async()=>{
 assert.equal(typeof api.validatePristineBrowser,'function');const empty:IdentifiedLattice={...source(),count:0},oracle=new IndexedStructure(empty),encoded=encodePristine(empty,oracle,recipe),decoded=await api.decodePristineBrowser(encoded.bytes,encoded.manifest);assert.deepEqual(snapshot(IndexedStructure.fromPristine(empty,await api.validatePristineBrowser(empty,decoded))),snapshot(oracle));assert.equal(await api.topologyDigestBrowser(empty),topologyDigest(empty));
});
test('public digest owns Buffer subviews before asynchronous completion',async()=>{
 const whole=Buffer.from('xxxxabcxxxx'),pending=api.sha256Browser(whole.subarray(4,7));whole.fill(0);assert.equal(await pending,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('capacity limit includes interned string suffix, and missing Web Crypto fails closed',async()=>{
 const s={...source(),count:1,objectId:()=> 'x'.repeat(4096),neighbours:()=>{}};await assert.rejects(api.topologyDigestBrowser(s,{maxTopologyBytes:128}),/capacity/i);
 Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});try{await assert.rejects(api.sha256Browser('abc'),/Web Crypto/i);}finally{Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});}
});
test('recipe source checksum ordering is locale-independent UTF-16 code-unit order',async()=>{
 const r={mapId:'unicode-recipe',seed:11,sourceChecksums:{a:'a'.repeat(64),'ä':'b'.repeat(64),z:'c'.repeat(64)}};
 const expected=sha256(JSON.stringify(['pristine-support-recipe-v1','unicode-recipe',11,[['a','a'.repeat(64)],['z','c'.repeat(64)],['ä','b'.repeat(64)]]]));
 assert.equal(recipeDigest(r),expected);assert.equal(await api.recipeDigestBrowser(r),expected);
});
test('invalid direct-validation counts reject before invoking typed-table copy hooks',async()=>{
 const p=fixture(),decoded=decodePristine(p.encoded.bytes,p.encoded.manifest);decoded.tables.members.slice=()=>{throw new Error('copy hook must not be called');};
 await assert.rejects(api.validatePristineBrowser({...p.s,count:-1},decoded),/source count/i);
});
test('typed-array subclass slice overrides cannot alias the owned validation snapshot',async()=>{
 const p=fixture(),decoded=decodePristine(p.encoded.bytes,p.encoded.manifest);class AliasingMembers extends Uint32Array {override slice(){return this;}}
 const members=new AliasingMembers(decoded.tables.members);decoded.tables.members=members;const pending=api.validatePristineBrowser(p.s,decoded);members.fill(0);const token=await pending;assert.deepEqual(snapshot(IndexedStructure.fromPristine(p.s,token)),snapshot(p.oracle));
});

test('validated reset templates preserve source ownership and mint independent single-use snapshots',async()=>{
 const {createPristineTokenFactory}=await import('./pristine-core.js');
 assert.equal(typeof createPristineTokenFactory,'function','validated reset template factory missing');
 const p=fixture(),decoded=await api.decodePristineBrowser(p.encoded.bytes,p.encoded.manifest),token=await api.validatePristineBrowser(p.s,decoded);
 const next=createPristineTokenFactory(p.s,token);assert.throws(()=>IndexedStructure.fromPristine(p.s,token));
 const a=next(),b=next();assert.notEqual(a,b);assert.throws(()=>IndexedStructure.fromPristine(source(),a));
 const ga=IndexedStructure.fromPristine(p.s,a);ga.leave([0,1,2]);
 assert.deepEqual(snapshot(IndexedStructure.fromPristine(p.s,b)),snapshot(p.oracle));assert.throws(()=>IndexedStructure.fromPristine(p.s,b));
 assert.throws(()=>createPristineTokenFactory(p.s,{} as any));
});
