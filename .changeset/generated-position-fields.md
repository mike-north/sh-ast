---
'sh-ast': minor
---

Replace `normalize.ts`'s hand-maintained `POS_KEYS` bare-name denylist with a generated, per-(node type, field name) `position-fields` table (`tools/gen-visitor-keys`, pinned to mvdan.cc/sh/v3 v3.13.1), so the normalizer never has to guess whether a reused field name is a position from one struct or real data from another.

This recovers three fields the old denylist wrongly dropped for _every_ node carrying a same-named field, even though none of them is a `Pos` in any mvdan/sh v3.13.1 struct:

- `ForClause.Select` (`bool`) — marks a `select ... in ...; do ...; done` loop.
- `WhileClause.Until` (`bool`) — marks an `until ...; do ...; done` loop.
- `ArithmExp.Unsigned` / `ArithmCmd.Unsigned` (`bool`) — marks mksh's `$((# expr))` / `((# expr))` unsigned arithmetic.

`Do` (`ForClause`/`WhileClause`'s loop body, issue #2) and `Dollar` (`SglQuoted`/`DblQuoted`'s ANSI-C-quoting flag, issue #3) were already fixed by earlier PRs; this generated table is what makes the whole collision class structurally impossible to reintroduce on a future mvdan/sh bump, rather than requiring another hand audit.

Normalized output changes for any source containing a `select` loop, an `until` loop, or mksh unsigned arithmetic — previously these booleans were silently omitted — hence the minor bump.
