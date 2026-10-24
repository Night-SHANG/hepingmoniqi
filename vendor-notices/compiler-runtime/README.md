# Windows/Linux runtime and Godot engine notice supplement

Collected 2026-10-24. Keep this directory with the existing Voxel Tools notices. It closes identified **missing notice-text** gaps; it is not legal clearance, an exhaustive SBOM, a binary-to-source attestation, or a safety guarantee.

## Files to retain with an applicable desktop binary package

- `GCC-GPL-3.0.txt` and `GCC-RUNTIME-LIBRARY-EXCEPTION-3.1.txt`: unmodified GCC 15.2.0 upstream text. Identical Git blobs were separately checked in GCC 13.2.0 and 11.4.0, matching the version families found in the Windows/Linux binaries. Keep the exception beside the GPL. Its permissions are conditional; including the GPL does not by itself mean this game must use the GPL.
- `GCC-LIBGCC-SOURCE-NOTICE.txt` and `GCC-LIBSTDCXX-SOURCE-NOTICE.txt`: exact representative GCC 15.2.0 source copyright/exception headers, not a claim to enumerate every linked runtime object.
- `MINGW-W64-RUNTIME-LICENSES.txt`: the full upstream aggregate specifically intended for redistribution of MinGW-linked binaries. Do not remove sections merely because a stripped binary lacks a recognizable string.
- `MINGW-W64-COPYING.txt`, `MINGW-W64-TLS-PUBLIC-DOMAIN-NOTICE.txt`, and `MINGW-W64-PUBLIC-DOMAIN-DISCLAIMER.txt`: upstream project terms plus the observed CRT source family's public-domain notice and disclaimer.
- `WINPTHREADS-LICENSE.txt`: both the upstream MIT notice and Lockless Inc. BSD notice. `WINPTHREADS-RWLOCK-SOURCE-NOTICE.txt` additionally preserves the observed source family's 2011–2016 copyright rather than silently reducing it to the aggregate's 2011 date.
- `GNU-LGPL-2.1.txt`: complete reference text retained because the MinGW runtime aggregate discusses Wine-derived LGPL headers. This inclusion does not establish that LGPL implementation code is linked or impose a license on the game.
- `GODOT-4.7.1-LICENSE.txt` and `GODOT-4.7.1-COPYRIGHT.txt`: exact upstream engine MIT and complete engine third-party notice files from the official 4.7.1 source tag. Godot's own guidance recommends accompanying desktop notices and permits retaining the complete COPYRIGHT file. Replace/review these when the engine changes.

The MinGW files are an immutable upstream notice snapshot, not the recovered toolchain source for the DLLs. Its aggregate retains upstream language about Cephes and Wine-derived files; this review has neither rewritten that language nor resolved which conditional portions were linked. The exact godot-cpp revision also remains unknown; retain the existing supplemental godot-cpp MIT notice.

## Verification

`notice-source-manifest.json` contains exact source URLs, upstream commits/blob IDs, extraction boundaries, local SHA-256 values, and the earlier GCC version cross-checks. The finishing pass rechecked all 13 notice files: nine full files match their recorded upstream Git blob IDs, and four excerpts match their recorded byte counts and SHA-256 values. Full source files for those excerpts are not retained here, so this pass did not independently re-extract them or re-fetch upstream sources. The Git blob IDs identify bytes; they are not a publisher signature or proof of the DLL build inputs.

`runtime-binary-evidence.json` records six Windows/Linux binary hashes, direct comparison with the approved ZIP members, corroborating runtime-family strings, and fresh read-only dependency inspections. Both Windows DLLs import 13 DLL names: `KERNEL32.dll` and 12 `api-ms-win-crt-*` API-set names. Their delay-import directory entries are zero. The former draft's empty Windows lists were a field-name copying error, not evidence of no imports. Linux files each declare three `DT_NEEDED` entries. Non-applicable fields now use `null` plus an explicit status. These tables do not enumerate arbitrary runtime loads or all static objects.

`SHA256SUMS` covers every file in this directory except itself. The parent `vendor-notices/SHA256SUMS` covers the entire notice tree, including this directory's checksum file, and excludes only the parent checksum file. From the project root, run:

```sh
(cd vendor-notices/compiler-runtime && sha256sum --strict -c SHA256SUMS)
(cd vendor-notices && sha256sum --strict -c SHA256SUMS)
```

The extension DLLs contain real MinGW-w64 CRT and winpthreads source paths; this is stronger evidence than a compiler banner alone. Linux static GNU C++ runtime inclusion is corroborated by GNU C++ markers, the build option, and the absence of a dynamic libstdc++ dependency in the inspected ELF dependency lists. These observations do not identify every linked object.

Follow [`docs/EXPORT-NOTICE-BOUNDARY.md`](../../docs/EXPORT-NOTICE-BOUNDARY.md) for packaging. Merely placing these files in the source project does not put them in a delivered build. A source ZIP and a binary export have separate inclusion checks; neither passing the checksum check nor retaining this bundle constitutes complete redistribution clearance.
