---
'sh-ast': minor
---

`sh-ast/analyze` now re-exports `ShAstError` (the shared base class every error the analyze layer throws — `ShAnalyzeMaxDepthError`, `ShAnalyzeInvalidWrapperSpecError` — extends) and `ShNode`/`Position` (the node/position types the subpath's public surface consumes and exposes). A consumer of `sh-ast/analyze` can now `catch`/reference these directly, without also importing from the root `sh-ast` entry point. This also clears the two pre-existing, accepted `ae-forgotten-export` API Extractor warnings at the top of `packages/sh-ast/api-report/sh-ast-analyze.api.md` (see #23).
