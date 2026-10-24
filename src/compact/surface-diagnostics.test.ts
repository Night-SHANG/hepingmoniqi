import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCompactSurfaceRenderer} from './surface-renderer.js';
import type {CompactSurfaceSource,SurfaceEdit} from './surface-source.js';

function fixture(){
 const world=new THREE.Scene(),box=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
 const gone=new Set<number>(),hp=new Map<number,number>();let queries=0;
 const source:CompactSurfaceSource={bounds:{minX:0,maxX:7,minY:0,maxY:0,minZ:0,maxZ:0},staticIdAt(x,y,z){queries++;return x>=0&&x<8&&y===0&&z===0&&!gone.has(x)?x:null;},colorOf:()=>0x8899aa,hpOf:id=>hp.get(id)??10,maxHpOf:()=>10,forEachChunk:(_size,visit)=>visit(0,0,0)};
 const renderer=createCompactSurfaceRenderer(world,box,material,{chunkSize:32});renderer.bind(source);
 const edit=(id:number,revision:number,topologyChanged:boolean,appearanceChanged:boolean):SurfaceEdit=>({id,revision,position:{x:id,y:0,z:0},topologyChanged,appearanceChanged});
 return {renderer,source,gone,hp,edit,get queries(){return queries;},dispose(){renderer.dispose();box.dispose();material.dispose();}};
}

// Replacing the maintained count with a keys()/iterator union must fail. The
// ledgers are observed through their actual numeric IDs and revision values;
// no source-text checks or production test hooks are involved.
test('diagnostics count overlapping revision ledgers without enumerating their historical keys',()=>{
 const f=fixture();
 try{
  f.gone.add(0);f.gone.add(2);f.hp.set(1,8);
  f.renderer.applyEdits([f.edit(0,11,true,false),f.edit(1,12,false,true),f.edit(2,13,true,true)]);f.renderer.flush();
  const original=Map.prototype.keys;let ledgerKeyEnumerations=0;
  Map.prototype.keys=function(){if(this.get(0)===11||this.get(1)===12)ledgerKeyEnumerations++;return original.call(this);};
  let count:number;
  try{count=f.renderer.getDiagnostics().changedRevisionEntries;f.renderer.getDiagnostics();}finally{Map.prototype.keys=original;}
  assert.equal(count,3,'topology-only, appearance-only and overlap must form a unique union');
  assert.equal(ledgerKeyEnumerations,0,'hot diagnostics must not enumerate historical revision ledgers');
 }finally{f.dispose();}
});

test('revision-entry counts stay exact after stale replays, cross-ledger additions and ordinary rebinds',()=>{
 const f=fixture();
 try{
  f.gone.add(0);f.hp.set(1,8);
  const edits=[f.edit(0,11,true,false),f.edit(1,12,false,true)];
  f.renderer.applyEdits(edits);f.renderer.flush();assert.equal(f.renderer.getDiagnostics().changedRevisionEntries,2);
  const beforeQueries=f.queries,beforeRevision=f.renderer.getDiagnostics().revision;
  for(let i=0;i<60;i++){f.renderer.applyEdits([...edits].reverse());const report=f.renderer.flush();assert.equal(report.chunks,0);assert.equal(report.colorChunks,0);}
  assert.equal(f.queries,beforeQueries,'replaying the same revisions must not requery any static surface');
  assert.equal(f.renderer.getDiagnostics().revision,beforeRevision);
  f.renderer.applyEdits([f.edit(0,14,false,true),f.edit(1,15,true,false),f.edit(2,16,true,true),f.edit(3,17,false,false)]);
  f.renderer.flush();assert.equal(f.renderer.getDiagnostics().changedRevisionEntries,3,'a second ledger entry is not a second cell');
  f.renderer.bind(f.source);assert.equal(f.renderer.getDiagnostics().changedRevisionEntries,0);
  f.renderer.applyEdits([f.edit(1,1,false,true)]);assert.equal(f.renderer.flush().colorChunks,1);assert.equal(f.renderer.getDiagnostics().changedRevisionEntries,1,'low revisions in a new binding must count');
  f.renderer.dispose();assert.equal(f.renderer.getDiagnostics().changedRevisionEntries,0);
 }finally{f.dispose();}
});

test('pristine managed rebind keeps an empty ledger count and then counts low new revisions',async()=>{
 const {getManagedCompactGameFixture}=await import('./managed-fixture.js'),{CompactAuthorityStore}=await import('./store.js'),{createCompactQuerySource,createCompactSurfaceSource}=await import('./surface-source.js');
 const fixture=await getManagedCompactGameFixture('courtyard'),world=new THREE.Scene(),box=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),renderer=createCompactSurfaceRenderer(world,box,material,{chunkSize:32});
 const bind=(store:InstanceType<typeof CompactAuthorityStore>)=>renderer.bind(createCompactSurfaceSource(createCompactQuerySource(store,()=>1)));
 try{
  bind(new CompactAuthorityStore(fixture));const fresh=new CompactAuthorityStore(fixture);assert.equal(bind(fresh).chunks,0);assert.equal(renderer.getDiagnostics().lastBindReused,true);assert.equal(renderer.getDiagnostics().changedRevisionEntries,0);
  const id=fixture.idAt(fixture.bounds.maxX,-1,fixture.bounds.maxZ)!;fresh.writable(id)!.hp/=2;fresh.markChanged(id);renderer.applyEdits(fresh.changesSince(0).edits);renderer.flush();assert.equal(renderer.getDiagnostics().changedRevisionEntries,1);
  fresh.reset();bind(fresh);assert.equal(renderer.getDiagnostics().changedRevisionEntries,0);
  assert.equal(bind(new CompactAuthorityStore(fixture)).chunks,0);assert.equal(renderer.getDiagnostics().changedRevisionEntries,0);
 }finally{renderer.dispose();box.dispose();material.dispose();}
});
