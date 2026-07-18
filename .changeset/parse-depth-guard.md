---
'sh-ast': minor
---

`parseSync` now rejects pathologically deep/nested shell source (deeply nested subshells, command substitutions, control-flow bodies, or very long pipeline/list chains) with a typed, catchable `ShParseMaxDepthError` (`code: 'ESLINT_SH_PARSE_MAX_DEPTH'`) instead of letting it reach the WASM parser, where sufficiently deep nesting causes an uncatchable native stack overflow. The guard runs a conservative, single-pass estimate of the input's structural nesting depth before ever invoking the shared WASM instance, so pathological input never risks crashing (or wedging) that instance for subsequent calls. Realistic scripts, including deeply-but-legitimately nested ones, are unaffected.
