import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompactGameFixture} from './fixture.js';
import {createCompactPreview} from './preview.js';
import type {MapId} from '../contracts.js';
import type {CompactFixture} from './fixture.js';

const load=async()=>{
 const api=await import(new URL('./managed-fixture.ts',import.meta.url).href).catch(()=>({}));
 assert.equal(typeof api.getManagedCompactGameFixture,'function','managed immutable fixture factory is required');
 assert.equal(typeof api.isManagedCompactFixture,'function','exact managed identity proof is required');
 return api as {getManagedCompactGameFixture:(map:MapId)=>CompactFixture;isManagedCompactFixture:(fixture:CompactFixture)=>boolean};
};
test('managed fixtures reuse only the two most recently used map identities while fresh callers remain independent',async()=>{
 const {getManagedCompactGameFixture:get,isManagedCompactFixture:isManaged}=await load();
 const a=get('courtyard'),b=get('warehouse');assert.equal(get('courtyard'),a);
 const c=get('tower');assert.equal(get('courtyard'),a);assert.notEqual(get('warehouse'),b);
 assert.equal(isManaged(a),true);assert.equal(isManaged(c),true);
 const fresh=createCompactGameFixture('courtyard');assert.notEqual(fresh,a);assert.notEqual(createCompactGameFixture('courtyard'),fresh);assert.equal(isManaged(fresh),false);
 assert.equal(isManaged({...a}),false);assert.equal(isManaged(new Proxy(a,{})),false);
});
test('managed facade never exposes mutable inventory and detached methods cannot be redirected by their receiver',async()=>{
 const {getManagedCompactGameFixture:get}=await load(),fixture=get('courtyard'),id=fixture.idAtOrdinal(0)!;
 assert.ok(Object.isFrozen(fixture));assert.ok(Object.isFrozen(fixture.bounds));
 assert.equal(Object.getPrototypeOf(fixture),Object.prototype);
 for(const [key,value] of Object.entries(fixture)){
  if(typeof value==='function')assert.equal(Object.getOwnPropertyDescriptor(fixture,key)!.writable,false);
  else if(value&&typeof value==='object'){assert.equal(key,'bounds');assert.ok(Object.values(value).every(v=>typeof v==='number'));}
 }
 assert.deepEqual(Object.getOwnPropertySymbols(fixture),[]);
 assert.throws(()=>Object.assign(fixture,{hpOf:()=>0}));assert.throws(()=>Object.assign(fixture.bounds,{minX:999}));
 const original=fixture.original,cell=original.call({original:()=>undefined},id)!;cell.hp=0;cell.position.x=999;
 assert.notEqual(original(id)!.hp,0);assert.notEqual(original(id)!.position.x,999);
 const ids=fixture.idsInBounds(fixture.bounds);ids.length=0;assert.equal(fixture.idAtOrdinal(0),id);
 const diagnostics=fixture.diagnostics();diagnostics.typedBytes=0;assert.ok(fixture.diagnostics().typedBytes>0);
});
test('preview sources reuse a managed immutable fixture but own independent live stores',async()=>{
 const {isManagedCompactFixture:isManaged}=await load(),a=createCompactPreview('courtyard'),b=createCompactPreview('courtyard');
 assert.equal(a.fixture,b.fixture);assert.ok(isManaged(a.fixture));assert.notEqual(a.source,b.source);
 assert.equal(a.diagnostics().mutableStates,0);assert.equal(b.diagnostics().mutableStates,0);
});
