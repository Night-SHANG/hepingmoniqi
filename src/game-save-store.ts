import type {WorldSnapshot} from './contracts.js';

export const GAME_SAVE_KEY='hepingmoniqi.structural.v09';
export const LEGACY_GAME_SAVE_KEY='hepingmoniqi.first-playable.v1';
export const GAME_SAVE_DATABASE='hepingmoniqi.saves';
export const GAME_SAVE_OBJECT_STORE='snapshots';
// Web Storage quotas count UTF-16 code units on some browsers. Keep the
// optional mirror well below the quota and leave the old save untouched.
export const LOCAL_SAVE_MIRROR_MAX_BYTES=1_000_000;

export interface GameSaveEnvelope {savedAt:number;snapshot:WorldSnapshot;}
interface GameSavePointer {savedAt:number;storage:'indexeddb';}
export interface GameSaveDatabase {
 read():Promise<unknown>;
 /** Resolve only after the write transaction has committed. */
 write(envelope:GameSaveEnvelope):Promise<void>;
}
export interface GameSaveStoreOptions {
 localStorage?:Pick<Storage,'getItem'|'setItem'>|null;
 database?:GameSaveDatabase|null;
 now?:()=>number;
 localMirrorMaxBytes?:number;
}

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const timestamp=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER;
// Persistence validates the container, not the physical simulation. The world
// adapter remains responsible for its full, atomic domain validation on restore.
function snapshotShape(value:unknown):value is WorldSnapshot {
 if(!record(value))return false;
 return (value.schemaVersion===undefined||[2,3,4,5,6,7,8,9].includes(value.schemaVersion as number))
  &&Number.isSafeInteger(value.epoch)&&Number(value.epoch)>=0
  &&Array.isArray(value.voxels)&&Number.isSafeInteger(value.totalCount)&&Number(value.totalCount)>=0
  &&Number.isSafeInteger(value.destroyedCount)&&Number(value.destroyedCount)>=0
  &&Number(value.destroyedCount)<=Number(value.totalCount)
  &&Number.isSafeInteger(value.research)&&Number(value.research)>=0
  &&typeof value.firstRewardClaimed==='boolean'
  &&(value.schemaVersion!==9||(record(value.structural)&&value.structural.schema==='structural-game/v1'));
}
function envelope(value:unknown):GameSaveEnvelope|null {
 if(!record(value)||!timestamp(value.savedAt)||!snapshotShape(value.snapshot))return null;
 return {savedAt:value.savedAt,snapshot:value.snapshot};
}
function pointer(value:unknown):GameSavePointer|null {
 return record(value)&&timestamp(value.savedAt)&&value.storage==='indexeddb'&&!('snapshot' in value)
  ?{savedAt:value.savedAt,storage:'indexeddb'}:null;
}
function browserLocalStorage():GameSaveStoreOptions['localStorage'] {
 try{return globalThis.localStorage??null;}catch{return null;}
}
function browserIndexedDB():IDBFactory|null {
 try{return globalThis.indexedDB??null;}catch{return null;}
}

/** Built-in IndexedDB only: no dependency, network request, or remote service. */
export function createIndexedDBSaveDatabase(factory:IDBFactory|null=browserIndexedDB()):GameSaveDatabase|null {
 if(!factory)return null;
 function open():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
   let done=false;
   const timer=setTimeout(()=>finish(new Error('Save database open timed out')),3000);
   const finish=(error:Error)=>{if(done)return;done=true;clearTimeout(timer);reject(error);};
   let request:IDBOpenDBRequest;
   try{request=factory!.open(GAME_SAVE_DATABASE,1);}catch(error){finish(error instanceof Error?error:new Error('Save database unavailable'));return;}
   request.onupgradeneeded=()=>{
    if(done){request.transaction?.abort();return;}
    const database=request.result;
    if(!database.objectStoreNames.contains(GAME_SAVE_OBJECT_STORE))database.createObjectStore(GAME_SAVE_OBJECT_STORE);
   };
   request.onerror=()=>finish(request.error??new Error('Save database unavailable'));
   request.onblocked=()=>finish(new Error('Save database is blocked by another page'));
   request.onsuccess=()=>{
    const database=request.result;
    if(done){database.close();return;}
    done=true;clearTimeout(timer);
    database.onversionchange=()=>database.close();
    resolve(database);
   };
  });
 }
 async function transaction(mode:IDBTransactionMode,value?:GameSaveEnvelope):Promise<unknown>{
  const database=await open();
  return new Promise((resolve,reject)=>{
   let result:unknown=null,tx:IDBTransaction;
   try{
    tx=database.transaction(GAME_SAVE_OBJECT_STORE,mode);
    // Request success is not durability. Quota and commit failures can still
    // abort the transaction, so callers are released only by oncomplete.
    tx.oncomplete=()=>{database.close();resolve(result);};
    tx.onabort=()=>{database.close();reject(tx.error??new Error('Save database transaction aborted'));};
    const store=tx.objectStore(GAME_SAVE_OBJECT_STORE);
    const request=mode==='readonly'?store.get(GAME_SAVE_KEY):store.put(value,GAME_SAVE_KEY);
    request.onsuccess=()=>{result=request.result;};
   }catch(error){database.close();reject(error);}
  });
 }
 return {read:()=>transaction('readonly'),async write(value){await transaction('readwrite',value);}};
}

/** Separate instances support deterministic storage tests without browser shims. */
export function createGameSaveStore(options:GameSaveStoreOptions={}) {
 const local=options.localStorage===undefined?browserLocalStorage():options.localStorage;
 const database=options.database===undefined?createIndexedDBSaveDatabase():options.database;
 const now=options.now??Date.now,mirrorLimit=options.localMirrorMaxBytes??LOCAL_SAVE_MIRROR_MAX_BYTES;
 let writes:Promise<void>=Promise.resolve(),latestSavedAt=0;
 function readLocal(key:string):unknown {
  try{const raw=local?.getItem(key);return raw?JSON.parse(raw):null;}catch{return null;}
 }
 async function readCurrent(){
  const localValue=readLocal(GAME_SAVE_KEY);
  let databaseValue:unknown=null;
  try{databaseValue=await database?.read()??null;}catch{/* A small mirror may still be durable. */}
  const localEnvelope=envelope(localValue),databaseEnvelope=envelope(databaseValue),localPointer=pointer(localValue);
  latestSavedAt=Math.max(latestSavedAt,localEnvelope?.savedAt??0,databaseEnvelope?.savedAt??0,localPointer?.savedAt??0);
  return {localValue,localEnvelope,databaseEnvelope,localPointer};
 }
 async function loadGameSave():Promise<unknown|null>{
  await writes;
  const {localValue,localEnvelope,databaseEnvelope,localPointer}=await readCurrent();
  const newest=databaseEnvelope&&(!localEnvelope||databaseEnvelope.savedAt>=localEnvelope.savedAt)?databaseEnvelope:localEnvelope;
  if(localPointer&&(!newest||newest.savedAt<localPointer.savedAt)){
   // A pointer proves newer progress exists. Returning old legacy research
   // here would silently roll the user back when IndexedDB is only blocked.
   throw new Error('The latest game save is in an unavailable save database');
  }
  if(newest)return newest.snapshot;
  if(snapshotShape(localValue))return localValue;
  const legacy=readLocal(LEGACY_GAME_SAVE_KEY);
  return snapshotShape(legacy)?legacy:null;
 }
 function saveGameSnapshot(snapshot:WorldSnapshot):Promise<void>{
  let owned:WorldSnapshot;
  try{
   // Clone before joining the queue: callers may immediately mutate or replace
   // their world while an older transaction is still in flight.
   owned=JSON.parse(JSON.stringify(snapshot)) as WorldSnapshot;
   if(!snapshotShape(owned))throw new Error('Invalid game save snapshot');
  }catch(error){return Promise.reject(error);}
  const saving=writes.then(async()=>{
   // Also protects calls made before load, and fallback writes after a reload
   // or a backwards wall-clock adjustment.
   await readCurrent();
   const clock=Math.floor(now());
   const savedAt=Math.max(Number.isSafeInteger(clock)&&clock>=0?clock:0,latestSavedAt+1);
   if(!timestamp(savedAt))throw new Error('Game save timestamp limit exceeded');
   latestSavedAt=savedAt;
   const value:GameSaveEnvelope={savedAt,snapshot:owned};
   let databaseSaved=false,localSaved=false;
   const errors:unknown[]=[];
   try{if(database){await database.write(value);databaseSaved=true;}}catch(error){errors.push(error);}
   const serialized=JSON.stringify(value),small=serialized.length*2<=mirrorLimit;
   // A pointer is useful only after the full snapshot has really committed.
   if(small||databaseSaved){
    try{
     if(local){local.setItem(GAME_SAVE_KEY,small?serialized:JSON.stringify({savedAt,storage:'indexeddb'} satisfies GameSavePointer));localSaved=small;}
    }catch(error){errors.push(error);}
   }
   if(!databaseSaved&&!localSaved)throw new AggregateError(errors,'Game save could not be persisted in browser storage');
  });
  // A rejected write must not poison future saves, but its own caller must
  // still see the failure and must not display a successful-save message.
  writes=saving.catch(()=>undefined);
  return saving;
 }
 return {loadGameSave,saveGameSnapshot};
}

let browserStore:ReturnType<typeof createGameSaveStore>|undefined;
const defaultStore=()=>browserStore??=createGameSaveStore();
export const loadGameSave=():Promise<unknown|null>=>defaultStore().loadGameSave();
export const saveGameSnapshot=(snapshot:WorldSnapshot):Promise<void>=>defaultStore().saveGameSnapshot(snapshot);
