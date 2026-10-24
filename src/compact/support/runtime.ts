// Browser-ready isolated proof. Native Web Crypto only; no Node imports/polyfills.
// Source accessors must expose immutable ORIGINAL topology, as for IndexedStructure.
import {
 MAX_COMPILED_BYTES,recipeText,writeTopology,_prepareDecode,_finishDecode,_preparePristine,_finishPristine,
 type Recipe,type CompiledManifest,type DecodedPristine,type IdentifiedLattice,type ValidatedPristine,
} from './pristine-core.js';
export type {Recipe,CompiledManifest,DecodedPristine,IdentifiedLattice,ValidatedPristine} from './pristine-core.js';
export interface TopologyOptions {maxTopologyBytes?:number}
async function digestOwned(bytes:Uint8Array<ArrayBuffer>):Promise<string> {
 if(!globalThis.crypto?.subtle)throw new Error('Native Web Crypto SHA-256 is required');
 const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
/** Own the exact caller range synchronously, before handing it to Web Crypto. */
export async function sha256Browser(input:Uint8Array|ArrayBuffer|string):Promise<string> {
 if(typeof input==='string')return digestOwned(new TextEncoder().encode(input));
 if(!(input instanceof Uint8Array)&&!(input instanceof ArrayBuffer))throw new Error('Invalid digest input');
 return digestOwned(new Uint8Array(input instanceof ArrayBuffer?new Uint8Array(input):input));
}
export async function recipeDigestBrowser(recipe:Recipe):Promise<string> {return digestOwned(new TextEncoder().encode(recipeText(recipe)));}
/** Internal measurement/encoding helper. Web Crypto is nonstreaming: it needs
 * one transient contiguous topology byte buffer, NOT a full-city JSON snapshot.
 * One canonical streaming pass fills the fixed numeric size plus a small suffix
 * reserve. Only unusually large interned strings grow the bounded owned buffer;
 * no second source enumeration or retained per-cell records are needed.
 * Native Web Crypto may additionally copy its input; that is platform-owned.
 */
export function _topologyBytes(source:IdentifiedLattice,options:TopologyOptions={}):Uint8Array<ArrayBuffer> {
 const n=source.count,max=options.maxTopologyBytes??MAX_COMPILED_BYTES;
 if(!Number.isInteger(n)||n<0||n>=2**31)throw new Error('Invalid source count');
 if(!Number.isSafeInteger(max)||max<0||max>MAX_COMPILED_BYTES||20+28*n+9>max)throw new Error('Topology byte capacity exceeded');
 let owned=new Uint8Array(Math.min(max,20+28*n+9+4096)),at=0;
 writeTopology(source,bytes=>{
  const required=at+bytes.length;if(required>max)throw new Error('Topology byte capacity exceeded');
  if(required>owned.length){const grown=new Uint8Array(Math.min(max,Math.max(required,owned.length*2)));grown.set(owned);owned=grown;}
  owned.set(bytes,at);at=required;
 });
 return owned.subarray(0,at);
}
export async function topologyDigestBrowser(source:IdentifiedLattice,options:TopologyOptions={}):Promise<string> {return digestOwned(_topologyBytes(source,options));}
export async function decodePristineBrowser(input:Uint8Array|ArrayBuffer,expected:CompiledManifest):Promise<DecodedPristine> {
 const p=_prepareDecode(input,expected); // Copies exact byte range and expected manifest before first await.
 const [recipe,expectedRecipe,payload]=await Promise.all([recipeDigestBrowser(p.manifest),recipeDigestBrowser(p.expected),digestOwned(p.bytes.subarray(p.offset) as Uint8Array<ArrayBuffer>)]);
 return _finishDecode(p,{recipe,expectedRecipe,payload});
}
export async function validatePristineBrowser(source:IdentifiedLattice,decoded:DecodedPristine,options:TopologyOptions={}):Promise<ValidatedPristine> {
 const p=_preparePristine(source,decoded); // Own tables and manifest before any async boundary.
 const [recipe,topology,payload]=await Promise.all([recipeDigestBrowser(p.manifest),topologyDigestBrowser(source,options),digestOwned(p.packed.bytes as Uint8Array<ArrayBuffer>)]);
 return _finishPristine(p,{recipe,topology,payload});
}
