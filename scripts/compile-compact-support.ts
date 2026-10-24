/** Node build-time only. Runtime never runs the material-seeded city partition. */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import type {MapId} from '../src/contracts.js';
import {createCompactGameFixture} from '../src/compact/fixture.js';
import {CompactSupportLattice} from '../src/compact/support/lattice.js';
import {IndexedStructure} from '../src/compact/support/indexed-structure.js';
import {encodePristine,decodePristine} from '../src/compact/support/node-codec.js';
import {sha256,recipeDigest,validatePristine,consumeValidatedPristine,type Recipe,type CompiledManifest} from '../src/compact/support/node-validation.js';

export const COMPACT_SUPPORT_MAPS:readonly MapId[]=['courtyard','warehouse','bridge','tower','cantilever','neighborhood','city'];
export const COMPACT_SUPPORT_SEED=11;
const root=new URL('../',import.meta.url),assets=new URL('src/compact/support/assets/',root);
// Canonical application-relative names only. No spike paths, machine directories,
// timestamps, generated manifest cycles, or unstated external source dependencies.
const sourceFiles=[
 'scripts/compile-compact-support.ts',
 'src/compact/fixture.ts',
 'src/compact/support/lattice.ts',
 'src/compact/support/indexed-structure.ts',
 'src/compact/support/pristine-core.ts',
 'src/compact/support/runtime.ts',
 'src/compact/support/node-validation.ts',
 'src/compact/support/node-codec.ts',
 'src/domain.ts',
 'src/map-generators.ts','src/scaled-map-generators.ts','src/generated/voxel-buildings.json',
 'src/world-layout.ts','src/structural/fixtures.ts','src/structural/game-fixtures.ts',
] as const;
export function compactSupportRecipe(map:MapId):Recipe {
 if(!COMPACT_SUPPORT_MAPS.includes(map))throw new Error('Unknown support map');
 return {mapId:map,seed:COMPACT_SUPPORT_SEED,sourceChecksums:Object.fromEntries([...sourceFiles].sort().map(name=>[name,sha256(readFileSync(new URL(name,root)))]))};
}
export function checkCompactSupport(map:MapId):CompiledManifest {
 const expected=JSON.parse(readFileSync(new URL(`${map}-seed-${COMPACT_SUPPORT_SEED}.manifest.json`,assets),'utf8')) as CompiledManifest;
 const recipe=compactSupportRecipe(map);
 if(expected.recipeSha256!==recipeDigest(recipe))throw new Error(`Stale compact support recipe for ${map}; rebuild artifacts`);
 const bytes=readFileSync(new URL(`${map}-seed-${COMPACT_SUPPORT_SEED}.bin`,assets)),source=new CompactSupportLattice(createCompactGameFixture(map));
 const decoded=decodePristine(bytes,expected);consumeValidatedPristine(source,validatePristine(source,decoded));
 return expected;
}
export function compileCompactSupport(map:MapId){
 const at=performance.now(),recipe=compactSupportRecipe(map),fixture=createCompactGameFixture(map),source=new CompactSupportLattice(fixture);
 const sourceMs=performance.now()-at,start=performance.now(),graph=new IndexedStructure(source,recipe.seed),partitionMs=performance.now()-start;
 const encoding=performance.now(),encoded=encodePristine(source,graph,recipe),encodeMs=performance.now()-encoding;
 if(recipeDigest(compactSupportRecipe(map))!==encoded.manifest.recipeSha256)throw new Error(`Sources changed while compiling ${map}; retry with stable source files`);
 mkdirSync(assets,{recursive:true});
 writeFileSync(new URL(`${map}-seed-${recipe.seed}.bin`,assets),encoded.bytes);
 writeFileSync(new URL(`${map}-seed-${recipe.seed}.manifest.json`,assets),JSON.stringify(encoded.manifest,null,2)+'\n');
 return {map,sourceMs,partitionMs,encodeMs,bytes:encoded.bytes.byteLength,manifest:encoded.manifest};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const flag=process.argv.indexOf('--map'),maps=flag>=0?[process.argv[flag+1] as MapId]:COMPACT_SUPPORT_MAPS;
 if(process.argv.includes('--ensure'))for(const map of maps){try{const manifest=checkCompactSupport(map);console.log(JSON.stringify({map,checked:true,recipe:manifest.recipeSha256}));}catch{const result=compileCompactSupport(map);console.log(JSON.stringify({map,compiled:true,bytes:result.bytes,recipe:result.manifest.recipeSha256}));}}
 else if(process.argv.includes('--check'))for(const map of maps)console.log(JSON.stringify({map,checked:true,manifest:checkCompactSupport(map)}));
 else for(const map of maps)console.log(JSON.stringify(compileCompactSupport(map)));
}
