// Synchronous Node build/profiling facade. Browser code imports pristine-core only.
import {createHash} from 'node:crypto';
import {recipeText,writeTopology,_preparePristine,_finishPristine,type IdentifiedLattice,type Recipe,type DecodedPristine,type ValidatedPristine} from './pristine-core.ts';
export {fields,packPristineTables,consumeValidatedPristine} from './pristine-core.ts';
export type {IdentifiedLattice,PristineTables,Recipe,CompiledManifest,DecodedPristine,ValidatedPristine} from './pristine-core.ts';
export const sha256=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export const recipeDigest=(recipe:Recipe):string=>sha256(recipeText(recipe));
export function topologyDigest(source:IdentifiedLattice):string {const hash=createHash('sha256');writeTopology(source,bytes=>{hash.update(bytes);});return hash.digest('hex');}
export function validatePristine(source:IdentifiedLattice,decoded:DecodedPristine):ValidatedPristine {
 const prepared=_preparePristine(source,decoded);
 return _finishPristine(prepared,{recipe:recipeDigest(prepared.manifest),topology:topologyDigest(source),payload:sha256(prepared.packed.bytes)});
}
