// Node build-time compiler only. Does not launch a browser or alter Node history.
import {writeFileSync} from 'node:fs';
import {CompactLattice} from '../incremental-support/incremental-support.ts';
import {IndexedStructure} from '../incremental-support/indexed-structure.ts';
import {encodePristine} from '../compiled-support/codec.ts';
import {citySource,browserRecipe,timed} from './source.ts';
const s=timed(citySource),source=new CompactLattice(s.value.store,s.value.input),recipe=browserRecipe(),graph=timed(()=>new IndexedStructure(source,recipe.seed)),encoded=timed(()=>encodePristine(source,graph.value,recipe));
writeFileSync(new URL('./city-seed-11.bin',import.meta.url),encoded.value.bytes);
writeFileSync(new URL('./city-seed-11.manifest.json',import.meta.url),JSON.stringify(encoded.value.manifest,null,2)+'\n');
console.log(JSON.stringify({scope:'Node build-time generation only; not browser execution',sourceMs:s.ms,partitionMs:graph.ms,encodeMs:encoded.ms,bytes:encoded.value.bytes.byteLength,manifest:encoded.value.manifest},null,2));
