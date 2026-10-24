import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import type {MapId} from '../../contracts.js';
import {createCompactGameFixture} from '../fixture.js';
import {CompactAuthorityStore} from '../store.js';
import {createCompactSupport} from './index.js';
import oracle from './city-cut-oracle.json';
const asset=(map:MapId)=>({artifactBytes:readFileSync(new URL(`./assets/${map}-seed-11.bin`,import.meta.url)),expectation:JSON.parse(readFileSync(new URL(`./assets/${map}-seed-11.manifest.json`,import.meta.url),'utf8'))});

for(const map of ['courtyard','warehouse','bridge','tower','cantilever','neighborhood','city'] as MapId[])test(`${map}: compiled game artifact validates against actual compact fixture scalars`,async()=>{
 const fixture=createCompactGameFixture(map),store=new CompactAuthorityStore(fixture),options=asset(map),graph=await createCompactSupport(store,options);
 assert.equal(graph.diagnostics().cells,fixture.count);assert.equal(graph.diagnostics().liveMembers,fixture.count);assert.deepEqual(graph.unsupported(),[]);
 assert.ok(Object.keys(options.expectation.sourceChecksums).every(p=>!p.includes('spike')&&!p.startsWith('/')));
 graph.dispose();assert.equal(graph.diagnostics().typedBufferBytes,0);
});

test('actual compact city preserves all twenty prior ordered cut hashes without full Cell objects',async()=>{
 const fixture=createCompactGameFixture('city'),options=asset('city');assert.equal(options.expectation.topologySha256,oracle.topologySha256);
 const store=new CompactAuthorityStore(fixture),graph=await createCompactSupport(store,options),bounds=new Map<string,{minX:number;maxX:number;minZ:number;maxZ:number}>();
 for(let n=0;n<fixture.structureCount;n++){
  const id=fixture.idAtOrdinal(n)!,role=fixture.roleOf(id);if(role!=='building'&&role!=='foundation')continue;
  const name=fixture.objectIdOf(id)!,x=fixture.xOf(id),z=fixture.zOf(id),b=bounds.get(name);
  if(b){b.minX=Math.min(b.minX,x);b.maxX=Math.max(b.maxX,x);b.minZ=Math.min(b.minZ,z);b.maxZ=Math.max(b.maxZ,z);}else bounds.set(name,{minX:x,maxX:x,minZ:z,maxZ:z});
 }
 const locations=[...bounds.values()];assert.equal(locations.length,36);
 for(let i=0;i<20;i++){
  const b=locations[(i*7)%36],at={x:(b.minX+b.maxX)/2,y:i%4===3?-5:-1,z:(b.minZ+b.maxZ)/2},radius=5.5+(i%3)*1.2;
  const before=graph.diagnostics().liveMembers;graph.remove(fixture.idsInSphere(at,radius));const after=graph.diagnostics().liveMembers;
  assert.equal(before-after,oracle.steps[i].removedCells,`cut ${i+1} count`);
  const hash=createHash('sha256').update(JSON.stringify(graph.unsupported())).digest('hex');assert.equal(hash,oracle.steps[i].exactOrderedMembershipSha256,`cut ${i+1} ordered membership`);
 }
 graph.dispose();
});
