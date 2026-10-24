# Fresh import shutdown compatibility boundary

Godot 4.7.1 plus Voxel Tools v1.7x aborts on a fresh editor `--import`
invocation after resources finish importing. This reproduced in local Linux
(SIGABRT / -6), GitHub Ubuntu (134) and the first Windows import (nonzero).
No script parse error was emitted. The upstream native abort cause is not
proven fixed.

The CI uses a normal editor initialization with `--max-fps 60 --quit-after 120`
instead of the import-and-immediately-exit mode. Three independent clean local
imports with this lifecycle exited 0 and produced the font import cache;
the immediate-exit negative control still aborted after producing the cache.
This is a lifecycle workaround, not suppression of the failure: CI requires
exit 0 and then separately validates actual graphical game inputs and actual
Windows release startup/exit. If either fails, validation fails.

The editor import timeout is not a gameplay timing change, delay or performance
claim. Main game code and physics parameters were not modified.
