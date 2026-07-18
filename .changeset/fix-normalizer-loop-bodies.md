---
'sh-ast': minor
---

Fix the normalizer dropping `ForClause`/`WhileClause` loop bodies (the `do` statement list). Any `for`, `while`, or `until` loop's body is now reachable on the normalized node's `do` field — previously it was silently omitted entirely.

Root cause: `normalize.ts`'s `POS_KEYS` denylist listed the bare field name `Do`, but mvdan/sh v3.13.1's `ForClause`/`WhileClause` structs use `Do` for two different fields — `DoPos Pos` (a position, correctly dropped) and `Do []*Stmt` (the loop body, a real child) — so the denylist entry discarded the statement list before it could become a normalized child.

This changes normalized output for any source containing a `for`/`while`/`until` loop, hence the minor bump.
