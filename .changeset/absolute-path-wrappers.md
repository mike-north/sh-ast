---
'sh-ast': minor
---

`resolveArgv0` now follows a transparent wrapper named by absolute path: `/usr/bin/env bash x`, `/usr/bin/sudo -u alice rm x` and `/usr/bin/nice -n 5 rm x` resolve through to `bash` and `rm` instead of stopping at the wrapper. A word is matched when it starts with `/` and its final path segment equals a `WrapperSpec.names` entry; the chain keeps the word as written (`/usr/bin/env`). Relative paths (`./env`, `bin/env`), a trailing-slash path and dynamic words (`"$dir/env"`) are not followed, and `PATH` and the filesystem are never consulted. This changes results on unchanged input: consumers that relied on `/usr/bin/sudo` being the effective command now see the wrapped command, with the wrapper still in `chain`. Pinned mvdan/sh remains v3.13.1.
