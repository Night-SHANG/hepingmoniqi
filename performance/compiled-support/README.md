# Compiled pristine support proof

See [AUDIT.md](AUDIT.md) for exact scope, binary layout, validation, reproducible commands and caveats; [summary.json](summary.json) summarizes nine corrected serial runs.

- `codec.ts`: deterministic binary encode/decode and expected-build identity checks.
- `pristine-validation.ts`: streaming topology/payload SHA-256, full semantic validation and private single-use hydration capabilities.
- `compiled-support.test.ts`: eight new tests; original adapter's eleven tests remain unchanged.
- `source.ts`: unchanged-city compact source plus exact source-file recipe checksums.
- `generate.ts`: original seeded partition, reproducible binary generation and complete round-trip equality.
- `profile.ts`: fresh-process uncached/first-read/second-load comparisons, twenty exact cuts and retained/released memory.
- `city-seed-11.bin`, `city-seed-11.manifest.json`: 3,857,400-byte fixed-city asset and trusted-build manifest.
- `generation-result.json`, `*-result-{1,2,3}.json`: raw results; `summarize.py` reproduces summary.
- `proof-test.txt`, `typecheck.txt`, `red-*.txt`: test/typecheck and RED evidence.

The only edits outside this directory are approved small hydration/export hooks in `../incremental-support/indexed-structure.ts` and `incremental-support.ts`. No production integration, remote write, browser or physics claim.
