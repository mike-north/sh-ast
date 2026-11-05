---
'sh-ast': minor
---

`resolveArgv0` now follows a transparent wrapper named by absolute path: `/usr/bin/env bash x`, `/usr/bin/sudo -u alice rm x` and `/usr/bin/nice -n 5 rm x` resolve through to `bash` and `rm` instead of stopping at the wrapper. Exact names anywhere in the table take precedence; otherwise an absolute path's final segment can match a `WrapperSpec.names` entry, including custom plain names. The chain keeps the word as written (`/usr/bin/env`). Relative and trailing-slash paths have no final-segment fallback but still match explicitly listed custom names. Dynamic words (`"$dir/env"`) are not followed. Matching assumes the selected grammar without consulting `PATH` or the filesystem. This changes results on unchanged input: consumers that relied on `/usr/bin/sudo` being the effective command now see the wrapped command, with the wrapper still in `chain`. The parser remains based on mvdan/sh v3.13.1 with the documented maintained patches.
