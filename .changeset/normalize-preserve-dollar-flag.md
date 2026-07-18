---
'sh-ast': minor
---

Preserve `SglQuoted`/`DblQuoted`'s `Dollar` flag in the normalized AST. `normalize.ts`'s `POS_KEYS` denylist previously stripped the bare field name `Dollar` unconditionally — correct for `ParamExp.Dollar` (a position, already dropped by the generic position check), but wrong for `SglQuoted.Dollar`/`DblQuoted.Dollar`, which are `bool` flags marking `$'...'` (ANSI-C quoting) and `$"..."` (locale translation) respectively. Without the flag, `$'...'` was indistinguishable from plain `'...'` in the normalized tree (and likewise for `$"..."` vs `"..."`).

A normalized `SglQuoted`/`DblQuoted` node now carries a `dollar` boolean field it previously omitted entirely — a consumer-visible addition to the normalized output shape, hence the minor bump. `sh-ast/analyze`'s `resolveWord` (see its own changeset) is the first consumer that relies on this flag.
