---
'sh-ast': minor
---

Renamed the public error taxonomy in `sh-ast/errors` to drop pre-spinout `eslint-sh`/`@eslint-sh/bridge` naming, now that this package ships standalone. This is a breaking rename with **no back-compat aliases** — 0.x, so it ships as `minor` rather than `major` per this repo's pre-1.0 policy.

`code` string literals:

- `ESLINT_SH_PARSE_ERROR` → `SH_AST_PARSE_ERROR`
- `ESLINT_SH_INVALID_DIALECT` → `SH_AST_INVALID_DIALECT`
- `ESLINT_SH_BRIDGE_INTERNAL` → `SH_AST_INTERNAL`
- `ESLINT_SH_ANALYZE_MAX_DEPTH` → `SH_AST_ANALYZE_MAX_DEPTH`
- `ESLINT_SH_PARSE_MAX_DEPTH` → `SH_AST_PARSE_MAX_DEPTH`
- `ESLINT_SH_ANALYZE_INVALID_WRAPPER_SPEC` → `SH_AST_ANALYZE_INVALID_WRAPPER_SPEC`

Class renames:

- `ShBridgeError` (abstract base) → `ShAstError`
- `ShBridgeInternalError` → `ShInternalError`

All other exported error classes (`ShParseError`, `ShInvalidDialectError`, `ShAnalyzeMaxDepthError`, `ShParseMaxDepthError`, `ShAnalyzeInvalidWrapperSpecError`) are unchanged — they were already product-neutral. No error semantics, messages, or throw sites changed; this is an identifier rename only.
