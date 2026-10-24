import test from 'node:test';
import assert from 'node:assert/strict';

const load = async () => {
 const api = await import('./index.js').catch(() => null);
 assert.equal(typeof api?.createCompactSupport, 'function', 'validated compact support factory must exist');
 return api!;
};

test('compact support exposes cache-only graph construction and async validation', async () => {
 const api = await load();
 assert.equal(typeof api.prepareCompactSupport, 'function');
 assert.equal(typeof api.CompactSupportLattice, 'function');
});

async function bounded() {
 const api=await load();
 const {createDenseFixture}=await import('../fixture.js');
 const {CompactAuthorityStore}=await import('../store.js');
 const {encodePristine}=await import('./node-codec.js');
 const {IndexedStructure}=await import('./indexed-structure.js');
 const {createSupportGraph}=await import('../../structural/support.js');
 const cells=[];
 for(let x=-9;x<=9;x++)for(let y=0;y<3;y++)for(let z=-2;z<=2;z++)cells.push({id:1000+2*cells.length,objectId:x<0?'左':'right',role:'building' as const,position:{x,y,z},material:(x+y+z)%3?'wood' as const:'stone' as const,color:1,hp:3,maxHp:3,anchor:x===-9&&y===0});
 cells.reverse();
 const fixture=createDenseFixture({id:'bounded-compact-support',cells});
 const store=new CompactAuthorityStore(fixture),source=new api.CompactSupportLattice(fixture);
 const recipe={mapId:fixture.id,seed:11,sourceChecksums:{fixture:'a'.repeat(64)}};
 const encoded=encodePristine(source,new IndexedStructure(source,recipe.seed),recipe);
 return {api,fixture,store,source,cells,encoded,oracle:createSupportGraph(cells),options:{artifactBytes:encoded.bytes,expectation:encoded.manifest}};
}

test('typed store graph preserves seeded removal parity without full cell materialization',async()=>{
 const p=await bounded(),graph=await p.api.createCompactSupport(p.store,p.options);
 assert.deepEqual(graph.unsupported(),p.oracle.unsupported());
 for(let x=-9;x<=9;x+=2){const ids=p.cells.filter(c=>c.position.x===x).map(c=>c.id);graph.remove([...ids,...ids,999999]);p.oracle.remove(ids);assert.deepEqual(graph.unsupported(),p.oracle.unsupported());}
 assert.equal(graph.diagnostics().retainedVoxelRecords,0);assert.equal(graph.diagnostics().storedNeighborSlots,0);
});

test('hydration and synchronous reset replay every non-static sparse state, not just gone cells',async()=>{
 const p=await bounded(),departures=p.cells.filter(c=>c.position.x===-9).map(c=>c.id),states=['gone','dynamic','rubble'] as const;
 for(const [n,id]of departures.entries()){const c=p.store.writable(id)!;c.state=states[n%states.length];p.store.markChanged(id);}
 const graph=await p.api.createCompactSupport(p.store,p.options);p.oracle.remove(departures);assert.deepEqual(graph.unsupported(),p.oracle.unsupported());
 p.store.reset();graph.reset();const {createSupportGraph}=await import('../../structural/support.js');assert.deepEqual(graph.unsupported(),createSupportGraph(p.cells).unsupported());
 for(const id of departures){const c=p.store.writable(id)!;c.state='dynamic';p.store.markChanged(id);}graph.reset();assert.deepEqual(graph.unsupported(),p.oracle.unsupported());
 assert.equal(graph.diagnostics().liveMembers,p.cells.length-departures.length);
});

test('corrupt artifact and wrong recipe reject without touching live sparse authority',async()=>{
 const p=await bounded(),id=p.cells[0].id,c=p.store.writable(id)!;c.hp=1;p.store.markChanged(id);const before=p.store.changedStates();
 const corrupt=p.encoded.bytes.slice();corrupt[corrupt.length-1]^=255;
 await assert.rejects(p.api.createCompactSupport(p.store,{...p.options,artifactBytes:corrupt}));
 await assert.rejects(p.api.createCompactSupport(p.store,{...p.options,expectation:{...p.encoded.manifest,mapId:'wrong'}}));
 assert.deepEqual(p.store.changedStates(),before);
});

test('cached graph reset remains privately owned after caller bytes mutate; disposal releases graph authority',async()=>{
 const p=await bounded(),graph=await p.api.createCompactSupport(p.store,p.options);p.encoded.bytes.fill(0);p.encoded.manifest.payloadSha256='f'.repeat(64);
 graph.remove(p.cells.map(c=>c.id));assert.equal(graph.diagnostics().liveMembers,0);graph.reset();assert.equal(graph.diagnostics().liveMembers,p.cells.length);
 graph.dispose();graph.dispose();assert.equal(graph.diagnostics().disposed,true);assert.throws(()=>graph.reset(),/disposed/i);assert.throws(()=>graph.unsupported(),/disposed/i);assert.throws(()=>graph.remove([]),/disposed/i);
});

test('lattice rejects duplicate occupancy before any cache is hydrated',async()=>{
 const api=await load(),{createDenseFixture}=await import('../fixture.js');
 const cell={id:1,objectId:'a',role:'building' as const,position:{x:0,y:0,z:0},material:'stone' as const,color:0,hp:1,maxHp:1};
 const fixture=createDenseFixture({id:'overlap',cells:[cell,{...cell,id:2}]});
 assert.throws(()=>new api.CompactSupportLattice(fixture),/overlap|occupancy/i);
});

test('support lattice and hydration do not request complete cell views',async()=>{
 const p=await bounded(),{CompactAuthorityStore}=await import('../store.js');
 const fixture=new Proxy(p.fixture,{get(target,key,receiver){if(key==='original'||key==='diagnosticCells')return ()=>{throw new Error('Full cell materialization forbidden');};return Reflect.get(target,key,receiver);}});
 const store=new CompactAuthorityStore(fixture),graph=await p.api.createCompactSupport(store,p.options);
 assert.deepEqual(graph.unsupported(),p.oracle.unsupported());
});

test('host asset loader is single-install, optional, and cleanly reversible',async()=>{
 const api=await load();assert.equal(typeof api.configureCompactSupportAssetLoader,'function','host artifact loader hook missing');
 // The regular suite preloads a real filesystem artifact loader. Verify host
 // lifecycle separately without replacing or leaking that process-wide loader.
 const {spawnSync}=await import('node:child_process');
 const script=`
 import assert from 'node:assert/strict';
 import {readFile} from 'node:fs/promises';
 import {configureCompactSupportAssetLoader,createCompactSupport} from './src/compact/support/index.ts';
 import {createCompactGameFixture} from './src/compact/fixture.ts';
 import {CompactAuthorityStore} from './src/compact/store.ts';
 const store=new CompactAuthorityStore(createCompactGameFixture('courtyard'));let calls=0;
 const cleanup=configureCompactSupportAssetLoader(async map=>{calls++;assert.equal(map,'courtyard');return {artifactBytes:await readFile('src/compact/support/assets/'+map+'-seed-11.bin'),expectation:JSON.parse(await readFile('src/compact/support/assets/'+map+'-seed-11.manifest.json','utf8'))};});
 try{assert.throws(()=>configureCompactSupportAssetLoader(async()=>{throw new Error('unused');}),/already/i);const graph=await createCompactSupport(store);assert.equal(calls,1);assert.equal(graph.diagnostics().cells,store.fixture.count);graph.dispose();}finally{cleanup();cleanup();}
 await assert.rejects(createCompactSupport(store),/artifact bytes/i);
 `;
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:new URL('../../../',import.meta.url),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});

test('compiler produces byte-identical canonical artifacts for a fixed source and seed',async()=>{
 const p=await bounded(),{encodePristine}=await import('./node-codec.js'),{IndexedStructure}=await import('./indexed-structure.js');
 const second=encodePristine(p.source,new IndexedStructure(p.source,11),p.encoded.manifest);
 assert.deepEqual(second.bytes,p.encoded.bytes);assert.deepEqual(second.manifest,p.encoded.manifest);
});

test('reset replays borrowed sparse departure IDs without cloning sparse Cell records',async()=>{
 const p=await bounded(),id=p.cells[0].id,state=p.store.writable(id)!;state.state='dynamic';p.store.markChanged(id);
 p.store.departedStates=()=>{throw new Error('Sparse Cell cloning forbidden in support reset');};
 const graph=await p.api.createCompactSupport(p.store,p.options);assert.equal(graph.diagnostics().liveMembers,p.cells.length-1);
 graph.reset();assert.equal(graph.diagnostics().liveMembers,p.cells.length-1);
});
