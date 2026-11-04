---
'sh-ast': patch
---

Fix a Go runtime abort (`fatal error: found bad pointer in Go heap`) that could occur once the WASM heap had grown, after which every later call failed. The WASM shim is now built with Go 1.26.10, which includes the upstream fix for golang/go#80472. Parse, position, and print output is unchanged.
