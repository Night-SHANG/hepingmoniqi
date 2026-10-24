import test from 'node:test';
import assert from 'node:assert/strict';
import type {WorldSnapshot} from './contracts.js';

const saveKey='hepingmoniqi.structural.v09';
const legacyKey='hepingmoniqi.first-playable.v1';
const snapshot=(research=0):WorldSnapshot=>({schemaVersion:9,structural:{schema:'structural-game/v1',simulation:null},epoch:1,voxels:[],totalCount:1,destroyedCount:0,research,firstRewardClaimed:false});
const moduleUnderTest=async()=>{
 const module=await import('./game-save-store.js').catch(()=>null);
 assert.ok(module?.createGameSaveStore,'the browser save store factory must exist');
 return module;
};
class MemoryStorage {
 values=new Map<string,string>();
 failReads=false;
 failWrites=false;
 getItem(key:string){if(this.failReads)throw new Error('Storage is disabled');return this.values.get(key)??null;}
 setItem(key:string,value:string){if(this.failWrites)throw new Error('Quota exceeded');this.values.set(key,value);}
}
class MemoryDatabase {
 value:unknown=null;
 failReads=false;
 failWrites=false;
 async read(){if(this.failReads)throw new Error('Database unavailable');return structuredClone(this.value);}
 async write(value:unknown){if(this.failWrites)throw new Error('Database unavailable');this.value=structuredClone(value);}
}

test('small snapshots survive a fresh store through a timestamped local mirror and IndexedDB',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage(),database=new MemoryDatabase(),save=snapshot(40);
 await createGameSaveStore({localStorage,database,now:()=>100}).saveGameSnapshot(save);
 const mirror=JSON.parse(localStorage.getItem(saveKey)!);
 assert.equal(mirror.savedAt,100);assert.deepEqual(mirror.snapshot,save);assert.deepEqual(database.value,mirror);
 assert.deepEqual(await createGameSaveStore({localStorage,database}).loadGameSave(),save);
});

test('multi-megabyte scenes are persisted in IndexedDB with only a small local pointer',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage(),database=new MemoryDatabase(),save=snapshot(1500);
 save.structural={schema:'structural-game/v1',largeScene:'x'.repeat(3_400_000)};
 await createGameSaveStore({localStorage,database,now:()=>100}).saveGameSnapshot(save);
 const raw=localStorage.getItem(saveKey)!;
 assert.ok(raw.length<200,'a large scene must never be squeezed into the localStorage quota');
 assert.equal(JSON.parse(raw).storage,'indexeddb');assert.equal(JSON.parse(raw).savedAt,100);
 assert.deepEqual(await createGameSaveStore({localStorage,database}).loadGameSave(),save);
});

test('a newer local fallback wins over stale IndexedDB after a database write fails',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage(),database=new MemoryDatabase();
 const store=createGameSaveStore({localStorage,database,now:()=>100});
 await store.saveGameSnapshot(snapshot(10));database.failWrites=true;await store.saveGameSnapshot(snapshot(20));
 assert.equal(JSON.parse(localStorage.getItem(saveKey)!).savedAt,101);
 assert.deepEqual(await createGameSaveStore({localStorage,database}).loadGameSave(),snapshot(20));
});

test('newer IndexedDB wins even when writing its local mirror failed',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage(),database=new MemoryDatabase();
 const store=createGameSaveStore({localStorage,database,now:()=>100});
 await store.saveGameSnapshot(snapshot(10));localStorage.failWrites=true;await store.saveGameSnapshot(snapshot(20));
 assert.deepEqual(await createGameSaveStore({localStorage,database}).loadGameSave(),snapshot(20));
});

test('a failed large save rejects without replacing the previous durable snapshot or local data',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage(),database=new MemoryDatabase();
 const store=createGameSaveStore({localStorage,database,now:()=>100,localMirrorMaxBytes:1000});
 await store.saveGameSnapshot(snapshot(10));const prior=localStorage.getItem(saveKey);database.failWrites=true;
 const large=snapshot(20);large.structural={schema:'structural-game/v1',data:'x'.repeat(1000)};
 await assert.rejects(store.saveGameSnapshot(large),/save|persist|storage/i);
 assert.equal(localStorage.getItem(saveKey),prior);assert.deepEqual(await store.loadGameSave(),snapshot(10));
});

test('writes reject when both backends fail and subsequent saves can recover',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage(),database=new MemoryDatabase();
 const store=createGameSaveStore({localStorage,database});localStorage.failWrites=true;database.failWrites=true;
 await assert.rejects(store.saveGameSnapshot(snapshot(10)),/save|persist|storage/i);
 database.failWrites=false;await store.saveGameSnapshot(snapshot(20));assert.deepEqual(await store.loadGameSave(),snapshot(20));
});

test('queued writes preserve submission order and deeply own snapshots before waiting',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage(),database=new MemoryDatabase();
 let release!:()=>void,started!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
 const write=database.write.bind(database);let calls=0;
 database.write=async value=>{if(++calls===1){started();await gate;}await write(value);};
 const store=createGameSaveStore({localStorage,database,now:()=>100}),first=snapshot(10),second=snapshot(20);
 second.structural={schema:'structural-game/v1',nested:{position:{x:5}}};
 const firstWrite=store.saveGameSnapshot(first);await entered;
 const secondWrite=store.saveGameSnapshot(second);second.research=999;(second.structural as {nested:{position:{x:number}}}).nested.position.x=999;
 await Promise.resolve();assert.equal(calls,1,'later writes must wait for the first transaction');release();await Promise.all([firstWrite,secondWrite]);
 const restored=await store.loadGameSave() as WorldSnapshot;
 assert.equal(restored.research,20);assert.equal((restored.structural as {nested:{position:{x:number}}}).nested.position.x,5);
});

test('loading waits for submitted writes rather than returning stale progress',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),database=new MemoryDatabase();
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 database.write=async value=>{await gate;database.value=structuredClone(value);};
 const store=createGameSaveStore({localStorage:null,database});
 const saving=store.saveGameSnapshot(snapshot(50));const loading=store.loadGameSave();release();await saving;
 assert.deepEqual(await loading,snapshot(50));
});

test('existing raw schema 9 local saves remain loadable without IndexedDB',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage();localStorage.setItem(saveKey,JSON.stringify(snapshot(75)));
 assert.deepEqual(await createGameSaveStore({localStorage,database:null}).loadGameSave(),snapshot(75));
});

test('small snapshots can be saved and reloaded when IndexedDB is absent entirely',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage();
 await createGameSaveStore({localStorage,database:null}).saveGameSnapshot(snapshot(75));
 assert.deepEqual(await createGameSaveStore({localStorage,database:null}).loadGameSave(),snapshot(75));
});

test('an unavailable IndexedDB reader still allows small local fallback saves',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage(),database=new MemoryDatabase();database.failReads=true;database.failWrites=true;
 await createGameSaveStore({localStorage,database}).saveGameSnapshot(snapshot(85));
 assert.deepEqual(await createGameSaveStore({localStorage,database}).loadGameSave(),snapshot(85));
});

test('legacy saves are read as fallback and never changed by new writes',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage(),database=new MemoryDatabase(),legacy={...snapshot(90),schemaVersion:8};
 const original=JSON.stringify(legacy);localStorage.setItem(legacyKey,original);
 const store=createGameSaveStore({localStorage,database});assert.deepEqual(await store.loadGameSave(),legacy);
 await store.saveGameSnapshot(snapshot(100));assert.equal(localStorage.getItem(legacyKey),original);
});

test('corrupt records do not displace a valid local save or the legacy fallback',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage(),database=new MemoryDatabase();
 database.value={savedAt:999,snapshot:{broken:true}};localStorage.setItem(saveKey,JSON.stringify({savedAt:10,snapshot:snapshot(20)}));
 const store=createGameSaveStore({localStorage,database});assert.deepEqual(await store.loadGameSave(),snapshot(20));
 localStorage.setItem(saveKey,'not JSON');localStorage.setItem(legacyKey,JSON.stringify({...snapshot(5),schemaVersion:8}));
 assert.deepEqual(await store.loadGameSave(),{...snapshot(5),schemaVersion:8});
});

test('a missing latest IndexedDB snapshot is an explicit load error, not a silent legacy rollback',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage(),database=new MemoryDatabase();
 localStorage.setItem(saveKey,JSON.stringify({savedAt:100,storage:'indexeddb'}));localStorage.setItem(legacyKey,JSON.stringify({...snapshot(5),schemaVersion:8}));
 database.failReads=true;
 await assert.rejects(createGameSaveStore({localStorage,database}).loadGameSave(),/save|database|storage/i);
 database.failReads=false;database.value={savedAt:90,snapshot:snapshot(10)};
 await assert.rejects(createGameSaveStore({localStorage,database}).loadGameSave(),/save|database|storage/i);
});

test('storage-disabled environments can still read and write IndexedDB without touching legacy data',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage(),database=new MemoryDatabase();localStorage.failReads=true;localStorage.failWrites=true;
 const store=createGameSaveStore({localStorage,database});await store.saveGameSnapshot(snapshot(80));assert.deepEqual(await store.loadGameSave(),snapshot(80));
});

test('timestamps advance beyond loaded versions even when the device clock moves backwards',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage(),database=new MemoryDatabase();database.value={savedAt:500,snapshot:snapshot(10)};
 const store=createGameSaveStore({localStorage,database,now:()=>100});await store.loadGameSave();database.failWrites=true;await store.saveGameSnapshot(snapshot(20));
 assert.equal(JSON.parse(localStorage.getItem(saveKey)!).savedAt,501);assert.deepEqual(await createGameSaveStore({localStorage,database}).loadGameSave(),snapshot(20));
});

test('unavailable backends produce an empty load and an explicitly rejected save',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),store=createGameSaveStore({localStorage:null,database:null});
 assert.equal(await store.loadGameSave(),null);await assert.rejects(store.saveGameSnapshot(snapshot()),/save|persist|storage/i);
});

test('serialization failures reject before replacing a durable save',async()=>{
 const {createGameSaveStore}=await moduleUnderTest(),localStorage=new MemoryStorage(),database=new MemoryDatabase(),store=createGameSaveStore({localStorage,database});
 await store.saveGameSnapshot(snapshot(10));const circular=snapshot(20);circular.structural=circular;
 await assert.rejects(store.saveGameSnapshot(circular));assert.deepEqual(await store.loadGameSave(),snapshot(10));
});

test('the native IndexedDB adapter rejects a disabled or blocked database without hanging',async()=>{
 const {createIndexedDBSaveDatabase}=await moduleUnderTest();
 assert.equal(createIndexedDBSaveDatabase(null),null);
 const disabled={open(){throw new Error('SecurityError: IndexedDB disabled');}} as unknown as IDBFactory;
 await assert.rejects(createIndexedDBSaveDatabase(disabled)!.write({savedAt:1,snapshot:snapshot()}),/disabled/);
 const blocked={open(){const request={} as IDBOpenDBRequest;queueMicrotask(()=>request.onblocked?.call(request,{} as IDBVersionChangeEvent));return request;}} as unknown as IDBFactory;
 await assert.rejects(createIndexedDBSaveDatabase(blocked)!.read(),/blocked/);
});

test('the native IndexedDB adapter waits for transaction commit, not merely successful put',async()=>{
 const {createIndexedDBSaveDatabase}=await moduleUnderTest();
 let transaction!:IDBTransaction,request!:IDBRequest,putStarted!:()=>void;
 const started=new Promise<void>(resolve=>{putStarted=resolve;});
 const database={close(){},transaction(){
  transaction={objectStore(){return {put(){request={} as IDBRequest;putStarted();return request;}};}} as unknown as IDBTransaction;return transaction;
 }} as unknown as IDBDatabase;
 const factory={open(){const open={result:database} as IDBOpenDBRequest;queueMicrotask(()=>open.onsuccess?.call(open,{} as Event));return open;}} as unknown as IDBFactory;
 const backend=createIndexedDBSaveDatabase(factory)!;
 let committed=false;
 const saving=backend.write({savedAt:1,snapshot:snapshot()}).then(()=>{committed=true;});await started;
 request.onsuccess?.call(request,{} as Event);await Promise.resolve();assert.equal(committed,false,'put success is not a committed transaction');
 transaction.oncomplete?.call(transaction,{} as Event);await saving;assert.equal(committed,true);
});

test('the native IndexedDB adapter rejects a transaction abort even after a successful put',async()=>{
 const {createIndexedDBSaveDatabase}=await moduleUnderTest();
 const database={close(){},transaction(){
  const transaction={error:new DOMException('Quota full','QuotaExceededError'),objectStore(){return {put(){const request={} as IDBRequest;queueMicrotask(()=>{request.onsuccess?.call(request,{} as Event);transaction.onabort?.call(transaction,{} as Event);});return request;}};}} as unknown as IDBTransaction;return transaction;
 }} as unknown as IDBDatabase;
 const factory={open(){const request={result:database} as IDBOpenDBRequest;queueMicrotask(()=>request.onsuccess?.call(request,{} as Event));return request;}} as unknown as IDBFactory;
 await assert.rejects(createIndexedDBSaveDatabase(factory)!.write({savedAt:1,snapshot:snapshot()}),/Quota full/);
});
