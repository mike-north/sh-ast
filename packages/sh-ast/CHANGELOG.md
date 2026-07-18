# sh-ast

## 0.1.0

### Minor Changes

- [#11](https://github.com/mike-north/sh-ast/pull/11) [`936c601`](https://github.com/mike-north/sh-ast/commit/936c6014f4f19fd701134d463ec368b6a0add5bb) Thanks [@mike-north](https://github.com/mike-north)! - Add `enumerateCommands` to `sh-ast/analyze`: finds every command invocation (`CallExpr`) reachable from a parsed tree, including ones hidden inside command/process substitutions nested in arguments, redirection targets, case subjects, loop word lists, assignment values, and test/arithmetic operands. Each `CommandSite` reports its resolved words (via `resolveWord`) and a `CommandContext` path describing how it's reached — `&&`/`||`/pipeline position, subshell, if/case branch, loop role, function name, background/negated/coproc — in source order. Facts only: no safety verdict, no command/wrapper allowlist or denylist.

  `enumerateCommands` traverses `|`/`|&`/`&&`/`||` chains of any length iteratively, so a long linear chain never risks a stack overflow. For genuinely nested structure (subshells within subshells, chained command/process substitutions, deeply nested `if`/`case`/loop/function/`time`/`{ }` bodies, chained `elif`), it now throws the new `ShAnalyzeMaxDepthError` rather than crashing or silently returning a truncated result once a defensive nesting-depth guard is exceeded — a fail-closed backstop against pathological/adversarial input.

- [#7](https://github.com/mike-north/sh-ast/pull/7) [`d051af4`](https://github.com/mike-north/sh-ast/commit/d051af42c746f6f42217902678a0407321e4a69a) Thanks [@mike-north](https://github.com/mike-north)! - Add the `sh-ast/analyze` subpath, with `resolveWord` as its first primitive: determines whether a `Word` node is statically a known string (single quoting, `$'...'` ANSI-C escapes, concatenated literals, and `DblQuoted` text with no expansions all count as static) and reports a neutral, extensible reason — `expansion`, `tilde`, `glob`, `brace`, `locale`, or `unsupported` — when it isn't. Bracket expressions (`[...]`) and `$"..."` locale-translated strings are recognized as non-static, and an unrepresentable `$'\U...'` ANSI-C code point reports `unsupported` rather than a false literal. An optional second `options.context` parameter (`'command-argument'` or `'assignment-value'`, default `'assignment-value'`) controls whether an assignment's colon-adjacent tilde (`PATH=/foo:~/bar`) is detected. Built against the pinned mvdan.cc/sh/v3 v3.13.1 parser; reports syntactic facts only, never a safety verdict.

- [#6](https://github.com/mike-north/sh-ast/pull/6) [`6cd00f4`](https://github.com/mike-north/sh-ast/commit/6cd00f4bfcc7cd1e73007ba84e49b42770c66e78) Thanks [@mike-north](https://github.com/mike-north)! - Fix the normalizer dropping `ForClause`/`WhileClause` loop bodies (the `do` statement list). Any `for`, `while`, or `until` loop's body is now reachable on the normalized node's `do` field — previously it was silently omitted entirely.

  Root cause: `normalize.ts`'s `POS_KEYS` denylist listed the bare field name `Do`, but mvdan/sh v3.13.1's `ForClause`/`WhileClause` structs use `Do` for two different fields — `DoPos Pos` (a position, correctly dropped) and `Do []*Stmt` (the loop body, a real child) — so the denylist entry discarded the statement list before it could become a normalized child.

  This changes normalized output for any source containing a `for`/`while`/`until` loop, hence the minor bump.

- [#12](https://github.com/mike-north/sh-ast/pull/12) [`b8bead0`](https://github.com/mike-north/sh-ast/commit/b8bead084c8274bfaf1daa7f2f0e01e0e7031f0b) Thanks [@mike-north](https://github.com/mike-north)! - Replace `normalize.ts`'s hand-maintained `POS_KEYS` bare-name denylist with a generated, per-(node type, field name) `position-fields` table (`tools/gen-visitor-keys`, pinned to mvdan.cc/sh/v3 v3.13.1), so the normalizer never has to guess whether a reused field name is a position from one struct or real data from another.

  This recovers three fields the old denylist wrongly dropped for _every_ node carrying a same-named field, even though none of them is a `Pos` in any mvdan/sh v3.13.1 struct:

  - `ForClause.Select` (`bool`) — marks a `select ... in ...; do ...; done` loop.
  - `WhileClause.Until` (`bool`) — marks an `until ...; do ...; done` loop.
  - `ArithmExp.Unsigned` / `ArithmCmd.Unsigned` (`bool`) — marks mksh's `$((# expr))` / `((# expr))` unsigned arithmetic.

  `Do` (`ForClause`/`WhileClause`'s loop body, issue [#2](https://github.com/mike-north/sh-ast/issues/2)) and `Dollar` (`SglQuoted`/`DblQuoted`'s ANSI-C-quoting flag, issue [#3](https://github.com/mike-north/sh-ast/issues/3)) were already fixed by earlier PRs; this generated table is what makes the whole collision class structurally impossible to reintroduce on a future mvdan/sh bump, rather than requiring another hand audit.

  Normalized output changes for any source containing a `select` loop, an `until` loop, or mksh unsigned arithmetic — previously these booleans were silently omitted — hence the minor bump.

- [#9](https://github.com/mike-north/sh-ast/pull/9) [`e6ceb37`](https://github.com/mike-north/sh-ast/commit/e6ceb377032763c068fa35f8b66b3875d94dda48) Thanks [@mike-north](https://github.com/mike-north)! - Preserve `SglQuoted`/`DblQuoted`'s `Dollar` flag in the normalized AST. `normalize.ts`'s `POS_KEYS` denylist previously stripped the bare field name `Dollar` unconditionally — correct for `ParamExp.Dollar` (a position, already dropped by the generic position check), but wrong for `SglQuoted.Dollar`/`DblQuoted.Dollar`, which are `bool` flags marking `$'...'` (ANSI-C quoting) and `$"..."` (locale translation) respectively. Without the flag, `$'...'` was indistinguishable from plain `'...'` in the normalized tree (and likewise for `$"..."` vs `"..."`).

  A normalized `SglQuoted`/`DblQuoted` node now carries a `dollar` boolean field it previously omitted entirely — a consumer-visible addition to the normalized output shape, hence the minor bump. `sh-ast/analyze`'s `resolveWord` (see its own changeset) is the first consumer that relies on this flag.
