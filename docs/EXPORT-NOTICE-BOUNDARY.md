# Desktop export notice boundary

Reviewed 2026-10-24. Applies to the approved official Voxel Tools `v1.7x` extension archive and the project's official Godot **4.7.1** Windows/Linux export path. This is an engineering notice-packaging checklist, not legal advice or complete redistribution clearance.

## What has been closed

The earlier extension audit's missing GCC/MinGW notice-text gap now has a concrete local bundle in [`vendor-notices/compiler-runtime/`](../vendor-notices/compiler-runtime/). It includes GPLv3 **and** GCC Runtime Library Exception 3.1, MinGW's full redistributor-oriented runtime aggregate, winpthreads MIT/BSD notices, representative source copyright notices, and the official Godot 4.7.1 MIT plus complete engine `COPYRIGHT.txt`. The existing Voxel/LZ4/meshoptimizer/FastNoiseLite/PCG/Transvoxel/godot-cpp notices remain necessary; this supplement does not replace them.

Exact source URLs and SHA-256 values are recorded in [`notice-source-manifest.json`](../vendor-notices/compiler-runtime/notice-source-manifest.json). The finishing pass recomputed all 13 local notice hashes and sizes: nine full files match the previously recorded upstream Git blob IDs, and four source-comment excerpts match their recorded hashes. The full excerpt source files are not retained, so independent re-extraction was not performed in this pass. The earlier upstream cross-check recorded byte-identical GPLv3 and runtime-exception texts in GCC 11.4.0, 13.2.0 and 15.2.0. No upstream fetch was repeated for this local finishing pass.

The extension's Windows DLLs contain paths identifying `mingw-w64-crt/crt/tls_atexit.c` and winpthreads `nanosleep.c`/`rwlock.c`, alongside the MinGW GCC 15.2.0 banner. Linux binaries identify GCC 13.2.0 or 11.4.0 and GNU C++ runtime markers. See [`runtime-binary-evidence.json`](../vendor-notices/compiler-runtime/runtime-binary-evidence.json). No downloaded code or native library was executed for this supplement.

All six inspected installed libraries were rehashed and match the corresponding members of the approved extension ZIP. Direct `objdump -p` inspection found the same 13 imported DLL names in both Windows libraries: `KERNEL32.dll` plus 12 UCRT API-set names. The earlier supplement's empty Windows import arrays were caused by reading the wrong key from the original audit, not by absence of imports; this is corrected. Both PE delay-import directory entries are zero. Direct `readelf -d` inspection confirms the three declared dependencies per Linux library. These are declared direct dependencies, not a complete account of runtime-loaded or statically linked libraries.

## Still required for the actual delivery

1. Package an accessible `THIRD-PARTY-NOTICES/` directory beside the executable, rather than relying on files hidden inside a PCK. Copy the applicable existing notice bundle, this runtime/engine supplement, and the game's font and other asset licenses. Keeping the complete collected bundle avoids accidental omission when pruning components.
2. The inspected `export_presets.cfg` excludes `vendor-notices/*` and `docs/*`. This is compatible with sidecar packaging, but an export alone does **not** satisfy the notice-delivery step. The exporter or release packager must copy the sidecars explicitly.
3. Inventory the final Windows/Linux archive, verify every required notice is present and readable, and record notice SHA-256 values alongside the executable, PCK and extension hashes. Check the archive that will actually be delivered, not only the source directory or staging folder.
4. Keep the target set narrow. This supplement does not close Android NDK/libc++, iOS or macOS runtime coverage. A full multi-platform addon/source archive requires review of those additional shipped files. Do not remove or rebuild native libraries merely as a notice-audit side effect.
5. If engine version, native extension, font/assets, or packaged runtime libraries change, update the corresponding notices and repeat archive verification. Linux system libraries or Microsoft/UCRT system DLLs merely imported from the operating system are not asserted to be bundled; independently review any such libraries if the package actually supplies copies.

No final distributable was created, shared, uploaded or published by this notice task. A successful local export or compatibility test is not the same as a verified notice-bearing delivery.

## CI source-package contract

The source packager must include the complete `vendor-notices/` tree, including both checksum files, all 13 supplement texts, both supplement JSON manifests, the existing source-component notices and the audit evidence. It must also retain this document, `docs/VOXEL-THIRD-PARTY-NOTICES.md`, `assets/fonts/LICENSE.txt`, and `assets/fonts/SOURCE.txt`. These files must be normal readable archive members, not only references to files outside the ZIP. Preserve directory structure so the relative links and checksums continue to work.

Before packaging, verify both inventories from the project root:

```sh
(cd vendor-notices/compiler-runtime && sha256sum --strict -c SHA256SUMS)
(cd vendor-notices && sha256sum --strict -c SHA256SUMS)
```

The top-level inventory covers the entire notice tree except its own `SHA256SUMS`; the nested inventory excludes only its own checksum file. Compare each inventory's path set against the actual files as well as verifying listed hashes. After packaging, reopen the actual ZIP, reject duplicate or unsafe archive paths, verify the required members and their bytes against the checked source files, and verify the archived notice inventories relative to their respective directories. A staging-directory-only check is insufficient. A later edit to any covered file requires regenerating the applicable checksum inventories.

Do not confuse a source-development archive with a desktop-only binary distribution. If a source package includes the untouched full addon, it also carries Android, iOS and macOS native libraries; this Windows/Linux supplement does not close their runtime notice or provenance review. The source packager should report its actual platform inventory and carry this caveat rather than call the package fully cleared. The notice audit does not authorize pruning native libraries, changing addon settings, publishing, or uploading files. Final archive verification is the packager's remaining step, not a result claimed here.

## Provenance caveats, not blanket bans on local development

- **Exact godot-cpp revision:** still unknown because the inspected workflow names a moving branch. The existing supplemental MIT file is retained and labeled as such. Unknown checkout provenance is not evidence that an additional license is missing or that local testing must stop; it prevents claiming exact source attestation.
- **Exact runtime builds:** compiler/version and source-path strings identify runtime families, not the distribution's exact patched source or complete linked-object inventory. GCC notice versions were cross-checked; MinGW notices are pinned to a separately observed upstream snapshot, not misrepresented as recovered DLL build inputs.
- **Conditional MinGW portions:** the upstream aggregate itself preserves ambiguity about Cephes and discusses Wine-derived LGPL headers. This task retains that text and the full LGPL reference rather than declaring which conditional portions apply without link records. No blanket claim that the game is GPL/LGPL, or that the runtime exception is unconditional, is made.
- **Coverage:** full engine and known runtime aggregates reduce concrete missing-text gaps. They do not prove every header/object in the original builds has been audited. Nothing here is a security certification or legal clearance.

These distinctions allow authorized local implementation/build/testing to continue while keeping the public-delivery checklist explicit. Do not describe the whole archive as MIT-only or as having complete build provenance.

## Primary sources

- [GCC Runtime Library Exception and libstdc++ licensing](https://gcc.gnu.org/onlinedocs/libstdc++/manual/license.html).
- [GCC 15.2.0 GPLv3](https://github.com/gcc-mirror/gcc/blob/5115c7e447fc07457443df874bf57840e8316d5f/COPYING3) and [runtime exception](https://github.com/gcc-mirror/gcc/blob/5115c7e447fc07457443df874bf57840e8316d5f/COPYING.RUNTIME).
- [MinGW runtime redistribution notice](https://github.com/mingw-w64/mingw-w64/blob/7ce22f6637cc93fd2eb37c8a645908c92bb80bbd/COPYING.MinGW-w64-runtime/COPYING.MinGW-w64-runtime.txt) and [upstream packaging explanation](https://github.com/mingw-w64/mingw-w64/blob/7ce22f6637cc93fd2eb37c8a645908c92bb80bbd/COPYING.MinGW-w64/COPYING.MinGW-w64.txt).
- [winpthreads license](https://github.com/mingw-w64/mingw-w64/blob/7ce22f6637cc93fd2eb37c8a645908c92bb80bbd/mingw-w64-libraries/winpthreads/COPYING).
- [Godot 4.7.1 MIT](https://github.com/godotengine/godot/blob/a13da4feb8d8aefc283c3763d33a2f170a18d541/LICENSE.txt), [complete engine third-party notices](https://github.com/godotengine/godot/blob/a13da4feb8d8aefc283c3763d33a2f170a18d541/COPYRIGHT.txt), and [Godot notice-packaging guidance](https://docs.godotengine.org/en/stable/about/complying_with_licenses.html).
