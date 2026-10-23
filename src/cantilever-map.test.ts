import test from 'node:test';
import assert from 'node:assert/strict';
import {cantileverVoxels} from './map-generators';
test('cantilever is deterministic, unique and fully supported by its offset mast',()=>{
 const a=cantileverVoxels();assert.deepEqual(a,cantileverVoxels());assert.ok(a.length>150&&a.length<700);
 const keys=new Set(a.map(v=>`${v.position.x},${v.position.y},${v.position.z}`));assert.equal(keys.size,a.length);
 const visited=new Set<string>(),queue=a.filter(v=>v.anchored).map(v=>v.position);
 while(queue.length){const p=queue.pop()!,k=`${p.x},${p.y},${p.z}`;if(visited.has(k))continue;visited.add(k);for(const [x,y,z]of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const q={x:p.x+x,y:p.y+y,z:p.z+z};if(keys.has(`${q.x},${q.y},${q.z}`))queue.push(q);}}
 assert.equal(visited.size,a.length);assert.ok(a.every(v=>v.id>=50000&&v.group==='house'&&v.objectId==='cantilever'));
 assert.ok(a.filter(v=>v.position.y===0).every(v=>v.position.x<0));assert.ok(a.filter(v=>v.position.x>=2).every(v=>v.position.y>=10));
});

test('cantilever weak support cut detaches the offset deck while grounded footing remains',async()=>{
 const {createWorld}=await import('./domain');const w=createWorld();assert.equal(w.loadMap('cantilever',true),true);
 const r=w.damage({id:'cantilever-neck',epoch:w.epoch,target:{x:-6,y:5,z:0},weapon:'pulse',power:1,reward:false});
 assert.ok(r.accepted);assert.ok(r.detached.some(v=>v.position.x>=2&&v.position.y===10));assert.ok(w.getVoxels().some(v=>v.group==='house'&&v.anchored));assert.equal(w.getSnapshot().research,0);
});
