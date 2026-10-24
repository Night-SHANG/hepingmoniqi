# Browser-ready compact support proof

This is an isolated architecture/performance experiment, not the game. It adds no dependency and does not integrate rendering, Rapier, blast/HP rules, or production gameplay. Local evidence is Node-native Web Crypto plus Vite bundling. No actual browser was launched here; real browser execution must be established independently by the authorized CI run.

## Public browser API

Import `decodePristineBrowser`, `validatePristineBrowser`, `sha256Browser`, `recipeDigestBrowser`, and `topologyDigestBrowser` from `runtime.ts` or `entry.ts`.

1. Construct one immutable-original `CompactLattice` instance from pristine compact stores.
2. Await `decodePristineBrowser(bytes, expectedManifest)`. `bytes` may be an exact `Uint8Array` subview or an `ArrayBuffer`. The exact range and expected manifest are owned before the first await.
3. Await `validatePristineBrowser(source, decoded)`. Typed tables and manifest are owned before the first await. Optional `maxTopologyBytes` can lower the default 64 MiB cap.
4. Call `IndexedStructure.fromPristine(source, token)` with that same source instance. Tokens are single-use and cannot be forged as plain objects. Failed wrong-source use does not consume the valid token.

Original source accessors must remain immutable. This is the existing lattice contract, not a snapshot of arbitrary caller-defined mutable accessor closures. Native `crypto.subtle` is required; there is no JavaScript SHA implementation or Node fallback in the browser entry. The underscored shared-core functions are internal platform-driver plumbing, not public trusted-digest APIs. Hostile code replacing same-realm modules or crypto providers is outside this corruption/ownership boundary.

## Shared implementation and preserved invariants

`compiled-support/pristine-core.ts` contains canonical encoding, owned decode/validation preparation, full graph invariants, and the private token WeakMap. Node's `pristine-validation.ts` remains a synchronous `node:crypto` facade. The public browser facade computes actual hashes itself using native Web Crypto; neither facade accepts claimed digests from callers.

The only algorithm-file change is `indexed-structure.ts` importing the crypto-free core. MIT seeded cut/leave/split/unsupported logic is unchanged. Validation retains recipe, topology, payload digest, exact table sizes, root/object ownership, all members, geometric reciprocal edge counts, same-material connectivity, and exact original ordering. The Node Buffer-subview ownership regression remains green.

Review additionally found and fixed:
- Bitwise alignment overflow could cancel oversized table lengths. Alignment is now arithmetic and all decoded byte/count-derived lengths are capacity checked before table allocation.
- Locale-dependent recipe sorting could disagree across environments. Source checksum names now use canonical UTF-16 code-unit ordering.
- Direct validation now checks source/count/byte shape before copying. Typed arrays are copied through built-in constructors, not caller-overridable `.slice()` methods.

## Memory and timing evidence

Web Crypto is nonstreaming. The browser implementation creates one transient contiguous topology byte buffer, not giant per-cell JSON. A first bounded streaming pass counts bytes; a second fills the exact allocation. It also uses approximately 64 KiB numeric batches plus interned string metadata. Native Web Crypto can copy its input internally, so this is not an absolute peak-memory guarantee.

Three serial fresh-process Node-native-Web-Crypto samples, before helper extraction and review hardening:
- 454,913 cells, including 401,800 terrain cells and 53,113 structure cells; 36 buildings.
- All 60 ordered cut-oracle hashes matched.
- Median decode + full validation + hydration: 521.98 ms; including file I/O: 524.88 ms.
- Median decode: 15.22 ms; validation: 489.46 ms; hydration: 16.31 ms.
- Explicit topology buffer: 12,738,762 bytes (about 12.15 MiB).
- Separate two-pass topology encoding: median 148.08 ms; public SHA call including its ownership copy: median 17.43 ms.

`webcrypto-result-{1,2,3}.json` and `summary.json` preserve those sample facts. `helper-parity-result.json` verifies one subsequent native run using the shared browser/native fixture and cut helpers, with all 20 hashes matching. The final regenerated artifact has identical topology and payload hashes to the historical Node asset; its recipe hash changes to pin current sources. Do not label old timing samples as a measurement of the exact final reviewed revision or as browser timing.

Memory snapshots in profile outputs are GC-retained Node memory, not peak. In particular, `afterHydrationWithDecodedBuffers` deliberately still retains input/decoded tables plus the graph. `arrayBuffers` is included in `external`, so do not add them. The separate topology probe reports the owned buffer exactly; native extra copies and browser peak are not established.

## Minimal real-browser diagnostic page

`index.html` + `demo.ts` provide only Load/Run and Release Graph controls. No fake game or redesigned game UI is included. Build assets first with `generate.ts`, then build with `vite.demo.config.ts`; output is `dist-demo/`. All asset URLs use `new URL(..., import.meta.url)`.

- `#load` loads the actual generated binary/manifest, generates the compact city source, validates through native Web Crypto, hydrates the graph, and compares all 20 cuts individually with the exact ordered SHA-256 oracle and removal counts.
- `#clear` drops the retained graph/source reference. It does not claim that GC ran or that process memory returned to baseline.
- Read-only `window.__supportAB` yields detached diagnostic snapshots: `status`, `active`, `records`, `errors`, and `retainedGraph` (graph diagnostics or null). States are idle/running/passed/error/cleared. Each successful record contains source counts, stage timings, recipe/topology hashes, and 20 step hashes. CI can require passed, no errors, and exact20CutHashes, then verify clear produces inactive + null retainedGraph.

`city-source.ts` and `cut-sequence.ts` are shared with the native profile. Neither duplicates the support graph algorithm. Fixture generation still temporarily constructs structure fixture records; this is not proof of an allocation-free production loader.

## Verification and reproduction

Use the existing application's `tsx`, TypeScript and Vite installation. In the original workspace:

- `node --import ./hepingmoniqi-v09/node_modules/tsx/dist/loader.mjs --test hepingmoniqi-performance-spikes/browser-support/*.test.ts hepingmoniqi-performance-spikes/compiled-support/compiled-support.test.ts hepingmoniqi-performance-spikes/incremental-support/incremental-support.test.ts`
- `node --expose-gc --import ./hepingmoniqi-v09/node_modules/tsx/dist/loader.mjs hepingmoniqi-performance-spikes/browser-support/generate.ts`
- `node --expose-gc --import ./hepingmoniqi-v09/node_modules/tsx/dist/loader.mjs hepingmoniqi-performance-spikes/browser-support/profile.ts`
- `./hepingmoniqi-v09/node_modules/.bin/vite build --config hepingmoniqi-performance-spikes/browser-support/vite.config.ts`
- `./hepingmoniqi-v09/node_modules/.bin/vite build --config hepingmoniqi-performance-spikes/browser-support/vite.demo.config.ts`

Final focused suite: 35 passed (15 browser tests, one independent audit regression, and 19 original Node/incremental tests). Strict ESNext/Bundler typecheck passed. Both Vite builds passed with an explicit plugin rejecting Node builtin imports in their browser graphs. An earlier broad run passed all 85 active spike tests. The production suite completed with 410 passed and one skipped before the final narrow hardening; no production source was edited.

Historical verification errors are preserved rather than hidden: an initial NodeNext typecheck used the wrong module mode for this Bundler project; another overly broad test discovery included the deliberately incomplete frozen source-evidence archive and failed to resolve its omitted domain dependency. Active test discovery must use `performance/*/*.test.ts`, excluding historical archives.

Source manifests resolve actual files via `import.meta.url`, without workspace-absolute paths. A staging rewrite from the original `../../hepingmoniqi-v09/src|vendor` layout to repository `../../src|vendor` must be followed by generation before build. Historical `compiled-support` assets, manifests, measurements and source-evidence remain unchanged; do not silently regenerate or rewrite that baseline.
