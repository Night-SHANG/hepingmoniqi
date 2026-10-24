import {citySource} from './city-source.ts';
import {applyCityCut,orderedUnsupported} from './cut-sequence.ts';
import {CompactLattice} from '../incremental-support/incremental-support.ts';
import {IndexedStructure} from '../incremental-support/indexed-structure.ts';
import {decodePristineBrowser,validatePristineBrowser,sha256Browser,type CompiledManifest} from './runtime.ts';
interface DiagnosticRecord {cellCount:number;chunks:number;artifactBytes:number;recipeSha256:string;topologySha256:string;timings:Record<string,number>;exact20CutHashes:boolean;steps:{step:number;removedCells:number;exactOrderedMembershipSha256:string}[]}
const state:{status:string;active:boolean;records:DiagnosticRecord[];errors:string[]}={status:'idle',active:false,records:[],errors:[]};
let active:{source:CompactLattice;graph:IndexedStructure}|null=null;
const load=document.querySelector<HTMLButtonElement>('#load')!,clear=document.querySelector<HTMLButtonElement>('#clear')!,status=document.querySelector<HTMLElement>('#status')!;
Object.defineProperty(window,'__supportAB',{configurable:false,enumerable:true,get:()=>Object.freeze(structuredClone({...state,active:active!==null,retainedGraph:active?active.graph.diagnostics():null}))});
const show=()=>{status.textContent=JSON.stringify(state,null,2);};
const nextFrame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
const timed=<T>(fn:()=>T)=>{const at=performance.now(),value=fn();return {value,ms:performance.now()-at};};
const timedAsync=async<T>(fn:()=>Promise<T>)=>{const at=performance.now(),value=await fn();return {value,ms:performance.now()-at};};
async function checkedFetch(url:URL){const response=await fetch(url);if(!response.ok)throw new Error(`Asset fetch failed: ${response.status}`);return response;}
load.onclick=async()=>{
 load.disabled=true;clear.disabled=true;active=null;state.active=false;state.status='running';show();await nextFrame();
 try{
  const io=await timedAsync(async()=>{const [bin,manifest,oracle]=await Promise.all([checkedFetch(new URL('./city-seed-11.bin',import.meta.url)),checkedFetch(new URL('./city-seed-11.manifest.json',import.meta.url)),checkedFetch(new URL('../support-ab/city-result-1.json',import.meta.url))]);return {bytes:await bin.arrayBuffer(),manifest:await manifest.json() as CompiledManifest,oracle:await oracle.json()};});
  const built=timed(citySource),s=built.value,lattice=timed(()=>new CompactLattice(s.store,s.input)),source=lattice.value;
  const decoded=await timedAsync(()=>decodePristineBrowser(io.value.bytes,io.value.manifest)),validated=await timedAsync(()=>validatePristineBrowser(source,decoded.value)),hydrated=timed(()=>IndexedStructure.fromPristine(source,validated.value)),graph=hydrated.value;
  if(graph.unsupported().length)throw new Error('Unexpected initially unsupported pieces');
  const steps:DiagnosticRecord['steps']=[],cutStart=performance.now();
  for(let i=0;i<20;i++){
   const removedCells=applyCityCut(source,graph,s.locations,i),pieces=orderedUnsupported(source,graph),hash=await sha256Browser(JSON.stringify(pieces)),expected=io.value.oracle.steps[i];
   if(hash!==expected.exactOrderedMembershipSha256||removedCells!==expected.removedCells)throw new Error(`Exact oracle mismatch at cut ${i+1}`);
   steps.push({step:i+1,removedCells,exactOrderedMembershipSha256:hash});
  }
  active={source,graph};state.active=true;state.status='passed';state.records.push({cellCount:source.count,chunks:graph.chunks.length,artifactBytes:io.value.bytes.byteLength,recipeSha256:io.value.manifest.recipeSha256,topologySha256:io.value.manifest.topologySha256,timings:{fetchMs:io.ms,sourceMs:built.ms,latticeMs:lattice.ms,decodeMs:decoded.ms,validateMs:validated.ms,hydrateMs:hydrated.ms,decodeValidateHydrateMs:decoded.ms+validated.ms+hydrated.ms,cutsAndOracleHashesMs:performance.now()-cutStart},exact20CutHashes:true,steps});
 }catch(error){active=null;state.active=false;state.status='error';state.errors.push(error instanceof Error?error.message:String(error));}
 finally{load.disabled=false;clear.disabled=false;show();}
};
clear.onclick=()=>{active=null;state.active=false;state.status='cleared';show();};
// The getter reads graph diagnostics, retaining the actual graph until clear.
