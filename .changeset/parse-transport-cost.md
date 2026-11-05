---
'sh-ast': patch
---

Reduce `parseSync` and `parseWithPositionsSync` transport cost. The WASM shim now encodes syntax records with precomputed per-type plans, cheaper cycle tracking and a reused response buffer, and sends an ASCII-only response with compact File position tuples; the JavaScript side finds the response terminator natively, skips byte-string restoration when no byte strings are present, and restores positions during its single File validation pass. Parsed records, `GoString` values, position snapshots and supported-input error precedence are unchanged (pinned mvdan/sh v3.13.1).

Sparse list holes in caller-constructed records now produce `InputError` before transport; they are not explicit nullable elements. Empty arrays and explicit `null` entries retain their existing behavior.
