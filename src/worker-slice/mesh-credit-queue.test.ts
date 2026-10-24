import test from 'node:test';
import assert from 'node:assert/strict';
import type {ChunkMesh} from './chunk-mesh';
import {MeshCreditQueue,MeshPatchRevisionGate} from './mesh-credit-queue';

const envelope=(epoch=1,sequence=0)=>({worldId:'mesh-test',epoch,sequence,mapRecipeHash:'small-asymmetric'});
function mesh(key:string,faces=1):ChunkMesh {
 return {key,position:new Float32Array(faces*18),normal:new Int8Array(faces*18),color:new Float32Array(faces*18),faces,bounds:faces?{minX:0,maxX:1,minY:0,maxY:1,minZ:0,maxZ:1}:null,stats:{queriedCells:27,temporaryBytes:243,outputBytes:faces*162}};
}
function next(queue:MeshCreditQueue,build=(key:string)=>mesh(key),now=0){const value=queue.takeNext(build,now);assert.equal(value.status,'patch');if(value.status!=='patch')throw new Error('Expected patch');return value;}

test('slow consumers bound bytes and dirty keys, then rebuild only the newest unsent revision',()=>{
 const queue=new MeshCreditQueue({envelope:envelope(),chunkKeys:['0,0,0','1,0,0'],maxInFlightBytes:162});
 queue.markDirty('0,0,0',1,0);queue.markDirty('1,0,0',1,0);const first=next(queue);
 for(let revision=2;revision<=1000;revision++){queue.markDirty('0,0,0',revision,revision);queue.markDirty('1,0,0',revision,revision);}
 let builds=0;assert.equal(queue.takeNext(key=>{builds++;return mesh(key);},1100).status,'blocked');assert.equal(builds,0);
 const blocked=queue.diagnostics(1100);assert.equal(blocked.inFlightBytes,162);assert.equal(blocked.pendingDirty,2);assert.equal(blocked.inFlightPatches,1);assert.equal(blocked.oldestDirtyAgeMs,1100);
 assert.equal(queue.acknowledge(first.patch.header),162);const second=next(queue);assert.equal(second.patch.header.key,'1,0,0');assert.equal(second.patch.header.bindingRevision,1000);
 assert.equal(queue.acknowledge(second.patch.header),162);const latest=next(queue);assert.equal(latest.patch.header.key,'0,0,0');assert.equal(latest.patch.header.chunkRevision,2);assert.equal(latest.patch.header.bindingRevision,1000);
 queue.acknowledge(latest.patch.header);assert.equal(queue.takeNext(mesh).status,'empty');assert.equal(queue.diagnostics().inFlightBytes,0);
});

test('stale dirty revisions cannot supersede newer geometry and header envelope follows committed sequence',()=>{
 const queue=new MeshCreditQueue({envelope:envelope(),chunkKeys:['0,0,0']});
 assert.equal(queue.markDirty('0,0,0',10,0),true);assert.equal(queue.markDirty('0,0,0',9,1),false);assert.equal(queue.markDirty('0,0,0',10,1),false);
 queue.setEnvelope(envelope(1,7));const patch=next(queue).patch;assert.equal(patch.header.sequence,7);assert.equal(patch.header.bindingRevision,10);
 assert.throws(()=>queue.markDirty('invented',11));assert.throws(()=>queue.setEnvelope(envelope(2)));assert.throws(()=>queue.setEnvelope(envelope(1,6)));
 assert.equal(queue.diagnostics().pendingDirty,0);
});

test('native transfer consumes returned arrays, while acknowledgements release original tracked bytes once',()=>{
 const queue=new MeshCreditQueue({envelope:envelope(),chunkKeys:['0,0,0']});queue.markDirty('0,0,0',1);const result=next(queue);
 const received=structuredClone(result.patch,{transfer:result.transfer});assert.equal(result.patch.mesh.position.byteLength,0);assert.equal(received.mesh.position.byteLength,72);
 assert.equal(queue.diagnostics().inFlightBytes,162);assert.equal(queue.acknowledge({...received.header,bindingRevision:2}),0);
 assert.equal(queue.acknowledge(received.header),162);assert.equal(queue.acknowledge(received.header),0);assert.equal(queue.diagnostics().releasedBytes,162);
});

test('zero-byte deletion patches are bounded by one in-flight slot per registered chunk',()=>{
 const queue=new MeshCreditQueue({envelope:envelope(),chunkKeys:['0,0,0'],maxInFlightBytes:1});queue.markDirty('0,0,0',1);const first=next(queue,key=>mesh(key,0));
 for(let i=2;i<100;i++){queue.markDirty('0,0,0',i);assert.equal(queue.takeNext(key=>mesh(key,0)).status,'blocked');}
 assert.equal(queue.diagnostics().inFlightPatches,1);assert.equal(queue.diagnostics().pendingDirty,1);
 queue.acknowledge(first.patch.header);assert.equal(next(queue,key=>mesh(key,0)).patch.header.bindingRevision,99);
});

test('oversized individual patch is explicitly rejected and remains dirty without retaining its buffers',()=>{
 const queue=new MeshCreditQueue({envelope:envelope(),chunkKeys:['0,0,0'],maxInFlightBytes:161});queue.markDirty('0,0,0',1);
 const result=queue.takeNext(mesh);assert.equal(result.status,'oversized');if(result.status==='oversized'){assert.equal(result.outputBytes,162);assert.equal(result.maxInFlightBytes,161);assert.equal(result.key,'0,0,0');}
 assert.equal(queue.diagnostics().pendingDirty,1);assert.equal(queue.diagnostics().inFlightBytes,0);
 assert.equal(queue.takeNext(()=>{throw new Error('Do not repeatedly rebuild a known oversized revision');}).status,'oversized');
 queue.markDirty('0,0,0',2);assert.equal(next(queue,key=>mesh(key,0)).patch.header.bindingRevision,2);
});

test('partial credits retain only a size hint and skip repeated blocked rebuilds until credit returns',()=>{
 const queue=new MeshCreditQueue({envelope:envelope(),chunkKeys:['0,0,0','1,0,0'],maxInFlightBytes:243});queue.markDirty('0,0,0',1);queue.markDirty('1,0,0',1);const first=next(queue);
 assert.equal(queue.takeNext(mesh).status,'blocked');assert.equal(queue.takeNext(()=>{throw new Error('Blocked revision must not allocate again');}).status,'blocked');
 queue.acknowledge(first.patch.header);assert.equal(next(queue).patch.header.key,'1,0,0');
});

test('reset and dispose invalidate pending work and stale acknowledgements without corrupting new credits',()=>{
 const queue=new MeshCreditQueue({envelope:envelope(),chunkKeys:['0,0,0']});queue.markDirty('0,0,0',1);const old=next(queue);queue.markDirty('0,0,0',2);
 queue.reset(envelope(2),['1,0,0']);assert.equal(queue.diagnostics().inFlightBytes,0);assert.equal(queue.diagnostics().pendingDirty,0);assert.equal(queue.diagnostics().releasedBytes,162);
 queue.markDirty('1,0,0',1);const fresh=next(queue);assert.equal(queue.acknowledge(old.patch.header),0);assert.equal(queue.diagnostics().inFlightBytes,162);assert.equal(fresh.patch.header.chunkRevision,1);
 assert.throws(()=>queue.reset(envelope(2),[]));queue.dispose();assert.equal(queue.diagnostics().inFlightBytes,0);assert.equal(queue.diagnostics().inFlightPatches,0);assert.equal(queue.acknowledge(fresh.patch.header),0);assert.throws(()=>queue.markDirty('1,0,0',2));
});

test('consumer gate rejects out-of-order complete replacements and only advances after actual installation',()=>{
 const gate=new MeshPatchRevisionGate({envelope:envelope(),chunkKeys:['0,0,0']}),first={...envelope(),key:'0,0,0',chunkRevision:1,bindingRevision:3},newer={...first,chunkRevision:3,bindingRevision:5};
 assert.equal(gate.canInstall(first),true);assert.equal(gate.canInstall(newer),true);assert.equal(gate.installed(newer),true);
 assert.equal(gate.canInstall(first),false);assert.equal(gate.installed(first),false);assert.equal(gate.canInstall(newer),false);
 assert.equal(gate.canInstall({...newer,chunkRevision:4,bindingRevision:4}),false);assert.equal(gate.canInstall({...newer,key:'1,0,0',chunkRevision:4}),false);
 gate.reset(envelope(2),['0,0,0']);assert.equal(gate.canInstall({...newer,chunkRevision:4}),false);assert.equal(gate.installed({...first,epoch:2}),true);gate.dispose();assert.equal(gate.canInstall({...newer,epoch:2,chunkRevision:4}),false);
});

test('invalid builder output does not reserve credits or lose dirty work',()=>{
 const queue=new MeshCreditQueue({envelope:envelope(),chunkKeys:['0,0,0']});queue.markDirty('0,0,0',1);
 assert.throws(()=>queue.takeNext(()=>mesh('1,0,0')));assert.throws(()=>queue.takeNext(key=>({...mesh(key),normal:new Int8Array(1)})));
 assert.equal(queue.diagnostics().inFlightBytes,0);assert.equal(queue.diagnostics().pendingDirty,1);assert.equal(next(queue).patch.header.chunkRevision,1);
});

test('indexed greedy quads reserve and transfer the index bytes with owned vertex buffers',()=>{
 const q=new MeshCreditQueue({envelope:envelope(),chunkKeys:['0,0,0'],maxInFlightBytes:132});q.markDirty('0,0,0',1,0);
 const indexed={...mesh('0,0,0'),position:new Float32Array(12),normal:new Int8Array(12),color:new Float32Array(12),index:new Uint32Array([0,1,2,2,1,3]),stats:{queriedCells:27,temporaryBytes:243,outputBytes:132}};
 const out=next(q,()=>indexed);assert.equal(out.transfer.length,4);assert.equal(q.diagnostics().inFlightBytes,132);const receiver=structuredClone(out.patch,{transfer:out.transfer});assert.equal(indexed.index.byteLength,0);assert.equal(receiver.mesh.index!.length,6);assert.equal(q.acknowledge(out.patch.header),132);
});
test('indexed replacement rejects out-of-range triangle indices without reserving credit',()=>{
 const q=new MeshCreditQueue({envelope:envelope(),chunkKeys:['0,0,0']});q.markDirty('0,0,0',1,0);
 const indexed={...mesh('0,0,0'),position:new Float32Array(12),normal:new Int8Array(12),color:new Float32Array(12),index:new Uint32Array([0,1,2,2,1,8]),stats:{queriedCells:27,temporaryBytes:243,outputBytes:132}};
 assert.throws(()=>q.takeNext(()=>indexed,0),/index/i);assert.equal(q.diagnostics().inFlightBytes,0);
});

test('material textures consume byte credit and transfer ownership with geometry',()=>{
 const make=(key:string)=>{const m=mesh(key);const cellColors={key,origin:[0,0,0],dimensions:[1,1,1],paletteIndex:new Uint8Array([1]),palette:new Float32Array(8),paletteWidth:2,paletteHeight:1,shade:new Float32Array([.8]),stats:{queriedCells:1,occupiedCells:1,airTexels:0,indexBytes:1,paletteBytes:32,shadeBytes:4,totalTextureBytes:37}};return {...m,cellColors,stats:{...m.stats,outputBytes:199}} as unknown as ChunkMesh;};
 const q=new MeshCreditQueue({envelope:envelope(),chunkKeys:['0,0,0'],maxInFlightBytes:199});q.markDirty('0,0,0',1);const result=next(q,make);assert.equal(result.transfer.length,6);assert.equal(q.diagnostics().inFlightBytes,199);const received=structuredClone(result.patch,{transfer:result.transfer});assert.equal((result.patch.mesh as any).cellColors.palette.byteLength,0);assert.equal((received.mesh as any).cellColors.palette.byteLength,32);assert.equal(q.acknowledge(received.header),199);
 const tooSmall=new MeshCreditQueue({envelope:envelope(),chunkKeys:['0,0,0'],maxInFlightBytes:198});tooSmall.markDirty('0,0,0',1);assert.equal(tooSmall.takeNext(make).status,'oversized');
});
