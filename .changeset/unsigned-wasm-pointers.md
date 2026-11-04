---
'sh-ast': patch
---

Read every pointer returned across the WASM boundary as unsigned 32-bit, so parses no longer fail with a `RangeError` once linear memory grows past 2 GiB. An address that cannot be viewed now surfaces as `ShInternalError`.
