# Validated compact support

Public API (`index.ts`):

- `await createCompactSupport(store, { artifactBytes, expectation })`
- Returned graph: `remove(ids)`, `unsupported()`, synchronous `reset()`, `dispose()`,
  and `diagnostics()`.
- `prepareCompactSupport(store, options)` optionally validates once and returns a
  factory for independent graphs over the same immutable fixture/store.
- `configureCompactSupportAssetLoader(loader)` supplies an environment loader and
  returns idempotent cleanup. Only one host loader may be installed. It supplies
  bytes and expected metadata, not trusted graph state: full validation still runs.

Outside a browser, provide bytes/manifest or install the host loader. The test
preloader reads real generated artifacts using Node filesystem APIs. Those APIs
are not imported by the production browser path.

The default browser loader dynamically imports `assets.ts`. All seven binary
URLs and manifests are static Vite imports; no deployment base URL is guessed.
Native asynchronous Web Crypto is required. No SHA JavaScript fallback, Node
crypto import, or polyfill is used in the browser validation path.

Build-time generation:

    node --import tsx scripts/compile-compact-support.ts
    node --import tsx scripts/compile-compact-support.ts --map city
    node --import tsx scripts/compile-compact-support.ts --check

Generation runs the deterministic seed-11 partition once per map in sequence and
writes canonical binary tables plus a manifest. `--check` rejects stale source
recipes, corrupt payloads, wrong topology, and semantic graph defects. It never
repartitions. Sources are application-relative, timestamps are excluded, and
there are no historical spike-directory dependencies. Only generator, lattice,
partition, codec/validation, and compiler source files are hashed; renderers,
mutable stores, simulation kernels, loaders, and type-only files are excluded.
Because some existing source files mix map generation with other code, edits to
those shared files conservatively invalidate artifacts even if topology is
unchanged. Recompile/check after generator source edits and before releasing.

Runtime does not perform full-city material seed partitioning. Hashing and
semantic validation still traverse immutable original topology and allocate a
bounded transient topology byte buffer. Do not describe this as free startup or
60 FPS. The twenty-cut tests are Node-native correctness tests, not browser or
full-game performance measurements.
