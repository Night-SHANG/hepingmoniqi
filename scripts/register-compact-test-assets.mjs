// Test host adapter only: load the exact generated browser artifacts from disk.
// It does not change gameplay, physics, save validation, or research state.
import {readFile} from 'node:fs/promises';
import {configureCompactSupportAssetLoader} from '../src/compact/support/index.ts';
configureCompactSupportAssetLoader(async map=>{
 const root=new URL('../src/compact/support/assets/',import.meta.url);
 const [artifactBytes,manifest]=await Promise.all([readFile(new URL(`${map}-seed-11.bin`,root)),readFile(new URL(`${map}-seed-11.manifest.json`,root),'utf8')]);
 return {artifactBytes,expectation:JSON.parse(manifest)};
});
