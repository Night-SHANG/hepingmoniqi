# Voxel Tools v1.7x notices

These files accompany the provenance and third-party notice review in [`docs/VOXEL-THIRD-PARTY-NOTICES.md`](../docs/VOXEL-THIRD-PARTY-NOTICES.md).

The root notice text files reproduce full upstream licences or exact opening comment excerpts from the inspected sources. Do not replace them with a generic MIT label. `evidence/notice-source-manifest.json` records each source URL, Git blob, and extraction boundary.

`supplemental/` contains independently verified current official upstream licences. In particular, the current godot-cpp commit is not established as the revision compiled into the release. These files do not erase the unresolved provenance/runtime questions in the audit.

`evidence/` contains read-only audit results and text-only build-script snapshots. They were not executed. The Transvoxel evidence compares integer data without copying the tables into this bundle.

`compiler-runtime/` adds 13 GCC/MinGW/winpthreads and official Godot 4.7.1 notice texts, a source manifest, and a fresh six-binary Windows/Linux inspection. It closes identified missing-text gaps, not exact runtime build provenance or Android/iOS/macOS coverage. See [`docs/EXPORT-NOTICE-BOUNDARY.md`](../docs/EXPORT-NOTICE-BOUNDARY.md) for the updated desktop and source-package boundary; the older extension-only audit remains historical evidence, not the final status of this supplement.

`SHA256SUMS` recursively covers every file under this directory except itself, including the separate `compiler-runtime/SHA256SUMS`. Verify it from this directory with `sha256sum --strict -c SHA256SUMS`. Checksums detect changed or missing listed bytes; separately compare the manifest's path set with the actual tree to detect extra or omitted inventory entries.

Before distributing a game, review unresolved platform runtimes and engine dependencies, place applicable notices in user-accessible accompanying material, and verify the final archive actually contains them. A CI source archive must retain this entire directory plus the applicable documentation and asset licences. A binary export needs explicit sidecar copying because the project export excludes this tree. This audit did not publish, upload or create a final delivery archive.
