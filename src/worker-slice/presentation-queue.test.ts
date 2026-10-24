import test from 'node:test';import assert from 'node:assert/strict';
import {PresentationQueue} from './presentation-queue.js';
test('presentation rejects old epochs and revisions, acknowledges replaced output without installing it',()=>{
 const ack:number[]=[];const q=new PresentationQueue<string>(h=>ack.push(h.chunkRevision),100);q.reset(2);
 q.enqueue({epoch:2,key:'a',chunkRevision:1,authorityRevision:4},'old',20);q.enqueue({epoch:2,key:'a',chunkRevision:2,authorityRevision:6},'new',30);
 q.enqueue({epoch:1,key:'a',chunkRevision:9,authorityRevision:9},'wrong world',20);
 const installed:string[]=[];q.drain(p=>installed.push(p),4,()=>0);assert.deepEqual(installed,['new']);assert.deepEqual(ack,[1,9,2]);
 q.enqueue({epoch:2,key:'a',chunkRevision:1,authorityRevision:4},'late',20);q.drain(p=>installed.push(p),4,()=>0);assert.deepEqual(installed,['new']);assert.equal(q.diagnostics().bytes,0);
});
test('budget stops additional work and reports indivisible installation overshoot, never fakes preemption',()=>{
 let t=0;const q=new PresentationQueue<number>(()=>{},100);q.reset(1);for(let i=0;i<3;i++)q.enqueue({epoch:1,key:String(i),chunkRevision:1,authorityRevision:1},i,10);
 const r=q.drain(()=>{t+=7;},4,()=>t);assert.equal(r.installed,1);assert.equal(r.elapsedMs,7);assert.equal(r.overBudgetMs,3);assert.equal(q.diagnostics().pending,2);assert.equal(q.diagnostics().bytes,20);
 q.reset(2);assert.equal(q.diagnostics().pending,0);assert.equal(q.diagnostics().bytes,0);
});
test('malformed or over-credit input cannot allocate an unbounded presentation backlog',()=>{const q=new PresentationQueue<string>(()=>{},20);q.reset(1);assert.throws(()=>q.enqueue({epoch:1,key:'a',chunkRevision:1,authorityRevision:1},'x',21),/credit/);assert.equal(q.diagnostics().pending,0);});
test('a higher chunk revision cannot replace a pending newer authoritative geometry state',()=>{const q=new PresentationQueue<string>(()=>{},100);q.reset(1);q.enqueue({epoch:1,key:'x',chunkRevision:2,authorityRevision:9},'new',10);assert.equal(q.enqueue({epoch:1,key:'x',chunkRevision:3,authorityRevision:8},'regression',10),false);const values:string[]=[];q.drain(x=>values.push(x),4,()=>0);assert.deepEqual(values,['new']);});
