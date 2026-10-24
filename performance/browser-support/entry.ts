// Browser library entry, deliberately importing the real graph and compact stores.
export {sha256Browser,recipeDigestBrowser,topologyDigestBrowser,decodePristineBrowser,validatePristineBrowser} from './runtime.ts';
export {IndexedStructure} from '../incremental-support/indexed-structure.ts';
export {CompactLattice,CompactIncrementalSupport} from '../incremental-support/incremental-support.ts';
export {CompactStructures} from '../structure-store/compact-structures.ts';
export {CompactTerrain} from '../terrain/compact-terrain.ts';
