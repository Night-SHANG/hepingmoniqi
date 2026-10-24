# Isolated browser A/B checks

`preview-browser-check.mjs` uses real selection buttons in the isolated preview viewer. It records input dispatch delay, CPU construction, render submission and a later two-rAF frame opportunity separately, captures actual rendered city screenshots, and records heap across repeated switches and clear/GC.

A later frame opportunity is not measured compositor presentation latency. Screenshot duration is not FPS. This script does not prove formal-game Start latency, 20 full explosions, save compatibility, solver load or mobile performance. Those remain full single-world integration gates.

No local browser has been launched. Run only in the approved standard cloud browser CI environment. The default port is5193; `GAME_URL` and `QA_BROWSER_CHANNEL` can be supplied explicitly.

The preview loop alternates old and compact representations of the same city, not ten real game-map transitions. `support-browser-check.mjs` separately loads the real binary through native browser Web Crypto, validates and hydrates it, checks 20 ordered cut hashes, clears the graph and repeats three times. These cuts are support-occupancy edits, not weapon explosions. Both scripts are prepared but have not yet executed in a browser.
