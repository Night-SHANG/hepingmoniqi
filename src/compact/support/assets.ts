// Vite owns these exact static asset URLs; no deployment path is guessed.
import type {MapId} from '../../contracts.js';
import type {CompactSupportOptions} from './index.js';
import type {CompiledManifest} from './pristine-core.js';
import courtyardManifest from './assets/courtyard-seed-11.manifest.json';
import courtyardUrl from './assets/courtyard-seed-11.bin?url';
import warehouseManifest from './assets/warehouse-seed-11.manifest.json';
import warehouseUrl from './assets/warehouse-seed-11.bin?url';
import bridgeManifest from './assets/bridge-seed-11.manifest.json';
import bridgeUrl from './assets/bridge-seed-11.bin?url';
import towerManifest from './assets/tower-seed-11.manifest.json';
import towerUrl from './assets/tower-seed-11.bin?url';
import cantileverManifest from './assets/cantilever-seed-11.manifest.json';
import cantileverUrl from './assets/cantilever-seed-11.bin?url';
import neighborhoodManifest from './assets/neighborhood-seed-11.manifest.json';
import neighborhoodUrl from './assets/neighborhood-seed-11.bin?url';
import cityManifest from './assets/city-seed-11.manifest.json';
import cityUrl from './assets/city-seed-11.bin?url';
const assets:Record<MapId,{url:string;manifest:CompiledManifest}>={
 courtyard:{url:courtyardUrl,manifest:courtyardManifest},
 warehouse:{url:warehouseUrl,manifest:warehouseManifest},
 bridge:{url:bridgeUrl,manifest:bridgeManifest},
 tower:{url:towerUrl,manifest:towerManifest},
 cantilever:{url:cantileverUrl,manifest:cantileverManifest},
 neighborhood:{url:neighborhoodUrl,manifest:neighborhoodManifest},
 city:{url:cityUrl,manifest:cityManifest},
};
export async function loadCompactSupportAsset(map:MapId):Promise<CompactSupportOptions>{
 const asset=assets[map];if(!asset)throw new Error('Unknown compiled support asset');
 const response=await fetch(asset.url);if(!response.ok)throw new Error(`Compiled support asset request failed: ${response.status}`);
 return {artifactBytes:await response.arrayBuffer(),expectation:asset.manifest};
}
