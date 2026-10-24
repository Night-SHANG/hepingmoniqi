# Historical Node source evidence

These are byte-identical copies of every source file listed in city-seed-11.manifest.json at the time of the final Node measurements. Their paths preserve the original workspace-relative names. The generator, profile, tests and summarizer are also copied for reproducibility. MIT notice is retained in LICENSE and original source headers.

The parent workspace may subsequently port SHA-256 validation to browsers. Do not overwrite the historical binary, manifest, source evidence or Node results with the new browser version. To replay, use a separate scratch copy of the original workspace with the already installed dependencies, overlay these source paths there, then run the commands in ../AUDIT.md. Do not overlay an actively edited workspace.
