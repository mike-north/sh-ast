---
'sh-ast': patch
---

Reduce `parseSync` and `parseWithPositionsSync` transport cost. The WASM shim now encodes syntax records with precomputed per-type plans, cheaper cycle tracking and a reused response buffer, and sends an ASCII-only response with compact File position tuples; the JavaScript side finds the response terminator natively, skips byte-string restoration when no byte strings are present, and restores positions during its single File validation pass. Parsed records, `GoString` values, position snapshots and error precedence are unchanged (pinned mvdan/sh v3.13.1). The shim also builds its syntax interface tables at startup, avoiding a Go js/wasm runtime fault that could abort the WASM instance during large parses.
