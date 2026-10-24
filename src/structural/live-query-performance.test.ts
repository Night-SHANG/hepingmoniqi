import test from 'node:test';
import assert from 'node:assert/strict';
import {createStructuralSimulation} from './simulation.js';
import type {Cell} from './types.js';

// Explicit opt-in: run alone, not alongside map builds or the parallel full suite.
// STRUCTURAL_QUERY_BENCHMARK_CELLS=200000 node --import tsx --test src/structural/live-query-performance.test.ts
const count=Number(process.env.STRUCTURAL_QUERY_BENCHMARK_CELLS??0);
test('large-world query benchmark retains 200k-cell identity without idle clones or full sparse deltas',{
 skip:count===0?'Set STRUCTURAL_QUERY_BENCHMARK_CELLS=200000 for the isolated large-world benchmark':false,
},async t=>{
 assert.ok(Number.isSafeInteger(count)&&count>=200000);
 const stage=(name:string)=>console.log(JSON.stringify({stage:name,cells:count,rssMiB:Math.round(process.memoryUsage().rss/1024/1024)}));
 const cells:Cell[]=Array.from({length:count},(_,id)=>({id,objectId:'benchmark-soil',role:'terrain',position:{x:id%500,y:0,z:Math.floor(id/500)},material:'soil',color:0x887766,hp:100,maxHp:100,anchor:true}));
 stage('fixture-created');const started=performance.now();const s=await createStructuralSimulation({id:'large-read-benchmark',cells});
 const setupMs=performance.now()-started;stage('simulation-created');
 try{
  s.step(1/120);const firstStart=performance.now();const first=s.liveViews(),revision=s.viewRevision;s.research();const firstViewMs=performance.now()-firstStart;
  stage('views-warmed');const clone=globalThis.structuredClone;let clones=0;
  globalThis.structuredClone=((...args:Parameters<typeof clone>)=>{clones++;return clone(...args);}) as typeof clone;
  try{
   const idleStart=performance.now();for(let frame=0;frame<120;frame++){s.step(1/60);assert.equal(s.liveViews(),first);assert.equal(s.viewChanges(revision).cells.length,0);assert.equal(s.research(),0);assert.equal(s.eventsSince({epoch:s.epoch,index:0}).events.length,0);}
   const idle120Ms=performance.now()-idleStart,idleClones=clones;assert.equal(idleClones,0);stage('idle-queries-complete');
   s.blast({id:'one-cell',epoch:s.epoch,position:{x:250,y:0,z:200},radius:.2,damage:25,impulse:0});clones=0;
   const deltaStart=performance.now(),delta=s.viewChanges(revision),sparseDeltaMs=performance.now()-deltaStart;
   assert.equal(delta.reset,false);assert.equal(delta.cells.length,1);assert.equal(delta.cells[0].id,100250);assert.equal(delta.cells[0].hp,75);assert.equal(clones,0);
   t.diagnostic(JSON.stringify({cells:count,setupMs,firstViewMs,idle120Ms,idleMsPerFrame:idle120Ms/120,idleClones,sparseDeltaMs,sparseChangedCells:delta.cells.length,sparseQueryClones:clones}));
  }finally{globalThis.structuredClone=clone;}
 }finally{s.dispose();}
});
