// Build/profile-only source manifest. Every file is resolved relative to this
// module so staging the performance directory does not embed workspace paths.
import {readFileSync} from 'node:fs';
import {sha256,type Recipe} from '../compiled-support/pristine-validation.ts';
export {citySource} from './city-source.ts';
export const timed=<T>(fn:()=>T)=>{const at=performance.now(),value=fn();return {value,ms:performance.now()-at};};
const inputs:Record<string,URL>={
 'application/src/structural/fixtures.ts':new URL('../../src/structural/fixtures.ts',import.meta.url),
 'application/src/structural/game-fixtures.ts':new URL('../../src/structural/game-fixtures.ts',import.meta.url),
 'application/src/structural/types.ts':new URL('../../src/structural/types.ts',import.meta.url),
 'application/src/world-layout.ts':new URL('../../src/world-layout.ts',import.meta.url),
 'application/vendor/three-voxel-destruction/structure.ts':new URL('../../vendor/three-voxel-destruction/structure.ts',import.meta.url),
 'performance/terrain/compact-terrain.ts':new URL('../terrain/compact-terrain.ts',import.meta.url),
 'performance/terrain/legacy-layout-columns.ts':new URL('../terrain/legacy-layout-columns.ts',import.meta.url),
 'performance/structure-store/compact-structures.ts':new URL('../structure-store/compact-structures.ts',import.meta.url),
 'performance/support-ab/sparse-structure-fixture.ts':new URL('../support-ab/sparse-structure-fixture.ts',import.meta.url),
 'performance/incremental-support/indexed-structure.ts':new URL('../incremental-support/indexed-structure.ts',import.meta.url),
 'performance/incremental-support/incremental-support.ts':new URL('../incremental-support/incremental-support.ts',import.meta.url),
 'performance/compiled-support/codec.ts':new URL('../compiled-support/codec.ts',import.meta.url),
 'performance/compiled-support/pristine-validation.ts':new URL('../compiled-support/pristine-validation.ts',import.meta.url),
 'performance/compiled-support/pristine-core.ts':new URL('../compiled-support/pristine-core.ts',import.meta.url),
 'performance/compiled-support/source.ts':new URL('../compiled-support/source.ts',import.meta.url),
 'performance/browser-support/city-source.ts':new URL('./city-source.ts',import.meta.url),
 'performance/browser-support/cut-sequence.ts':new URL('./cut-sequence.ts',import.meta.url),
 'performance/browser-support/runtime.ts':new URL('./runtime.ts',import.meta.url),
 'performance/browser-support/source.ts':new URL('./source.ts',import.meta.url),
 'performance/browser-support/generate.ts':new URL('./generate.ts',import.meta.url),
};
export function browserRecipe():Recipe {return {mapId:'city',seed:11,sourceChecksums:Object.fromEntries(Object.entries(inputs).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,url])=>[name,sha256(readFileSync(url))]))};}
